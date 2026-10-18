import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, symlink, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lockOutput } from '../../dist/capture/lock.js';
import { evidenceStore } from '../../dist/capture/store.js';
import { reconcileManifest } from '../../dist/manifest/reconcile.js';

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'device-annotate-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const owner = { kind: 'one-off', step: 'sample' };
const manifest = () => reconcileManifest({ owner, spec: { criteria: [{ criterion: 'Neutral evidence', steps: { sample: {} } }] } });

test('capture and cleanup share immediate exclusion across output aliases', async (t) => {
  const dir = await folder(t), alias = `${dir}-alias`;
  await symlink(dir, alias); t.after(() => rm(alias));
  const lock = await lockOutput(dir);
  await assert.rejects(lockOutput(alias), { code: 'OUTPUT_BUSY' });
  await lock.release();
  const next = await lockOutput(alias); assert.equal(next.directory, lock.directory);
  await next.release(); await next.release();
});

test('concurrent claimants admit exactly one owner', async (t) => {
  const dir = await folder(t);
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => lockOutput(dir)));
  const admitted = results.filter((result) => result.status === 'fulfilled');
  assert.equal(admitted.length, 1);
  assert.ok(results.filter((result) => result.status === 'rejected').every((result) => result.reason.code === 'OUTPUT_BUSY'));
  await admitted[0].value.release();
});

test('a killed owner is recovered without an age-based lease', async (t) => {
  const dir = await folder(t);
  const module = new URL('../../dist/capture/lock.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { lockOutput } from ${JSON.stringify(module)}; await lockOutput(process.argv[1]); console.log('locked'); setInterval(() => {}, 1000);`, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  await assert.rejects(lockOutput(dir), { code: 'OUTPUT_BUSY' });
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const recovered = await lockOutput(dir); await recovered.release();
});

test('malformed and foreign lock owners fail closed', async (t) => {
  const dir = await folder(t); const lock = await lockOutput(dir); await lock.release();
  await symlink(JSON.stringify({ host: `${hostname()}-foreign`, pid: 123 }), join(dir, '.device-proof-lock/2.owner'));
  await assert.rejects(lockOutput(dir), { code: 'OUTPUT_BUSY' });
});

test('immutable attempts exclusively save files and publish validated ledgers', async (t) => {
  const dir = await folder(t), store = evidenceStore(dir);
  const a = await store.allocate('sample'), b = await store.allocate('sample');
  assert.notEqual(a.attemptId, b.attemptId);
  const path = await a.save('raw', Uint8Array.of(1, 2, 3));
  await assert.rejects(a.save('raw', Uint8Array.of(9)), { code: 'EEXIST' });
  assert.deepEqual([...await readFile(join(dir, path))], [1, 2, 3]);
  await store.publish(manifest());
  assert.deepEqual(await store.read(owner), manifest());
  assert.ok(!(await readdir(dir)).some((file) => file.endsWith('.tmp')));
});

test('invalid replacement and ownership refusals preserve saved manifest bytes', async (t) => {
  const dir = await folder(t), store = evidenceStore(dir);
  await store.publish(manifest()); const before = await readFile(join(dir, 'manifest.json'));
  await assert.rejects(store.publish({ ...manifest(), result: 'passed' }));
  await assert.rejects(store.read({ kind: 'one-off', step: 'other' }), (error) => error.result.error.code === 'OUTPUT_OWNER_MISMATCH');
  assert.deepEqual(await readFile(join(dir, 'manifest.json')), before);
  await writeFile(join(dir, 'manifest.json'), '{broken');
  await assert.rejects(store.read(owner), { code: 'OUTPUT_OWNER_INVALID' });
});

test('managed directory symlinks cannot redirect artifacts outside the folder', async (t) => {
  const dir = await folder(t), outside = await folder(t);
  await symlink(outside, join(dir, 'attempts'));
  await assert.rejects(evidenceStore(dir).allocate('sample'), { code: 'ARTIFACT_PATH_UNSAFE' });
  assert.deepEqual(await readdir(outside), []);
});

test('process interruption before atomic rename preserves the previous ledger and permits recovery', async (t) => {
  const dir = await folder(t), store = evidenceStore(dir);
  await store.publish(manifest());
  const before = await readFile(join(dir, 'manifest.json'));
  const module = new URL('../../dist/capture/store.js', import.meta.url).href;
  const lockModule = new URL('../../dist/capture/lock.js', import.meta.url).href;
  const script = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    fs.rename = async () => { console.log('before-rename'); await new Promise(() => setInterval(() => {}, 1000)); };
    syncBuiltinESMExports();
    const { evidenceStore } = await import(${JSON.stringify(module)});
    const { lockOutput } = await import(${JSON.stringify(lockModule)});
    const directory = process.argv[1];
    await lockOutput(directory);
    const store = evidenceStore(directory);
    const ledger = await store.read();
    ledger.retention.maxAttemptsPerStep = 3;
    await store.publish(ledger);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  assert.deepEqual(await readFile(join(dir, 'manifest.json')), before);
  assert.ok((await readdir(dir)).some((name) => name.startsWith('.manifest-')));
  const recovered = await lockOutput(dir);
  try {
    assert.deepEqual(await store.read(owner), manifest());
    await store.publish(manifest());
  } finally { await recovered.release(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile, mkdir, link, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { cleanup } from '../../dist/capture/cleanup.js';
import { evidenceStore } from '../../dist/capture/store.js';
import { manifestSchema } from '../../dist/manifest/schema.js';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'device-proof-cleanup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(new URL('../../examples/manifest-ledger.json', import.meta.url)));
  manifest.retention = { maxAttemptsPerStep: 0, maxAgeDays: 0, maxBytes: 0 };
  const attempts = [...manifest.history, ...manifest.criteria.flatMap((group) => group.steps.filter((step) => step.result !== 'incomplete'))];
  for (const attempt of attempts) {
    attempt.recordings = [];
    for (const key of ['image', 'raw', 'snapshot']) if (attempt[key]) {
      const file = join(dir, attempt[key]); await mkdir(dirname(file), { recursive: true }); await writeFile(file, `neutral ${attempt.attemptId}`);
    }
  }
  manifestSchema.parse(manifest);
  await evidenceStore(dir).publish(manifest);
  return { dir, manifest, current: manifest.criteria.flatMap((group) => group.steps).find((step) => step.result !== 'incomplete') };
}

test('preview preserves bytes and apply removes history only, repeatedly', async (t) => {
  const { dir, manifest, current } = await setup(t);
  assert.ok(manifest.history.length);
  const before = await readFile(join(dir, 'manifest.json'));
  const preview = await cleanup({ outDir: dir });
  assert.equal(preview.applied, false); assert.ok(preview.files.length);
  assert.deepEqual(await readFile(join(dir, 'manifest.json')), before);
  for (const path of preview.files) assert.ok(await readFile(join(dir, path)));
  const applied = await cleanup({ outDir: dir, apply: true });
  assert.deepEqual(applied.files, preview.files);
  assert.ok(await readFile(join(dir, current.raw)));
  for (const path of preview.files) await assert.rejects(readFile(join(dir, path)), { code: 'ENOENT' });
  assert.deepEqual((await cleanup({ outDir: dir, apply: true })).files, []);
});

test('caller-owned hardlink aliases remain intact when their history record is pruned', async (t) => {
  const { dir, manifest, current } = await setup(t);
  const historical = manifest.history.find((attempt) => attempt.raw);
  const recording = join(dir, 'caller-recording.mp4');
  await link(join(dir, historical.raw), recording); current.recordings = [recording];
  await evidenceStore(dir).publish(manifest);
  const before = await readFile(recording);
  const result = await cleanup({ outDir: dir, apply: true });
  assert.ok(!result.files.includes(historical.raw));
  assert.deepEqual(await readFile(recording), before);
  assert.deepEqual(await readFile(join(dir, historical.raw)), before);
});

test('interrupted cleanup resumes with already removed historical files', async (t) => {
  const { dir, manifest } = await setup(t);
  const historical = manifest.history.find((attempt) => attempt.raw);
  await unlink(join(dir, historical.raw));
  await cleanup({ outDir: dir, apply: true });
  assert.equal((await evidenceStore(dir).read()).history.length, 0);
});

test('managed symlinks and unavailable recording identities fail before deletion', async (t) => {
  const { dir, manifest, current } = await setup(t);
  current.recordings = [join(dir, 'missing.mp4')]; await evidenceStore(dir).publish(manifest);
  await assert.rejects(cleanup({ outDir: dir, apply: true }), { code: 'RECORDING_IDENTITY_UNAVAILABLE' });
  current.recordings = []; await evidenceStore(dir).publish(manifest);
  const historical = manifest.history.find((attempt) => attempt.raw);
  await unlink(join(dir, historical.raw)); await symlink(join(dir, current.raw), join(dir, historical.raw));
  await assert.rejects(cleanup({ outDir: dir, apply: true }), { code: 'ARTIFACT_PATH_UNSAFE' });
  assert.ok(await readFile(join(dir, current.raw)));
});

test('finished-run cleanup previews current artifacts and repeated application is harmless', async (t) => {
  const { dir, current } = await setup(t);
  const preview = await cleanup({ outDir: dir, finished: true });
  assert.ok(preview.files.includes(current.raw));
  assert.ok(await readFile(join(dir, current.raw)));
  await cleanup({ outDir: dir, finished: true, apply: true });
  const manifest = await evidenceStore(dir).read();
  assert.equal(manifest.result, 'incomplete'); assert.equal(manifest.history.length, 0);
  assert.deepEqual((await cleanup({ outDir: dir, finished: true, apply: true })).files, []);
});

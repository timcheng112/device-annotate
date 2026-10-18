import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

// The offline consumer must never initiate network IO, including through dependencies.
const refuseNetwork = () => { throw new Error('Unexpected network request in offline package verification'); };
net.connect = net.createConnection = http.request = http.get = https.request = https.get = refuseNetwork;
globalThis.fetch = refuseNetwork;
syncBuiltinESMExports();
const { validate, capture, cleanup } = await import('device-annotate');
const entry = import.meta.resolve('device-annotate');
const packageRoot = new URL('../', entry);
const cli = fileURLToPath(new URL('bin/device-annotate.mjs', packageRoot));
function command(args, status = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', AGENT_DEVICE_STATE_DIR: resolve('no-daemon') }, timeout: 30_000 });
  assert.equal(result.status, status, result.stderr || result.stdout);
  return result.stdout;
}
const help = command(['help']);
const pkg = JSON.parse(await readFile(new URL('package.json', packageRoot)));
assert.ok(help.startsWith(`# device-annotate ${pkg.version}\n`));
for (const args of [['--help'], ['-h'], ['validate', '--help'], ['capture', '--help'], ['cleanup', '--help']]) assert.equal(command(args), help);
const specs = [...help.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1]);
assert.ok(specs.length);
for (const [index, source] of specs.entries()) {
  assert.equal(validate(source).valid, true);
  await writeFile(`example-${index}.yaml`, source);
  assert.equal(JSON.parse(command(['validate', `example-${index}.yaml`])).valid, true);
}
assert.equal(JSON.parse(command(['validate', 'missing.yaml'], 2)).valid, false);
assert.equal((await capture({ step: 'sample', criterion: 'Offline preflight', out: 'preflight', recordings: ['missing.mp4'] })).error.code, 'RECORDING_UNAVAILABLE');
assert.equal(JSON.parse(command(['capture', '--step', 'sample', '--criterion', 'The total is displayed', '--box', 'id="cart-total"', '--out', 'no-session'], 2)).error.code, 'DAEMON_UNAVAILABLE');

// Replace only the device boundary. Exercise installed rendering, assets, persistence, and public cleanup.
const { runCapture } = await import(new URL('capture/public.js', entry));
const snapshot = JSON.parse(await readFile('fixture/capture.snapshot.json'));
const screenshot = await readFile('fixture/capture.raw.png');
const environment = JSON.parse(await readFile('environment.json'));
const adapter = async () => ({ platform: 'ios', wait: async () => {}, environment: async () => environment,
  snapshot: async () => snapshot, screenshot: async () => screenshot, close: async () => {} });
for (const [name, config, expected] of [
  ['pass', { checks: [{ target: 'id="center"', expect: { exists: true } }] }, 'passed'],
  ['fail', { checks: [{ target: 'id="center"', expect: { text: 'wrong' } }] }, 'failed'],
  ['error', { annotate: [{ mask: { target: 'id="missing"' } }] }, 'error'],
]) {
  const out = resolve(name);
  const attempt = await runCapture({ step: 'sample', criterion: 'Neutral installed-package evidence', out, config }, adapter);
  assert.equal(attempt.result, expected, JSON.stringify(attempt));
  assert.equal(Boolean(attempt.image), name !== 'error');
  assert.deepEqual(await readFile(resolve(out, attempt.raw)), screenshot);
  if (attempt.image) assert.ok((await readFile(resolve(out, attempt.image))).length > 100);
  assert.equal(JSON.parse(await readFile(resolve(out, 'manifest.json'))).criteria[0].steps[0].attemptId, attempt.attemptId);
  assert.equal((await cleanup({ outDir: out })).result, 'passed');
  if (expected === 'error') {
    assert.equal(JSON.parse(command(['cleanup', out, '--finished'], 2)).error.code, 'RUN_NOT_FINISHED');
  } else {
    assert.equal(JSON.parse(command(['cleanup', out, '--finished'])).result, 'passed');
    assert.equal((await cleanup({ outDir: out, finished: true, apply: true })).result, 'passed');
  }
}
console.log('Installed CLI help/examples/preflight, Node API, pass/fail/error rendering, raw artifacts, manifest, and cleanup passed with network calls blocked in the consumer process.');

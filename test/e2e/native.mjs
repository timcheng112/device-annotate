// Explicit native gate. The caller opens only the neutral fixture with agent-device first.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDeviceAdapter } from '../../dist/capture/device.js';
import { verifyNativeEnvironment } from './environment-gate.mjs';

const platform = process.argv[2];
assert.ok(['ios', 'android'].includes(platform), 'Usage: node test/e2e/native.mjs ios|android [output-directory]');
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const output = process.argv[3] ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), `device-annotate-native-${platform}-`));
await mkdir(output, { recursive: true });
const adapter = await localDeviceAdapter({ cwd, platform });
try {
  const snapshot = await adapter.snapshot();
  assert.equal(snapshot.appBundleId ?? snapshot.identifiers?.appId ?? snapshot.identifiers?.package, 'dev.deviceproof.fixture', 'Only the neutral app may enter this native gate');
  assert.ok(snapshot.nodes.some((node) => node.identifier?.endsWith('center') || node.label === 'center'));
} finally { await adapter.close(); }
const summary = [];
const center = platform === 'android' ? 'id="dev.deviceproof.fixture:id/center"' : 'id="center"';
for (const [name, config, expected, exit] of [
  ['pass', { checks: [{ target: center, expect: { exists: true } }] }, 'passed', 0],
  ['fail', { checks: [{ target: center, expect: { text: 'deliberately wrong' } }] }, 'failed', 1],
  ['error', { annotate: [{ mask: { target: 'id="missing-neutral-target"' } }] }, 'error', 2],
]) {
  const specPath = join(output, `${name}.json`);
  const out = join(output, name);
  await writeFile(specPath, JSON.stringify({ out, criteria: [{ criterion: `Neutral ${platform} ${name} evidence`, steps: { sample: config } }] }));
  const start = performance.now();
  const result = spawnSync(process.execPath, ['bin/device-annotate.mjs', 'capture', specPath, '--step', 'sample', '--platform', platform], { cwd, encoding: 'utf8', timeout: 300_000 });
  assert.equal(result.status, exit, result.stderr || result.stdout);
  const attempt = JSON.parse(result.stdout);
  assert.equal(attempt.result, expected, JSON.stringify(attempt.error));
  const unavailable = verifyNativeEnvironment(platform, attempt.environment);
  assert.ok(attempt.raw && attempt.snapshot);
  assert.equal(Boolean(attempt.image), name !== 'error');
  for (const kind of ['raw', 'snapshot', 'image']) if (attempt[kind]) assert.ok((await readFile(join(out, attempt[kind]))).length);
  const ledger = JSON.parse(await readFile(join(out, 'manifest.json')));
  assert.equal(ledger.criteria[0].steps[0].attemptId, attempt.attemptId);
  summary.push({ name, result: attempt.result, exit, elapsedMs: Math.round(performance.now() - start), image: attempt.image ? join(out, attempt.image) : null, unavailable });
}
// Exercise the real environment gate and ledger reconciliation through the CLI.
const flowPath = join(output, 'flow.json');
const flowOut = join(output, 'flow');
const buildPath = join(output, 'build.json');
const nativeFile = platform === 'android' ? join(cwd, 'scripts/m0/.local/build/fixture.apk') : join(cwd, 'scripts/m0/.local/build/DeviceProofFixture.app/DeviceProofFixture');
const hash = createHash('sha256').update(await readFile(nativeFile)).digest('hex');
await writeFile(buildPath, JSON.stringify({ appId: 'dev.deviceproof.fixture', native: `sha256:${hash}`, runtime: { kind: 'embedded' } }));
const saveFlow = async (first) => writeFile(flowPath, JSON.stringify({ out: flowOut, criteria: [{ criterion: 'Neutral multi-step flow', steps: { [first]: {}, second: {} } }] }));
await saveFlow('first');
const runStep = (step) => {
  const result = spawnSync(process.execPath, ['bin/device-annotate.mjs', 'capture', flowPath, '--step', step, '--platform', platform, '--build', buildPath], { cwd, encoding: 'utf8', timeout: 300_000 });
  return { status: result.status, attempt: JSON.parse(result.stdout) };
};
const first = runStep('first');
if (summary[0].unavailable.length) {
  assert.equal(first.status, 2);
  assert.equal(first.attempt.error.code, 'ENVIRONMENT_UNAVAILABLE');
  assert.equal(first.attempt.raw, undefined);
  summary.push({ name: 'multi-step-environment-gate', result: 'refused-as-required' });
} else {
  assert.equal(first.status, 0, JSON.stringify(first.attempt.error));
  assert.equal(runStep('second').status, 0);
  const before = JSON.parse(await readFile(join(flowOut, 'manifest.json')));
  assert.equal(before.result, 'passed');
  const secondId = before.criteria[0].steps.find((step) => step.step === 'second').attemptId;
  assert.equal(runStep('first').status, 0);
  await saveFlow('renamed');
  assert.equal(runStep('renamed').status, 0);
  const after = JSON.parse(await readFile(join(flowOut, 'manifest.json')));
  assert.equal(after.result, 'passed');
  assert.equal(after.criteria[0].steps.find((step) => step.step === 'second').attemptId, secondId);
  assert.ok(after.history.some((step) => step.step === 'first'));
  for (const step of [...after.history, ...after.criteria[0].steps]) {
    for (const kind of ['raw', 'snapshot', 'image']) if (step[kind]) assert.ok((await readFile(join(flowOut, step[kind]))).length);
  }
  summary.push({ name: 'multi-step-replace-rename', result: 'passed' });
}
await writeFile(join(output, 'summary.json'), JSON.stringify({ platform, capturedAt: new Date().toISOString(), cases: summary }, null, 2) + '\n');
console.log(JSON.stringify({ platform, output, cases: summary }, null, 2));

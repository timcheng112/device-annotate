import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeCapture } from '../../dist/capture/execute.js';
import { prepareOneOffCapture, prepareSpecCapture } from '../../dist/spec/capture-input.js';
import { lockOutput } from '../../dist/capture/lock.js';

const root = new URL('../../', import.meta.url);
const snapshot = JSON.parse(await readFile(new URL('test/fixtures/capture-spike/ios/capture.snapshot.json', root)));
const screenshot = await readFile(new URL('test/fixtures/capture-spike/ios/capture.raw.png', root));
const environment = JSON.parse(await readFile(new URL('examples/environment.complete.json', root)));
const build = { appId: 'dev.deviceproof.fixture', native: 'neutral-build', runtime: { kind: 'embedded' } };
async function setup(t, config = {}) {
  const outDir = await mkdtemp(join(tmpdir(), 'device-proof-execute-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const calls = [];
  const adapter = {
    platform: 'ios', async environment() { calls.push('environment'); return environment; },
    async wait() { calls.push('wait'); }, async snapshot() { calls.push('snapshot'); return snapshot; },
    async screenshot() { calls.push('screenshot'); return screenshot; }, async close() { calls.push('close'); },
  };
  const input = { prepared: prepareOneOffCapture({ step: 'sample', criterion: 'Neutral fixture evidence', config }), owner: { kind: 'one-off', step: 'sample' }, outDir, recordings: [] };
  return { input, calls, adapter, dependencies: { async adapter() { calls.push('factory'); return adapter; } } };
}
for (const [name, config, result] of [
  ['pass', { checks: [{ target: 'id="center"', expect: { exists: true } }] }, 'passed'],
  ['assertion failure', { checks: [{ target: 'id="center"', expect: { text: 'wrong' } }] }, 'failed'],
  ['partial evidence error', { annotate: [{ box: { target: 'id="missing"' } }] }, 'error'],
  ['mask omission', { annotate: [{ mask: { target: 'id="missing"' } }] }, 'error'],
]) test(`integration produces ${name} with durable matching artifacts`, async (t) => {
  const state = await setup(t, config);
  const output = await executeCapture(state.input, state.dependencies);
  assert.equal(output.attempt.result, result);
  assert.equal(output.attempt.image !== undefined, name !== 'mask omission');
  assert.deepEqual(await readFile(join(output.directory, output.attempt.raw)), screenshot);
  assert.deepEqual(JSON.parse(await readFile(join(output.directory, output.attempt.snapshot))), snapshot);
  assert.deepEqual(JSON.parse(await readFile(join(output.directory, 'manifest.json'))), output.manifest);
  assert.deepEqual(state.calls, ['factory', 'environment', 'wait', 'snapshot', 'screenshot', 'snapshot', 'environment', 'close']);
});
test('rendering failure preserves completed checks and audit artifacts without image', async (t) => {
  const state = await setup(t, { checks: [{ target: 'id="center"', expect: { exists: true } }] });
  const output = await executeCapture(state.input, { ...state.dependencies, async renderer() { return { render() { throw new Error('render failed'); } }; } });
  assert.equal(output.attempt.result, 'error'); assert.equal(output.attempt.checkCounts.passed, 1);
  assert.ok(output.attempt.raw); assert.ok(output.attempt.snapshot); assert.equal(output.attempt.image, undefined);
});
test('busy and ownership refusals occur before the lazy device factory', async (t) => {
  const state = await setup(t);
  const held = await lockOutput(state.input.outDir);
  await assert.rejects(executeCapture(state.input, state.dependencies), { code: 'OUTPUT_BUSY' });
  assert.deepEqual(state.calls, []); await held.release();
  await executeCapture(state.input, state.dependencies); state.calls.length = 0;
  await assert.rejects(executeCapture({ ...state.input, owner: { kind: 'one-off', step: 'different' } }, state.dependencies));
  assert.deepEqual(state.calls, []);
});
test('a newer capture error replaces a pass without borrowing its image', async (t) => {
  const state = await setup(t);
  const before = await executeCapture(state.input, state.dependencies);
  state.adapter.wait = async () => { throw new Error('device unavailable'); };
  const after = await executeCapture(state.input, state.dependencies);
  assert.equal(after.attempt.result, 'error'); assert.equal(after.attempt.image, undefined);
  assert.equal(after.manifest.history[0].attemptId, before.attempt.attemptId);
  assert.ok((await readFile(join(after.directory, before.attempt.image))).length);
});
test('multi-step captures aggregate and replace without double counting', async (t) => {
  const state = await setup(t);
  const spec = { criteria: [{ criterion: 'Two neutral observations', steps: { first: { checks: [{ target: 'id="center"', expect: { exists: true } }] }, second: {} } }] };
  const input = (step) => ({ ...state.input, owner: { kind: 'spec', specPath: '/neutral/spec.yaml' }, prepared: prepareSpecCapture({ spec, step, build }) });
  const first = await executeCapture(input('first'), state.dependencies);
  assert.equal(first.manifest.result, 'incomplete');
  const second = await executeCapture(input('second'), state.dependencies);
  assert.equal(second.manifest.result, 'passed'); assert.equal(second.manifest.checkCounts.total, 1);
  assert.equal(second.manifest.criteria[0].steps[0].attemptId, first.attempt.attemptId);
  const replacement = await executeCapture(input('first'), state.dependencies);
  assert.equal(replacement.manifest.checkCounts.total, 1); assert.equal(replacement.manifest.history.length, 1);
});

test('unknown environment blocks multi-step capture before screenshot work', async (t) => {
  const state = await setup(t);
  const partial = structuredClone(environment);
  partial.display.textSize = null;
  partial.unavailable = [{ path: ['display', 'textSize'], message: 'Text size could not be observed.' }];
  state.adapter.environment = async () => partial;
  const prepared = prepareSpecCapture({ spec: { criteria: [{ criterion: 'Neutral flow', steps: { first: {}, second: {} } }] }, step: 'first', build });
  const output = await executeCapture({ ...state.input, prepared, owner: { kind: 'spec', specPath: '/neutral/spec.yaml' } }, state.dependencies);
  assert.equal(output.attempt.error.code, 'ENVIRONMENT_UNAVAILABLE');
  assert.deepEqual(state.calls, ['factory', 'close']);
  assert.equal(output.attempt.raw, undefined);
});

test('environment changes during capture preserve raw evidence and refuse evaluation', async (t) => {
  const state = await setup(t);
  let reads = 0;
  state.adapter.environment = async () => {
    const next = structuredClone(environment);
    if (++reads > 1) next.display.appearance = next.display.appearance === 'dark' ? 'light' : 'dark';
    return next;
  };
  const output = await executeCapture(state.input, state.dependencies);
  assert.equal(output.attempt.error.code, 'ENVIRONMENT_CHANGED');
  assert.ok(output.attempt.raw && output.attempt.snapshot);
  assert.equal(output.attempt.image, undefined); assert.deepEqual(output.attempt.checks, []);
});

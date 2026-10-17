import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { reconcileManifest, replaceAttempt } from '../../dist/manifest/reconcile.js';
import { planAttemptArtifacts } from '../../dist/manifest/artifacts.js';
import { summarizeManifest } from '../../dist/manifest/schema.js';
import { validate } from '../../dist/index.js';

const example = JSON.parse(readFileSync(new URL('../../examples/manifest-ledger.json', import.meta.url)));
const original = example.criteria[0].steps[0];
const clone = (value) => structuredClone(value);
const specFor = (attempt = original) => ({ criteria: [{ criterion: attempt.configuration.criterion, steps: { [attempt.step]: { annotate: attempt.configuration.annotate, checks: attempt.configuration.checks, crop: attempt.configuration.crop } } }] });
const args = (patch = {}) => ({ spec: specFor(), owner: example.owner, previous: example, build: original.build, environment: original.environment, ...patch });
const steps = (manifest) => manifest.criteria.flatMap((group) => group.steps);
function attempt(id, name = original.step, patch = {}) {
  const value = { ...clone(original), step: name, attemptId: `${String(id).padStart(8,'0')}-0000-4000-8000-000000000000`, ...patch };
  const { directory, ...paths } = planAttemptArtifacts({ step: value.step, attemptId: value.attemptId });
  return { ...value, ...paths };
}
function twoStep() {
  const value = clone(example);
  value.criteria[0].steps.push(attempt(3, 'before'));
  return summarizeManifest(value);
}
function specFrom(manifest) {
  return { criteria: manifest.criteria.map((group) => ({ criterion: group.criterion, steps: Object.fromEntries(group.steps.map((step) => [step.step, { annotate: clone(step.configuration.annotate), checks: clone(step.configuration.checks), crop: clone(step.configuration.crop) }])) })) };
}

test('fresh manifest has incomplete steps and zero evaluated assertions', () => {
  const result = reconcileManifest({ spec: specFor(), owner: example.owner });
  assert.equal(result.result, 'incomplete'); assert.deepEqual(result.checkCounts, { total: 0, passed: 0, failed: 0 });
  assert.equal(steps(result)[0].attemptId, undefined);
});

test('unchanged steps retain their original capture and provenance without mutation', () => {
  const before = clone(example), result = reconcileManifest(args());
  assert.deepEqual(result, example); assert.deepEqual(example, before);
  assert.notEqual(result, example);
});

test('formatting-only YAML changes and object property ordering preserve results', () => {
  const yaml = `# Comment\ncriteria:\n  - criterion: ${JSON.stringify(original.configuration.criterion)}\n    steps:\n      after:\n        checks:\n          - expect: {text: "£12.00"}\n            target: 'id="cart-total"'\n`;
  const validated = validate(yaml); assert.equal(validated.valid, true);
  assert.equal(reconcileManifest(args({ spec: validated.spec })).result, 'passed');
});

for (const [name, change] of [
  ['selector', (s) => s.criteria[0].steps.after.checks[0].target = 'id=other'],
  ['assertion', (s) => s.criteria[0].steps.after.checks[0].expect.text = '£13.00'],
  ['annotation', (s) => s.criteria[0].steps.after.annotate.push({ box: { target: 'id=other' } })],
]) test(`${name} edits invalidate only the affected step`, () => {
  const previous = twoStep(), spec = specFrom(previous); change(spec);
  const result = reconcileManifest(args({ previous, spec }));
  assert.deepEqual(steps(result).map((step) => step.result), ['incomplete', 'passed']);
  assert.equal(result.checkCounts.total, 1); assert.ok(result.history.some((step) => step.attemptId === original.attemptId));
});

test('criterion changes invalidate all dependent steps and preserve the historical wording', () => {
  const previous = twoStep(), spec = specFrom(previous); spec.criteria[0].criterion = 'Changed criterion';
  const result = reconcileManifest(args({ previous, spec }));
  assert.ok(steps(result).every((step) => step.result === 'incomplete'));
  assert.equal(result.checkCounts.total, 0);
  assert.equal(result.history.at(-1).configuration.criterion, original.configuration.criterion);
});

test('shared crop edits affect inherited steps, while explicit full-frame steps remain compatible', () => {
  const previous = twoStep(), spec = specFrom(previous);
  delete spec.criteria[0].steps.after.crop;
  spec.defaults = { crop: { targets: ['id="cart-total"'] } };
  const result = reconcileManifest(args({ previous, spec }));
  assert.deepEqual(steps(result).map((step) => step.result), ['incomplete', 'passed']);
});

test('renamed and new steps are incomplete, removed attempts enter history without old counts', () => {
  const spec = specFor(); spec.criteria[0].steps.renamed = spec.criteria[0].steps.after;
  delete spec.criteria[0].steps.after; spec.criteria[0].steps.new = {};
  const result = reconcileManifest(args({ spec }));
  assert.deepEqual(steps(result).map(({ step, result }) => [step, result]), [['renamed', 'incomplete'], ['new', 'incomplete']]);
  assert.equal(result.history.at(-1).step, 'after'); assert.equal(result.checkCounts.total, 0);
});

test('step and criterion reordering preserves compatible evidence', () => {
  const previous = twoStep(), spec = specFrom(previous);
  const { before, after } = spec.criteria[0].steps;
  spec.criteria = [{ criterion: original.configuration.criterion, steps: { before } }, { criterion: original.configuration.criterion, steps: { after } }];
  const result = reconcileManifest(args({ previous, spec }));
  assert.deepEqual(steps(result).map((step) => step.step), ['before', 'after']); assert.equal(result.checkCounts.total, 2);
  assert.equal(result.history.length, previous.history.length);
});

for (const build of [undefined, { ...original.build, native: 'new' }, { ...original.build, runtime: { kind: 'external', revision: 'ota-2' } }]) test(`build compatibility ${JSON.stringify(build)} invalidates the flow`, () => {
  const previous = twoStep();
  const result = reconcileManifest(args({ previous, spec: specFrom(previous), build }));
  assert.ok(steps(result).every((step) => step.result === 'incomplete')); assert.equal(result.checkCounts.total, 0);
});

test('unknown historical build never becomes evidence of an unchanged build', () => {
  const previous = clone(example); delete previous.criteria[0].steps[0].build;
  const result = reconcileManifest(args({ previous, build: undefined }));
  assert.equal(result.result, 'incomplete');
});

for (const [group, field, value] of [
  ['device','platform','macos'], ['device','identity',{ scope: 'other-host', id: 'other-device' }], ['device','osVersion','new'],
  ['display','pixelWidth',1000], ['display','pixelHeight',2000], ['display','pixelDensity',2], ['display','rotation','landscape-left'],
  ['display','appearance','dark'], ['display','textSize',{ kind: 'ios-content-size', value: 'small' }],
  ['versions','deviceProof','new'], ['versions','agentDevice','new'],
]) test(`changed environment ${group}.${field} invalidates every current step`, () => {
  const previous = twoStep(), environment = clone(original.environment); environment[group][field] = value;
  if (field === 'platform') environment.display.textSize = { kind: 'platform-native', unit: 'scale', value: '1' };
  const result = reconcileManifest(args({ previous, spec: specFrom(previous), environment }));
  assert.equal(result.result, 'incomplete'); assert.equal(result.checkCounts.total, 0);
});

test('unknown environment and missing environment never enable reuse', () => {
  const environment = clone(original.environment); environment.device.osVersion = null;
  environment.unavailable = [{ path: ['device', 'osVersion'], message: 'Unavailable' }];
  for (const value of [undefined, environment]) assert.equal(reconcileManifest(args({ environment: value })).result, 'incomplete');
});

test('output/retention changes preserve captures; repeated invalidation does not duplicate history', () => {
  const spec = { ...specFor(), out: 'elsewhere', retention: { maxAgeDays: 3 } };
  assert.equal(reconcileManifest(args({ spec })).result, 'passed');
  const first = reconcileManifest(args({ build: undefined }));
  const second = reconcileManifest(args({ previous: first, build: undefined }));
  assert.deepEqual(second, first);
});

test('replacement archives the old attempt and recounts current results once', () => {
  const replacement = attempt(4); replacement.checks[0].actual.text = 'Wrong'; replacement.checks[0].result = 'fail';
  replacement.result = 'failed'; replacement.checkCounts = { total: 1, passed: 0, failed: 1 };
  const result = replaceAttempt(example, replacement);
  assert.equal(result.result, 'failed'); assert.deepEqual(result.checkCounts, replacement.checkCounts);
  assert.deepEqual(result.history.at(-1), original);
  assert.deepEqual(example.criteria[0].steps[0], original);
});

test('new error supersedes old pass and is never replaced by an older historical pass', () => {
  const value = attempt(5); for (const key of ['raw','image','snapshot','capturedAt','geometry','environment']) delete value[key];
  Object.assign(value, { checks: [], errors: [], result: 'error', checkCounts: { total: 0, passed: 0, failed: 0 }, error: { code: 'CAPTURE_FAILED', message: 'Disconnected' } });
  const updated = replaceAttempt(example, value);
  assert.equal(updated.result, 'error'); assert.equal(updated.checkCounts.total, 0);
  const reconciled = reconcileManifest(args({ previous: updated }));
  assert.equal(reconciled.result, 'incomplete'); assert.ok(reconciled.history.some((step) => step.result === 'error'));
});

test('replacement rejects reused IDs, unowned steps, changed configuration, and incompatible environment', () => {
  assert.throws(() => replaceAttempt(example, original), /immutable/);
  assert.throws(() => replaceAttempt(example, attempt(6, 'unknown')), /belong/);
  const changed = attempt(6); changed.configuration.criterion = 'Different';
  assert.throws(() => replaceAttempt(example, changed), /configuration/);
  const mismatched = attempt(6); mismatched.environment.device.osVersion = 'new';
  assert.throws(() => replaceAttempt(twoStep(), mismatched), /compatible/);
  assert.throws(() => reconcileManifest(args({ owner: { kind: 'spec', specPath: '/other/spec.yaml' } })), /owner/);
});

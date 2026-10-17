import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { attachRefs } from '../../dist/vendor/agent-device/snapshot.js';
import { createResolutionContext } from '../../dist/resolve/targets.js';
import { evaluateStep } from '../../dist/check/step.js';
import { evaluateCheck } from '../../dist/check/evaluate.js';
import * as fixtures from '../vendor/interaction-targeting.fixtures.ts';

const rect = { x: 20, y: 100, width: 80, height: 40 };
function input(nodes = [], patch = {}) {
  return { snapshot: { nodes: attachRefs([{ index: 0, type: 'Application', rect: { x: 0, y: 0, width: 400, height: 800 } }, ...nodes]), createdAt: 1, viewport: { width: 400, height: 800 }, backend: 'xctest', snapshotQuality: { state: 'healthy', backend: 'tree' } }, platform: 'ios', screenshot: { width: 1200, height: 2400 }, ...patch };
}
const node = (patch = {}) => ({ index: 1, parentIndex: 0, type: 'Button', identifier: 'save', label: 'Save', rect, ...patch });
const check = (expect, target = 'id=save') => ({ target, expect });
const run = (step, nodes = [node()], patch = {}) => evaluateStep({ ...input(nodes), step, ...patch });

test('resolution refuses zero and multiple matches with useful candidate details', () => {
  const context = createResolutionContext(input([node(), node({ index: 2 })]));
  assert.equal(context.resolve('id=save').error.code, 'TARGET_AMBIGUOUS');
  assert.match(context.resolve('id=save').error.message, /Candidates:.*Save.*testID/);
  assert.equal(context.resolve('id=missing').error.code, 'TARGET_NOT_FOUND');
  assert.match(context.resolve('id=missing').error.message, /save/);
  assert.equal(context.resolve('id=').error.code, 'CHECK_UNAVAILABLE');
});

test('alternative resolution preserves upstream unique fallback ordering', () => {
  const context = createResolutionContext(input([node(), node({ index: 2 }), node({ index: 3, identifier: 'unique' })]));
  assert.equal(context.resolve('id=save || id=unique').node.index, 3);
  assert.equal(context.resolve('id=save || id=unique').matches.length, 2);
});

test('RN duplicated reporter collapses to authored component; lookalikes remain ambiguous', () => {
  for (const [name, expected] of [['RN_TEXT_ECHO_NODES', 0], ['RN_TEXT_ECHO_DISTINCT_SUBTREE_NODES', undefined], ['RN_TEXT_ECHO_OFFSET_RECT_NODES', undefined], ['RN_TEXT_ECHO_AUTHORED_CHILD_NODES', undefined]]) {
    const base = input(); base.snapshot.nodes = attachRefs(fixtures[name]);
    const resolution = createResolutionContext(base).resolve('label="Catalog scroll: top"');
    assert.equal(resolution.node?.index, expected, name);
    if (expected === undefined) assert.equal(resolution.error.code, 'TARGET_AMBIGUOUS', name);
  }
});

for (const expect of [{ visible: true }, { exists: true }, { editable: true }, { selected: true }, { focused: true }, { text: 'Save' }]) {
  test(`evaluates ${Object.keys(expect)[0]} against the supplied snapshot`, () => {
    const result = run({ checks: [check(expect)] }, [node({ type: 'TextField', selected: true, focused: true })]);
    assert.equal(result.result, 'passed');
    assert.deepEqual(result.checks[0].actual, expect);
    assert.deepEqual(result.checkCounts, { total: 1, passed: 1, failed: 0 });
  });
}

test('failed text/state checks preserve actual values, INFO stays uncounted', () => {
  const result = run({ annotate: [{ box: { target: 'id=save' } }], checks: [check({ text: 'Other' }), check({ selected: true })] });
  assert.equal(result.result, 'failed');
  assert.deepEqual(result.checks.map(({ n, actual }) => ({ n, actual })), [{ n: 2, actual: { text: 'Save' } }, { n: 3, actual: { selected: false } }]);
  assert.deepEqual(result.geometry.groups, [{ numbers: [1, 2, 3] }]);
  assert.deepEqual(result.checkCounts, { total: 2, passed: 0, failed: 2 });
});

test('absence is a passing legend-only result; drawing a missing target still errors', () => {
  const result = run({ checks: [check({ absent: true }, 'id=missing')] });
  assert.equal(result.result, 'passed'); assert.deepEqual(result.geometry.targets, []);
  assert.deepEqual(result.imagePolicy.legendNumbers, [1]);
  const annotated = run({ annotate: [{ box: { target: 'id=missing', expect: { absent: true } } }] });
  assert.equal(annotated.result, 'error'); assert.equal(annotated.checks[0].result, 'pass');
  assert.equal(annotated.errors[0].code, 'TARGET_NOT_FOUND');
});

test('hidden is legend-only for a resolved invisible target; no match retains upstream refusal', () => {
  const hidden = run({ checks: [check({ hidden: true })] }, [node({ rect: { ...rect, y: 900 } })]);
  assert.equal(hidden.result, 'passed'); assert.deepEqual(hidden.geometry.targets, []);
  const missing = run({ checks: [check({ hidden: true }, 'id=missing')] });
  assert.equal(missing.result, 'error'); assert.equal(missing.checkCounts.total, 0);
});

for (const [name, patch] of [
  ['truncated', { truncated: true }],
  ['sparse', { snapshotQuality: { state: 'sparse', backend: 'tree' } }],
  ['unsettled', { postGestureOutcome: { kind: 'unsettled', gesture: { action: 'swipe', positionals: [] } } }],
  ['legacy root-only', { snapshotQuality: undefined }],
]) test(`absence cannot pass on ${name} captures`, () => {
  const base = input(); Object.assign(base.snapshot, patch);
  const result = evaluateStep({ ...base, step: { checks: [check({ absent: true }, 'id=missing')] } });
  assert.equal(result.result, 'error'); assert.equal(result.checkCounts.total, 0);
  assert.ok(result.errors.some((error) => error.code === 'CHECK_UNAVAILABLE'));
});
for (const captureOptions of [{ depth: 2 }, { scope: 'id=panel' }]) test(`absence refuses limited capture ${JSON.stringify(captureOptions)}`, () => {
  const result = run({ checks: [check({ absent: true }, 'id=missing')] }, [], { captureOptions });
  assert.equal(result.result, 'error'); assert.equal(result.checkCounts.total, 0);
});

test('presence checks retain completed results even when drawable identity is ambiguous', () => {
  const result = run({ checks: [check({ exists: true }), check({ absent: true })] }, [node(), node({ index: 2 })]);
  assert.equal(result.result, 'error');
  assert.deepEqual(result.checkCounts, { total: 2, passed: 1, failed: 1 });
  assert.equal(result.errors.length, 2);
});

test('entry errors do not prevent later independent assertions or reuse old entry numbers', () => {
  const result = run({ annotate: [{ box: { target: 'id=missing' } }], checks: [check({ text: 'Save' }), check({ text: 'Wrong' })] });
  assert.equal(result.result, 'error');
  assert.deepEqual(result.checkCounts, { total: 2, passed: 1, failed: 1 });
  assert.deepEqual(result.geometry.targets.map(({ n }) => n), [2, 3]);
  assert.deepEqual(result.imagePolicy.legendNumbers, [1, 2, 3]);
});

test('invalid selector diagnostics do not stop later checks or allow a missing mask', () => {
  const result = run({ annotate: [{ mask: { target: 'id=' } }], checks: [check({ text: 'Save' })] });
  assert.equal(result.imagePolicy.kind, 'omit'); assert.equal(result.checkCounts.passed, 1);
  assert.match(result.errors[0].message, /selector syntax/);
});

test('edge uncertainty and proven clipping are distinct and preserve assertion success', () => {
  const edgeNode = node({ rect: { ...rect, x: 0 } });
  const uncertain = run({ checks: [check({ visible: true })] }, [edgeNode]);
  assert.equal(uncertain.result, 'passed'); assert.equal(uncertain.geometry.warnings[0].code, 'EDGE_EXTENT_UNKNOWN');
  const known = run({ checks: [check({ visible: true })] }, [edgeNode], { originalBounds: new Map([[1, { x: -20, y: 100, width: 100, height: 40 }]]) });
  assert.equal(known.result, 'passed'); assert.equal(known.geometry.warnings[0].code, 'PARTIALLY_OFFSCREEN');
  assert.equal(known.geometry.targets[0].originalRect.x, -60);
  const aligned = run({ checks: [check({ visible: true })] }, [edgeNode], { originalBounds: new Map([[1, edgeNode.rect]]) });
  assert.deepEqual(aligned.geometry.warnings, []);
});

test('positive source bounds crossing the screen produce clipped geometry; fully offscreen errors', () => {
  const partial = run({ annotate: [{ marker: { target: 'id=save' } }] }, [node({ rect: { ...rect, x: -10 } })]);
  assert.deepEqual(partial.geometry.targets[0].rect, { x: 0, y: 300, width: 210, height: 120 });
  assert.equal(partial.geometry.warnings[0].code, 'PARTIALLY_OFFSCREEN');
  const outside = run({ checks: [check({ text: 'Save' })] }, [node({ rect: { ...rect, y: 900 } })]);
  assert.equal(outside.checks[0].result, 'pass'); assert.equal(outside.errors[0].code, 'TARGET_OFFSCREEN');
});

test('crop unions include all drawable targets; errors omit image while preserving checks', () => {
  const result = run({ checks: [check({ visible: true })], crop: { targets: ['id=other'], padding: 10 } }, [node(), node({ index: 2, identifier: 'other', rect: { x: 200, y: 300, width: 10, height: 10 } })]);
  assert.deepEqual(result.geometry.crop, { x: 50, y: 290, width: 590, height: 650 });
  assert.equal(result.geometry.targets[0].rect.x, 60);
  const invalid = run({ checks: [check({ visible: true })], crop: { targets: ['id=missing'] } });
  assert.equal(invalid.result, 'error'); assert.equal(invalid.checkCounts.passed, 1);
  assert.equal(invalid.imagePolicy.kind, 'omit'); assert.equal(invalid.error.code, 'CROP_UNUSABLE');
  assert.equal(invalid.geometry.crop, undefined);
});

test('distinct components with identical rectangles share drawing groups without sharing identity', () => {
  const result = run({ checks: [check({ visible: true }), check({ visible: true }, 'id=other')] }, [node(), node({ index: 2, identifier: 'other' })]);
  assert.deepEqual(result.geometry.groups, [{ numbers: [1, 2] }]);
  assert.notEqual(result.geometry.targets[0].targetId, result.geometry.targets[1].targetId);
});

test('invalid viewports and duplicate node identities fail before any evidence can be drawn', () => {
  const base = input(); delete base.snapshot.viewport;
  assert.throws(() => createResolutionContext(base));
  assert.throws(() => createResolutionContext(input([node(), node()])), /unique/);
});

for (const platform of ['ios', 'android', 'ios-compat']) test(`neutral ${platform} capture matches measured screenshot coordinates`, () => {
  const records = JSON.parse(readFileSync(new URL('../fixtures/capture-spike/geometry.json', import.meta.url)));
  const record = records.find((record) => record.platform === platform);
  const snapshot = JSON.parse(readFileSync(new URL(`../fixtures/capture-spike/${platform}/capture.snapshot.json`, import.meta.url)));
  const context = createResolutionContext({ snapshot, platform: platform === 'android' ? 'android' : 'ios', screenshot: record.png });
  for (const row of record.rows) {
    const id = platform === 'android' ? `dev.deviceproof.fixture:id/${row.id.replaceAll('-', '_')}` : row.id;
    const result = context.draw(`id="${id}"`);
    assert.ok('target' in result, JSON.stringify(result));
    for (const field of ['x', 'y', 'width', 'height']) assert.ok(Math.round(result.target.rect[field]) === row.projected[field], `${platform}/${id}/${field}`);
  }
});

test('Android editable uses upstream type rules rather than an unrelated reported bit', () => {
  const base = input([node({ type: 'android.widget.Button', editable: true })], { platform: 'android' });
  const result = evaluateCheck(createResolutionContext(base), 1, 'id=save', { editable: true });
  assert.deepEqual(result.check.actual, { editable: false });
});

test('fractional viewport scaling never turns exact edge alignment into proven clipping', () => {
  const edge = node({ rect: { x: 3, y: 100, width: 299, height: 40 } });
  const base = input([edge]); base.snapshot.viewport.width = 302; base.screenshot.width = 1206;
  const unknown = evaluateStep({ ...base, step: { checks: [check({ visible: true })] } });
  assert.equal(unknown.geometry.warnings[0].code, 'EDGE_EXTENT_UNKNOWN');
  assert.equal(unknown.geometry.targets[0].originalRect, undefined);
  const known = evaluateStep({ ...base, originalBounds: new Map([[1, edge.rect]]), step: { checks: [check({ visible: true })] } });
  assert.deepEqual(known.geometry.warnings, []);
});

test('all five primitives share target identity and resolve without modifying the snapshot', () => {
  const base = input([node()]), before = structuredClone(base);
  const result = evaluateStep({ ...base, step: { annotate: [
    { box: { target: 'id=save' } }, { arrow: { to: 'id=save', text: 'Save here' } },
    { marker: { target: 'id=save' } }, { callout: { target: 'id=save', text: 'Save control' } },
    { mask: { target: 'id=save' } },
  ] } });
  assert.equal(result.result, 'passed'); assert.equal(result.checkCounts.total, 0);
  assert.deepEqual(result.geometry.groups, [{ numbers: [1,2,3,4,5] }]);
  assert.equal(new Set(result.geometry.targets.map(({ targetId }) => targetId)).size, 1);
  assert.deepEqual(base, before);
});

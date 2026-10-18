import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createTextMetrics } from '../../dist/layout/font.js';
import { denseTargetGroups, overlaps } from '../../dist/layout/overlap.js';
import { layoutStep } from '../../dist/layout/step.js';
import { evaluateStep } from '../../dist/check/step.js';
import { attachRefs } from '../../dist/vendor/agent-device/snapshot.js';
const bytes = readFileSync(new URL('../../src/render/fonts/Inter-Regular.ttf', import.meta.url));
const semibold = readFileSync(new URL('../../src/render/fonts/Inter-SemiBold.ttf', import.meta.url));
const metrics = createTextMetrics(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), semibold.buffer.slice(semibold.byteOffset, semibold.byteOffset + semibold.byteLength));
const rect = { x: 100, y: 100, width: 80, height: 40 };
const node = (identifier, bounds = rect, index = 1) => ({ index, parentIndex: 0, type: 'Button', identifier, label: identifier, rect: bounds });
function run(step, nodes = [node('a')], criterion = 'The expected UI is shown.', extra = {}) {
  const input = { step, platform: 'ios', screenshot: { width: 400, height: 800 }, snapshot: {
    nodes: attachRefs([{ index: 0, type: 'Application', rect: { x: 0, y: 0, width: 400, height: 800 } }, ...nodes]),
    createdAt: 1, viewport: { width: 400, height: 800 }, backend: 'xctest', snapshotQuality: { state: 'healthy', backend: 'tree' } }, ...extra };
  const accepted = evaluateStep(input);
  const before = structuredClone({ step, accepted });
  const result = layoutStep({ step, criterion, accepted, metrics });
  assert.deepEqual({ step, accepted }, before);
  assert.deepEqual(layoutStep({ step, criterion, accepted, metrics }), result);
  return result;
}
const check = (target = 'id=a', expect = { visible: true }) => ({ target, expect });

test('pinned font bytes and real variable glyph widths', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82');
  assert.ok(metrics.line('WWW', 16).width > metrics.line('iii', 16).width * 3);
  assert.equal(metrics.line('✓ ×', 16).displayText, '✓ ×');
  assert.ok(metrics.line('✓ ×', 16).glyphs.every(({ index }) => index > 0));
  assert.equal(metrics.line('漢', 16).displayText, '\\u{6F22}');
});

test('wrapping preserves whitespace, newlines, long tokens, and unsupported Unicode', () => {
  for (const source of ['long '.repeat(80), 'X'.repeat(1000), 'one\n\n  two\n', '漢😀 '.repeat(30)]) {
    const lines = metrics.wrap(source, 16, 240);
    assert.equal(lines.map(({ text }) => text).join(''), source.replaceAll('\n', ''));
    assert.ok(lines.every(({ width }) => width <= 240));
  }
  assert.throws(() => metrics.wrap('W', 16, 1));
});

test('shared tag preserves INFO, passing and failing checks with separate legend rows', () => {
  const result = run({ annotate: [{ box: { target: 'id=a' } }], checks: [check(), check('id=a', { text: 'other' })] });
  const region = result.views[0].regions[0];
  assert.deepEqual(region.numbers, [1, 2, 3]);
  assert.equal(region.border, 'dashed');
  assert.equal(region.tag.lines.map(({ text }) => text).join(''), '1, 2 ✓, 3 ×');
  assert.deepEqual(result.legend.rows.map(({ outcome }) => outcome), ['INFO', 'PASS', 'FAIL']);
  assert.match(result.legend.rows[2].block.source, /Expected:.*other.*\nActual:.*a/);
  assert.equal(result.checkCounts.total, 2);
});

test('INFO is dotted, all passing checks solid, and arrows have target-edge endpoints', () => {
  const info = run({ annotate: [{ arrow: { to: 'id=a', text: 'Here' } }] });
  assert.equal(info.views[0].regions[0].border, 'dotted');
  assert.equal(info.views[0].regions[0].tag.lines[0].text, '1');
  assert.equal(info.views[0].regions[0].arrows.length, 1);
  assert.equal(info.legend.rows[0].title.source, 'INFO · Here');
  assert.equal(info.legend.rows[0].detail.source, 'Highlighted for context; no assertion');
  assert.equal(run({ checks: [check()] }).views[0].regions[0].border, 'solid');
});

test('errors and legend-only checks retain numbering and successful results', () => {
  const result = run({ annotate: [{ box: { target: 'id=missing' } }], checks: [check('id=missing', { absent: true }), check()] });
  assert.equal(result.result, 'error');
  assert.match(result.legend.badge.source, /^ERROR/);
  assert.deepEqual(result.views[0].regions[0].numbers, [3]);
  assert.deepEqual(result.legend.rows.map(({ n }) => n), [1, 2, 3]);
  assert.match(result.legend.rows[0].block.source, /TARGET_NOT_FOUND/);
  const hidden = run({ checks: [check('id=a', { hidden: true })] }, [node('a', { ...rect, y: 900 })]);
  assert.equal(hidden.views[0].regions.length, 0);
  assert.equal(hidden.legend.rows[0].outcome, 'PASS');
});

for (const padding of [undefined, 0, 24, 500]) test(`crop translation respects union and padding ${padding}`, () => {
  const result = run({ annotate: [{ box: { target: 'id=a' } }], crop: { targets: ['id=b'], ...(padding === undefined ? {} : { padding }) } },
    [node('a'), node('b', { x: 280, y: 300, width: 50, height: 50 }, 2)]);
  const view = result.views[0], p = padding ?? 24;
  assert.equal(view.source.x, Math.max(0, 100 - p));
  assert.equal(view.source.y, Math.max(0, 100 - p));
  assert.equal(view.source.width, Math.min(400, 330 + p) - view.source.x);
  assert.equal(view.regions[0].rect.x - view.frame.x, 100 - view.source.x);
});

test('full frame and partial clipping warnings survive layout', () => {
  const result = run({ annotate: [{ box: { target: 'id=a' } }] }, [node('a', { x: -10, y: 100, width: 80, height: 40 })]);
  assert.deepEqual(result.views[0].source, { x: 0, y: 0, width: 400, height: 800 });
  assert.equal(result.views[0].regions[0].rect.width, 70);
  assert.match(result.legend.rows[0].block.source, /Partly off-screen/);
  const edge = run({ annotate: [{ box: { target: 'id=a' } }] }, [node('a', { ...rect, x: 0 })]);
  assert.match(edge.legend.rows[0].block.source, /full extent unknown/);
});

test('masks must resolve; crop failures omit the image', () => {
  assert.equal(run({ annotate: [{ mask: { target: 'id=missing' } }] }).kind, 'omit');
  assert.equal(run({ checks: [check()], crop: { targets: ['id=missing'] } }).kind, 'omit');
  const masked = run({ annotate: [{ mask: { target: 'id=a', expect: { text: 'wrong' } } }] });
  assert.equal(masked.result, 'failed');
  assert.deepEqual(masked.views[0].masks[0].rect, masked.views[0].regions[0].rect);
  assert.equal(masked.views[0].masks[0].hatch, true);
});

test('overlap counts identities, includes containment and transitivity, excludes touching edges', () => {
  const target = (n, targetId, rect) => ({ n, targetId, rect });
  const a = { x: 0, y: 0, width: 20, height: 20 }, b = { ...a, x: 15 }, c = { ...a, x: 30 };
  assert.deepEqual(denseTargetGroups([target(1, 'a', a), target(2, 'b', b), target(3, 'c', c)]), [['a', 'b', 'c']]);
  assert.deepEqual(denseTargetGroups([target(1, 'a', a), target(2, 'a', a), target(3, 'b', b)]), []);
  assert.deepEqual(denseTargetGroups([target(1, 'a', a), target(2, 'b', a), target(3, 'c', a)]), [['a', 'b', 'c']]);
  assert.deepEqual(denseTargetGroups([target(1, 'a', { ...a, width: 100 }), target(2, 'b', b), target(3, 'c', c)]), [['a', 'b', 'c']]);
  assert.equal(overlaps(a, { ...a, x: 20 }), false);
});

test('detail views preserve shared colors and all intersecting masks, excluding unrelated targets', () => {
  const result = run({ annotate: [{ mask: { target: 'id=a' } }], checks: [check('id=b'), check('id=c'), check('id=d')] },
    [node('a'), node('b', rect, 2), node('c', rect, 3), node('d', { ...rect, y: 600 }, 4)]);
  assert.equal(result.views.length, 4);
  assert.equal(result.views[0].regions.length, 2);
  for (const view of result.views.slice(1)) {
    assert.equal(view.regions.length, 1); assert.equal(view.masks.length, 1);
    assert.equal(view.regions[0].color, result.views[0].regions[0].color);
    assert.deepEqual(view.masks[0].rect, view.regions[0].rect);
  }
});

test('tags remain within canvas, clear of all targets and one another even at edges', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => node(`n${i}`, { x: (i % 4) * 100, y: Math.floor(i / 4) * 30, width: 99, height: 29 }, i + 1));
  const result = run({ checks: nodes.map(({ identifier }) => check(`id=${identifier}`)) }, nodes);
  const regions = result.views[0].regions;
  assert.ok(regions.some(({ tag }) => tag.placement === 'margin'));
  for (const region of regions) {
    const r = region.tag.rect;
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= result.width && r.y + r.height <= result.legend.rect.y);
    assert.ok(regions.every((other) => !overlaps(r, other.rect)));
    assert.ok(regions.every((other) => other === region || !overlaps(r, other.tag.rect)));
  }
  assert.equal(new Set(regions.map(({ color }) => color)).size, regions.length);
});

test('nearby tags use distinct outer edges without moving target bounds', () => {
  const result = run({ checks: [check(), check('id=b')] }, [node('a'), node('b', { ...rect, x: 185 }, 2)]);
  const [a, b] = result.views[0].regions;
  assert.equal(a.rect.x, 116); assert.equal(b.rect.x, 201);
  assert.equal(overlaps(a.tag.rect, b.tag.rect), false);
});

test('long grouped tags and legend text wrap without lost numbers or evidence', () => {
  const text = 'Detailed criterion '.repeat(100) + '\nSecond line';
  const result = run({ annotate: [{ callout: { target: 'id=a', text } }], checks: Array.from({ length: 100 }, () => check()) }, undefined, text);
  assert.equal(result.views.length, 1);
  const tag = result.views[0].regions[0].tag;
  assert.ok(tag.lines.length > 1);
  assert.ok(tag.lines.every(({ text }) => /^\d/.test(text) && !/\d$/.test(text))); 
  assert.equal(tag.lines.map(({ text }) => text).join(''), '1, ' + Array.from({ length: 100 }, (_, i) => `${i + 2} ✓`).join(', '));
  assert.equal(result.legend.criterion.source, text);
  assert.equal(result.legend.rows.length, 101);
  assert.ok(result.legend.rows.every(({ block }) => block.y >= result.legend.rect.y));
});

for (const platform of ['ios', 'android', 'ios-compat']) test(`neutral ${platform} capture flows through layout`, () => {
  const records = JSON.parse(readFileSync(new URL('../fixtures/capture-spike/geometry.json', import.meta.url)));
  const record = records.find((item) => item.platform === platform);
  const snapshot = JSON.parse(readFileSync(new URL(`../fixtures/capture-spike/${platform}/capture.snapshot.json`, import.meta.url)));
  const checks = record.rows.map((row) => check(`id="${platform === 'android' ? `dev.deviceproof.fixture:id/${row.id.replaceAll('-', '_')}` : row.id}"`));
  const step = { checks };
  const accepted = evaluateStep({ step, snapshot, platform: platform === 'android' ? 'android' : 'ios', screenshot: record.png });
  const result = layoutStep({ step, criterion: 'Neutral controls are visible.', accepted, metrics });
  assert.equal(result.kind, 'layout');
  assert.equal(result.legend.rows.length, record.rows.length);
  for (const target of accepted.geometry.targets) {
    const region = result.views[0].regions.find(({ numbers }) => numbers.includes(target.n));
    assert.ok(Math.abs(region.rect.x - result.views[0].frame.x - target.rect.x) < 1e-9);
    assert.ok(Math.abs(region.rect.y - result.views[0].frame.y - target.rect.y) < 1e-9);
    assert.equal(region.rect.width, target.rect.width);
  }
});

test('all corner tags and tiny zero-padding crops remain readable outside targets', () => {
  for (const [x, y] of [[0, 0], [399, 0], [0, 799], [399, 799]]) {
    const result = run({ checks: [check()], crop: { targets: ['id=a'], padding: 0 } }, [node('a', { x, y, width: 1, height: 1 })]);
    const view = result.views[0];
    assert.equal(view.source.width, 1);
    assert.equal(view.regions[0].tag.placement, 'margin');
    assert.ok(view.regions[0].tag.rect.x + view.regions[0].tag.rect.width <= result.width);
  }
});

test('completed check survives a drawable-evidence error in its legend row', () => {
  const result = run({ annotate: [{ box: { target: 'id=missing', expect: { absent: true } } }] });
  assert.equal(result.result, 'error');
  assert.equal(result.views[0].regions.length, 0);
  assert.match(result.legend.rows[0].block.source, /ERROR.*\nCheck: PASS/);
  assert.equal(result.checkCounts.passed, 1);
});

test('unavailable assertion still applies a drawable mask with an error badge', () => {
  const step = { annotate: [{ mask: { target: 'id=a', expect: { visible: true } } }] };
  const accepted = evaluateStep({ step, platform: 'ios', screenshot: { width: 400, height: 800 }, snapshot: {
    nodes: attachRefs([node('a')]), createdAt: 1, viewport: { width: 400, height: 800 }, backend: 'xctest' } });
  accepted.checks = [];
  accepted.errors = [{ n: 1, code: 'CHECK_UNAVAILABLE', message: 'Capture could not prove the check.' }];
  const result = layoutStep({ step, criterion: 'Mask remains covered.', accepted, metrics });
  assert.equal(result.result, 'error'); assert.equal(result.views[0].masks.length, 1);
  assert.match(result.views[0].regions[0].tag.lines[0].text, /1 !/);
});


test('legend hierarchy preserves measured text, large numbers and zero-check counts', () => {
  assert.equal(createHash('sha256').update(semibold).digest('hex'), '78a843fade9d4612a5567302fb595b56976eb5fcebf4fea5a5912d638bafcde3');
  const text = 'Wide heading WWW with spaces and unsupported 漢 '.repeat(12);
  const result = run({ annotate: Array.from({ length: 105 }, () => ({ callout: { target: 'id=a', text } })) }, undefined, text);
  assert.equal(result.legend.badge.source, 'PASSED');
  assert.equal(result.legend.counts.source, 'Checks: 0, passed: 0, failed: 0');
  assert.ok(result.legend.criterion.lines.every((line) => line.weight === 'semibold'));
  for (const row of result.legend.rows) {
    assert.equal(row.number.source, String(row.n));
    assert.ok(row.title.lines.every((line) => line.weight === 'semibold'));
    assert.ok(row.detail.lines.every((line) => line.weight === 'regular'));
    for (const block of [row.title, row.detail]) {
      assert.equal(block.lines.map(({ text }) => text).join(''), block.source.replaceAll('\n', ''));
      assert.ok(block.lines.every((line) => block.x + line.width <= result.width - result.style.padding));
    }
    assert.ok(row.detail.y >= row.title.y + row.title.height);
    assert.ok(row.detail.y + row.detail.height <= result.height);
  }
});

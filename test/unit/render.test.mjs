import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { setup, loadCase } from '../golden/helpers.mjs';
import { prepareScreenshot } from '../../dist/render/screenshot.js';
import { regionColor } from '../../dist/layout/color.js';
import { escapeXml } from '../../dist/render/svg.js';
const renderer = await setup();
const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test('SVG uses actual region colors, bundled glyph paths, and explicit error diagnostics', async () => {
  const result = renderer.render(await loadCase('partial-error'));
  assert.equal(result.kind, 'rendered');
  assert.equal(result.layout.result, 'error');
  assert.match(result.svg, /ERROR/);
  assert.match(result.svg, /TARGET_NOT_FOUND/);
  assert.match(result.svg, /id="glyph-\d+-(?:regular|semibold)-[\d.]+"/);
  assert.doesNotMatch(result.svg, /<text|font-family=|file:|https?:\/\/(?!www\.w3\.org)/);
  const png = PNG.sync.read(Buffer.from(result.png));
  for (const region of result.layout.views[0].regions) {
    const rgb = region.color.match(/[a-f0-9]{2}/gi).map((pair) => parseInt(pair, 16));
    let found = false;
    for (let i = 0; i < png.data.length; i += 4) if (rgb.every((value, channel) => png.data[i + channel] === value)) { found = true; break; }
    assert.ok(found, `missing region color ${region.color}`);
  }
});

test('screenshot pixels remain exact outside annotations at native resolution', async () => {
  const input = await loadCase('ios-native'), original = PNG.sync.read(input.screenshot);
  const result = renderer.render(input), png = PNG.sync.read(Buffer.from(result.png));
  const frame = result.layout.views[0].frame;
  for (const [x, y] of [[600, 1800], [200, 900], [800, 1800]]) assert.deepEqual(pixel(png, x + frame.x, y + frame.y), pixel(original, x, y));
  assert.equal(result.layout.style.fontSize, 48);
});

test('crop translation renders source pixels from the accepted source rectangle', async () => {
  const input = await loadCase('crop-edge'), original = PNG.sync.read(input.screenshot);
  const result = renderer.render(input), png = PNG.sync.read(Buffer.from(result.png));
  const { source, frame } = result.layout.views[0];
  assert.equal(source.y, 80);
  assert.deepEqual(pixel(png, 190 - source.x + frame.x, 145 - source.y + frame.y), pixel(original, 190, 145));
});

test('mask preprocessing is opaque and rounds fractional bounds outward', () => {
  const raw = { width: 6, height: 6, data: Buffer.alloc(6 * 6 * 4, 255) };
  const source = PNG.sync.write(raw), before = Buffer.from(source);
  const masked = PNG.sync.read(Buffer.from(prepareScreenshot(source, raw, [{ x: 1.5, y: 1.5, width: 2, height: 2 }])));
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) assert.deepEqual(pixel(masked, x, y), [53, 53, 53, 255]);
  assert.deepEqual(pixel(masked, 0, 0), [255, 255, 255, 255]);
  assert.deepEqual(source, before);
  assert.throws(() => prepareScreenshot(source, raw, [{ x: -1, y: 0, width: 2, height: 2 }]), /Cannot apply mask/);
  assert.throws(() => prepareScreenshot(source, raw, [{ x: 0, y: 0, width: NaN, height: 2 }]), /Cannot apply mask/);
});

test('embedded screenshot already masks every detail source and contains no original secret pixels', async () => {
  const input = await loadCase('dense-masked'), result = renderer.render(input);
  const encoded = result.svg.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)[1];
  const masked = PNG.sync.read(Buffer.from(encoded, 'base64'));
  const target = input.accepted.geometry.targets.find(({ n }) => n === 1).rect;
  for (let y = target.y; y < target.y + target.height; y++) for (let x = target.x; x < target.x + target.width; x++) assert.deepEqual(pixel(masked, x, y), [53, 53, 53, 255]);
  assert.ok(result.layout.views.filter((view) => view.masks.length > 0).length >= 3);
});

test('corrupt screenshots, inconsistent dimensions and unusable masks never return an image', async () => {
  const input = await loadCase('dense-masked');
  assert.throws(() => renderer.render({ ...input, screenshot: new Uint8Array([1, 2, 3]) }));
  const wrongSize = PNG.sync.write({ width: 1, height: 1, data: Buffer.alloc(4) });
  assert.throws(() => renderer.render({ ...input, screenshot: wrongSize }), /dimensions disagree/);
  const badGeometry = structuredClone(input.accepted);
  badGeometry.geometry.targets[0].rect.width = -1;
  assert.throws(() => renderer.render({ ...input, accepted: badGeometry }));
  const unavailable = { ...input, step: { annotate: [{ mask: { target: 'id=missing' } }] }, accepted: {
    checks: [], errors: [{ n: 1, code: 'TARGET_NOT_FOUND', message: 'Mask target is missing.' }], geometry: { screenshot: { width: 480, height: 420 }, crop: { x: 0, y: 0, width: 480, height: 420 }, targets: [], cropTargets: [], groups: [], warnings: [] } } };
  assert.equal(renderer.render(unavailable).kind, 'omit');
  assert.equal(renderer.render(unavailable).png, undefined);
});

test('XML-sensitive user text stays data and does not create executable SVG elements', async () => {
  const input = await loadCase('legend-only');
  const criterion = '</title><script>alert("x")</script> & \'quotes\' <image href="https://example.invalid/x"/>';
  const result = renderer.render({ ...input, criterion });
  assert.doesNotMatch(result.svg, /<script|href="https:\/\/example/);
  assert.match(result.svg, /&lt;\/title&gt;/);
  assert.equal(result.layout.legend.criterion.source, criterion);
  assert.equal(escapeXml('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
});

test('rendering is repeatable, input-preserving, and frees resources between calls', async () => {
  const input = await loadCase('primitives-mixed'), before = structuredClone(input);
  const a = renderer.render(input), b = renderer.render(input);
  assert.deepEqual(a.png, b.png); assert.equal(a.svg, b.svg);
  assert.deepEqual(input.step, before.step); assert.deepEqual(input.accepted, before.accepted);
  assert.deepEqual([...input.screenshot], [...before.screenshot]);
});

test('all region colors have at least 4.5:1 white-text contrast', () => {
  for (let i = 0; i < 100; i++) {
    const rgb = regionColor(i).match(/[a-f0-9]{2}/gi).map((pair) => parseInt(pair, 16) / 255);
    const linear = rgb.map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
    const luminance = linear.reduce((sum, n, channel) => sum + n * [0.2126, 0.7152, 0.0722][channel], 0);
    assert.ok(1.05 / (luminance + 0.05) >= 4.5);
  }
});

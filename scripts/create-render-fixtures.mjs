// Regenerate neutral synthetic input fixtures, never golden output images.
import { writeFile } from 'node:fs/promises';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { assets, root } from '../test/golden/helpers.mjs';
import { attachRefs } from '../dist/vendor/agent-device/snapshot.js';
import { regionColor } from '../dist/layout/color.js';
import { escapeXml } from '../dist/render/svg.js';
const runtime = await assets(); await initWasm(runtime.wasm);
const rect = (x, y, width, height) => ({ x, y, width, height });
const target = (id, bounds, label = id, color = '#e2e8f0') => ({ id, rect: bounds, label, color });
const check = (id, expect = { visible: true }) => ({ target: `id=${id}`, expect });
const specs = [
  { name: 'primitives-mixed', width: 520, height: 520, targets: [
    target('save', rect(40, 70, 180, 60), 'Save changes'), target('status', rect(270, 70, 210, 60), 'Ready'),
    target('account', rect(40, 220, 440, 70), 'Account 1234 5678'), target('help', rect(40, 370, 440, 60), 'Help & support'),
  ], step: { annotate: [
    { box: { target: 'id=save', text: 'The save control is visible.', expect: { visible: true } } },
    { marker: { target: 'id=status', text: 'Current status' } },
    { arrow: { to: 'id=help', text: 'Help <link> & "support" stays available.' } },
    { callout: { target: 'id=status', text: 'Expected final status', expect: { text: 'Complete' } } },
    { mask: { target: 'id=account', text: 'Seeded account identifier' } },
  ], checks: [check('save')] }, criterion: 'Save remains visible, status reads "Complete", and Help & support is available.\nThe seeded account is masked.' },
  { name: 'dense-masked', width: 480, height: 420, targets: [
    target('order', rect(30, 60, 420, 300), '', '#ffffff'), target('summary', rect(50, 100, 380, 230), '', '#e2e8f0'),
    target('total', rect(70, 230, 340, 70), '', '#cbd5e1'), target('amount', rect(250, 245, 140, 40), '$12.00', '#f8fafc'),
    target('secret', rect(80, 130, 160, 40), 'Account 1234', '#ffffff'),
  ], step: { annotate: [{ mask: { target: 'id=secret', text: 'Account stays masked in every detail.' } }], checks: [check('order'), check('summary'), check('total'), check('amount', { text: '$12.00' })] }, criterion: 'The order summary and $12.00 total are visible. Each detail uses the same captured frame.' },
  { name: 'long-tags', width: 400, height: 240, targets: [target('continue', rect(30, 80, 340, 70), 'Continue')],
    step: { annotate: [{ box: { target: 'id=continue', text: 'Informational context' } }], checks: Array.from({ length: 32 }, (_, i) => check('continue', i % 7 === 0 ? { text: 'Pay now' } : { visible: true })) },
    criterion: 'Every repeated check retains its own number and result. ' + 'Long criteria wrap without truncating the acceptance evidence. '.repeat(5) + '\nSecond paragraph: <xml> & "quotes" remain plain text. Unicode outside Inter: 漢 😀.' },
  { name: 'partial-error', width: 480, height: 300, targets: [target('save', rect(60, 90, 170, 60), 'Save'), target('status', rect(270, 90, 160, 60), 'Pending')],
    step: { annotate: [{ box: { target: 'id=missing', text: 'Missing control' } }], checks: [check('save'), check('status', { text: 'Complete' }), check('gone', { absent: true })] }, criterion: 'Usable evidence survives an unresolved entry; the overall outcome is ERROR.' },
  { name: 'crop-edge', width: 480, height: 400, targets: [target('partial', rect(-15, 80, 180, 60), 'Partial target'), target('secret', rect(220.5, 100.25, 150.5, 50.5), 'Secret 54321'), target('tiny', rect(400, 150, 3, 3), '')],
    step: { annotate: [{ marker: { target: 'id=partial' } }, { mask: { target: 'id=secret' } }, { mask: { target: 'id=tiny' } }], crop: { targets: ['id=partial'], padding: 0 } }, criterion: 'Zero-padding crop preserves all drawable targets, clipped bounds, and fractional masks.' },
  { name: 'contrast', width: 480, height: 300, targets: [target('a', rect(25, 80, 190, 70), 'Same blue', regionColor(0)), target('b', rect(230, 80, 220, 70), 'Same rose', regionColor(1))],
    step: { annotate: [{ box: { target: 'id=a' } }, { box: { target: 'id=b' } }], checks: [check('a'), check('b', { text: 'Mismatch' })] }, criterion: 'White halos preserve annotation edges against matching-color UI regions.' },
  { name: 'legend-only', width: 400, height: 240, targets: [target('a', rect(50, 80, 300, 60), 'No alert is shown')],
    step: { checks: [check('alert', { absent: true })] }, criterion: 'The alert is absent. A passing absence check has a legend row and no marker.' },
];
for (const item of specs) {
  const dimensions = { width: item.width, height: item.height };
  const background = `<rect width="100%" height="100%" fill="#f8fafc"/><text x="24" y="34" font-family="Inter" font-size="20" fill="#334155">DEVICE PROOF / NEUTRAL FIXTURE</text>`;
  const body = item.targets.map(({ rect: r, label, color }) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${color}"/><text x="${r.x + 12}" y="${r.y + r.height / 2 + 7}" font-family="Inter" font-size="20" fill="${[regionColor(0), regionColor(1)].includes(color) ? '#ffffff' : '#172033'}">${escapeXml(label)}</text>`).join('');
  const renderer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${item.width}" height="${item.height}">${background}${body}</svg>`, { font: { fontBuffers: [new Uint8Array(runtime.font)] } });
  const image = renderer.render();
  try { await writeFile(new URL(`test/fixtures/render/${item.name}.raw.png`, root), image.asPng()); } finally { image.free(); renderer.free(); }
  const snapshot = { nodes: attachRefs([{ index: 0, type: 'Application', rect: { x: 0, y: 0, ...dimensions } }, ...item.targets.map((target, i) => ({ index: i + 1, parentIndex: 0, type: 'Button', identifier: target.id, label: target.label, rect: target.rect }))]),
    createdAt: 1, viewport: dimensions, backend: 'xctest', snapshotQuality: { state: 'healthy', backend: 'tree' } };
  await writeFile(new URL(`test/fixtures/render/${item.name}.json`, root), JSON.stringify({ platform: 'ios', dimensions, snapshot, screenshotPath: `test/fixtures/render/${item.name}.raw.png`, step: item.step, criterion: item.criterion }, null, 2) + '\n');
}
for (const [platform, dimensions] of [['ios', { width: 1206, height: 2622 }], ['android', { width: 1080, height: 2220 }]]) {
  const id = (name) => platform === 'android' ? `dev.deviceproof.fixture:id/${name.replaceAll('-', '_')}` : name;
  await writeFile(new URL(`test/fixtures/render/${platform}-native.json`, root), JSON.stringify({ platform, dimensions,
    snapshotPath: `test/fixtures/capture-spike/${platform}/capture.snapshot.json`, screenshotPath: `test/fixtures/capture-spike/${platform}/capture.raw.png`,
    step: { annotate: [{ box: { target: `id="${id('top-left')}"`, text: 'Top-left control', expect: { visible: true } } }, { arrow: { to: `id="${id('top-right')}"`, text: 'Top-right control' } }, { mask: { target: `id="${id('partial-left')}"`, text: 'Mask the visible part of the clipped control.' } }] },
    criterion: `Neutral ${platform} capture: edge controls stay visible and clipped bounds are reported.` }, null, 2) + '\n');
}
console.log(`Wrote ${specs.length + 2} neutral render input fixtures.`);

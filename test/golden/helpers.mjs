import { readFile } from 'node:fs/promises';
import { createEvidenceRenderer } from '../../dist/render/evidence.js';
import { evaluateStep } from '../../dist/check/step.js';
export const root = new URL('../../', import.meta.url);
export async function assets() {
  const font = await readFile(new URL('src/render/fonts/Inter-Regular.ttf', root));
  const semibold = await readFile(new URL('src/render/fonts/Inter-SemiBold.ttf', root));
  const wasm = await readFile(new URL('../../node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url));
  return { font: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength), semibold: semibold.buffer.slice(semibold.byteOffset, semibold.byteOffset + semibold.byteLength), wasm };
}
export const cases = ['ios-native', 'android-native', 'primitives-mixed', 'dense-masked', 'long-tags', 'partial-error', 'crop-edge', 'contrast', 'legend-only'];
export async function setup() {
  return createEvidenceRenderer(await assets());
}
export async function loadCase(name) {
  const fixture = JSON.parse(await readFile(new URL(`test/fixtures/render/${name}.json`, root)));
  const screenshot = await readFile(new URL(fixture.screenshotPath, root));
  const snapshot = fixture.snapshotPath ? JSON.parse(await readFile(new URL(fixture.snapshotPath, root))) : fixture.snapshot;
  const accepted = evaluateStep({ step: fixture.step, snapshot, platform: fixture.platform, screenshot: fixture.dimensions });
  return { step: fixture.step, criterion: fixture.criterion, accepted, screenshot };
}

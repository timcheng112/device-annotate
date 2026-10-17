import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch, release } from 'node:os';
import { assets, root } from '../test/golden/helpers.mjs';
import { createEvidenceRenderer } from '../dist/render/evidence.js';
import { evaluateStep } from '../dist/check/step.js';
const runtime = await assets();
const start = performance.now();
const renderer = await createEvidenceRenderer(runtime);
const initializationMs = performance.now() - start;
const records = [];
for (const name of ['ios-native', 'android-native', 'dense-masked', 'long-tags']) {
  const fixture = JSON.parse(await readFile(new URL(`test/fixtures/render/${name}.json`, root)));
  const screenshot = await readFile(new URL(fixture.screenshotPath, root));
  const snapshot = fixture.snapshotPath ? JSON.parse(await readFile(new URL(fixture.snapshotPath, root))) : fixture.snapshot;
  const times = [];
  let dimensions;
  for (let i = 0; i < 6; i++) {
    const started = performance.now();
    const accepted = evaluateStep({ step: fixture.step, snapshot, platform: fixture.platform, screenshot: fixture.dimensions });
    const result = renderer.render({ step: fixture.step, criterion: fixture.criterion, accepted, screenshot });
    times.push(performance.now() - started);
    if (result.kind !== 'rendered') throw new Error(`${name} omitted`);
    dimensions = { width: result.layout.width, height: result.layout.height };
  }
  const warm = times.slice(1).sort((a, b) => a - b);
  records.push({ name, dimensions, firstMs: times[0], medianMs: warm[2], maxMs: warm.at(-1), samplesMs: times });
}
const report = { runtime: process.version, os: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0].model },
  dependencies: { resvgWasm: '2.6.2', pngjs: '7.0.0', opentype: '1.3.4' }, initializationMs,
  boundary: 'In-memory accepted-snapshot evaluation, layout, PNG decode, opaque mask application, PNG re-encode, SVG generation, WASM rasterization, final PNG encoding and buffer copy. Asset/file reads and device capture excluded. First sample retained; warm statistics use the following five samples.', records };
console.log(JSON.stringify(report, null, 2));
if (records.some(({ maxMs, firstMs }) => Math.max(maxMs, firstMs) >= 1000)) process.exitCode = 1;

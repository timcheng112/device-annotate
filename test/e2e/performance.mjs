import { performance } from 'node:perf_hooks';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCapture } from '../../dist/capture/public.js';
import { localDeviceAdapter } from '../../dist/capture/device.js';
const platform = process.argv[2];
if (!['ios', 'android'].includes(platform)) throw new Error('Supply ios or android with the neutral fixture already foregrounded.');
const out = await mkdtemp(join(tmpdir(), 'device-proof-native-performance-'));
const samples = [];
for (let index = 0; index < 4; index++) {
  let captureMs = 0;
  const start = performance.now();
  const result = await runCapture({ step: 'sample', criterion: 'Neutral center exists', platform, out,
    config: { annotate: [{ box: { target: platform === 'ios' ? 'id="center"' : 'id="dev.deviceproof.fixture:id/center"', expect: { exists: true } } }] },
  }, async (options) => {
    const before = performance.now();
    const device = await localDeviceAdapter(options);
    captureMs += performance.now() - before;
    return { platform: device.platform, ...Object.fromEntries(['environment', 'wait', 'snapshot', 'screenshot', 'close'].map((name) => [name, async () => {
      const before = performance.now();
      try { return await device[name](); } finally { captureMs += performance.now() - before; }
    }])) };
  });
  if (result.result !== 'passed') throw new Error(JSON.stringify(result));
  const totalMs = performance.now() - start;
  samples.push({ totalMs, deviceAndMetadataMs: captureMs, processingAndPersistenceMs: totalMs - captureMs });
}
const report = { platform, node: process.version, samples, boundary: 'Full capture entry point minus adapter construction, metadata, stable observation, screenshot, and adapter resource cleanup. Includes validation, lock, rendering initialization, persistence, ledger replacement, and history pruning.' };
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

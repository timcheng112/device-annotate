import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, mkdtemp, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startVideo, markVideo, stopVideo, renderVideo } from '../dist/video/public.js';
import { checklistAt } from '../dist/video/schema.js';
import { readRun, saveRun } from '../dist/video/store.js';
import { mediaCommand, probeVideo } from '../dist/video/media.js';

const base = resolve('scripts/m0/.local/video-verification');
await mkdir(base, { recursive: true });
const cwd = await mkdtemp(join(base, 'run-'));
const spec = { criteria: [{ criterion: 'The control is visible and its text matches', steps: {
  review: { checks: [{ target: 'id="center"', expect: { exists: true } }] },
  verify: { checks: [{ target: 'id="center"', expect: { text: 'Expected value' } }] },
  context: {},
} }] };
await writeFile(join(cwd, 'flow.json'), JSON.stringify(spec));
const screenshot = await readFile(new URL('../test/fixtures/capture-spike/ios/capture.raw.png', import.meta.url));
const snapshot = JSON.parse(await readFile(new URL('../test/fixtures/capture-spike/ios/capture.snapshot.json', import.meta.url)));
const environment = JSON.parse(await readFile(new URL('../examples/environment.complete.json', import.meta.url)));
let time = 1000, raw;
const deps = {
  clock: () => time,
  device: async () => ({ identity: { address: 'synthetic-encoder-test', createdAt: 1, platform: 'ios', deviceId: 'fixture', agentDevice: '0.21.27' },
    start: async path => { raw = path; time = 1100; return { recording: 'started', outPath: path }; },
    stop: async () => {
      await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=480x640:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', raw]);
      return { recording: 'stopped', outPath: raw, recorder: 'confirmed' };
    },
  }),
  captureAdapter: async () => ({ platform: 'ios', environment: async () => environment, wait: async () => { time += 200; }, snapshot: async () => snapshot, screenshot: async () => screenshot, close: async () => {} }),
};
const folder = { cwd, out: 'video' };
const start = await startVideo({ ...folder, specPath: 'flow.json', build: { appId: 'fixture', native: 'neutral', runtime: { kind: 'embedded' } } }, deps);
assert.equal(start.result, 'passed', JSON.stringify(start));
for (const [i, step] of ['review', 'verify', 'context'].entries()) {
  time = 1500 + i * 1000;
  const mark = await markVideo({ ...folder, step }, deps);
  assert.equal(mark.result, step === 'verify' ? 'failed' : 'passed', JSON.stringify(mark));
}
time = 5000;
const result = await stopVideo(folder, deps);
assert.equal(result.result, 'failed', JSON.stringify(result));
const dimensions = await probeVideo(result.video);
assert.equal(dimensions.width, 480); assert.ok(dimensions.height > 640); assert.ok(Math.abs(dimensions.durationMs - 6000) < 100);
const run = await readRun(join(cwd, 'video'));
assert.deepEqual(checklistAt(run, 4000).map(row => row.status), ['PASS', 'FAIL', 'INFO']);
const streams = JSON.parse(await mediaCommand('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', result.video]));
assert.ok(streams.streams.some(s => s.codec_type === 'audio'));
await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-i', result.video, '-f', 'null', '-']);
for (const [name, at] of [['pending', 0], ['checking', 0.6], ['failed', 2], ['ending', 5]]) {
  await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-ss', String(at), '-i', result.video, '-frames:v', '1', '-y', join(cwd, `${name}.png`)]);
}
const before = await readFile(result.video);
assert.equal((await renderVideo(folder)).result, 'failed');
assert.deepEqual(await readFile(result.video), before);
// Cached output integrity is verified without trusting a nonempty file or matching dimensions.
assert.match(run.export.sha256, /^[a-f0-9]{64}$/);
await writeFile(result.video, 'unrelated video file');
assert.equal((await renderVideo(folder)).error.code, 'VIDEO_EXPORT_INVALID');
assert.equal(await readFile(result.video, 'utf8'), 'unrelated video file');
await unlink(result.video);
assert.equal((await renderVideo(folder)).result, 'failed');
assert.deepEqual(await readFile(result.video), before);
// Older ledgers migrate only after a deterministic export matches the existing file.
delete run.export.sha256;
await saveRun(join(cwd, 'video'), run);
assert.equal((await renderVideo(folder)).result, 'failed');
assert.match((await readRun(join(cwd, 'video'))).export.sha256, /^[a-f0-9]{64}$/);
assert.deepEqual(await readFile(result.video), before);
// Simulate a crash after atomic MP4 publication but before updating video.json.
delete run.export;
await saveRun(join(cwd, 'video'), run);
assert.equal((await renderVideo(folder)).result, 'failed');
assert.deepEqual(await readFile(result.video), before);
// A pre-existing unrelated output must survive the same recovery path.
await saveRun(join(cwd, 'video'), run);
await writeFile(result.video, 'unrelated video file');
assert.equal((await renderVideo(folder)).error.code, 'VIDEO_OUTPUT_EXISTS');
assert.equal(await readFile(result.video, 'utf8'), 'unrelated video file');
await writeFile(result.video, before);
assert.equal((await renderVideo(folder)).result, 'failed');
console.log(JSON.stringify({ result: 'passed', test: 'synthetic video + real capture evaluation/render/persistence', video: result.video, dimensions, stills: cwd }));

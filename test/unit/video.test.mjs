import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startVideo, markVideo, stopVideo, renderVideo } from '../../dist/video/public.js';
import { readRun, saveRun } from '../../dist/video/store.js';
import { checklistAt, videoSchema, videoOutcome } from '../../dist/video/schema.js';
import { checklistRenderer } from '../../dist/video/render.js';
import { PNG } from 'pngjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/capture-spike/ios/capture.snapshot.json', import.meta.url)));
const screenshot = await readFile(new URL('../fixtures/capture-spike/ios/capture.raw.png', import.meta.url));
const environment = JSON.parse(await readFile(new URL('../../examples/environment.complete.json', import.meta.url)));
const build = { appId: 'dev.deviceproof.fixture', native: 'neutral-build', runtime: { kind: 'embedded' } };
const spec = { criteria: [{ criterion: 'The cart is ready', steps: {
  review: { checks: [{ target: 'id="center"', expect: { exists: true } }] },
  checkout: { checks: [{ target: 'id="center"', expect: { text: 'wrong' } }] },
  context: {},
} }] };
async function setup(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'device-video-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'flow.json'), JSON.stringify(spec));
  const calls = [];
  let clock = 1000, raw;
  const identity = { address: 'fixture', createdAt: 1, platform: 'ios', deviceId: 'fixture', agentDevice: '0.21.27' };
  const deps = { clock: () => clock += 100, preflight: async () => {},
    device: async (_, expected) => {
      if (expected) assert.deepEqual(expected, identity);
      return { identity, start: async path => { calls.push('start'); raw = path; return { recording: 'started', outPath: path }; }, stop: async () => {
        calls.push('stop'); await writeFile(raw, 'stub-video'); return { recording: 'stopped', outPath: raw, recorder: 'confirmed' };
      } };
    },
    captureAdapter: async () => ({ platform: 'ios', environment: async () => environment, wait: async () => {}, snapshot: async () => fixture, screenshot: async () => screenshot, close: async () => {} }),
    export: async directory => { calls.push('export'); await writeFile(join(directory, 'annotated.mp4'), 'stub-export'); return { path: 'annotated.mp4', durationMs: 5000, width: 480, height: 900 }; },
  };
  return { cwd, calls, deps, options: { cwd, out: 'video', specPath: 'flow.json', build, platform: 'ios' }, folder: { cwd, out: 'video' }, directory: join(cwd, 'video') };
}
test('video flow retains captures, orders marks, accumulates real results, and stops idempotently', async t => {
  const s = await setup(t);
  assert.equal((await startVideo(s.options, s.deps)).state, 'recording');
  assert.equal((await markVideo({ ...s.folder, step: 'checkout' }, s.deps)).error.code, 'VIDEO_STEP_ORDER');
  assert.equal((await markVideo({ ...s.folder, step: 'review' }, s.deps)).result, 'passed');
  assert.equal((await markVideo({ ...s.folder, step: 'checkout' }, s.deps)).result, 'failed');
  assert.equal((await markVideo({ ...s.folder, step: 'context' }, s.deps)).result, 'passed');
  const run = await readRun(s.directory);
  assert.deepEqual(checklistAt(run, 0).map(r => r.status), ['PENDING', 'PENDING', 'PENDING']);
  assert.equal(checklistAt(run, run.marks[0].startedMs)[0].status, 'CHECKING');
  assert.equal(checklistAt(run, run.marks[0].completedMs - 1)[0].status, 'CHECKING');
  assert.deepEqual(checklistAt(run, 9999).map(r => r.status), ['PASS', 'FAIL', 'INFO']);
  assert.match(checklistAt(run, 9999)[1].details[0], /Expected.*wrong.*actual/);
  assert.equal((await stopVideo(s.folder, s.deps)).result, 'failed');
  assert.equal((await stopVideo(s.folder, s.deps)).result, 'failed');
  assert.deepEqual(s.calls, ['start', 'stop', 'export']);
  const image = await readFile(join(s.directory, 'evidence', run.marks[0].attempt.image));
  assert.ok(image.length > 100);
  const changed = structuredClone(run); changed.marks[0].attempt.checks[0].result = 'fail';
  assert.equal(videoSchema.safeParse(changed).success, false);
});
test('rejects unsafe input, existing outputs, masks, and missing multi-step build before recording', async t => {
  const s = await setup(t);
  const noBuild = { ...s.options }; delete noBuild.build;
  assert.equal((await startVideo(noBuild, s.deps)).result, 'error');
  await writeFile(join(s.cwd, 'flow.json'), JSON.stringify({ criteria: [{ criterion: 'Mask', steps: { a: { annotate: [{ mask: { target: 'id="secret"' } }] } } }] }));
  assert.equal((await startVideo(s.options, s.deps)).error.code, 'VIDEO_SPEC_UNSUPPORTED');
  assert.deepEqual(s.calls, []);
  await writeFile(join(s.cwd, 'flow.json'), JSON.stringify(spec));
  await startVideo(s.options, s.deps);
  assert.equal((await startVideo(s.options, s.deps)).error.code, 'VIDEO_OUTPUT_EXISTS');
  assert.deepEqual(s.calls, ['start']);
});
test('incomplete and interrupted marks never turn into passes; interrupted check blocks later marks', async t => {
  const s = await setup(t); await startVideo(s.options, s.deps);
  const run = await readRun(s.directory); run.marks.push({ step: 'review', startedMs: 100 }); await saveRun(s.directory, run);
  assert.equal((await markVideo({ ...s.folder, step: 'checkout' }, s.deps)).error.code, 'VIDEO_MARK_INTERRUPTED');
  const stopped = await stopVideo(s.folder, s.deps);
  assert.equal(stopped.error.code, 'VIDEO_FLOW_INCOMPLETE');
  const final = await readRun(s.directory);
  assert.deepEqual(checklistAt(final, 9999).map(r => r.status), ['ERROR', 'PENDING', 'PENDING']);
  assert.equal(videoOutcome(final), 'error');
});
test('export failures retain raw evidence and permit offline retry without stopping twice', async t => {
  const s = await setup(t); await startVideo(s.options, s.deps);
  const failed = await stopVideo(s.folder, { ...s.deps, export: async () => { throw new Error('encoder unavailable'); } });
  assert.equal(failed.result, 'error');
  assert.equal((await readRun(s.directory)).state, 'stopped');
  assert.equal(await readFile(join(s.directory, 'raw.mp4'), 'utf8'), 'stub-video');
  await renderVideo(s.folder, s.deps);
  assert.deepEqual(s.calls, ['start', 'stop', 'export']);
});
test('uncertain start never stops an unowned recorder', async t => {
  const s = await setup(t);
  const original = s.deps.device;
  s.deps.device = async (...args) => ({ ...await original(...args), start: async () => { throw new Error('start failed'); } });
  assert.equal((await startVideo(s.options, s.deps)).result, 'error');
  assert.equal((await stopVideo(s.folder, s.deps)).error.code, 'VIDEO_START_UNCONFIRMED');
  assert.deepEqual(s.calls, []);
});
test('edited frozen spec and changed session cannot publish new checks', async t => {
  const s = await setup(t); await startVideo(s.options, s.deps);
  await writeFile(join(s.directory, 'spec.json'), JSON.stringify({ criteria: [{ criterion: 'Different', steps: { review: {} } }] }));
  assert.equal((await markVideo({ ...s.folder, step: 'review' }, s.deps)).error.code, 'VIDEO_SPEC_CHANGED');
  assert.equal((await readRun(s.directory)).marks.length, 0);
});
test('footer renders all rows and preserves fixed dimensions through failure', async t => {
  const s = await setup(t); await startVideo(s.options, s.deps);
  for (const step of ['review', 'checkout', 'context']) await markVideo({ ...s.folder, step }, s.deps);
  const run = await readRun(s.directory);
  const times = [0, run.marks[0].startedMs, 9999];
  const renderer = await checklistRenderer(run, 480, times, 9000);
  const frames = times.map((_, i) => renderer.render(i));
  for (const frame of frames) {
    const png = PNG.sync.read(Buffer.from(frame.png));
    assert.equal(png.width, 480); assert.equal(png.height, renderer.height);
  }
  assert.ok(frames[0].svg.includes('PENDING')); assert.ok(frames[2].svg.includes('FAIL'));
  assert.ok(frames[2].svg.includes('Recording ended'));
  assert.notDeepEqual(frames[0].png, frames[2].png);
});

test('environment changes during recording become explicit evidence errors', async t => {
  const s = await setup(t); await startVideo(s.options, s.deps);
  const original = s.deps.captureAdapter;
  s.deps.captureAdapter = async (...args) => ({ ...await original(...args), environment: async () => ({ ...environment, display: { ...environment.display, appearance: 'dark' } }) });
  const result = await markVideo({ ...s.folder, step: 'review' }, s.deps);
  assert.equal(result.result, 'error');
  assert.equal(result.attempt.error.code, 'ENVIRONMENT_CHANGED');
  assert.equal(result.attempt.checkCounts.total, 0);
  assert.equal(checklistAt(await readRun(s.directory), 9999)[0].status, 'ERROR');
});
test('busy folder and backwards clock refuse mutation', async t => {
  const s = await setup(t); await startVideo(s.options, s.deps);
  const { lockOutput } = await import('../../dist/capture/lock.js');
  const lock = await lockOutput(s.directory);
  try { assert.equal((await markVideo({ ...s.folder, step: 'review' }, s.deps)).error.code, 'OUTPUT_BUSY'); }
  finally { await lock.release(); }
  assert.equal((await markVideo({ ...s.folder, step: 'review' }, { ...s.deps, clock: () => 0 })).error.code, 'VIDEO_CLOCK_CHANGED');
  assert.equal((await readRun(s.directory)).marks.length, 0);
});


test('long checklists wrap every row and safely display XML and unsupported Unicode', async t => {
  const s = await setup(t); await startVideo(s.options, s.deps);
  const run = await readRun(s.directory);
  run.spec.criteria = [{ criterion: 'Review <script> & a long criterion with café and 🦊 without hiding words', steps: Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`step-${i + 1}-with-a-long-description-that-wraps-to-the-next-line`, {}])
  ) }];
  const renderer = await checklistRenderer(run, 480, [0, 9999], 9000);
  const output = renderer.render(0);
  assert.equal((output.svg.match(/<title>PENDING<\/title>/g) ?? []).length, 12);
  assert.ok(output.svg.includes('&lt;script&gt;'));
  assert.ok(!output.svg.includes('<script>'));
  assert.ok(output.svg.includes('u{1F98A}'));
  assert.ok(renderer.height > 700 && renderer.height < 8192);
});


test('cached exports detect changed bytes, preserve replacements, and rebuild missing files', async t => {
  const s = await setup(t); await startVideo(s.options, s.deps);
  await stopVideo(s.folder, s.deps);
  const output = join(s.directory, 'annotated.mp4');
  const run = await readRun(s.directory);
  assert.match(run.export.sha256, /^[a-f0-9]{64}$/);
  await writeFile(output, 'not a video');
  assert.equal((await renderVideo(s.folder, s.deps)).error.code, 'VIDEO_EXPORT_INVALID');
  assert.equal(await readFile(output, 'utf8'), 'not a video');
  assert.equal(s.calls.filter(c => c === 'export').length, 1);
  await rm(output);
  await renderVideo(s.folder, s.deps);
  assert.equal(await readFile(output, 'utf8'), 'stub-export');
  assert.equal(s.calls.filter(c => c === 'export').length, 2);
  assert.equal((await readRun(s.directory)).export.sha256, run.export.sha256);
  await rm(output);
  await symlink(join(s.cwd, 'missing-target'), output);
  assert.equal((await renderVideo(s.folder, s.deps)).error.code, 'VIDEO_UNAVAILABLE');
  assert.equal(s.calls.filter(c => c === 'export').length, 2);
});

test('source and composed-output probe limits accommodate the footer and final hold', async () => {
  const { validateVideoProbe } = await import('../../dist/video/media.js');
  const probe = (width, height, duration) => ({ streams: [{ width, height, duration: String(duration), sample_aspect_ratio: '1:1' }] });
  assert.deepEqual(validateVideoProbe(probe(8192, 8192, 3600)), { width: 8192, height: 8192, durationMs: 3600000 });
  assert.deepEqual(validateVideoProbe(probe(8192, 16384, 3602), 'export'), { width: 8192, height: 16384, durationMs: 3602000 });
  for (const metadata of [probe(480, 8200, 5), probe(480, 900, 3602)]) {
    assert.throws(() => validateVideoProbe(metadata), { code: 'VIDEO_UNSUPPORTED' });
    assert.doesNotThrow(() => validateVideoProbe(metadata, 'export'));
  }
  for (const metadata of [probe(8194, 900, 5), probe(480, 16386, 5), probe(480, 900, 3602.1)]) {
    assert.throws(() => validateVideoProbe(metadata, 'export'), { code: 'VIDEO_UNSUPPORTED' });
  }
});

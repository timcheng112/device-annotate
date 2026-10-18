import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, symlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCapture } from '../../dist/capture/public.js';
import { selectSession } from '../../dist/capture/device.js';
import { waitForQuietSnapshots, snapshotsMatch } from '../../dist/capture/stable.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/capture-spike/ios/capture.snapshot.json', import.meta.url)));
const screenshot = await readFile(new URL('../fixtures/capture-spike/ios/capture.raw.png', import.meta.url));
const environment = JSON.parse(await readFile(new URL('../../examples/environment.complete.json', import.meta.url)));
async function setup(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'device-annotate-public-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  let calls = 0;
  return { cwd, options: { cwd, step: 'sample', criterion: 'Neutral evidence', out: 'output' },
    calls: () => calls,
    adapter: async () => { calls++; return { platform: 'ios', environment: async () => environment, wait: async () => {}, snapshot: async () => fixture, screenshot: async () => screenshot, close: async () => {} }; },
  };
}
test('public preflight rejects missing recordings and incomplete multi-step build before device work', async (t) => {
  const s = await setup(t);
  const bad = await runCapture({ ...s.options, recordings: ['missing'] }, s.adapter);
  assert.equal(bad.error.code, 'RECORDING_UNAVAILABLE'); assert.equal(s.calls(), 0);
  await writeFile(join(s.cwd, 'flow.yaml'), 'criteria:\n  - criterion: Neutral\n    steps:\n      first: {}\n      second: {}\n');
  const build = await runCapture({ cwd: s.cwd, specPath: 'flow.yaml', step: 'first' }, s.adapter);
  assert.equal(build.error.code, 'INVALID_INPUT'); assert.equal(s.calls(), 0);
});
test('spec aliases share ownership while output follows the supplied spec path', async (t) => {
  const s = await setup(t);
  await writeFile(join(s.cwd, 'flow.yaml'), 'out: output\ncriteria:\n  - criterion: Neutral\n    steps:\n      sample: {}\n');
  await symlink('flow.yaml', join(s.cwd, 'alias.yaml'));
  for (const specPath of ['flow.yaml', 'alias.yaml']) {
    const result = await runCapture({ cwd: s.cwd, specPath, step: 'sample' }, s.adapter);
    assert.equal(result.result, 'passed');
  }
  const manifest = JSON.parse(await readFile(join(s.cwd, 'output/manifest.json')));
  assert.equal(manifest.history.length, 1); assert.match(manifest.owner.specPath, /flow.yaml$/);
});
for (const alias of ['direct', 'symlink', 'hardlink']) test(`recording ${alias} alias of manifest is preserved before device access`, async (t) => {
  const s = await setup(t);
  await runCapture(s.options, s.adapter);
  const manifest = join(s.cwd, 'output/manifest.json');
  const before = await readFile(manifest);
  let recording = manifest;
  if (alias !== 'direct') {
    recording = join(s.cwd, 'recording');
    await (alias === 'symlink' ? symlink : link)(manifest, recording);
  }
  const result = await runCapture({ ...s.options, recordings: [recording] }, s.adapter);
  assert.equal(result.error.code, 'RECORDING_OUTPUT_CONFLICT'); assert.equal(s.calls(), 1);
  assert.deepEqual(await readFile(manifest), before); assert.deepEqual(await readFile(recording), before);
});
test('selects exact explicit addresses and refuses ambiguous implicit inventory', () => {
  const entry = (address, platform = 'ios') => ({ name: address.startsWith('cwd:') ? 'default' : address, address, device: { platform } });
  const ios = entry('cwd:scope:ios'), android = entry('cwd:scope:android', 'android'), named = entry('fixture');
  assert.equal(selectSession([ios, android, named], { platform: 'ios' }), ios);
  assert.equal(selectSession([ios, android, named], { session: 'fixture' }), named);
  assert.throws(() => selectSession([ios, android], {}), { code: 'SESSION_UNAVAILABLE' });
  assert.throws(() => selectSession([named], {}), { code: 'SESSION_UNAVAILABLE' });
});
test('quiet loop resets its interval on evidence change and ignores refs and timing', async () => {
  let clock = 0, count = 0;
  await waitForQuietSnapshots(async () => {
    const s = structuredClone(fixture); s.nodes[0].ref = String(++count);
    s.nodes[0].label = clock < 200 ? 'before' : 'after';
    return s;
  }, { quietMs: 500, timeoutMs: 1000, now: () => clock, sleep: async (ms) => { clock += ms; } });
  assert.equal(clock, 700);
  const a = { ...fixture, snapshotQuality: { state: 'healthy', backend: 'tree', timing: { acquisitionMs: 1, presentationMs: 2 } } };
  const b = structuredClone(a); b.snapshotQuality.timing.acquisitionMs = 100;
  assert.equal(snapshotsMatch(a, b), true);
  b.snapshotQuality.state = 'sparse'; assert.equal(snapshotsMatch(a, b), false);
  assert.equal(snapshotsMatch({ ...fixture, androidSnapshot: { elapsedMs: 4, rootPresent: true } }, { ...fixture, androidSnapshot: { elapsedMs: 7, rootPresent: true } }), true);
  assert.equal(snapshotsMatch({ ...fixture, androidSnapshot: { elapsedMs: 4, rootPresent: true } }, { ...fixture, androidSnapshot: { elapsedMs: 7, rootPresent: false } }), false);
  assert.equal(snapshotsMatch({ ...fixture, androidSnapshot: { helperSessionReused: true, rootPresent: true } }, { ...fixture, androidSnapshot: { helperSessionReused: false, rootPresent: true } }), true);
  assert.equal(snapshotsMatch({ ...fixture, androidSnapshot: { helperSessionReused: true, rootPresent: true } }, { ...fixture, androidSnapshot: { helperSessionReused: false, rootPresent: false } }), false);
});
test('quiet loop bounds changes and propagates observe-only refusal without retry', async () => {
  let clock = 0;
  await assert.rejects(waitForQuietSnapshots(async () => ({ ...fixture, changing: clock }), {
    timeoutMs: 300, now: () => clock, sleep: async (ms) => { clock += ms; },
  }), { code: 'CAPTURE_UNSTABLE' });
  assert.equal(clock, 300);
  let calls = 0;
  await assert.rejects(waitForQuietSnapshots(async () => { calls++; throw new Error('foreground unavailable'); }), /foreground unavailable/);
  assert.equal(calls, 1);
});

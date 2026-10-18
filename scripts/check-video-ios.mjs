// Requires a pre-opened neutral iOS fixture on a dedicated Device Proof simulator.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentDeviceClient } from 'agent-device';
import { guardedTransport, installedAgentVersion } from '../dist/capture/daemon.js';
import { localDeviceAdapter, selectSession } from '../dist/capture/device.js';
import { probeVideo, mediaCommand } from '../dist/video/media.js';
import { checklistAt } from '../dist/video/schema.js';
import { readRun } from '../dist/video/store.js';
const exec = promisify(execFile);
const [session, udid] = process.argv.slice(2);
assert.ok(session && udid, 'Usage: node scripts/check-video-ios.mjs <neutral-session-address> <dedicated-simulator-udid>');
const root = fileURLToPath(new URL('../', import.meta.url));
const options = { cwd: root, platform: 'ios', session };
const client = createAgentDeviceClient({ cwd: root }, { transport: await guardedTransport({ version: await installedAgentVersion() }) });
const selected = selectSession(await client.sessions.list(), options);
assert.equal(selected.device.id, udid);
assert.match(selected.device.name, /^Device Proof/);
const observer = await localDeviceAdapter(options);
let environment;
try {
  const snapshot = await observer.snapshot();
  assert.equal(snapshot.appBundleId ?? snapshot.identifiers?.appId, 'dev.deviceproof.fixture');
  assert.ok(snapshot.nodes.some(n => n.identifier === 'center'));
  environment = await observer.environment();
} finally { await observer.close(); }
assert.deepEqual(environment.unavailable, []);
const base = join(root, 'scripts/m0/.local/video-verification');
await mkdir(base, { recursive: true });
const out = await mkdtemp(join(base, 'ios-'));
const app = (await exec('xcrun', ['simctl', 'get_app_container', udid, 'dev.deviceproof.fixture', 'app'])).stdout.trim();
const hash = createHash('sha256').update(await readFile(join(app, 'DeviceProofFixture'))).digest('hex');
const build = join(out, 'build.json');
await writeFile(build, JSON.stringify({ appId: 'dev.deviceproof.fixture', native: `sha256:${hash}`, runtime: { kind: 'embedded' } }));
const cli = join(root, 'bin/device-annotate.mjs');
async function command(args, expectedExit = 0) {
  let result;
  try { result = { ...await exec(process.execPath, [cli, ...args], { cwd: root, timeout: 240000, maxBuffer: 4 * 1024 * 1024 }), code: 0 }; }
  catch (error) { result = error; }
  assert.equal(result.code, expectedExit, result.stderr || result.stdout || result.message);
  const data = JSON.parse(result.stdout);
  console.log(JSON.stringify({ command: args.slice(0, 2), result: data.result, state: data.state, error: data.error }));
  return data;
}
const cases = [];
for (const [name, config, exit, status] of [
  ['pass', { checks: [{ target: 'id="center"', expect: { exists: true } }] }, 0, 'PASS'],
  ['fail', { checks: [{ target: 'id="center"', expect: { text: 'deliberately wrong' } }] }, 1, 'FAIL'],
  ['info', { annotate: [{ box: { target: 'id="center"', text: 'Context only' } }] }, 0, 'INFO'],
]) {
  const spec = join(out, `${name}.json`), folder = join(out, name);
  await writeFile(spec, JSON.stringify({ criteria: [{ criterion: `Neutral iOS ${name} video evidence`, steps: { sample: config } }] }));
  await command(['video', 'start', spec, '--out', folder, '--build', build, '--platform', 'ios', '--session', session]);
  let stopped = false;
  try {
    const mark = await command(['video', 'mark', '--out', folder, '--step', 'sample'], exit);
    assert.equal(mark.attempt.checkCounts.total, name === 'info' ? 0 : 1);
    const result = await command(['video', 'stop', '--out', folder], exit);
    stopped = true;
    const info = await probeVideo(result.video, 'export');
    await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', result.video, '-f', 'null', '-']);
    await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-sseof', '-1', '-i', result.video, '-frames:v', '1', '-n', join(out, `${name}.png`)]);
    const run = await readRun(folder);
    assert.equal(checklistAt(run, info.durationMs)[0].status, status);
    assert.equal(checklistAt(run, run.marks[0].completedMs - 1)[0].status, 'CHECKING');
    const before = createHash('sha256').update(await readFile(result.video)).digest('hex');
    assert.equal(before, run.export.sha256);
    await command(['video', 'render', '--out', folder], exit);
    assert.equal(createHash('sha256').update(await readFile(result.video)).digest('hex'), before);
    cases.push({ name, result: 'passed', expectedExit: exit, checklist: status, video: result.video, info });
  } finally {
    if (!stopped) await exec(process.execPath, [cli, 'video', 'stop', '--out', folder], { cwd: root, timeout: 240000 }).catch(() => {});
  }
}
const steps = {
  review: { checks: [{ target: 'id="center"', expect: { exists: true } }] },
  verify: { checks: [{ target: 'id="center"', expect: { text: 'deliberately wrong' } }] },
  context: { annotate: [{ box: { target: 'id="center"', text: 'Context only' } }] },
};
const spec = join(out, 'multi.json'), folder = join(out, 'multi');
await writeFile(spec, JSON.stringify({ criteria: [{ criterion: 'iOS running checklist', steps }] }));
await command(['video', 'start', spec, '--out', folder, '--build', build, '--platform', 'ios', '--session', session]);
let stopped = false;
try {
  for (const [step, exit] of [['review', 0], ['verify', 1], ['context', 0]]) {
    await command(['video', 'mark', '--out', folder, '--step', step], exit);
  }
  const result = await command(['video', 'stop', '--out', folder], 1);
  stopped = true;
  const info = await probeVideo(result.video, 'export');
  await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', result.video, '-f', 'null', '-']);
  await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-sseof', '-1', '-i', result.video, '-frames:v', '1', '-n', join(out, 'multi.png')]);
  const run = await readRun(folder);
  assert.deepEqual(checklistAt(run, info.durationMs).map(row => row.status), ['PASS', 'FAIL', 'INFO']);
  assert.deepEqual(checklistAt(run, run.marks[1].startedMs).map(row => row.status), ['PASS', 'CHECKING', 'PENDING']);
  const before = createHash('sha256').update(await readFile(result.video)).digest('hex');
  await command(['video', 'render', '--out', folder], 1);
  assert.equal(createHash('sha256').update(await readFile(result.video)).digest('hex'), before);
  cases.push({ name: 'multi-step', result: 'passed', video: result.video, info });
} finally {
  if (!stopped) await exec(process.execPath, [cli, 'video', 'stop', '--out', folder], { cwd: root, timeout: 240000 }).catch(() => {});
}
const rotationFolder = join(out, 'rotation');
await command(['video', 'start', spec, '--out', rotationFolder, '--build', build, '--platform', 'ios', '--session', session]);
const rotate = direction => exec(process.execPath, [join(root, 'node_modules/agent-device/bin/agent-device.mjs'), 'orientation', direction, '--platform', 'ios', '--session', session, '--json'], { cwd: root, timeout: 120000 });
try {
  await command(['video', 'mark', '--out', rotationFolder, '--step', 'review']);
  await rotate('landscape-left');
  const changed = await command(['video', 'mark', '--out', rotationFolder, '--step', 'verify'], 2);
  assert.equal(changed.attempt.error.code, 'ENVIRONMENT_CHANGED');
  assert.equal(changed.attempt.checkCounts.total, 0);
  cases.push({ name: 'rotation-change', result: 'refused-as-required' });
} finally {
  await exec(process.execPath, [cli, 'video', 'stop', '--out', rotationFolder], { cwd: root, timeout: 240000 }).catch(() => {});
  await rotate('portrait');
}
await writeFile(join(out, 'summary.json'), JSON.stringify({ platform: 'ios', udid, cases }, null, 2) + '\n');
console.log(JSON.stringify({ result: 'passed', out, cases }));

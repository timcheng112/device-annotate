// Requires an already opened neutral Android fixture session; never boots or opens apps.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeVideo, mediaCommand } from '../dist/video/media.js';
const exec = promisify(execFile);
const [session, serial] = process.argv.slice(2);
assert.ok(session && serial, 'Usage: node scripts/check-video-native.mjs <neutral-session-address> <android-serial>');
const root = fileURLToPath(new URL('../', import.meta.url));
const base = resolve(root, 'scripts/m0/.local/video-verification'); await mkdir(base, { recursive: true });
const out = await mkdtemp(join(base, 'native-'));
const installedPath = (await exec('adb', ['-s', serial, 'shell', 'pm', 'path', 'dev.deviceproof.fixture'])).stdout.trim().replace(/^package:/, '');
assert.ok(installedPath.endsWith('/base.apk') && !installedPath.includes('\n'));
await exec('adb', ['-s', serial, 'pull', installedPath, join(out, 'installed.apk')]);
const hash = createHash('sha256').update(await readFile(join(out, 'installed.apk'))).digest('hex');
await writeFile(join(out, 'build.json'), JSON.stringify({ appId: 'dev.deviceproof.fixture', native: `sha256:${hash}`, runtime: { kind: 'embedded' } }));
await writeFile(join(out, 'flow.json'), JSON.stringify({ criteria: [{ criterion: 'The center control is visible and reads Complete', steps: {
  review: { checks: [{ target: 'id="dev.deviceproof.fixture:id/center"', expect: { visible: true } }] },
  verify: { checks: [{ target: 'id="dev.deviceproof.fixture:id/center"', expect: { text: 'Complete' } }] },
  context: { annotate: [{ box: { target: 'id="dev.deviceproof.fixture:id/top_left"', text: 'Context only' } }] },
} }] }));
const cli = resolve(root, 'bin/device-annotate.mjs');
async function command(args, code = 0) {
  let result;
  try { result = await exec(process.execPath, [cli, ...args], { cwd: root, timeout: 240000, maxBuffer: 4 * 1024 * 1024 }); assert.equal(code, 0); }
  catch (error) { assert.equal(error.code, code, error.stderr || error.stdout || error.message); result = error; }
  const data = JSON.parse(result.stdout); console.log(JSON.stringify({ command: args.slice(0, 2), result: data.result, error: data.error, state: data.state })); return data;
}
const folder = join(out, 'video');
await command(['video', 'start', join(out, 'flow.json'), '--out', folder, '--build', join(out, 'build.json'), '--platform', 'android', '--session', session]);
let stopped = false;
try {
  await command(['video', 'mark', '--out', folder, '--step', 'review']);
  await exec(process.execPath, [resolve(root, 'node_modules/agent-device/bin/agent-device.mjs'), 'press', 'id="dev.deviceproof.fixture:id/center"', '--session', session, '--platform', 'android', '--json'], { cwd: root, timeout: 60000 });
  await command(['video', 'mark', '--out', folder, '--step', 'verify'], 1);
  await command(['video', 'mark', '--out', folder, '--step', 'context']);
  const result = await command(['video', 'stop', '--out', folder], 1); stopped = true;
  const info = await probeVideo(result.video);
  await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-i', result.video, '-f', 'null', '-']);
  await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-sseof', '-1', '-i', result.video, '-frames:v', '1', '-y', join(out, 'final.png')]);
  console.log(JSON.stringify({ result: 'passed', video: result.video, info, preview: join(out, 'final.png') }));
} finally {
  if (!stopped) await exec(process.execPath, [cli, 'video', 'stop', '--out', folder], { cwd: root, timeout: 240000 }).catch(() => {});
}

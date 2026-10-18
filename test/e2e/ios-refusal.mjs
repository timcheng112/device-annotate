import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createAgentDeviceClient } from 'agent-device';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectSession } from '../../dist/capture/device.js';
import { guardedTransport, installedAgentVersion, daemonStateDirectory } from '../../dist/capture/daemon.js';

const [udid, out] = process.argv.slice(2);
assert.ok(udid && out, 'Usage: node test/e2e/ios-refusal.mjs <dedicated-neutral-udid> <out>');
const client = createAgentDeviceClient({ cwd: process.cwd(), lockPlatform: 'ios' }, { transport: await guardedTransport({ version: await installedAgentVersion() }) });
const selected = selectSession(await client.sessions.list(), { platform: 'ios' });
assert.equal(selected.device.id, udid);
assert.match(selected.device.name, /^Device Proof/);
const metadata = join(daemonStateDirectory(), 'daemon.json');
const before = await readFile(metadata);
execFileSync('xcrun', ['simctl', 'terminate', udid, 'dev.deviceproof.fixture']);
try {
  const result = spawnSync(process.execPath, ['bin/device-annotate.mjs', 'capture', '--step', 'refused', '--criterion', 'Unavailable foreground app must not be activated', '--platform', 'ios', '--out', out], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 2, result.stderr);
  const attempt = JSON.parse(result.stdout);
  assert.equal(attempt.error.code, 'IOS_OBSERVATION_UNAVAILABLE');
  assert.equal(attempt.raw, undefined); assert.equal(attempt.image, undefined);
  const processes = execFileSync('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'], { encoding: 'utf8', timeout: 30_000 });
  assert.ok(!processes.split('\n').some((line) => /^\d+\s/.test(line) && line.includes('UIKitApplication:dev.deviceproof.fixture[')), 'Capture must not launch the terminated app');
  assert.deepEqual(await readFile(metadata), before);
  console.log(JSON.stringify({ result: 'passed', refusal: attempt.error.code, appRemainedStopped: true, daemonUnchanged: true }));
} finally {
  execFileSync('xcrun', ['simctl', 'launch', udid, 'dev.deviceproof.fixture'], { stdio: 'ignore' });
}

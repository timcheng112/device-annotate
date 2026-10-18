// Exercise actual interface direction, including equal-size opposite landscapes.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { localDeviceAdapter } from '../../dist/capture/device.js';
const [udid, session] = process.argv.slice(2);
assert.ok(udid, 'Usage: node test/e2e/ios-display.mjs <dedicated-neutral-udid> [session]');
const exec = promisify(execFile);
const adapter = await localDeviceAdapter({ cwd: process.cwd(), platform: 'ios', ...(session ? { session } : {}) });
const rotate = direction => exec(process.execPath, ['node_modules/agent-device/bin/agent-device.mjs', 'orientation', direction, '--platform', 'ios', ...(session ? ['--session', session] : []), '--json'], { timeout: 120000 });
try {
  const snapshot = await adapter.snapshot();
  assert.equal(snapshot.appBundleId ?? snapshot.identifiers?.appId, 'dev.deviceproof.fixture');
  const initial = await adapter.environment();
  assert.equal(initial.device.identity?.id, udid);
  assert.deepEqual(initial.unavailable, []);
  assert.equal(initial.display.rotation, 'portrait');
  for (const [physical, expected] of [['landscape-left', 'landscape-right'], ['landscape-right', 'landscape-left'], ['portrait', 'portrait']]) {
    await rotate(physical);
    let observed;
    for (let attempt = 0; attempt < 5; attempt++) {
      observed = await adapter.environment();
      if (observed.display.rotation === expected) break;
      await setTimeout(500);
    }
    assert.deepEqual(observed.unavailable, []);
    assert.equal(observed.display.rotation, expected);
    const landscape = physical.startsWith('landscape');
    assert.equal(observed.display.pixelWidth, landscape ? initial.display.pixelHeight : initial.display.pixelWidth);
    assert.equal(observed.display.pixelHeight, landscape ? initial.display.pixelWidth : initial.display.pixelHeight);
    console.log(JSON.stringify({ physical, interface: expected, display: observed.display, result: 'passed' }));
  }
} finally {
  await rotate('portrait');
  await adapter.close();
}

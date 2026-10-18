import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectEnvironment } from '../../dist/capture/environment.js';
import { assessEnvironment } from '../../dist/manifest/environment.js';

test('iOS probes bind to session simulator set and preserve unknown rotation on older tools', async (t) => {
  const set = await mkdtemp(join(tmpdir(), 'device-proof-set-'));
  t.after(() => rm(set, { recursive: true, force: true }));
  const calls = [];
  const session = { device: { ios: { udid: 'fixture', simulatorSetPath: set } } };
  const device = { platform: 'ios', kind: 'simulator', id: 'fixture', osVersion: '18.3' };
  const env = await collectEnvironment(session, device, '0.21.27', async (file, args) => {
    calls.push([file, args]);
    if (file.includes('ioreg')) return '"IOPlatformUUID" = "00000000-0000-0000-0000-000000000000"';
    if (args.includes('enumerate')) return '(1) LCD:\nScreen Type: Integrated\nPixel Size: {1206, 2622}\nPreferred UI Scale: 3';
    if (args.includes('appearance')) return 'dark';
    if (args.includes('content_size')) return 'accessibility-large';
    throw new Error('unsupported');
  });
  assert.equal(env.display.pixelDensity, 3); assert.equal(env.display.rotation, null);
  assert.equal(env.display.pixelWidth, null); assert.equal(env.display.appearance, 'dark');
  assert.deepEqual(env.display.textSize, { kind: 'ios-content-size', value: 'accessibility-large' });
  assert.match(env.device.identity.scope, /apple:/);
  assert.equal(assessEnvironment(env, 2).captureAllowed, false);
  assert.equal(assessEnvironment(env, 1).captureAllowed, true);
  for (const [, args] of calls.filter(([, args]) => args[0] === 'simctl')) {
    assert.deepEqual(args.slice(0, 3), ['simctl', '--set', set]); assert.ok(args.includes('fixture'));
    assert.ok(!args.includes('boot'));
  }
});
test('failed or unrecognized metadata reads remain explicit unknowns', async () => {
  const env = await collectEnvironment({ device: { android: { serial: 'emulator-1234' } } },
    { platform: 'android', kind: 'emulator', id: 'emulator-1234' }, '0.21.27', async () => 'null');
  assert.equal(env.device.identity, null); assert.equal(env.display.textSize, null);
  assert.equal(env.display.appearance, null);
  assert.equal(new Set(env.unavailable.map((x) => x.path.join('.'))).size, env.unavailable.length);
});
test('Android effective appearance and exact numeric font scale survive collection', async () => {
  const calls = [];
  const env = await collectEnvironment({ device: { android: { serial: 'emulator-1234' } } },
    { platform: 'android', kind: 'emulator', id: 'emulator-1234', osVersion: '13' }, '0.21.27', async (file, args) => {
      calls.push(args);
      if (args.includes('get-config')) return 'config: en-rUS-ldltr-sw393dp-w393dp-h759dp-normal-long-port-notnight-440dpi';
      if (args.includes('activity')) return '  mGlobalConfiguration: {1.07 310mcc260mnc [en_US] port}';
      if (args.includes('density')) return 'Physical density: 440\nOverride density: 480';
      return '';
    });
  assert.equal(env.display.appearance, 'light'); assert.equal(env.display.pixelDensity, 3);
  assert.deepEqual(env.display.textSize, { kind: 'android-font-scale', value: 1.07 });
  for (const args of calls.filter((args) => args[0] === '-s')) assert.equal(args[1], 'emulator-1234');
});

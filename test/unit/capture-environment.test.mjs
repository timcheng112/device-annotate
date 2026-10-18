import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectEnvironment } from '../../dist/capture/environment.js';
import { assessEnvironment } from '../../dist/manifest/environment.js';

test('iOS probes bind to session simulator set and preserve unknown rotation on older tools', async (t) => {
  const set = await mkdtemp(join(tmpdir(), 'device-annotate-set-'));
  t.after(() => rm(set, { recursive: true, force: true }));
  const calls = [];
  const session = { device: { ios: { udid: 'fixture', simulatorSetPath: set } } };
  const device = { platform: 'ios', kind: 'simulator', id: 'fixture', osVersion: '18.3' };
  const env = await collectEnvironment(session, device, '0.21.27', async (file, args) => {
    calls.push([file, args]);
    if (file.includes('ioreg')) return '"IOPlatformUUID" = "00000000-0000-0000-0000-000000000000"';
    if (args.includes('enumerate')) return 'Connected Screens:\n(1) LCD:\nScreen Type: Integrated\nPixel Size: {1206, 2622}\nPreferred UI Scale: 3';
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

test('iOS integrated display metadata uses observed interface orientation and scopes every device read', async t => {
  const set = await mkdtemp(join(tmpdir(), 'device-annotate-set-'));
  t.after(() => rm(set, { recursive: true, force: true }));
  const calls = [];
  let orientation = 'portrait';
  const session = { device: { ios: { udid: 'fixture', simulatorSetPath: set } } };
  const device = { platform: 'ios', kind: 'simulator', id: 'fixture', osVersion: '18.3' };
  const probe = async (file, args) => {
    calls.push([file, args]);
    if (file.includes('ioreg')) return '"IOPlatformUUID" = "00000000-0000-0000-0000-000000000000"';
    if (args.includes('enumerate')) return 'Connected Screens:\n(1) LCD:\nScreen Type: Integrated\nPixel Size: {1206, 2622}\nPreferred UI Scale: 3';
    if (args.includes('appearance')) return 'light';
    if (args.includes('content_size')) return 'large';
    if (args.includes('clang')) return '';
    if (args.includes('spawn')) return JSON.stringify({ version: 1, orientation });
    throw new Error('Unexpected probe');
  };
  for (const [value, width, height] of [['portrait', 1206, 2622], ['portrait-upside-down', 1206, 2622], ['landscape-left', 2622, 1206], ['landscape-right', 2622, 1206]]) {
    orientation = value;
    const env = await collectEnvironment(session, device, '0.21.27', probe);
    assert.equal(env.display.rotation, value);
    assert.equal(env.display.pixelWidth, width);
    assert.equal(env.display.pixelHeight, height);
    assert.equal(assessEnvironment(env, 2).captureAllowed, true);
  }
  for (const [, args] of calls.filter(([, args]) => args[0] === 'simctl')) {
    assert.deepEqual(args.slice(0, 3), ['simctl', '--set', set]);
    assert.ok(args.includes('fixture'));
    assert.ok(!args.includes('boot') && !args.includes('launch'));
  }
  assert.ok(!calls.some(([, args]) => args.includes('devicectl')));
});

test('simulator display parsing refuses ambiguous panels and invalid dimensions', async () => {
  const { integratedPanel } = await import('../../dist/capture/ios-display.js');
  const panel = '\n(1) LCD:\nScreen Type: Integrated\nPixel Size: {1206, 2622}\nPreferred UI Scale: 3';
  assert.deepEqual(integratedPanel('Connected Screens:' + panel), { width: 1206, height: 2622, density: 3 });
  for (const source of [panel, 'Connected Screens:' + panel + panel.replace('(1)', '(2)'), ('Connected Screens:' + panel).replace('1206', '0'), ('Connected Screens:' + panel).replace('Scale: 3', 'Scale: 0')]) {
    assert.equal(integratedPanel(source), undefined);
  }
});

test('orientation helper failures and unknown responses preserve unknown metadata and remove temporary files', async () => {
  const { simulatorInterfaceOrientation } = await import('../../dist/capture/ios-display.js');
  const { access } = await import('node:fs/promises');
  for (const response of ['bad json', '{"version":1,"orientation":"unknown"}', '{"version":2,"orientation":"portrait"}', '{"version":1,"orientation":null}']) {
    let binary;
    const result = await simulatorInterfaceOrientation('/neutral-set', 'fixture', async (_, args) => {
      if (args.includes('clang')) { binary = args.at(-1); return ''; }
      return response;
    });
    assert.equal(result, undefined);
    await assert.rejects(access(binary.replace(/\/orientation$/, '')), { code: 'ENOENT' });
  }
  assert.equal(await simulatorInterfaceOrientation('/neutral-set', 'fixture', async () => { throw new Error('tool missing'); }), undefined);
});

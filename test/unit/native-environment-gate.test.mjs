import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyNativeEnvironment } from '../e2e/environment-gate.mjs';

const environment = (...paths) => ({ unavailable: paths.map((path) => ({ path: path.split('.') })) });

test('native gate admits complete metadata on both platforms', () => {
  for (const platform of ['ios', 'android']) assert.deepEqual(verifyNativeEnvironment(platform, environment()), []);
});

test('Android metadata loss fails instead of skipping multi-step verification', () => {
  for (const path of ['device.identity', 'display.rotation', 'display.textSize', 'versions.agentDevice']) {
    assert.throws(() => verifyNativeEnvironment('android', environment(path)), /Unexpected unavailable android metadata/);
  }
});

test('iOS metadata loss fails instead of skipping multi-step verification', () => {
  for (const path of ['display.rotation', 'display.pixelWidth', 'display.pixelHeight', 'device.identity']) {
    assert.throws(() => verifyNativeEnvironment('ios', environment(path)), /Unexpected unavailable ios metadata/);
  }
});

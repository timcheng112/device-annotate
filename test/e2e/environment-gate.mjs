import assert from 'node:assert/strict';

// CI must exercise Android reuse. Only the measured iOS display limitation may
// select the refusal case; unrelated metadata regressions must fail the gate.
export function verifyNativeEnvironment(platform, environment) {
  const unavailable = environment.unavailable.map((entry) => entry.path.join('.'));
  const allowed = platform === 'ios'
    ? ['display.rotation', 'display.pixelWidth', 'display.pixelHeight'] : [];
  assert.deepEqual(unavailable.filter((path) => !allowed.includes(path)), [],
    `Unexpected unavailable ${platform} metadata: ${unavailable.join(', ')}`);
  return unavailable;
}

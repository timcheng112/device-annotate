import assert from 'node:assert/strict';

// Both native gates must exercise reuse with complete observed metadata.
export function verifyNativeEnvironment(platform, environment) {
  const unavailable = environment.unavailable.map((entry) => entry.path.join('.'));
  assert.deepEqual(unavailable, [],
    `Unexpected unavailable ${platform} metadata: ${unavailable.join(', ')}`);
  return unavailable;
}

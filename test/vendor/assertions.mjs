// The copied upstream tests use only these two Vitest assertion methods.
import assert from 'node:assert/strict';
export { test } from 'node:test';
export const expect = (actual) => ({
  toBe: (expected) => assert.strictEqual(actual, expected),
  toEqual: (expected) => assert.deepStrictEqual(actual, expected),
});

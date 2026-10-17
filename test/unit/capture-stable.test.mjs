import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { captureStable, snapshotsMatch } from '../../dist/capture/stable.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/capture-spike/ios/capture.snapshot.json', import.meta.url)));
test('stability ignores refs, acquisition timestamps, diagnostics, and object key ordering', () => {
  const after = structuredClone(fixture);
  after.refsGeneration++;
  after.createdAt = 12345;
  after.snapshotDiagnostics = { stats: { count: 999 } };
  after.nodes.forEach((node) => { node.ref = 'different'; });
  assert.equal(snapshotsMatch(fixture, after), true);
});
for (const [field, change] of [
  ['label', (s) => { s.nodes[1].label = 'changed'; }],
  ['geometry', (s) => { s.nodes[1].rect.x++; }],
  ['viewport', (s) => { s.viewport.width++; }],
  ['truncation', (s) => { s.truncated = true; }],
  ['visibility', (s) => { s.visibility.partial = true; }],
  ['identity', (s) => { s.identifiers.session = 'another'; }],
  ['unknown evidence field', (s) => { s.futureEvidence = true; }],
]) test(`stability rejects changed ${field}`, () => {
  const after = structuredClone(fixture); change(after);
  assert.equal(snapshotsMatch(fixture, after), false);
});

test('retries whole sequences and accepts only the matching pair', async () => {
  const changed = structuredClone(fixture); changed.nodes[1].label = 'changed';
  const snapshots = [fixture, changed, changed, changed];
  const calls = [];
  const result = await captureStable({
    async wait() { calls.push('wait'); },
    async snapshot() { calls.push('snapshot'); return snapshots.shift(); },
    async screenshot() { calls.push('screenshot'); return Uint8Array.of(calls.length); },
  }, () => new Date('2026-10-18T00:00:00Z'));
  assert.equal(result.snapshot, changed);
  assert.deepEqual([...result.screenshot], [7]);
  assert.equal(result.capturedAt, '2026-10-18T00:00:00.000Z');
  assert.deepEqual(calls, ['wait', 'snapshot', 'screenshot', 'snapshot', 'wait', 'snapshot', 'screenshot', 'snapshot']);
});

test('four unstable attempts preserve final raw observation without accepting it', async () => {
  let reads = 0, waits = 0;
  await assert.rejects(captureStable({
    async wait() { waits++; },
    async snapshot() { const s = structuredClone(fixture); s.nodes[1].label = String(++reads); return s; },
    async screenshot() { return Uint8Array.of(waits); },
  }), (error) => {
    assert.equal(error.code, 'CAPTURE_UNSTABLE');
    assert.equal(waits, 4); assert.equal(reads, 8);
    assert.deepEqual([...error.observation.screenshot], [4]);
    return true;
  });
});

test('a failed retry cannot combine an earlier screenshot with a new snapshot', async () => {
  let reads = 0, shots = 0;
  await assert.rejects(captureStable({
    async wait() {},
    async snapshot() { const s = structuredClone(fixture); s.nodes[1].label = String(++reads); return s; },
    async screenshot() { if (++shots === 2) throw new Error('offline'); return Uint8Array.of(1); },
  }), (error) => {
    assert.equal(error.code, 'CAPTURE_FAILED');
    assert.equal(error.observation.snapshot.nodes[1].label, '3');
    assert.equal(error.observation.screenshot, undefined);
    assert.equal(error.observation.capturedAt, undefined);
    return true;
  });
});

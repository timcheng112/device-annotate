import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { planHistoryPruning } from '../../dist/manifest/prune.js';
import { planAttemptArtifacts } from '../../dist/manifest/artifacts.js';
import { summarizeManifest } from '../../dist/manifest/schema.js';

const example = JSON.parse(readFileSync(new URL('../../examples/manifest-ledger.json', import.meta.url)));
const original = example.criteria[0].steps[0];
const clone = (value) => structuredClone(value);
const baseTime = Date.parse('2026-10-18T12:00:00.000Z');
const day = 86_400_000;
function attempt(id, age = 0, step = 'after') {
  const value = clone(original); value.attemptId = `${String(id).padStart(8,'0')}-0000-4000-8000-000000000000`;
  value.step = step; const { directory, ...paths } = planAttemptArtifacts({ step, attemptId: value.attemptId });
  Object.assign(value, paths, { attemptedAt: new Date(baseTime - age).toISOString(), capturedAt: new Date(baseTime - age).toISOString() });
  return value;
}
const paths = (attempt) => ['image','raw','snapshot'].flatMap((kind) => attempt[kind] ? [attempt[kind]] : []);
function args(history = [], retention = {}, bytes = 10) {
  const manifest = clone(example); manifest.history = history; Object.assign(manifest.retention, retention);
  const all = [original, ...history];
  return { manifest, now: baseTime, files: all.flatMap(paths).map((path) => ({ path, identity: path, bytes })), recordings: [] };
}
const prunedIds = (result) => result.pruned.map(({ attempt }) => attempt.attemptId);

test('history expires at seven elapsed days, not one millisecond before', () => {
  const old = attempt(1, 7*day), young = attempt(2, 7*day-1);
  const result = planHistoryPruning(args([old, young]));
  assert.deepEqual(prunedIds(result), [old.attemptId]); assert.deepEqual(result.retained, [young]);
  assert.equal(result.pruned[0].reason, 'age');
});

test('count limit keeps three previous attempts independently for each step, excluding current', () => {
  const history = [attempt(1, 4), attempt(2, 3), attempt(3, 2), attempt(4, 1), attempt(5, 9, 'removed')];
  const result = planHistoryPruning(args(history));
  assert.deepEqual(prunedIds(result), [history[0].attemptId]); assert.equal(result.retained.length, 4);
});

test('byte limit prunes oldest first, accepts exact limit, and excludes current files', () => {
  const first = attempt(1, 2), second = attempt(2, 1);
  assert.equal(planHistoryPruning(args([first,second], { maxBytes: 60 })).pruned.length, 0);
  const result = planHistoryPruning(args([first,second], { maxBytes: 59 }));
  assert.deepEqual(prunedIds(result), [first.attemptId]); assert.deepEqual(result.deletePaths, paths(first).sort());
  assert.equal(result.pruned[0].reason, 'bytes');
});

for (const limit of ['maxAttemptsPerStep', 'maxAgeDays', 'maxBytes']) test(`zero ${limit} disables history while protecting current evidence`, () => {
  const history = [attempt(1, 2), attempt(2, 1)];
  const result = planHistoryPruning(args(history, { [limit]: 0 }));
  assert.equal(result.retained.length, 0); assert.equal(result.deletePaths.length, 6);
  assert.ok(result.deletePaths.every((path) => !paths(original).includes(path)));
});

test('age, count, and byte limits apply together', () => {
  const history = [attempt(1, 8*day), attempt(2, 4), attempt(3, 3), attempt(4, 2), attempt(5, 1)];
  const result = planHistoryPruning(args(history, { maxBytes: 60 }));
  assert.deepEqual(result.pruned.map(({ reason }) => reason), ['age','count','bytes']);
  assert.deepEqual(result.retained.map(({ attemptId }) => attemptId), history.slice(-2).map(({ attemptId }) => attemptId));
});

test('current identity aliases are protected even if a historical path looks deletable', () => {
  const history = [attempt(1, 8*day)]; const input = args(history);
  input.files.find((file) => file.path === history[0].image).identity = original.image;
  const result = planHistoryPruning(input);
  assert.equal(result.pruned.length, 1); assert.ok(!result.deletePaths.includes(history[0].image));
  assert.ok(!result.deletePaths.includes(original.image));
});

test('caller recordings, including aliases of managed paths, are never deletion candidates', () => {
  const old = attempt(1, 8*day); old.recordings = ['/caller/video.mov'];
  const input = args([old]); input.recordings = [{ path: '/caller/video.mov', identity: old.raw }];
  const result = planHistoryPruning(input);
  assert.ok(!result.deletePaths.includes(old.raw));
  assert.ok(!result.deletePaths.includes('/caller/video.mov'));
  assert.equal(result.deletePaths.length, 2);
});

test('a retained attempt protects a shared file identity and bytes count shared storage once', () => {
  const old = attempt(1, 8*day), retained = attempt(2, 1); const input = args([old,retained]);
  input.files.find((file) => file.path === old.raw).identity = retained.raw;
  assert.ok(!planHistoryPruning(input).deletePaths.includes(old.raw));
  const a = attempt(3, 2), b = attempt(4, 1), shared = args([a,b], { maxBytes: 30 });
  for (const kind of ['image','raw','snapshot']) shared.files.find((file) => file.path === a[kind]).identity = b[kind];
  assert.equal(planHistoryPruning(shared).pruned.length, 0);
});

test('equal timestamps are pruned deterministically regardless of history order', () => {
  const a = attempt(1), b = attempt(2);
  assert.deepEqual(prunedIds(planHistoryPruning(args([b,a], { maxAttemptsPerStep: 1 }))), [a.attemptId]);
  assert.deepEqual(prunedIds(planHistoryPruning(args([a,b], { maxAttemptsPerStep: 1 }))), [a.attemptId]);
});

test('INFO and pre-capture error history use the same eligibility rules', () => {
  const info = attempt(1, 8*day); info.configuration.checks = []; info.checks = [];
  info.checkCounts = { total:0, passed:0, failed:0 }; info.geometry.targets = []; info.geometry.groups = [];
  const error = attempt(2, 8*day);
  for (const key of ['image','raw','snapshot','capturedAt','environment','geometry']) delete error[key];
  Object.assign(error, { result:'error', checks:[], checkCounts:{ total:0,passed:0,failed:0 }, error:{ code:'CAPTURE_FAILED',message:'Disconnected' } });
  const result = planHistoryPruning(args([info,error]));
  assert.equal(result.pruned.length, 2); assert.deepEqual(result.deletePaths, paths(info).sort());
});

test('future timestamps do not expire early, and cleanup previews preserve their inputs', () => {
  const input = args([attempt(1, -day)]); const before = clone(input);
  assert.equal(planHistoryPruning(input).pruned.length, 0); assert.deepEqual(input, before);
});

test('missing or inconsistent file observations fail closed instead of guessing deletion safety', () => {
  const input = args([attempt(1, 8*day)]);
  assert.throws(() => planHistoryPruning({ ...input, files: input.files.slice(1) }), /Missing artifact/);
  assert.throws(() => planHistoryPruning({ ...input, files: [...input.files, input.files[0]] }), /Duplicate/);
  const alias = clone(input); alias.files[1].identity = alias.files[0].identity; alias.files[1].bytes++;
  assert.throws(() => planHistoryPruning(alias), /same observed size/);
  input.manifest.history[0].recordings = ['/caller/video.mov'];
  assert.throws(() => planHistoryPruning(input), /recording identity/);
  assert.throws(() => planHistoryPruning({ ...input, now: NaN }));
});

test('unreferenced inventory paths never become deletion candidates', () => {
  const input = args([attempt(1, 8*day)]);
  input.files.push({ path: '/outside/private-file', identity: 'outside', bytes: 999 });
  assert.ok(!planHistoryPruning(input).deletePaths.includes('/outside/private-file'));
});

test('repeating cleanup after applying its preview produces no more removals', () => {
  const input = args([attempt(1, 8*day), attempt(2, 1)]), result = planHistoryPruning(input);
  input.manifest.history = result.retained;
  input.files = input.files.filter((file) => !result.deletePaths.includes(file.path));
  assert.deepEqual(planHistoryPruning(input).deletePaths, []);
  assert.equal(summarizeManifest(input.manifest).result, 'passed');
});

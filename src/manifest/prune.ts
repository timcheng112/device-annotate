import * as z from 'zod';
import { manifestSchema } from './schema.js';
import { referencedAttemptArtifacts } from './artifacts.js';
import type { Attempt } from './attempt.js';

const fileSchema = z.strictObject({ path: z.string().min(1), identity: z.string().min(1), bytes: z.number().int().nonnegative() });
const recordingSchema = z.strictObject({ path: z.string().min(1), identity: z.string().min(1) });
export type ManagedFileObservation = z.input<typeof fileSchema>;
export type RecordingObservation = z.input<typeof recordingSchema>;

/** Pure deletion preview. The filesystem adapter supplies canonical file identities and sizes.
 * Missing observations fail closed; this function never infers identity from a path spelling.
 */
export function planHistoryPruning(input: {
  manifest: unknown; now: number; files: ManagedFileObservation[]; recordings: RecordingObservation[];
}) {
  const manifest = manifestSchema.parse(input.manifest);
  const now = z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000).parse(input.now);
  const files = z.array(fileSchema).parse(input.files);
  const recordings = z.array(recordingSchema).parse(input.recordings);
  const byPath = new Map<string, z.output<typeof fileSchema>>();
  const sizes = new Map<string, number>();
  for (const file of files) {
    if (byPath.has(file.path)) throw new Error(`Duplicate artifact observation: ${file.path}`);
    const bytes = sizes.get(file.identity);
    if (bytes !== undefined && bytes !== file.bytes) throw new Error('Aliases of one file must have the same observed size.');
    byPath.set(file.path, file); sizes.set(file.identity, file.bytes);
  }
  const current = manifest.criteria.flatMap((group) => group.steps.filter((step): step is Attempt => step.result !== 'incomplete'));
  const all = [...current, ...manifest.history];
  const pathsFor = (attempt: Attempt) => referencedAttemptArtifacts({ step: attempt.step, attemptId: attempt.attemptId, ...(attempt.image ? { image: attempt.image } : {}), ...(attempt.raw ? { raw: attempt.raw } : {}), ...(attempt.snapshot ? { snapshot: attempt.snapshot } : {}) }).map(({ path }) => path);
  for (const attempt of all) for (const path of pathsFor(attempt)) if (!byPath.has(path)) throw new Error(`Missing artifact observation: ${path}`);
  const recordingByPath = new Map<string, string>();
  for (const recording of recordings) {
    if (recordingByPath.has(recording.path)) throw new Error(`Duplicate recording observation: ${recording.path}`);
    recordingByPath.set(recording.path, recording.identity);
  }
  const protectedIdentities = new Set(current.flatMap(pathsFor).map((path) => byPath.get(path)!.identity));
  for (const attempt of all) for (const path of attempt.recordings) {
    const identity = recordingByPath.get(path);
    if (identity === undefined) throw new Error(`Missing caller-owned recording identity: ${path}`);
    protectedIdentities.add(identity);
  }
  // Protect all caller-supplied recording observations, including extra aliases.
  for (const recording of recordings) protectedIdentities.add(recording.identity);
  const time = (attempt: Attempt) => Date.parse(attempt.capturedAt ?? attempt.attemptedAt);
  const oldest = [...manifest.history].sort((a, b) => time(a) - time(b) || (a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0));
  const removed = new Map<string, 'age' | 'count' | 'bytes' | 'disabled'>();
  const policy = manifest.retention;
  if (policy.maxAgeDays === 0 || policy.maxAttemptsPerStep === 0 || policy.maxBytes === 0) {
    for (const attempt of oldest) removed.set(attempt.attemptId, 'disabled');
  } else {
    for (const attempt of oldest) if ((now - time(attempt)) / 86_400_000 >= policy.maxAgeDays) removed.set(attempt.attemptId, 'age');
    const counts = new Map<string, number>();
    for (const attempt of [...oldest].reverse()) {
      if (removed.has(attempt.attemptId)) continue;
      const count = (counts.get(attempt.step) ?? 0) + 1;
      counts.set(attempt.step, count);
      if (count > policy.maxAttemptsPerStep) removed.set(attempt.attemptId, 'count');
    }
    const identitiesFor = (attempt: Attempt) => new Set(pathsFor(attempt).map((path) => byPath.get(path)!.identity));
    const references = new Map<string, number>();
    let bytes = 0n;
    for (const attempt of oldest) {
      if (removed.has(attempt.attemptId)) continue;
      for (const id of identitiesFor(attempt)) {
        const count = references.get(id) ?? 0;
        if (count === 0 && !protectedIdentities.has(id)) bytes += BigInt(sizes.get(id)!);
        references.set(id, count + 1);
      }
    }
    for (const attempt of oldest) {
      if (bytes <= BigInt(policy.maxBytes)) break;
      if (removed.has(attempt.attemptId)) continue;
      removed.set(attempt.attemptId, 'bytes');
      for (const id of identitiesFor(attempt)) {
        const count = references.get(id)! - 1;
        references.set(id, count);
        if (count === 0 && !protectedIdentities.has(id)) bytes -= BigInt(sizes.get(id)!);
      }
    }
  }
  const retained = manifest.history.filter((attempt) => !removed.has(attempt.attemptId));
  for (const attempt of retained) for (const path of pathsFor(attempt)) protectedIdentities.add(byPath.get(path)!.identity);
  const pruned = oldest.filter((attempt) => removed.has(attempt.attemptId));
  const deletePaths = pruned.flatMap(pathsFor).filter((path) => !protectedIdentities.has(byPath.get(path)!.identity));
  return {
    retained, pruned: pruned.map((attempt) => ({ attempt, reason: removed.get(attempt.attemptId)! })),
    deletePaths: [...new Set(deletePaths)].sort(),
  };
}

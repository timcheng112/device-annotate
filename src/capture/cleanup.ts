import { lstat, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { manifestSchema, summarizeManifest, type Manifest } from '../manifest/schema.js';
import { referencedAttemptArtifacts } from '../manifest/artifacts.js';
import { planHistoryPruning } from '../manifest/prune.js';
import { evidenceStore } from './store.js';
import { lockOutput } from './lock.js';
import { CaptureFailure } from './failure.js';
import { protectManifestRecording } from './recording-guard.js';
import * as z from 'zod';
import { localPathSchema } from '../spec/values.js';

/** Walk every managed component without following symlinks. Paths are schema-validated first. */
async function observe(directory: string, relative: string) {
  let file = directory;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    file = join(file, part);
    let info;
    try { info = await lstat(file); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { path: relative, identity: `missing:${relative}`, bytes: 0 };
      throw cause;
    }
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) {
      throw new CaptureFailure('ARTIFACT_PATH_UNSAFE', 'Cleanup found a symlink or special file in a managed artifact path. Existing evidence was preserved.');
    }
    if (index === parts.length - 1) return { path: relative, identity: `${info.dev}:${info.ino}`, bytes: info.size };
  }
  throw new Error('Empty artifact path.');
}

export async function previewCleanup(directory: string, input: Manifest, now = Date.now(), finished = false) {
  const original = manifestSchema.parse(input);
  let candidate = original;
  const hasAttempts = original.history.length > 0 || original.criteria.some((group) => group.steps.some((step) => step.result !== 'incomplete'));
  if (finished && hasAttempts) {
    if (original.result !== 'passed' && original.result !== 'failed') throw new CaptureFailure('RUN_NOT_FINISHED', 'Finished-run cleanup requires a fully captured passed or failed run. Use history cleanup for this folder.');
    candidate = summarizeManifest({ ...original, retention: { maxAttemptsPerStep: 0, maxAgeDays: 0, maxBytes: 0 },
      history: [...original.history, ...original.criteria.flatMap((group) => group.steps.filter((step) => step.result !== 'incomplete'))],
      criteria: original.criteria.map((group) => ({ ...group, steps: group.steps.map(({ step, configuration }) => ({ step, configuration, result: 'incomplete' as const, checkCounts: { total: 0, passed: 0, failed: 0 } })) })),
    });
  }
  const attempts = [...candidate.history, ...candidate.criteria.flatMap((group) => group.steps.filter((step) => step.result !== 'incomplete'))];
  await protectManifestRecording(directory, attempts.flatMap((attempt) => attempt.recordings));
  const paths = [...new Set(attempts.flatMap((attempt) => referencedAttemptArtifacts({ step: attempt.step, attemptId: attempt.attemptId,
    ...(attempt.image ? { image: attempt.image } : {}), ...(attempt.raw ? { raw: attempt.raw } : {}), ...(attempt.snapshot ? { snapshot: attempt.snapshot } : {}),
  }).map(({ path }) => path)))];
  const files = await Promise.all(paths.map((path) => observe(directory, path)));
  const recordings = await Promise.all([...new Set(attempts.flatMap((attempt) => attempt.recordings))].map(async (path) => {
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error('Not a regular recording.');
      return { path, identity: `${info.dev}:${info.ino}` };
    } catch (cause) {
      // An unavailable recording could have aliased a managed file. Do not infer ownership.
      throw new CaptureFailure('RECORDING_IDENTITY_UNAVAILABLE', 'Cleanup cannot establish a referenced recording’s file identity. Restore access to the recording before cleanup.', { cause });
    }
  }));
  const plan = planHistoryPruning({ manifest: candidate, now, files, recordings });
  const manifest = summarizeManifest({ ...candidate, retention: original.retention, history: plan.retained });
  return { plan, manifest, files };
}

/** Used only while the caller holds the folder lock, after a safely published capture. */
export async function applyHistoryCleanup(directory: string, manifest: Manifest, now = Date.now()) {
  const preview = await previewCleanup(directory, manifest, now);
  await apply(directory, preview);
  return preview.manifest;
}

async function apply(directory: string, preview: Awaited<ReturnType<typeof previewCleanup>>) {
  // Recheck every candidate before any deletion. Hard-link identities protect recordings.
  for (const path of preview.plan.deletePaths) {
    const current = await observe(directory, path);
    if (current.identity !== preview.files.find((file) => file.path === path)!.identity) throw new CaptureFailure('ARTIFACT_CHANGED', 'An artifact changed during cleanup. Retry after other filesystem activity finishes.');
  }
  for (const path of preview.plan.deletePaths) {
    await unlink(join(directory, path)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
  // If interrupted before publication, missing history files are observed as zero bytes on retry.
  // Current references remain protected and are never removed by automatic pruning.
  await evidenceStore(directory).publish(preview.manifest);
}

export async function cleanup(input: { outDir: string; apply?: boolean; finished?: boolean }) {
  const parsed = z.strictObject({ outDir: localPathSchema, apply: z.boolean().optional(), finished: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) throw new CaptureFailure('INVALID_INPUT', 'Supply an output directory and boolean apply/finished cleanup options.');
  const options = parsed.data;
  const lock = await lockOutput(options.outDir);
  try {
    const manifest = await evidenceStore(lock.directory).read();
    if (!manifest) throw new CaptureFailure('MANIFEST_UNAVAILABLE', 'This output folder has no evidence manifest to clean up.');
    const preview = await previewCleanup(lock.directory, manifest, Date.now(), options.finished ?? false);
    if (options.apply) await apply(lock.directory, preview);
    return { result: 'passed' as const, applied: options.apply ?? false, files: preview.plan.deletePaths,
      attempts: preview.plan.pruned.map(({ attempt, reason }) => ({ attemptId: attempt.attemptId, step: attempt.step, reason })) };
  } finally { await lock.release(); }
}

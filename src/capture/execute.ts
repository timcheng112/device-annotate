import { PNG } from 'pngjs';
import { evaluateStep } from '../check/step.js';
import { assessEnvironment, type Environment } from '../manifest/environment.js';
import { attemptSchema, type Attempt } from '../manifest/attempt.js';
import { reconcileManifest, replaceAttempt } from '../manifest/reconcile.js';
import type { OutputOwner } from '../manifest/owner.js';
import type { PreparedCapture } from '../spec/capture-input.js';
import type { Platform } from '../resolve/targets.js';
import { captureStable, StableCaptureFailure, type CaptureAdapter } from './stable.js';
import { lockOutput } from './lock.js';
import { evidenceStore } from './store.js';
import { CaptureFailure } from './failure.js';
import { loadRenderer } from './assets.js';
import { applyHistoryCleanup } from './cleanup.js';

export interface EvidenceAdapter extends CaptureAdapter {
  platform: Platform;
  environment(): Promise<Environment>;
  close(): Promise<void>;
}

/** Internal integration seam. Public input/preflight must finish before entering it.
 * The factory is lazy: contention and ownership refusal cannot contact the device.
 */
export async function executeCapture(input: {
  prepared: PreparedCapture; owner: OutputOwner; outDir: string; recordings: string[];
}, dependencies: {
  adapter(): Promise<EvidenceAdapter>;
  renderer?: typeof loadRenderer;
  now?: () => Date;
}) {
  const lock = await lockOutput(input.outDir);
  let adapter: EvidenceAdapter | undefined;
  try {
    const store = evidenceStore(lock.directory);
    const previous = await store.read(input.owner);
    const { prepared } = input;
    let ledger = reconcileManifest({ spec: prepared.spec, owner: input.owner, ...(previous ? { previous } : {}), ...(prepared.build ? { build: prepared.build } : {}) });
    // Claim a new folder before touching a device, including attempts that fail immediately.
    if (!previous) await store.publish(ledger);
    const now = dependencies.now ?? (() => new Date());
    const attempt: Attempt = {
      step: prepared.step, attemptId: '', attemptedAt: now().toISOString(), configuration: prepared.effectiveStep,
      ...(prepared.build ? { build: prepared.build } : {}),
      result: 'error', checkCounts: { total: 0, passed: 0, failed: 0 }, checks: [], errors: [], recordings: input.recordings,
    };
    const allocation = await store.allocate(prepared.step);
    attempt.attemptId = allocation.attemptId;
    let saveFailed = false;
    const save = async (kind: 'raw' | 'snapshot' | 'image', bytes: Uint8Array | string) => {
      try { attempt[kind] = await allocation.save(kind, bytes); }
      catch (cause) { saveFailed = true; throw new CaptureFailure('ARTIFACT_SAVE_FAILED', `Could not durably save the ${kind} artifact. Check output-folder permissions and free space.`, { cause }); }
    };
    try {
      adapter = await dependencies.adapter();
      const count = prepared.spec.criteria.reduce((sum, group) => sum + Object.keys(group.steps).length, 0);
      const observed = assessEnvironment(await adapter.environment(), count);
      attempt.environment = observed.environment;
      if (!observed.captureAllowed) throw new CaptureFailure('ENVIRONMENT_UNAVAILABLE', `Multi-step capture requires complete environment identity. Unavailable: ${observed.environment.unavailable.map(({ path, message }) => `${path.join('.')}: ${message}`).join('; ')}`);
      ledger = reconcileManifest({ spec: prepared.spec, owner: input.owner, ...(previous ? { previous } : {}), ...(prepared.build ? { build: prepared.build } : {}), environment: observed.environment });
      const accepted = await captureStable(adapter, now);
      attempt.capturedAt = accepted.capturedAt;
      // Independent saves preserve whichever audit artifact is available.
      const saved = await Promise.allSettled([
        save('snapshot', JSON.stringify(accepted.snapshot, null, 2) + '\n'),
        save('raw', accepted.screenshot),
      ]);
      const failed = saved.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const png = PNG.sync.read(Buffer.from(accepted.screenshot));
      const { criterion, ...step } = prepared.effectiveStep;
      const evaluated = evaluateStep({ snapshot: accepted.snapshot, screenshot: { width: png.width, height: png.height }, platform: adapter.platform, step });
      Object.assign(attempt, { checks: evaluated.checks, errors: evaluated.errors, geometry: evaluated.geometry, checkCounts: evaluated.checkCounts, result: evaluated.result });
      const renderer = await (dependencies.renderer ?? loadRenderer)();
      const rendered = renderer.render({ step, criterion, accepted: evaluated, screenshot: accepted.screenshot });
      if (rendered.kind === 'rendered') await save('image', rendered.png);
      else throw new CaptureFailure('IMAGE_OMITTED', 'The annotated image was omitted because a required mask, screenshot, or crop could not be used. Inspect the entry diagnostics and raw evidence.');
    } catch (cause) {
      if (cause instanceof StableCaptureFailure) {
        const observation = cause.observation;
        if (observation.capturedAt) attempt.capturedAt = observation.capturedAt;
        const saves: Promise<void>[] = [];
        if (observation.snapshot) saves.push(save('snapshot', JSON.stringify(observation.snapshot, null, 2) + '\n'));
        if (observation.screenshot) saves.push(save('raw', observation.screenshot));
        await Promise.allSettled(saves);
      }
      attempt.result = 'error';
      attempt.error = cause instanceof CaptureFailure
        ? { code: cause.code, message: cause.message }
        : { code: 'EVIDENCE_FAILED', message: 'Evidence processing failed. Inspect the available raw artifacts and retry after correcting the capture or runtime setup.' };
      if (saveFailed) attempt.error = { code: 'ARTIFACT_SAVE_FAILED', message: 'Some artifacts could not be durably saved. Check output-folder permissions and free space; only saved paths are listed.' };
    }
    const checked = attemptSchema.parse(attempt);
    let manifest = replaceAttempt(ledger, checked);
    await store.publish(manifest);
    let cleanupError: { code: string; message: string } | undefined;
    if (!saveFailed) {
      try { manifest = await applyHistoryCleanup(lock.directory, manifest, now().getTime()); }
      catch (cause) { cleanupError = { code: 'CLEANUP_FAILED', message: cause instanceof CaptureFailure ? cause.message : 'Evidence was saved, but history cleanup did not complete. Retry cleanup after checking file access.' }; }
    }
    return { attempt: checked, manifest, directory: lock.directory, saveFailed, ...(cleanupError ? { cleanupError } : {}) };
  } finally {
    try { await adapter?.close(); } finally { await lock.release(); }
  }
}

import { isDeepStrictEqual } from 'node:util';
import type { SnapshotState } from '../resolve/targets.js';
import { CaptureFailure } from './failure.js';

export type CaptureObservation = {
  snapshot?: SnapshotState;
  screenshot?: Uint8Array;
  capturedAt?: string;
};

export interface CaptureAdapter {
  wait(): Promise<void>;
  snapshot(): Promise<SnapshotState>;
  screenshot(): Promise<Uint8Array>;
}

/** Compare evidence-bearing fields, excluding only known observation bookkeeping.
 * Unknown fields remain significant so new upstream evidence cannot silently disappear.
 */
export function snapshotsMatch(before: SnapshotState, after: SnapshotState): boolean {
  const comparable = (snapshot: SnapshotState) => {
    const evidence: Record<string, unknown> = { ...snapshot };
    for (const key of ['refsGeneration', 'snapshotDiagnostics', 'createdAt', 'unchanged']) delete evidence[key];
    if (snapshot.snapshotQuality) {
      const { timing: _timing, ...quality } = snapshot.snapshotQuality;
      evidence.snapshotQuality = quality;
    }
    const android = evidence.androidSnapshot;
    if (typeof android === 'object' && android !== null) {
      const { elapsedMs: _elapsed, ...metadata } = android as Record<string, unknown>;
      evidence.androidSnapshot = metadata;
    }
    return { ...evidence, nodes: snapshot.nodes.map(({ ref: _ref, ...node }) => node) };
  };
  return isDeepStrictEqual(comparable(before), comparable(after));
}

export class StableCaptureFailure extends CaptureFailure {
  constructor(code: string, message: string, readonly observation: CaptureObservation, options?: ErrorOptions) {
    super(code, message, options);
  }
}

/** iOS must never enter upstream stable-wait's activating snapshot path. */
export async function waitForQuietSnapshots(snapshot: () => Promise<SnapshotState>, options: {
  quietMs?: number; timeoutMs?: number; intervalMs?: number;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
} = {}): Promise<void> {
  const quietMs = options.quietMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 100;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  let previous = await snapshot();
  let quietSince = now();
  while (now() < deadline) {
    await sleep(Math.min(intervalMs, deadline - now()));
    if (now() >= deadline) break;
    const current = await snapshot();
    if (now() >= deadline) break;
    if (!snapshotsMatch(previous, current)) quietSince = now();
    else if (now() - quietSince >= quietMs) return;
    previous = current;
  }
  throw new CaptureFailure('CAPTURE_UNSTABLE', 'The foreground app did not remain quiet within 60 seconds. Let it settle and retry; device-annotate will not activate it.');
}

/** One initial capture plus at most three retries. Never evaluate a rejected pair. */
export async function captureStable(adapter: CaptureAdapter, now = () => new Date()): Promise<Required<CaptureObservation>> {
  let observation: CaptureObservation = {};
  try {
    for (let retry = 0; retry <= 3; retry++) {
      // Do not accidentally pair a previous retry's image with this retry's snapshot.
      observation = {};
      await adapter.wait();
      observation.snapshot = await adapter.snapshot();
      observation.screenshot = await adapter.screenshot();
      observation.capturedAt = now().toISOString();
      const after = await adapter.snapshot();
      if (snapshotsMatch(observation.snapshot, after)) return observation as Required<CaptureObservation>;
    }
  } catch (cause) {
    throw new StableCaptureFailure(
      cause instanceof CaptureFailure ? cause.code : 'CAPTURE_FAILED',
      cause instanceof CaptureFailure ? cause.message : 'Device capture failed. Check the selected session and capture again.',
      observation, { cause },
    );
  }
  throw new StableCaptureFailure('CAPTURE_UNSTABLE', 'The screen changed during all four capture attempts. Wait for the app to settle and capture again.', observation);
}

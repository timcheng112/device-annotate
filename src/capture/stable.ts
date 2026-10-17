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
    for (const key of ['refsGeneration', 'snapshotDiagnostics', 'createdAt']) delete evidence[key];
    return { ...evidence, nodes: snapshot.nodes.map(({ ref: _ref, ...node }) => node) };
  };
  return isDeepStrictEqual(comparable(before), comparable(after));
}

export class StableCaptureFailure extends CaptureFailure {
  constructor(code: string, message: string, readonly observation: CaptureObservation, options?: ErrorOptions) {
    super(code, message, options);
  }
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

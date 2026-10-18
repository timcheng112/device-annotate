import * as z from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { hostname } from 'node:os';
import { readdir, writeFile } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { validate } from '../spec/validate.js';
import { prepareSpecCapture } from '../spec/capture-input.js';
import { localPathSchema } from '../spec/values.js';
import { stepNameSchema } from '../spec/step-name.js';
import { PreCaptureError } from '../spec/errors.js';
import { readLocalText, runCapture } from '../capture/public.js';
import { localDeviceAdapter } from '../capture/device.js';
import { assessEnvironment } from '../manifest/environment.js';
import { lockOutput } from '../capture/lock.js';
import { CaptureFailure } from '../capture/failure.js';
import { recordingDevice } from './device.js';
import { flowSteps, videoSchema, videoOutcome, type VideoRun } from './schema.js';
import { readRun, saveRun, regularFile, videoDigest } from './store.js';
import { exportVideo } from './export.js';
import { preflightMedia } from './media.js';

const folderOptions = z.strictObject({ out: localPathSchema, cwd: localPathSchema.refine(isAbsolute).optional() });
const startOptions = folderOptions.extend({ specPath: localPathSchema, build: z.unknown().optional(), platform: z.enum(['ios', 'android']).optional(), session: z.string().regex(/\S/).optional() });
const markOptions = folderOptions.extend({ step: stepNameSchema });
export type VideoStartOptions = z.input<typeof startOptions>;
export type VideoFolderOptions = z.input<typeof folderOptions>;
export type VideoMarkOptions = z.input<typeof markOptions>;
const monotonicMs = () => Number(process.hrtime.bigint() / 1_000_000n);
export type VideoDependencies = {
  device?: typeof recordingDevice; captureAdapter?: typeof localDeviceAdapter; clock?: () => number;
  preflight?: typeof preflightMedia; export?: typeof exportVideo;
};
function elapsed(run: VideoRun, now: () => number) {
  const ms = now() - run.clockMs;
  if (run.host !== hostname() || ms < (run.marks.at(-1)?.completedMs ?? run.marks.at(-1)?.startedMs ?? run.startUncertaintyMs ?? 0)) {
    throw new CaptureFailure('VIDEO_CLOCK_CHANGED', 'The host or monotonic clock changed. Stop the original recorder with agent-device; timing cannot be resumed safely.');
  }
  return ms;
}
function failure(cause: unknown) {
  if (cause instanceof PreCaptureError) return { result: 'error' as const, error: cause.result.error };
  if (cause instanceof z.ZodError) return { result: 'error' as const, error: { code: 'INVALID_INPUT', message: cause.issues.map(i => i.message).join('; ') } };
  return { result: 'error' as const, error: cause instanceof CaptureFailure ? { code: cause.code, message: cause.message } : {
    code: 'VIDEO_FAILED', message: 'Video operation could not finish. Check the output path, local permissions and selected session. Existing evidence was preserved.',
  } };
}
async function locked<T>(out: string, cwd: string | undefined, action: (directory: string) => Promise<T>) {
  const lock = await lockOutput(resolve(cwd ?? process.cwd(), out));
  try { return await action(lock.directory); } finally { await lock.release(); }
}
function success(directory: string, run: VideoRun, result: 'passed' | 'failed' | 'error' = 'passed') {
  return { result, state: run.state, manifest: join(directory, 'video.json'), raw: join(directory, run.raw),
    ...(run.export ? { video: join(directory, run.export.path) } : {}), warnings: run.warnings };
}

/** Internal seams replace external device and encoder work; validation and persistence stay real. */
export async function startVideo(input: unknown, dependencies: VideoDependencies = {}) {
  try {
    const options = startOptions.parse(input), cwd = options.cwd ?? process.cwd();
    const source = await readLocalText(resolve(cwd, options.specPath));
    const validation = validate(source);
    if (!validation.valid) return { result: 'error' as const, error: validation.error };
    const steps = flowSteps(validation.spec as VideoRun['spec']);
    const prepared = prepareSpecCapture({ spec: validation.spec, step: steps[0]!.name, build: options.build });
    if (steps.length > 100 || steps.some(s => s.configuration.annotate.some(a => 'mask' in a))) throw new CaptureFailure('VIDEO_SPEC_UNSUPPORTED', 'Use up to 100 steps without masks. Video captions do not redact the recording.');
    await (dependencies.preflight ?? preflightMedia)();
    return await locked(options.out, cwd, async directory => {
      if ((await readdir(directory)).some(name => name !== '.device-proof-lock')) throw new CaptureFailure('VIDEO_OUTPUT_EXISTS', 'Start each recording in a new empty output folder. Existing evidence was preserved.');
      const device = await (dependencies.device ?? recordingDevice)({ cwd, ...(options.platform ? { platform: options.platform } : {}), ...(options.session ? { session: options.session } : {}) });
      const captureOptions = { cwd, platform: device.identity.platform, session: device.identity.address };
      // Fail known capture incompatibilities before starting a potentially long recording.
      const observer = await (dependencies.captureAdapter ?? localDeviceAdapter)(captureOptions);
      let environment: VideoRun['environment'];
      try {
        const observed = assessEnvironment(await observer.environment(), steps.length);
        environment = observed.environment;
        if (!observed.captureAllowed) throw new CaptureFailure('ENVIRONMENT_UNAVAILABLE', 'This device cannot establish the complete environment required for a multi-step flow. Use a supported Android emulator or a single-step spec.');
      } finally { await observer.close(); }
      await writeFile(join(directory, 'spec.json'), JSON.stringify(validation.spec, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      const now = dependencies.clock ?? monotonicMs;
      const run: VideoRun = { version: 1, state: 'starting', spec: validation.spec, ...(prepared.build ? { build: prepared.build } : {}), cwd, session: device.identity, environment,
        host: hostname(), clockMs: now(), requestedAt: new Date().toISOString(), raw: 'raw.mp4', warnings: [], marks: [] };
      await saveRun(directory, run);
      // Start is intentionally not retried: an uncertain response may still have started recording.
      const response = await device.start(join(directory, run.raw));
      if (response.recording !== 'started' || resolve(response.outPath) !== join(directory, run.raw)) throw new CaptureFailure('VIDEO_START_UNCONFIRMED', 'Recording start did not confirm the requested path. Inspect agent-device before retrying; a recorder may be active.');
      run.startUncertaintyMs = now() - run.clockMs;
      run.state = 'recording';
      run.warnings.push(`Caption timing is approximate. Start request window: ${run.startUncertaintyMs} ms; the public recorder does not expose first-frame time.`);
      await saveRun(directory, run);
      return success(directory, run);
    });
  } catch (cause) { return failure(cause); }
}
export async function markVideo(input: unknown, dependencies: VideoDependencies = {}) {
  try {
    const options = markOptions.parse(input);
    return await locked(options.out, options.cwd, async directory => {
      const run = await readRun(directory);
      if (run.state !== 'recording') throw new CaptureFailure('VIDEO_NOT_RECORDING', 'Marks require an acknowledged active recording.');
      if (run.marks.at(-1)?.completedMs === undefined && run.marks.length) throw new CaptureFailure('VIDEO_MARK_INTERRUPTED', 'The previous mark was interrupted. Stop this run; its checklist will show ERROR. Start a new recording to retry the flow.');
      const next = flowSteps(run.spec)[run.marks.length];
      if (next?.name !== options.step) throw new CaptureFailure('VIDEO_STEP_ORDER', `Mark the next declared step: ${next?.name ?? '(all steps already marked)'}. Start a new recording for recaptures.`);
      await (dependencies.device ?? recordingDevice)({ cwd: run.cwd, platform: run.session.platform, session: run.session.address }, run.session);
      // The frozen spec is checked before every capture so edits cannot replace the approved flow.
      const savedSpec = validate(await readLocalText(join(directory, 'spec.json')));
      if (!savedSpec.valid || JSON.stringify(savedSpec.spec) !== JSON.stringify(run.spec)) throw new CaptureFailure('VIDEO_SPEC_CHANGED', 'The saved recording spec changed. Start a new recording for a different flow.');
      const now = dependencies.clock ?? monotonicMs;
      const mark: VideoRun['marks'][number] = { step: options.step, startedMs: elapsed(run, now) };
      run.marks.push(mark);
      await saveRun(directory, run);
      const result = await runCapture({ cwd: run.cwd, specPath: join(directory, 'spec.json'), step: options.step, out: join(directory, 'evidence'),
        ...(run.build ? { build: run.build } : {}), platform: run.session.platform, session: run.session.address }, async options => {
        const adapter = await (dependencies.captureAdapter ?? localDeviceAdapter)(options);
        return { ...adapter, async environment() {
          const observed = await adapter.environment();
          if (!isDeepStrictEqual(observed, run.environment)) throw new CaptureFailure('ENVIRONMENT_CHANGED', 'The device environment changed after recording started. Start a new recording for this environment.');
          return observed;
        } };
      });
      mark.completedMs = elapsed(run, now);
      if ('attemptId' in result) {
        const { cleanupError, ...attempt } = result;
        mark.attempt = attempt;
        if (cleanupError) run.warnings.push(`Screenshot history cleanup: ${cleanupError.message}`);
      }
      else mark.error = result.error;
      await saveRun(directory, run);
      return { ...success(directory, run, result.result), step: options.step, startedMs: mark.startedMs, completedMs: mark.completedMs, ...(mark.error ? { error: mark.error } : {}), ...(mark.attempt ? { attempt: mark.attempt } : {}) };
    });
  } catch (cause) { return failure(cause); }
}
async function renderLocked(directory: string, run: VideoRun, dependencies: VideoDependencies) {
  if (run.state !== 'stopped') throw new CaptureFailure('VIDEO_NOT_STOPPED', 'Stop recording before rendering.');
  let needsExport = true;
  if (run.export?.sha256) {
    let digest: string | undefined;
    try { digest = await videoDigest(join(directory, run.export.path)); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
    if (digest !== undefined) {
      if (digest !== run.export.sha256) throw new CaptureFailure('VIDEO_EXPORT_INVALID', 'The saved video has changed. Preserve or move annotated.mp4, then render again from the raw recording.');
      needsExport = false;
    }
  }
  if (needsExport) {
    // Legacy ledgers without a digest go through deterministic, exclusive publication again.
    // A missing output can be rebuilt; a differing existing file is never replaced.
    const exported = await (dependencies.export ?? exportVideo)(directory, run);
    run.export = { ...exported, sha256: await videoDigest(join(directory, exported.path)) };
    await saveRun(directory, run);
  }
  const result = videoOutcome(run);
  return { ...success(directory, run, result), ...(result === 'error' ? { error: { code: 'VIDEO_FLOW_INCOMPLETE', message: 'Video exported with incomplete or errored checks. Inspect the checklist and video.json.' } } : {}) };
}
export async function stopVideo(input: unknown, dependencies: VideoDependencies = {}) {
  try {
    const options = folderOptions.parse(input);
    return await locked(options.out, options.cwd, async directory => {
      const run = await readRun(directory);
      if (run.state === 'starting') throw new CaptureFailure('VIDEO_START_UNCONFIRMED', 'Start was interrupted or refused. Inspect the session with agent-device before stopping any recorder; this run has no acknowledged ownership.');
      if (run.state !== 'stopped') {
        const device = await (dependencies.device ?? recordingDevice)({ cwd: run.cwd, platform: run.session.platform, session: run.session.address }, run.session);
        run.stoppedMs ??= elapsed(run, dependencies.clock ?? monotonicMs);
        run.state = 'stopping';
        await saveRun(directory, run);
        const response = await device.stop();
        if (response.recording !== 'stopped' || resolve(response.outPath) !== join(directory, run.raw)) throw new CaptureFailure('VIDEO_STOP_UNCONFIRMED', 'Recorder did not return this run’s video. Existing evidence was preserved.');
        if (response.chunks && response.chunks.length > 1) throw new CaptureFailure('VIDEO_CHUNKS_UNSUPPORTED', 'Recorder returned multiple chunks. Preserve all raw chunks and use a shorter recording; this exporter requires one continuous file.');
        if (response.recorder === 'lost' || response.recorder === 'unconfirmed') throw new CaptureFailure('VIDEO_RECORDER_UNCONFIRMED', 'Recorder termination was not confirmed. Inspect agent-device before exporting evidence.');
        for (const warning of [response.warning, response.overlayWarning]) if (warning) run.warnings.push(warning);
        await regularFile(join(directory, run.raw));
        run.state = 'stopped';
        await saveRun(directory, run);
      }
      return await renderLocked(directory, run, dependencies);
    });
  } catch (cause) { return failure(cause); }
}
export async function renderVideo(input: unknown, dependencies: VideoDependencies = {}) {
  try {
    const options = folderOptions.parse(input);
    return await locked(options.out, options.cwd, async directory => renderLocked(directory, await readRun(directory), dependencies));
  } catch (cause) { return failure(cause); }
}

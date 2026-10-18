import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import * as z from 'zod';
import { localPathSchema } from '../spec/values.js';
import { prepareOneOffCapture, prepareSpecCapture, type PreparedCapture } from '../spec/capture-input.js';
import { inputErrorResult, PreCaptureError } from '../spec/errors.js';
import { recordingOptionsSchema } from '../spec/recordings.js';
import { resolveSpecPaths } from '../cli/paths.js';
import type { OutputOwner } from '../manifest/owner.js';
import type { StepInput } from '../spec/step.js';
import type { EvidenceAdapter } from './execute.js';
import type { DeviceOptions } from './device.js';
import { CaptureFailure } from './failure.js';
import { stepNameSchema } from '../spec/step-name.js';

const optionsSchema = z.strictObject({
  specPath: localPathSchema.optional(), step: stepNameSchema, criterion: z.unknown().optional(),
  config: z.unknown().optional(), build: z.unknown().optional(), out: localPathSchema.optional(),
  cwd: localPathSchema.refine(isAbsolute).optional(),
  platform: z.enum(['ios', 'android']).optional(), session: z.string().regex(/\S/).optional(),
  recordings: recordingOptionsSchema.shape.recordings,
}).superRefine((value, ctx) => {
  if (value.specPath && (value.criterion !== undefined || value.config !== undefined)) ctx.addIssue({ code: 'custom', path: [], message: 'Use either a spec file or a one-off criterion/config.' });
  if (!value.specPath && !value.out) ctx.addIssue({ code: 'custom', path: ['out'], message: 'Supply an output folder for a one-off capture.' });
});
export type CaptureOptions = {
  specPath?: string; step: string; criterion?: string; config?: StepInput; build?: unknown; out?: string;
  cwd?: string; platform?: 'ios' | 'android'; session?: string; recordings?: string[];
};

export async function readLocalText(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Expected a regular file.');
    return new TextDecoder('utf-8', { fatal: true }).decode(await handle.readFile());
  } finally { await handle.close(); }
}

/** Internal test seam replaces only the device boundary; preparation and persistence stay real. */
export async function runCapture(input: unknown, adapter: (options: DeviceOptions) => Promise<EvidenceAdapter> = async (options) => (await import('./device.js')).localDeviceAdapter(options)) {
  let prepared: PreparedCapture | undefined;
  try {
    const parsed = optionsSchema.safeParse(input);
    if (!parsed.success) return inputErrorResult(parsed.error);
    const options = parsed.data;
    const cwd = options.cwd ?? process.cwd();
    let owner: OutputOwner;
    let outDir: string;
    if (options.specPath) {
      const path = resolve(cwd, options.specPath);
      let source: string;
      let canonical: string;
      try { source = await readLocalText(path); canonical = await realpath(path); }
      catch { throw new PreCaptureError({ result: 'error', error: { code: 'SPEC_UNAVAILABLE', message: `Cannot read spec ${JSON.stringify(options.specPath)}. Supply a readable UTF-8 spec file.` } }); }
      prepared = prepareSpecCapture({ spec: source, step: options.step, build: options.build });
      owner = { kind: 'spec', specPath: canonical };
      outDir = options.out ? resolve(cwd, options.out) : resolveSpecPaths({ cwd, specPath: path, ...(prepared.spec.out ? { out: prepared.spec.out } : {}) }).outDir;
    } else {
      prepared = prepareOneOffCapture({ step: options.step, criterion: options.criterion, config: options.config ?? {}, build: options.build });
      owner = { kind: 'one-off', step: prepared.step };
      outDir = resolve(cwd, options.out!);
    }
    const recordings: string[] = [];
    for (const [index, value] of options.recordings.entries()) {
      const path = resolve(cwd, value);
      try {
        const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
        try { if (!(await handle.stat()).isFile()) throw new Error('Expected a regular file.'); }
        finally { await handle.close(); }
      } catch {
        throw new PreCaptureError({ result: 'error', step: prepared.step, criterion: prepared.effectiveStep.criterion,
          error: { code: 'RECORDING_UNAVAILABLE', message: `Cannot read recording ${JSON.stringify(path)}. Supply an existing readable regular file.`, issues: [{ path: ['recordings', index], message: 'Recording is unavailable.' }] } });
      }
      recordings.push(path);
    }
    const { executeCapture } = await import('./execute.js');
    const result = await executeCapture({ prepared, owner, outDir, recordings }, {
      adapter: () => adapter({ cwd, ...(options.platform ? { platform: options.platform } : {}), ...(options.session ? { session: options.session } : {}) }),
    });
    return { ...result.attempt, ...(result.cleanupError ? { cleanupError: result.cleanupError } : {}) };
  } catch (cause) {
    if (cause instanceof PreCaptureError) return cause.result;
    return { result: 'error' as const, ...(prepared ? { step: prepared.step, criterion: prepared.effectiveStep.criterion } : {}),
      error: cause instanceof CaptureFailure ? { code: cause.code, message: cause.message } : { code: 'CAPTURE_FAILED', message: 'Capture could not finish. Check local file access and the selected device session before retrying.' } };
  }
}

export async function capture(options: CaptureOptions) { return runCapture(options); }

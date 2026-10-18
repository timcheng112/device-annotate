import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readLocalText } from '../capture/public.js';
import { CaptureFailure } from '../capture/failure.js';
import { PreCaptureError } from '../spec/errors.js';

export async function captureCommand(args: string[]) {
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
      step: { type: 'string' }, criterion: { type: 'string' }, box: { type: 'string', multiple: true },
      out: { type: 'string' }, build: { type: 'string' }, platform: { type: 'string' }, session: { type: 'string' },
      recording: { type: 'string', multiple: true },
    } });
    if (positionals.length > 1) throw new Error('Supply at most one spec path.');
    let build: unknown;
    if (values.build !== undefined) {
      if (!values.build.trim() || values.build.includes('\0')) throw new Error('Supply a valid build file path.');
      build = JSON.parse(await readLocalText(resolve(values.build)));
    }
    // Runtime validation owns errors, including missing --step and invalid platform values.
    const { runCapture } = await import('../capture/public.js');
    return await runCapture({
      ...(positionals[0] ? { specPath: positionals[0] } : {}), step: values.step,
      ...(values.criterion !== undefined ? { criterion: values.criterion } : {}),
      ...(values.box ? { config: { annotate: values.box.map((target) => ({ box: { target } })) } } : {}),
      ...(values.out !== undefined ? { out: values.out } : {}), ...(build !== undefined ? { build } : {}),
      ...(values.platform !== undefined ? { platform: values.platform } : {}),
      ...(values.session !== undefined ? { session: values.session } : {}), recordings: values.recording ?? [],
    });
  } catch {
    return { result: 'error' as const, error: { code: 'INVALID_INPUT', message: 'Check capture arguments and supply a readable JSON build file when using --build.' } };
  }
}

export async function cleanupCommand(args: string[]) {
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
      apply: { type: 'boolean' }, finished: { type: 'boolean' },
    } });
    if (positionals.length !== 1 || !positionals[0]?.trim()) throw new Error('Supply one output folder.');
    const { cleanup } = await import('../capture/cleanup.js');
    return await cleanup({ outDir: resolve(positionals[0]), apply: values.apply ?? false, finished: values.finished ?? false });
  } catch (cause) {
    if (cause instanceof PreCaptureError) return cause.result;
    return { result: 'error' as const, error: cause instanceof CaptureFailure ? { code: cause.code, message: cause.message } : { code: 'CLEANUP_FAILED', message: 'Supply an accessible evidence folder and valid cleanup options.' } };
  }
}

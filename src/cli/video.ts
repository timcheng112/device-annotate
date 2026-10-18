import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readLocalText } from '../capture/public.js';
import { startVideo, markVideo, stopVideo, renderVideo } from '../video/public.js';
export async function videoCommand(args: string[]) {
  try {
    const action = args[0];
    const common = { out: { type: 'string' as const } };
    const { values, positionals } = parseArgs({ args: args.slice(1), strict: true, allowPositionals: true, options: {
      ...common,
      ...(action === 'start' ? { build: { type: 'string' as const }, platform: { type: 'string' as const }, session: { type: 'string' as const } } : {}),
      ...(action === 'mark' ? { step: { type: 'string' as const } } : {}),
    } });
    if (action === 'start' && positionals.length === 1) return await startVideo({ out: values.out, specPath: positionals[0],
      ...(values.build ? { build: JSON.parse(await readLocalText(resolve(String(values.build)))) } : {}),
      ...(values.platform ? { platform: values.platform } : {}), ...(values.session ? { session: values.session } : {}),
    });
    if (positionals.length) throw new Error('Unexpected positional argument.');
    if (action === 'mark') return await markVideo({ out: values.out, step: values.step });
    if (action === 'stop') return await stopVideo({ out: values.out });
    if (action === 'render') return await renderVideo({ out: values.out });
    throw new Error('Unknown video command.');
  } catch { return { result: 'error' as const, error: { code: 'INVALID_INPUT', message: 'Use video start <spec> --out <new-folder> [--build <file>], video mark --out <folder> --step <name>, or video stop|render --out <folder>.' } }; }
}

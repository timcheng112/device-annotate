import { readFile } from 'node:fs/promises';
import { createEvidenceRenderer } from '../render/evidence.js';

/** Runtime IO stays in capture/. Assets are loaded once and retries follow failures. */
let renderer: ReturnType<typeof createEvidenceRenderer> | undefined;
export function loadRenderer(): ReturnType<typeof createEvidenceRenderer> {
  renderer ??= (async () => {
    const [font, wasm] = await Promise.all([
      readFile(new URL('../../src/render/fonts/Inter-Regular.ttf', import.meta.url)),
      readFile(new URL('index_bg.wasm', import.meta.resolve('@resvg/resvg-wasm'))),
    ]);
    return createEvidenceRenderer({ font: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength), wasm });
  })().catch((error: unknown) => { renderer = undefined; throw error; });
  return renderer;
}

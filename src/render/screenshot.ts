import { PNG } from 'pngjs';
import type { Rect } from '../layout/overlap.js';

/** Decode before rendering: resvg may silently omit a corrupt embedded PNG. */
export function prepareScreenshot(bytes: Uint8Array, dimensions: { width: number; height: number }, masks: Rect[]): Uint8Array {
  const image = PNG.sync.read(Buffer.from(bytes));
  if (image.width !== dimensions.width || image.height !== dimensions.height) throw new Error('Screenshot dimensions disagree with accepted geometry.');
  for (const rect of masks) {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0
      || rect.x + rect.width > image.width || rect.y + rect.height > image.height) throw new Error('Cannot apply mask outside the accepted screenshot.');
    // Cover every pixel touched by fractional bounds, including antialiased edge pixels.
    for (let y = Math.floor(rect.y); y < Math.ceil(rect.y + rect.height); y++) {
      for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.width); x++) {
        const offset = (y * image.width + x) * 4;
        image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 53;
        image.data[offset + 3] = 255;
      }
    }
  }
  // Canonical PNG strips ancillary metadata and never embeds original masked pixels.
  return PNG.sync.write(image);
}

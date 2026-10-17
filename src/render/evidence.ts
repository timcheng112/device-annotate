import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { createTextMetrics } from '../layout/font.js';
import { layoutStep } from '../layout/step.js';
import { numberStepEntries } from '../spec/numbered-entries.js';
import { prepareScreenshot } from './screenshot.js';
import { createSvgBuilder } from './svg.js';

let initialization: Promise<void> | undefined;
/** The integration layer loads runtime assets; this module performs no IO. */
export async function createEvidenceRenderer(assets: { font: ArrayBuffer; wasm: Uint8Array<ArrayBuffer> }) {
  initialization ??= initWasm(assets.wasm).catch((error: unknown) => { initialization = undefined; throw error; });
  await initialization;
  const font = assets.font.slice(0), metrics = createTextMetrics(font), buildSvg = createSvgBuilder(font, metrics);
  return {
    render(input: Omit<Parameters<typeof layoutStep>[0], 'metrics'> & { screenshot: Uint8Array }) {
      const layout = layoutStep({ ...input, metrics });
      if (layout.kind === 'omit') return layout;
      const maskNumbers = new Set(numberStepEntries(input.step).filter((entry) => entry.kind === 'annotation' && 'mask' in entry.annotation).map(({ n }) => n));
      const masks = input.accepted.geometry.targets.filter(({ n }) => maskNumbers.has(n)).map(({ rect }) => rect);
      const dimensions = input.accepted.geometry.screenshot;
      // Failure throws before any SVG/PNG result is returned. There is no unmasked fallback.
      const screenshot = prepareScreenshot(input.screenshot, dimensions, masks);
      const svg = buildSvg(layout, screenshot, dimensions);
      const renderer = new Resvg(svg, { font: { fontBuffers: [new Uint8Array(font)], defaultFontFamily: 'Inter' },
        fitTo: { mode: 'original' }, shapeRendering: 2, textRendering: 2, imageRendering: 0 });
      try {
        const image = renderer.render();
        try {
          if (image.width !== layout.width || image.height !== layout.height) throw new Error('Rendered image dimensions disagree with layout.');
          return { kind: 'rendered' as const, layout, svg, png: image.asPng().slice() };
        } finally { image.free(); }
      } finally { renderer.free(); }
    },
  };
}

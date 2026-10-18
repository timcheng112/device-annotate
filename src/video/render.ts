import { readFile } from 'node:fs/promises';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-wasm';
import { initializeRasterizer } from '../render/evidence.js';
import { createTextMetrics, type TextLine } from '../layout/font.js';
import { escapeXml } from '../render/svg.js';
import { checklistAt, type VideoRun } from './schema.js';
import { CaptureFailure } from '../capture/failure.js';

/** Layout the whole timeline first. Every footer frame has identical dimensions. */
export async function checklistRenderer(run: VideoRun, width: number, times: number[], rawDurationMs: number) {
  const [regular, semibold, wasm] = await Promise.all([
    readFile(new URL('../../src/render/fonts/Inter-Regular.ttf', import.meta.url)),
    readFile(new URL('../../src/render/fonts/Inter-SemiBold.ttf', import.meta.url)),
    readFile(new URL('index_bg.wasm', import.meta.resolve('@resvg/resvg-wasm'))),
  ]);
  await initializeRasterizer(wasm);
  const array = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const metrics = createTextMetrics(array(regular), array(semibold));
  const fonts = { regular: opentype.parse(array(regular)), semibold: opentype.parse(array(semibold)) };
  const scale = width / 480;
  const rows = times.map(time => checklistAt(run, time));
  const criteria = [...new Set(rows[0]!.map(row => row.criterion))];
  const titles = criteria.flatMap((s, i) => metrics.wrap(criteria.length > 1 ? `${i + 1}. ${s}` : s, 17, 432, 'semibold'));
  const nameLines = rows[0]!.map(row => metrics.wrap(row.name.replaceAll('-', ' ').replaceAll('_', ' '), 15, 294));
  const rowHeights = nameLines.map(lines => Math.max(42, lines.length * 22 + 12));
  const detailLines = rows.map(list => list.flatMap(row => row.details.flatMap(detail => metrics.wrap(`${row.n}. ${detail}`, 13, 432).map(line => ({ line, color: row.status === 'INFO' ? '#667287' : '#aa2336' })))));
  const titleHeight = titles.length * 25 + 22;
  const detailHeight = Math.max(0, ...detailLines.map(lines => lines.length)) * 20;
  const height = Math.ceil((titleHeight + rowHeights.reduce((a, b) => a + b, 0) + detailHeight + 46) * scale / 2) * 2;
  if (height > 8192 || width * height > 32_000_000) throw new CaptureFailure('VIDEO_LEGEND_TOO_LARGE', 'The complete checklist is too large to render legibly. Split the flow or shorten its labels and check values.');
  const text = (line: TextLine, x: number, y: number, color: string) => `<g fill="${color}"><title>${escapeXml(line.displayText)}</title>${line.glyphs.map(g => `<path d="${fonts[line.weight].glyphs.get(g.index).getPath(x + g.x, y + metrics.ascent * line.size, line.size).toPathData(3)}"/>`).join('')}</g>`;
  return { width, height, render(index: number) {
    const time = times[index]!;
    const items: string[] = ['<rect width="100%" height="100%" fill="white"/>', '<path d="M0 0H480" stroke="#dfe4ec"/>'];
    titles.forEach((line, i) => items.push(text(line, 24, 15 + i * 25, '#1d293b')));
    let y = titleHeight;
    rows[index]!.forEach((row, i) => {
      const h = rowHeights[i]!;
      if (row.active) items.push(`<rect x="12" y="${y}" width="456" height="${h - 4}" rx="5" fill="#f0f4fa"/>`);
      const n = metrics.line(String(row.n), 13, 'semibold');
      items.push(`<circle cx="35" cy="${y + 18}" r="13" fill="#245699"/>`, text(n, 35 - n.width / 2, y + 9, 'white'));
      nameLines[i]!.forEach((line, j) => items.push(text(line, 59, y + 8 + j * 22, row.status === 'PENDING' ? '#667287' : '#1d293b')));
      const color = row.status === 'PASS' ? '#14783b' : row.status === 'FAIL' || row.status === 'ERROR' ? '#aa2336' : '#667287';
      items.push(text(metrics.line(row.status, 11, 'semibold'), 372, y + 11, color));
      y += h;
    });
    detailLines[index]!.forEach(({ line, color }, i) => items.push(text(line, 24, y + 8 + i * 20, color)));
    const end = time >= rawDurationMs;
    const note = end ? 'Recording ended · frozen final frame' : `Timing approximate · start window ${Math.ceil(run.startUncertaintyMs ?? 0)} ms`;
    items.push(text(metrics.line(note, 10), 24, height / scale - 24, '#667287'));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g transform="scale(${scale})">${items.join('')}</g></svg>`;
    const renderer = new Resvg(svg);
    try { const image = renderer.render(); try { return { svg, png: image.asPng().slice() }; } finally { image.free(); } }
    finally { renderer.free(); }
  } };
}

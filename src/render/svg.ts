import opentype from 'opentype.js';
import type { layoutStep, TextBlock } from '../layout/step.js';
import type { TextLine, TextMetrics } from '../layout/font.js';
import type { Rect } from '../layout/overlap.js';

export type EvidenceLayout = Extract<ReturnType<typeof layoutStep>, { kind: 'layout' }>;
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}
const box = (r: Rect) => `x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"`;

/** The caller must supply the successfully decoded and masked screenshot. */
export function createSvgBuilder(fontBytes: ArrayBuffer, metrics: TextMetrics) {
  const font = opentype.parse(fontBytes);
  return function buildSvg(layout: EvidenceLayout, screenshot: Uint8Array, dimensions: { width: number; height: number }): string {
    const { style } = layout;
    const scale = style.fontSize / 16;
    const definitions = new Map<number, string>();
    const title = (text: string) => `<title>${escapeXml(text)}</title>`;
    function lines(lines: TextLine[], x: number, y: number, color: string): string {
      return lines.map((line, index) => `<g fill="${escapeXml(color)}">${title(line.displayText)}${line.glyphs.map((glyph) => {
        if (!definitions.has(glyph.index)) definitions.set(glyph.index, font.glyphs.get(glyph.index).getPath(0, 0, style.fontSize).toPathData(3));
        return `<use href="#glyph-${glyph.index}" x="${x + glyph.x}" y="${y + index * style.lineHeight + metrics.ascent * style.fontSize}"/>`;
      }).join('')}</g>`).join('');
    }
    const block = (block: TextBlock, color = style.ink as string) => lines(block.lines, block.x, block.y, color);
    const content: string[] = [`<rect width="100%" height="100%" fill="#f3f4f6"/>`];
    const defs: string[] = [`<pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2 2L2-2M0 8L8 0M6 10L10 6" fill="none" stroke="#777" stroke-width="1"/></pattern>`];
    layout.views.forEach((view, index) => {
      defs.push(`<clipPath id="view-${index}"><rect ${box(view.frame)}/></clipPath>`);
      content.push(`<g>${title(view.kind === 'overview' ? 'Overview' : `Detail: entries ${view.regions.flatMap((region) => region.numbers).join(', ')}`)}
        <g clip-path="url(#view-${index})"><use href="#screenshot" x="${view.frame.x - view.source.x}" y="${view.frame.y - view.source.y}"/></g>`);
      for (const [maskIndex, mask] of view.masks.entries()) {
        const id = `mask-${index}-${maskIndex}`;
        defs.push(`<clipPath id="${id}"><rect ${box(mask.rect)}/></clipPath>`);
        content.push(`<rect ${box(mask.rect)} fill="${escapeXml(mask.fill)}"/><rect ${box(mask.rect)} fill="url(#hatch)"/>`);
        const label = metrics.line(mask.label, style.fontSize);
        // Tiny masks retain full opaque coverage; put their label in the corresponding legend.
        if (mask.rect.width >= label.width + 8 && mask.rect.height >= style.lineHeight) {
          content.push(`<g clip-path="url(#${id})">${lines([label], mask.rect.x + (mask.rect.width - label.width) / 2, mask.rect.y + (mask.rect.height - style.lineHeight) / 2, '#ffffff')}</g>`);
        }
      }
      for (const region of view.regions) {
        const color = escapeXml(region.color);
        const dash = region.border === 'dashed' ? ` stroke-dasharray="${8 * scale} ${5 * scale}"` : region.border === 'dotted' ? ` stroke-dasharray="${scale} ${5 * scale}" stroke-linecap="round"` : '';
        content.push(`<rect ${box(region.rect)} fill="none" stroke="${style.halo}" stroke-width="${style.haloWidth}"/><rect ${box(region.rect)} fill="none" stroke="${color}" stroke-width="${style.strokeWidth}"${dash}/>`);
        const { from, to } = region.tag.connector;
        const path = `M${from.x} ${from.y}L${to.x} ${to.y}`;
        content.push(`<path d="${path}" fill="none" stroke="${style.halo}" stroke-width="${style.haloWidth}"/><path d="${path}" fill="none" stroke="${color}" stroke-width="${style.strokeWidth}"/>`);
        if (region.arrows.length) {
          const angle = Math.atan2(to.y - from.y, to.x - from.x), size = 9 * scale;
          const ax = to.x - size * Math.cos(angle - 0.45), ay = to.y - size * Math.sin(angle - 0.45);
          const bx = to.x - size * Math.cos(angle + 0.45), by = to.y - size * Math.sin(angle + 0.45);
          content.push(`<path d="M${ax} ${ay}L${to.x} ${to.y}L${bx} ${by}" fill="none" stroke="white" stroke-width="${style.haloWidth}"/><path d="M${ax} ${ay}L${to.x} ${to.y}L${bx} ${by}" fill="none" stroke="${color}" stroke-width="${style.strokeWidth}"/>`);
        }
      }
      // Tags paint last so crossing connectors cannot obscure numbers or symbols.
      for (const region of view.regions) {
        content.push(`<rect ${box(region.tag.rect)} rx="${12 * scale}" fill="${escapeXml(region.color)}" stroke="white" stroke-width="${style.haloWidth}"/>`);
        content.push(lines(region.tag.lines, region.tag.rect.x + 8 * scale, region.tag.rect.y + 6 * scale, '#ffffff'));
      }
      content.push('</g>');
    });
    content.push(`<rect ${box(layout.legend.rect)} fill="${style.panel}"/>`);
    const badgeColor = layout.result === 'error' ? '#8b1e12' : layout.result === 'failed' ? '#9e1b24' : '#145c3a';
    content.push(`<rect x="${layout.legend.badge.x - 6 * scale}" y="${layout.legend.badge.y - 4 * scale}" width="${layout.width - 20 * scale}" height="${layout.legend.badge.height + 8 * scale}" rx="5" fill="${badgeColor}"/>`);
    content.push(block(layout.legend.badge, '#ffffff'), block(layout.legend.criterion));
    for (const row of layout.legend.rows) {
      content.push(`<path d="M${style.padding} ${row.block.y - 4 * scale}H${layout.width - style.padding}" stroke="#e1e4e8"/>`);
      content.push(block(row.block, row.color ?? style.ink));
    }
    for (const warning of layout.legend.warnings) content.push(block(warning));
    defs.push(`<image id="screenshot" width="${dimensions.width}" height="${dimensions.height}" href="data:image/png;base64,${Buffer.from(screenshot).toString('base64')}"/>`);
    for (const [index, path] of definitions) defs.push(`<path id="glyph-${index}" d="${path}"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}"><defs>${defs.join('')}</defs>${content.join('')}</svg>`;
  };
}

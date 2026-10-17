import { overlaps, type Rect } from './overlap.js';
import type { TextLine, TextMetrics } from './font.js';
export type Point = { x: number; y: number };
export type Tag = { rect: Rect; lines: TextLine[]; connector: { from: Point; to: Point }; placement: 'edge' | 'margin' };
export function layoutStyle(screenshotWidth: number) {
  const scale = Math.max(1, Math.round(screenshotWidth / 400));
  return Object.freeze({ fontSize: 16 * scale, lineHeight: 24 * scale, padding: 16 * scale, gap: 8 * scale,
    strokeWidth: 2 * scale, haloWidth: 6 * scale, halo: '#ffffff', ink: '#212121', panel: '#ffffff', mask: '#353535' });
}
export const style = layoutStyle(400);
const expand = (rect: Rect, amount: number): Rect => ({ x: rect.x - amount, y: rect.y - amount, width: rect.width + amount * 2, height: rect.height + amount * 2 });

/** Stable edge order with an unbounded external rail as the collision-free fallback. */
export function placeTags(items: { rect: Rect; text: string }[], frame: Rect, metrics: TextMetrics, appearance = style): { tags: Tag[]; width: number; height: number } {
  const style = appearance, scale = style.fontSize / 16;
  const tags: Tag[] = [];
  const maxWidth = Math.max(240 * scale, Math.min(400 * scale, frame.width));
  let railY = frame.y;
  for (const item of items) {
    const lines: TextLine[] = [];
    let pending = '';
    const tokens = item.text.split(', ');
    for (const [index, token] of tokens.entries()) {
      const piece = token + (index < tokens.length - 1 ? ', ' : '');
      if (pending && metrics.line(pending + piece, style.fontSize).width > maxWidth - 16 * scale) {
        lines.push(metrics.line(pending, style.fontSize)); pending = '';
      }
      // Keep each entry number and its result symbol together across wrapped lines.
      pending += piece;
    }
    if (pending) lines.push(metrics.line(pending, style.fontSize));
    const width = Math.ceil(Math.max(...lines.map((line) => line.width))) + 16 * scale;
    const height = lines.length * style.lineHeight + 12 * scale;
    const r = item.rect, gap = style.gap;
    const candidates: Rect[] = [
      { x: r.x, y: r.y - gap - height, width, height },
      { x: r.x + r.width + gap, y: r.y, width, height },
      { x: r.x + r.width - width, y: r.y + r.height + gap, width, height },
      { x: r.x - width - gap, y: r.y + r.height - height, width, height },
    ];
    const nearby = items.filter((other) => other !== item && overlaps(expand(r, 24 * scale), other.rect));
    if (nearby.length) {
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const dx = cx - nearby.reduce((sum, other) => sum + other.rect.x + other.rect.width / 2, 0) / nearby.length;
      const dy = cy - nearby.reduce((sum, other) => sum + other.rect.y + other.rect.height / 2, 0) / nearby.length;
      // Prefer the side facing away from close neighbours; stable sort breaks equal scores.
      const outward = (candidate: Rect) => ((candidate.x + width / 2 - cx) * dx + (candidate.y + height / 2 - cy) * dy);
      candidates.sort((a, b) => outward(b) - outward(a));
    }
    let rect = candidates.find((candidate) => candidate.x >= frame.x && candidate.y >= frame.y && candidate.x + width <= frame.x + frame.width && candidate.y + height <= frame.y + frame.height
      && !items.some((other) => overlaps(expand(candidate, style.haloWidth / 2), other.rect))
      && !tags.some((other) => overlaps(expand(candidate, gap), other.rect)));
    const placement = rect ? 'edge' : 'margin';
    if (!rect) {
      rect = { x: frame.x + frame.width + gap, y: railY, width, height };
      railY += height + gap;
    }
    const to = { x: Math.max(r.x, Math.min(rect.x + width / 2, r.x + r.width)), y: Math.max(r.y, Math.min(rect.y + height / 2, r.y + r.height)) };
    const from = { x: Math.max(rect.x, Math.min(to.x, rect.x + width)), y: Math.max(rect.y, Math.min(to.y, rect.y + height)) };
    tags.push({ rect, lines, connector: { from, to }, placement });
  }
  return { tags, width: Math.max(frame.x + frame.width, ...tags.map(({ rect }) => rect.x + rect.width)) + style.padding,
    height: Math.max(frame.y + frame.height, ...tags.map(({ rect }) => rect.y + rect.height)) + style.padding };
}

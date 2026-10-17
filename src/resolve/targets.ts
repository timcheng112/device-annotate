import * as z from 'zod';
import { parseSelectorChain, listSelectorChainMatches, resolveSelectorChain, formatSelectorFailure } from 'agent-device/selectors';
import type { SnapshotNode, SnapshotState, Rect } from '../vendor/agent-device/snapshot.js';
import type { Platform } from '../vendor/agent-device/platform.js';
import { resolveElementReportedTwice } from '../vendor/agent-device/reported-twice.js';
import { createSnapshotVisibility } from '../vendor/agent-device/snapshot-visibility.js';
import { evaluateIsPredicate } from '../vendor/agent-device/predicates.js';
import { isPositiveFiniteRect } from '../vendor/agent-device/rect.js';
import type { Geometry } from '../manifest/geometry.js';

export type { SnapshotNode, SnapshotState, Rect, Platform };
export type Resolution = {
  matches: SnapshotNode[];
  node?: SnapshotNode;
  error?: { code: 'TARGET_NOT_FOUND' | 'TARGET_AMBIGUOUS' | 'CHECK_UNAVAILABLE'; message: string };
};
export type Drawable = Omit<Geometry['targets'][number], 'n'>;
export type DrawingResolution =
  | { target: Drawable; warning?: { code: 'PARTIALLY_OFFSCREEN' | 'EDGE_EXTENT_UNKNOWN'; message: string } }
  | { error: { code: 'TARGET_NOT_FOUND' | 'TARGET_AMBIGUOUS' | 'TARGET_OFFSCREEN' | 'CHECK_UNAVAILABLE'; message: string } };
const sizeSchema = z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() });
const viewportSchema = z.object({ width: z.number().positive().max(Number.MAX_SAFE_INTEGER), height: z.number().positive().max(Number.MAX_SAFE_INTEGER) });
const rectSchema = z.strictObject({ x: z.number().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), y: z.number().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), width: z.number().positive().max(Number.MAX_SAFE_INTEGER), height: z.number().positive().max(Number.MAX_SAFE_INTEGER) });

/** One accepted snapshot, one visibility index, and one cached answer per selector. No capture calls. */
export function createResolutionContext(input: {
  snapshot: SnapshotState; platform: Platform; screenshot: { width: number; height: number };
  originalBounds?: ReadonlyMap<number, Rect>;
  captureOptions?: { depth?: number; scope?: string };
}) {
  const screenshot = sizeSchema.parse(input.screenshot);
  const viewport = viewportSchema.parse(input.snapshot.viewport);
  const snapshot = input.snapshot;
  const indexes = new Set<number>();
  for (const node of snapshot.nodes) {
    if (!Number.isSafeInteger(node.index) || indexes.has(node.index)) throw new Error('Snapshot node indexes must be unique safe integers.');
    indexes.add(node.index);
  }
  const visibility = createSnapshotVisibility(snapshot.nodes);
  const cache = new Map<string, Resolution>();
  function resolve(selector: string): Resolution {
    const previous = cache.get(selector);
    if (previous) return previous;
    let answer: Resolution;
    try {
      const chain = parseSelectorChain(selector);
      const options = { platform: input.platform, requireRect: false };
      // Preserve upstream alternative ordering: a later unique alternative wins before
      // the structural duplicate rule is attempted on the first ambiguous alternative.
      const unique = resolveSelectorChain(snapshot.nodes, chain, { ...options, requireUnique: true, disambiguateAmbiguous: false });
      const listed = listSelectorChainMatches(snapshot.nodes, chain, options);
      const matches = listed?.matchedNodes ?? [];
      const node = unique?.node ?? resolveElementReportedTwice(snapshot.nodes, matches) ?? undefined;
      const code = matches.length ? 'TARGET_AMBIGUOUS' : 'TARGET_NOT_FOUND';
      const candidates = matches.length ? matches : nearestCandidates(selector, snapshot.nodes);
      const details = candidates.slice(0, 5).map((candidate) => JSON.stringify({
        index: candidate.index, id: candidate.identifier, role: candidate.kind ?? candidate.type,
        label: candidate.label, rect: candidate.rect,
      })).join('; ');
      answer = {
        matches,
        ...(node ? { node } : { error: {
          code,
          message: `${formatSelectorFailure(chain, [{ selector, matches: matches.length }], { unique: true })}${details ? ` Candidates: ${details}.` : ''} Use a unique stable identifier or add a testID.`,
        } }),
      };
    } catch (error) {
      answer = { matches: [], error: { code: 'CHECK_UNAVAILABLE', message: `Cannot parse selector ${JSON.stringify(selector)}: ${error instanceof Error ? error.message : String(error)}. Use agent-device selector syntax.` } };
    }
    cache.set(selector, answer);
    return answer;
  }
  function draw(selector: string): DrawingResolution {
    const resolved = resolve(selector);
    if (!resolved.node) return { error: resolved.error! };
    const node = resolved.node;
    const visible = evaluateIsPredicate({ predicate: 'visible', node, visibility, platform: input.platform }).pass;
    if (!visible || !isPositiveFiniteRect(node.rect)) return { error: { code: 'TARGET_OFFSCREEN', message: `Selector ${JSON.stringify(selector)} matched node ${node.index}, but it has no visible drawable bounds. Bring the target on screen and capture again.` } };
    // Project edges independently so an exact viewport edge stays an exact pixel edge.
    // Multiplying x and width separately can manufacture a subpixel overflow.
    const project = (rect: Rect): Rect => {
      const x = rect.x / viewport.width * screenshot.width;
      const y = rect.y / viewport.height * screenshot.height;
      return { x, y, width: (rect.x + rect.width) / viewport.width * screenshot.width - x, height: (rect.y + rect.height) / viewport.height * screenshot.height - y };
    };
    const projected = project(node.rect);
    const sourceOutside = node.rect.x < 0 || node.rect.y < 0 || node.rect.x + node.rect.width > viewport.width || node.rect.y + node.rect.height > viewport.height;
    const supplied = input.originalBounds?.get(node.index);
    const originalRect = supplied ? project(rectSchema.parse(supplied)) : sourceOutside ? projected : undefined;
    const left = Math.max(0, projected.x), top = Math.max(0, projected.y);
    const right = Math.min(screenshot.width, projected.x + projected.width), bottom = Math.min(screenshot.height, projected.y + projected.height);
    if (right <= left || bottom <= top) return { error: { code: 'TARGET_OFFSCREEN', message: `Selector ${JSON.stringify(selector)} matched node ${node.index} entirely outside the screenshot. Bring the target on screen and capture again.` } };
    const rect = { x: left, y: top, width: right - left, height: bottom - top };
    const partial = originalRect && (originalRect.x < 0 || originalRect.y < 0 || originalRect.x + originalRect.width > screenshot.width || originalRect.y + originalRect.height > screenshot.height);
    const edge = !originalRect && (left === 0 || top === 0 || right === screenshot.width || bottom === screenshot.height);
    return {
      target: { targetId: `node:${node.index}`, rect, ...(originalRect ? { originalRect } : {}) },
      ...(partial ? { warning: { code: 'PARTIALLY_OFFSCREEN' as const, message: 'Partly off-screen; only the visible bounds are shown.' } } : edge ? { warning: { code: 'EDGE_EXTENT_UNKNOWN' as const, message: 'Touches screen edge; full extent unknown' } } : {}),
    };
  }
  return { snapshot, platform: input.platform, screenshot, visibility, resolve, draw, captureOptions: input.captureOptions ?? {} };
}
export type ResolutionContext = ReturnType<typeof createResolutionContext>;

/** Diagnostics only: ranking candidates never resolves an ambiguous or missing selector. */
function nearestCandidates(selector: string, nodes: SnapshotNode[]): SnapshotNode[] {
  const tokens = selector.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return nodes.map((node, index) => {
    const identity = [node.identifier, node.label, node.value, node.type, node.kind].filter(Boolean).join(' ').toLowerCase();
    return { node, index, score: tokens.reduce((score, token) => score + (identity.includes(token) ? token.length : 0), 0) };
  }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 5).map(({ node }) => node);
}

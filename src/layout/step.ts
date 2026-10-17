import type { evaluateStep } from '../check/step.js';
import { validateStepGeometry, rectWithinCrop } from '../manifest/geometry.js';
import { summarizeStepEvaluation } from '../manifest/evaluation.js';
import { stepSchema, type StepInput } from '../spec/step.js';
import { criterionSchema } from '../spec/values.js';
import { numberStepEntries } from '../spec/numbered-entries.js';
import { decideAnnotatedImage } from './image-policy.js';
import type { TextLine, TextMetrics } from './font.js';
import { regionColor } from './color.js';
import { denseTargetGroups, type Rect } from './overlap.js';
import { placeTags, layoutStyle, type Tag } from './place.js';

type AcceptedEvaluation = Pick<ReturnType<typeof evaluateStep>, 'checks' | 'errors' | 'geometry'>;
export type Region = { numbers: number[]; targetIds: string[]; rect: Rect; color: string;
  border: 'solid' | 'dashed' | 'dotted'; tag: Tag;
  results: { n: number; outcome: 'INFO' | 'PASS' | 'FAIL' | 'ERROR' }[];
  arrows: { n: number; from: { x: number; y: number }; to: { x: number; y: number } }[] };
export type View = { kind: 'overview' | 'detail'; targetId?: string; source: Rect; frame: Rect;
  width: number; height: number; regions: Region[]; masks: { numbers: number[]; rect: Rect; label: 'masked'; fill: string; hatch: true }[] };
export type TextBlock = { x: number; y: number; height: number; lines: TextLine[]; source: string };
export type LegendRow = { n: number; outcome: 'INFO' | 'PASS' | 'FAIL' | 'ERROR'; color?: string; block: TextBlock };

/** All positions are evidence-image pixels. Source rectangles remain raw screenshot pixels. */
export function layoutStep(input: { step: StepInput; criterion: string; accepted: AcceptedEvaluation; metrics: TextMetrics }) {
  const step = stepSchema.parse(input.step), criterion = criterionSchema.parse(input.criterion);
  const evaluation = { checks: input.accepted.checks, errors: input.accepted.errors };
  const interrupted = input.accepted.geometry.crop === undefined;
  const summary = summarizeStepEvaluation(step, evaluation, { interrupted });
  const geometry = validateStepGeometry(step, input.accepted.geometry, evaluation, { imageAvailable: false, interrupted });
  const policy = decideAnnotatedImage(step, evaluation, { screenshotUsable: true, cropUsable: !!geometry.crop,
    drawableNumbers: geometry.targets.map(({ n }) => n) }, { interrupted });
  if (policy.kind === 'omit') return { kind: 'omit' as const, policy };
  const entries = numberStepEntries(step), metrics = input.metrics;
  const style = layoutStyle(geometry.screenshot.width);
  const outcome = (n: number): LegendRow['outcome'] => summary.errors.some((error) => error.n === n) ? 'ERROR'
    : summary.checks.find((check) => check.n === n)?.result === 'fail' ? 'FAIL'
    : summary.checks.some((check) => check.n === n) ? 'PASS' : 'INFO';
  const groups = [...geometry.groups].sort((a, b) => a.numbers[0]! - b.numbers[0]!);
  const colorFor = (n: number) => {
    const index = groups.findIndex((group) => group.numbers.includes(n));
    // A fixed low-lightness palette sequence retains white-label contrast without pixel sampling.
    return regionColor(index);
  };
  const isMask = (n: number) => { const entry = entries[n - 1]!; return entry.kind === 'annotation' && 'mask' in entry.annotation; };
  function makeView(source: Rect, y: number, targetId?: string): View {
    const frame = { x: style.padding, y: y + style.padding, width: source.width, height: source.height };
    const project = (rect: Rect) => { const local = rectWithinCrop(rect, source); return { ...local, x: local.x + frame.x, y: local.y + frame.y }; };
    const selected = groups.map((group) => ({ numbers: group.numbers.filter((n) => !targetId || geometry.targets.find((target) => target.n === n)!.targetId === targetId) })).filter((group) => group.numbers.length);
    const draft = selected.map(({ numbers }) => {
      const targets = numbers.map((n) => geometry.targets.find((target) => target.n === n)!);
      const checks = summary.checks.filter((check) => numbers.includes(check.n));
      return { numbers, targetIds: [...new Set(targets.map(({ targetId }) => targetId))], rect: project(targets[0]!.rect), color: colorFor(numbers[0]!),
        border: (checks.some((check) => check.result === 'fail') ? 'dashed' : checks.length ? 'solid' : 'dotted') as Region['border'],
        results: numbers.map((n) => ({ n, outcome: outcome(n) })) };
    });
    // Inter includes these result symbols; INFO retains its number alone.
    const placed = placeTags(draft.map((region) => ({ rect: region.rect, text: region.results.map(({ n, outcome }) => `${n}${outcome === 'INFO' ? '' : outcome === 'PASS' ? ' ✓' : outcome === 'FAIL' ? ' ×' : ' !'}`).join(', ') })), frame, metrics, style);
    const regions: Region[] = draft.map((region, index) => {
      const tag = placed.tags[index]!;
      return { ...region, tag, arrows: region.numbers.filter((n) => {
        const entry = entries[n - 1]!; return entry.kind === 'annotation' && 'arrow' in entry.annotation;
      }).map((n) => ({ n, ...tag.connector })) };
    });
    // Every view masks ALL intersecting requested masks, including other detail targets.
    const masks: View['masks'] = [];
    for (const group of groups) {
      const numbers = group.numbers.filter(isMask);
      if (!numbers.length) continue;
      const rect = geometry.targets.find((target) => target.n === numbers[0])!.rect;
      const x = Math.max(source.x, rect.x), top = Math.max(source.y, rect.y);
      const right = Math.min(source.x + source.width, rect.x + rect.width), bottom = Math.min(source.y + source.height, rect.y + rect.height);
      if (right > x && bottom > top) masks.push({ numbers, rect: project({ x, y: top, width: right - x, height: bottom - top }), label: 'masked', fill: style.mask, hatch: true });
    }
    return { kind: targetId ? 'detail' : 'overview', ...(targetId ? { targetId } : {}), source: { ...source }, frame,
      width: placed.width, height: placed.height - y, regions, masks };
  }
  const views: View[] = [makeView(geometry.crop!, 0)];
  let bottom = views[0]!.height;
  for (const group of denseTargetGroups(geometry.targets)) {
    for (const targetId of group) {
      const rect = geometry.targets.find((target) => target.targetId === targetId)!.rect;
      const crop = geometry.crop!;
      const x = Math.max(crop.x, Math.floor(rect.x - 24)), y = Math.max(crop.y, Math.floor(rect.y - 24));
      const right = Math.min(crop.x + crop.width, Math.ceil(rect.x + rect.width + 24));
      const lower = Math.min(crop.y + crop.height, Math.ceil(rect.y + rect.height + 24));
      const view = makeView({ x, y, width: right - x, height: lower - y }, bottom, targetId);
      views.push(view); bottom += view.height;
    }
  }
  const width = Math.max(360 * style.fontSize / 16, ...views.map((view) => view.width));
  const legendY = bottom, textWidth = width - style.padding * 2;
  bottom += style.padding;
  function block(source: string): TextBlock {
    const lines = metrics.wrap(source, style.fontSize, textWidth);
    const result = { x: style.padding, y: bottom, height: lines.length * style.lineHeight, lines, source };
    bottom += result.height + style.gap;
    return result;
  }
  const badge = block(`${summary.result.toUpperCase()} | Checks: ${summary.checkCounts.total}, passed: ${summary.checkCounts.passed}, failed: ${summary.checkCounts.failed}`);
  const criterionBlock = block(criterion);
  const rows: LegendRow[] = entries.map((entry) => {
    const primitive = entry.kind === 'check' ? entry.check : Object.values(entry.annotation)[0]!;
    const target = 'to' in primitive ? primitive.to : primitive.target;
    const text = 'text' in primitive && typeof primitive.text === 'string' ? primitive.text : target;
    const check = summary.checks.find((check) => check.n === entry.n);
    const parts = [`${entry.n} ${outcome(entry.n)}: ${text}`];
    if (isMask(entry.n)) parts.push('masked');
    if (check) {
      parts.push(`Check: ${check.result.toUpperCase()}`);
      parts.push(`Expected: ${JSON.stringify(check.expect)}`, `Actual: ${JSON.stringify(check.actual)}`);
    }
    for (const error of summary.errors.filter((error) => error.n === entry.n)) parts.push(`${error.code}: ${error.message}`);
    for (const warning of geometry.warnings.filter((warning) => 'n' in warning && warning.n === entry.n)) parts.push(warning.message);
    return { n: entry.n, outcome: outcome(entry.n), ...(geometry.targets.some((target) => target.n === entry.n) ? { color: colorFor(entry.n) } : {}), block: block(parts.join('\n')) };
  });
  const warnings = geometry.warnings.filter((warning) => 'cropTarget' in warning).map((warning) => block(`${'cropTarget' in warning ? warning.cropTarget : ''}: ${warning.message}`));
  return { kind: 'layout' as const, width, height: bottom + style.padding, style, views,
    legend: { rect: { x: 0, y: legendY, width, height: bottom + style.padding - legendY }, badge, criterion: criterionBlock, rows, warnings },
    result: summary.result, checkCounts: summary.checkCounts };
}

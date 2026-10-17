import { stepSchema, type StepInput } from '../spec/step.js';
import { numberStepEntries } from '../spec/numbered-entries.js';
import { summarizeStepEvaluation, type CompletedCheck, type EntryError } from '../manifest/evaluation.js';
import { validateStepGeometry, type Geometry } from '../manifest/geometry.js';
import { decideAnnotatedImage } from '../layout/image-policy.js';
import { createResolutionContext } from '../resolve/targets.js';
import { evaluateCheck } from './evaluate.js';

/** Pure M2 entry point. Each entry is independent; a bad target cannot stop later checks. */
export function evaluateStep(input: Parameters<typeof createResolutionContext>[0] & { step: StepInput }) {
  const step = stepSchema.parse(input.step);
  const context = createResolutionContext(input);
  const checks: CompletedCheck[] = [], errors: EntryError[] = [];
  const geometry: Geometry = { screenshot: context.screenshot, targets: [], cropTargets: [], groups: [], warnings: [] };
  for (const entry of numberStepEntries(step)) {
    const primitive = entry.kind === 'annotation' ? Object.values(entry.annotation)[0]! : entry.check;
    const target = 'to' in primitive ? primitive.to : primitive.target;
    const expect = primitive.expect;
    let completed: CompletedCheck | undefined;
    if (expect) {
      const evaluated = evaluateCheck(context, entry.n, target, expect);
      if ('check' in evaluated) { completed = evaluated.check; checks.push(completed); }
      else errors.push(evaluated.error);
    }
    const legendOnly = entry.kind === 'check' && completed && (('absent' in completed.actual && completed.actual.absent) || ('hidden' in completed.actual && completed.actual.hidden));
    if (legendOnly) continue;
    const drawn = context.draw(target);
    if ('target' in drawn) {
      geometry.targets.push({ n: entry.n, ...drawn.target });
      if (drawn.warning) geometry.warnings.push({ n: entry.n, ...drawn.warning });
    } else if (!errors.some((error) => error.n === entry.n && error.code === drawn.error.code)) errors.push({ n: entry.n, ...drawn.error });
  }
  const cropErrors: string[] = [];
  for (const target of [...new Set(step.crop?.targets ?? [])].sort()) {
    const drawn = context.draw(target);
    if ('target' in drawn) {
      geometry.cropTargets.push({ target, ...drawn.target });
      if (drawn.warning) geometry.warnings.push({ cropTarget: target, ...drawn.warning });
    } else cropErrors.push(drawn.error.message);
  }
  if (!step.crop) geometry.crop = { x: 0, y: 0, ...context.screenshot };
  else if (!cropErrors.length) {
    const rects = [...geometry.targets, ...geometry.cropTargets].map((target) => target.rect);
    const padding = step.crop.padding;
    const x = Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.x)) - padding));
    const y = Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.y)) - padding));
    const right = Math.min(context.screenshot.width, Math.ceil(Math.max(...rects.map((rect) => rect.x + rect.width)) + padding));
    const bottom = Math.min(context.screenshot.height, Math.ceil(Math.max(...rects.map((rect) => rect.y + rect.height)) + padding));
    geometry.crop = { x, y, width: right - x, height: bottom - y };
  }
  const groups = new Map<string, number[]>();
  for (const target of geometry.targets) {
    const key = JSON.stringify(target.rect);
    const group = groups.get(key) ?? [];
    group.push(target.n); groups.set(key, group);
  }
  geometry.groups = [...groups.values()].map((numbers) => ({ numbers }));
  const options = { interrupted: cropErrors.length > 0 };
  const evaluation = summarizeStepEvaluation(step, { checks, errors }, options);
  const imagePolicy = decideAnnotatedImage(step, evaluationInput(evaluation), { screenshotUsable: true, cropUsable: geometry.crop !== undefined, drawableNumbers: geometry.targets.map(({ n }) => n) }, options);
  const validated = validateStepGeometry(step, geometry, evaluationInput(evaluation), { ...options, imageAvailable: imagePolicy.kind === 'render' });
  return { ...evaluation, geometry: validated, imagePolicy, ...(cropErrors.length ? { error: { code: 'CROP_UNUSABLE', message: cropErrors.join('\n') } } : {}) };
}
function evaluationInput(evaluation: { checks: CompletedCheck[]; errors: EntryError[] }) {
  return { checks: evaluation.checks, errors: evaluation.errors };
}

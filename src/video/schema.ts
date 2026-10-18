import * as z from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { specSchema, specStructureSchema } from '../spec/schema.js';
import { buildIdentitySchema } from '../spec/build-identity.js';
import { environmentStructureSchema, environmentSchema } from '../manifest/environment.js';
import { attemptSchema, attemptStructureSchema } from '../manifest/attempt.js';
import { normalizeStep } from '../spec/effective-step.js';
import { stepNameSchema } from '../spec/step-name.js';

const ms = z.number().finite().nonnegative();
const diagnostic = z.strictObject({ code: z.string().min(1), message: z.string().min(1) });
export const sessionIdentitySchema = z.strictObject({
  address: z.string().min(1), createdAt: ms, platform: z.enum(['ios', 'android']), deviceId: z.string().min(1),
  agentDevice: z.string().min(1),
});
export type SessionIdentity = z.infer<typeof sessionIdentitySchema>;
export const videoStructureSchema = z.strictObject({
  version: z.literal(1), state: z.enum(['starting', 'recording', 'stopping', 'stopped']),
  spec: specStructureSchema, build: buildIdentitySchema.optional(), cwd: z.string().min(1),
  session: sessionIdentitySchema, environment: environmentStructureSchema, host: z.string().min(1), clockMs: ms, requestedAt: z.iso.datetime(),
  startUncertaintyMs: ms.optional(), stoppedMs: ms.optional(),
  raw: z.literal('raw.mp4'), warnings: z.array(z.string()),
  marks: z.array(z.strictObject({
    step: stepNameSchema, startedMs: ms, completedMs: ms.optional(),
    attempt: attemptStructureSchema.optional(), error: diagnostic.optional(),
  })),
  export: z.strictObject({ path: z.literal('annotated.mp4'), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), durationMs: ms, width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
});
export type VideoRun = z.infer<typeof videoStructureSchema>;
export function flowSteps(spec: VideoRun['spec']) {
  return spec.criteria.flatMap(group => Object.entries(group.steps).map(([name, step]) => ({
    name, configuration: normalizeStep({ criterion: group.criterion, step, ...(spec.defaults ? { defaults: spec.defaults } : {}) }),
  })));
}
export const videoSchema = videoStructureSchema.superRefine((run, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (!specSchema.safeParse(run.spec).success) issue('Invalid video spec.');
  if (!environmentSchema.safeParse(run.environment).success) issue('Invalid recording environment.');
  const steps = flowSteps(run.spec);
  if (steps.length > 100) issue('Video supports up to 100 steps per recording. Split longer flows.');
  if (steps.some(s => s.configuration.annotate.some(a => 'mask' in a))) issue('Video does not redact moving regions. Use a spec without masks and seeded data.');
  if (steps.length > 1 && !run.build) issue('Multi-step video requires build identity.');
  if (run.state !== 'starting' && run.startUncertaintyMs === undefined) issue('Recording needs start timing uncertainty.');
  if (run.state === 'stopped' && run.stoppedMs === undefined) issue('Stopped recording needs a stop timestamp.');
  if (run.export && run.state !== 'stopped') issue('Only a stopped recording can be exported.');
  let previous = run.startUncertaintyMs ?? 0;
  for (const [i, mark] of run.marks.entries()) {
    const expected = steps[i];
    if (!expected || mark.step !== expected.name) issue('Mark each declared step once, in order.');
    if (mark.startedMs < previous) issue('Video marks must be chronological.');
    if (mark.completedMs !== undefined && mark.completedMs < mark.startedMs) issue('Completion precedes the mark.');
    if ((mark.attempt || mark.error) && mark.completedMs === undefined) issue('A result needs its completion timestamp.');
    if (mark.completedMs !== undefined && !mark.attempt && !mark.error) issue('A completed mark needs evidence or an explicit error.');
    if (mark.attempt && mark.error) issue('A mark cannot have two results.');
    if (mark.attempt) {
      if (!attemptSchema.safeParse(mark.attempt).success) issue('Invalid capture evidence.');
      if (mark.attempt.step !== mark.step || !isDeepStrictEqual(mark.attempt.configuration, expected?.configuration) || !isDeepStrictEqual(mark.attempt.build, run.build)) issue('Capture evidence does not match the recorded flow.');
    }
    if (mark.completedMs === undefined && i < run.marks.length - 1) issue('An unfinished mark must be last.');
    previous = mark.completedMs ?? mark.startedMs;
  }
  if (run.stoppedMs !== undefined && run.stoppedMs < previous) issue('Stop precedes a mark.');
});
export function videoOutcome(run: VideoRun): 'passed' | 'failed' | 'error' {
  if (run.marks.length !== flowSteps(run.spec).length || run.marks.some(m => !m.attempt || m.attempt.result === 'error')) return 'error';
  return run.marks.some(m => m.attempt?.result === 'failed') ? 'failed' : 'passed';
}
export function checklistAt(run: VideoRun, timeMs: number) {
  const visible = run.marks.filter(m => m.startedMs <= timeMs);
  const active = visible.at(-1)?.step;
  return flowSteps(run.spec).map((step, index) => {
    const mark = visible.find(m => m.step === step.name);
    const complete = mark?.completedMs !== undefined && mark.completedMs <= timeMs;
    const attempt = complete ? mark?.attempt : undefined;
    const status = !mark ? 'PENDING' : !complete ? (run.stoppedMs !== undefined && timeMs >= run.stoppedMs ? 'ERROR' : 'CHECKING')
      : !attempt || attempt.result === 'error' ? 'ERROR' : attempt.result === 'failed' ? 'FAIL' : attempt.checkCounts.total === 0 ? 'INFO' : 'PASS';
    const details: string[] = [];
    if (complete) {
      for (const check of attempt?.checks.filter(c => c.result === 'fail') ?? []) {
        const [predicate, expected] = Object.entries(check.expect)[0]!;
        const actual = Object.values(check.actual)[0];
        details.push(`#${check.n} Expected ${predicate}: ${JSON.stringify(expected)}; actual: ${JSON.stringify(actual)}`);
      }
      for (const error of attempt?.errors ?? []) details.push(`#${error.n} ${error.message}`);
      if (attempt?.error) details.push(attempt.error.message);
      if (mark?.error) details.push(mark.error.message);
      if (status === 'INFO') details.push('No assertions evaluated.');
    }
    if (status === 'ERROR' && !complete) details.push('Check interrupted; no completed result.');
    return { n: index + 1, name: step.name, criterion: step.configuration.criterion, active: step.name === active, status, details };
  });
}

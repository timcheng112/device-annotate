import type { Expectation } from '../spec/check.js';
import type { CompletedCheck } from '../manifest/evaluation.js';
import type { ResolutionContext } from '../resolve/targets.js';
import { evaluateIsPredicate } from '../vendor/agent-device/predicates.js';
import { absenceCaptureOptionRefusal, absenceCaptureOptionMessage, classifyAbsenceObservation, isUnprovableAbsence, UNPROVABLE_ABSENCE_CAUSES } from '../vendor/agent-device/absence-observation.js';

/** Evaluate one assertion against the accepted snapshot, retaining the observed value. */
export function evaluateCheck(context: ResolutionContext, n: number, selector: string, expect: Expectation):
  | { check: CompletedCheck }
  | { error: { n: number; code: 'CHECK_UNAVAILABLE' | 'TARGET_NOT_FOUND' | 'TARGET_AMBIGUOUS'; message: string } } {
  const resolution = context.resolve(selector);
  if (resolution.error?.code === 'CHECK_UNAVAILABLE') return { error: { n, ...resolution.error } };
  let actual: CompletedCheck['actual'];
  if ('absent' in expect) {
    const refused = absenceCaptureOptionRefusal(context.captureOptions);
    if (refused) return { error: { n, code: 'CHECK_UNAVAILABLE', message: absenceCaptureOptionMessage(refused) } };
    const observation = classifyAbsenceObservation(context.snapshot, resolution.matches);
    if (isUnprovableAbsence(observation.kind)) return { error: { n, code: 'CHECK_UNAVAILABLE', message: `Cannot establish absence for ${JSON.stringify(selector)}: ${UNPROVABLE_ABSENCE_CAUSES[observation.kind]}. Capture a settled, full-depth, unscoped snapshot.` } };
    actual = { absent: observation.kind === 'absent' };
  } else if ('exists' in expect) {
    actual = { exists: resolution.matches.length > 0 };
  } else {
    if (!resolution.node) return { error: { n, ...resolution.error! } };
    const name = Object.keys(expect)[0] as 'visible' | 'hidden' | 'editable' | 'selected' | 'focused' | 'text';
    const result = evaluateIsPredicate({ predicate: name, node: resolution.node, visibility: context.visibility, platform: context.platform, ...('text' in expect ? { expectedText: expect.text } : {}) });
    actual = { [name]: name === 'text' ? result.actualText : result.pass } as CompletedCheck['actual'];
  }
  const expectedValue = Object.values(expect)[0];
  return { check: { n, expect, actual, result: Object.values(actual)[0] === expectedValue ? 'pass' : 'fail' } };
}

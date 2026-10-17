import { specSchema } from '../spec/schema.js';
import { normalizeStep } from '../spec/effective-step.js';
import { buildIdentitySchema, type BuildIdentity } from '../spec/build-identity.js';
import { environmentSchema, environmentsMatch, type Environment } from './environment.js';
import { outputOwnerSchema } from './owner.js';
import { attemptSchema, type Attempt } from './attempt.js';
import { manifestSchema, summarizeManifest, type Manifest } from './schema.js';

const zero = () => ({ total: 0, passed: 0, failed: 0 });
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Reconcile current evidence only. Historical passes never become current automatically. */
export function reconcileManifest(input: {
  spec: unknown; owner: unknown; previous?: unknown; build?: BuildIdentity; environment?: Environment;
}): Manifest {
  const spec = specSchema.parse(input.spec);
  const owner = outputOwnerSchema.parse(input.owner);
  const previous = input.previous === undefined ? undefined : manifestSchema.parse(input.previous);
  const build = input.build === undefined ? undefined : buildIdentitySchema.parse(input.build);
  const environment = input.environment === undefined ? undefined : environmentSchema.parse(input.environment);
  if (previous && !equal(previous.owner, owner)) throw new Error('Evidence folder owner differs; use a folder owned by this verification flow.');
  const byName = new Map(previous?.criteria.flatMap((group) => group.steps.map((step) => [step.step, step] as const)) ?? []);
  const retained = new Set<string>();
  const criteria = spec.criteria.map((group) => ({
    criterion: group.criterion, result: 'incomplete' as const, checkCounts: zero(),
    steps: Object.entries(group.steps).map(([name, step]) => {
      const configuration = normalizeStep({ criterion: group.criterion, step, ...(spec.defaults ? { defaults: spec.defaults } : {}) });
      const old = byName.get(name);
      if (old && old.result !== 'incomplete' && build && old.build && environment && old.environment &&
          equal(old.configuration, configuration) && equal(old.build, build) && environmentsMatch(old.environment, environment)) {
        retained.add(old.attemptId);
        return old;
      }
      return { step: name, configuration, result: 'incomplete' as const, checkCounts: zero() };
    }),
  }));
  const superseded = [...byName.values()].filter((step): step is Attempt => step.result !== 'incomplete' && !retained.has(step.attemptId));
  return summarizeManifest({
    schemaVersion: 1, owner, retention: spec.retention,
    result: 'incomplete', checkCounts: zero(), criteria,
    history: [...(previous?.history ?? []), ...superseded],
  });
}

/** Replace one current step after a successful save; persistence and locks belong to capture/. */
export function replaceAttempt(manifestInput: unknown, attemptInput: unknown): Manifest {
  const manifest = manifestSchema.parse(manifestInput), attempt = attemptSchema.parse(attemptInput);
  const current = manifest.criteria.flatMap((group) => group.steps).find((step) => step.step === attempt.step);
  if (!current) throw new Error('The attempt step does not belong to the current spec. Reconcile first.');
  if (!equal(current.configuration, attempt.configuration)) throw new Error('The attempt configuration differs from the current spec. Reconcile first.');
  const previousAttempts = [...manifest.history, ...manifest.criteria.flatMap((group) => group.steps.filter((step): step is Attempt => step.result !== 'incomplete'))];
  if (previousAttempts.some((record) => record.attemptId === attempt.attemptId)) throw new Error('An immutable attempt ID cannot be reused.');
  if (current.result !== 'incomplete') manifest.history.push(current);
  for (const group of manifest.criteria) group.steps = group.steps.map((step) => step.step === attempt.step ? attempt : step);
  return summarizeManifest(manifest);
}

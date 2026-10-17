import * as z from "zod";
import { stepNameSchema } from "../spec/step-name.js";
import { criterionSchema } from "../spec/values.js";
import { retentionSchema } from "../spec/retention.js";
import { attemptSchema, attemptStructureSchema, checkCountsSchema, effectiveConfigurationSchema, validateConfiguration, validateNested, type Attempt } from "./attempt.js";
import { environmentsMatch } from "./environment.js";
import { outputOwnerSchema } from "./owner.js";

const resultSchema = z.enum(["error", "failed", "incomplete", "passed"]);
const incompleteSchema = z.strictObject({
  step: stepNameSchema, configuration: effectiveConfigurationSchema,
  result: z.literal("incomplete"),
  checkCounts: z.strictObject({ total: z.literal(0), passed: z.literal(0), failed: z.literal(0) }),
});
const currentStepSchema = z.discriminatedUnion("result", [incompleteSchema, attemptStructureSchema]);
const criterionRecordSchema = z.strictObject({
  criterion: criterionSchema, result: resultSchema, checkCounts: checkCountsSchema,
  steps: z.array(currentStepSchema).min(1),
});

export const manifestStructureSchema = z.strictObject({
  schemaVersion: z.literal(1), owner: outputOwnerSchema,
  retention: retentionSchema,
  result: resultSchema, checkCounts: checkCountsSchema,
  criteria: z.array(criterionRecordSchema).min(1),
  history: z.array(attemptStructureSchema),
}).describe("Current results under criteria; retained attempts in history. Complete semantic validation uses manifestSchema. Filesystem integration is separate.");

type CountedResult = { result: z.output<typeof resultSchema>; checkCounts: z.output<typeof checkCountsSchema> };
function aggregate(records: CountedResult[]): CountedResult {
  const result = (["error", "failed", "incomplete", "passed"] as const).find((value) => records.some((item) => item.result === value)) ?? "incomplete";
  const checkCounts = { total: 0, passed: 0, failed: 0 };
  for (const record of records) {
    for (const key of ["total", "passed", "failed"] as const) checkCounts[key] += record.checkCounts[key];
  }
  return { result, checkCounts };
}
function checkAggregate(record: CountedResult, children: CountedResult[], context: z.RefinementCtx, path: (string | number)[]): void {
  const expected = aggregate(children);
  if (record.result !== expected.result) context.addIssue({ code: "custom", path: [...path, "result"], message: "Derive the outcome from current children using error, failed, incomplete, passed precedence." });
  for (const key of ["total", "passed", "failed"] as const) {
    if (!Number.isSafeInteger(expected.checkCounts[key]) || record.checkCounts[key] !== expected.checkCounts[key]) {
      context.addIssue({ code: "custom", path: [...path, "checkCounts", key], message: "Sum current child checks only; history never contributes to these counts." });
    }
  }
}

export const manifestSchema = manifestStructureSchema.superRefine((manifest, context) => {
  const names = new Set<string>();
  const attempts = new Set<string>();
  const successful: Attempt[] = [];
  const stepCount = manifest.criteria.reduce((count, group) => count + group.steps.length, 0);
  const inspectAttempt = (attempt: z.output<typeof attemptStructureSchema>, path: (string | number)[]) => {
    const valid = validateNested(attemptSchema, attempt, context, path);
    if (attempts.has(attempt.attemptId)) context.addIssue({ code: "custom", path: [...path, "attemptId"], message: "An attempt ID must occur exactly once across current results and history." });
    attempts.add(attempt.attemptId);
    return valid;
  };
  for (const [groupIndex, group] of manifest.criteria.entries()) {
    const groupPath = ["criteria", groupIndex];
    for (const [stepIndex, step] of group.steps.entries()) {
      const path = [...groupPath, "steps", stepIndex];
      if (names.has(step.step)) context.addIssue({ code: "custom", path: [...path, "step"], message: "Current step names must be unique across criteria." });
      names.add(step.step);
      if (step.configuration.criterion !== group.criterion) context.addIssue({ code: "custom", path: [...path, "configuration", "criterion"], message: "Current evidence must use the current criterion verbatim." });
      if (step.result === "incomplete") {
        validateConfiguration(step.configuration, context, [...path, "configuration"]);
      } else if (inspectAttempt(step, path) && step.result !== "error") {
        if (stepCount > 1 && (step.build === undefined || step.environment!.unavailable.length > 0)) {
          context.addIssue({ code: "custom", path, message: "Current multi-step evidence requires complete build and environment identity." });
        }
        const previous = successful[0];
        if (previous && (JSON.stringify(previous.build) !== JSON.stringify(step.build) || !environmentsMatch(previous.environment, step.environment))) {
          context.addIssue({ code: "custom", path, message: "Current successful attempts must share compatible build and environment identity." });
        }
        successful.push(step);
      }
    }
    checkAggregate(group, group.steps, context, groupPath);
  }
  for (const [index, attempt] of manifest.history.entries()) inspectAttempt(attempt, ["history", index]);
  if (manifest.owner.kind === "one-off" && (stepCount !== 1 || !names.has(manifest.owner.step))) {
    context.addIssue({ code: "custom", path: ["owner"], message: "A one-off manifest must contain exactly its owner's current step." });
  }
  checkAggregate(manifest, manifest.criteria, context, []);
});

export type Manifest = z.output<typeof manifestSchema>;

/** Validate attempt data and recompute only current summaries without touching history. */
export function summarizeManifest(input: unknown): Manifest {
  const manifest = manifestStructureSchema.parse(input);
  for (const group of manifest.criteria) Object.assign(group, aggregate(group.steps));
  Object.assign(manifest, aggregate(manifest.criteria));
  return manifestSchema.parse(manifest);
}

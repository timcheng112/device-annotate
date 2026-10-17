import * as z from "zod";
import { expectationSchema, type Expectation } from "../spec/check.js";
import { numberStepEntries, type NumberedEntry } from "../spec/numbered-entries.js";
import type { StepInput } from "../spec/step.js";

const entryNumberSchema = z.number().int().positive();
const actualSchema = z.union([
  z.strictObject({ visible: z.boolean() }),
  z.strictObject({ hidden: z.boolean() }),
  z.strictObject({ exists: z.boolean() }),
  z.strictObject({ absent: z.boolean() }),
  z.strictObject({ editable: z.boolean() }),
  z.strictObject({ selected: z.boolean() }),
  z.strictObject({ focused: z.boolean() }),
  z.strictObject({ text: z.string() }),
]);

export const completedCheckSchema = z.strictObject({
  n: entryNumberSchema,
  expect: expectationSchema,
  actual: actualSchema,
  result: z.enum(["pass", "fail"]),
}).describe("Completed assertion only. The evaluation validator also checks its number, expectation, actual predicate, and outcome against the step.");

export const entryErrorSchema = z.strictObject({
  n: entryNumberSchema,
  code: z.enum(["TARGET_NOT_FOUND", "TARGET_AMBIGUOUS", "TARGET_OFFSCREEN", "CHECK_UNAVAILABLE"]),
  message: z.string().regex(/\S/, "Supply an actionable entry error message."),
}).describe("An entry could not be resolved, evaluated, or drawn. This is not a failed assertion.");

const evaluationInputSchema = z.strictObject({
  checks: z.array(completedCheckSchema),
  errors: z.array(entryErrorSchema),
});

export type CompletedCheck = z.output<typeof completedCheckSchema>;
export type EntryError = z.output<typeof entryErrorSchema>;
export type EvaluationSummary = {
  result: "passed" | "failed" | "error";
  checkCounts: { total: number; passed: number; failed: number };
  checks: CompletedCheck[];
  errors: EntryError[];
};

function expectationFor(entry: NumberedEntry): Expectation | undefined {
  if (entry.kind === "check") return entry.check.expect;
  // The annotation schema guarantees exactly one primitive.
  const primitive = Object.values(entry.annotation)[0] as { expect?: Expectation };
  return primitive.expect;
}

/** Preserve completed checks. A terminal interruption permits pending checks and forces error. */
export function summarizeStepEvaluation(step: StepInput, input: unknown, options: { interrupted?: boolean } = {}): EvaluationSummary {
  const entries = numberStepEntries(step);
  const validated = evaluationInputSchema.superRefine((evaluation, context) => {
    const completed = new Set<number>();
    const errored = new Set<number>();
    for (const [index, check] of evaluation.checks.entries()) {
      const location = ["checks", index];
      const entry = entries[check.n - 1];
      if (!entry) {
        context.addIssue({ code: "custom", path: [...location, "n"], message: "This entry number does not belong to the step." });
        continue;
      }
      if (completed.has(check.n)) {
        context.addIssue({ code: "custom", path: [...location, "n"], message: "Each assertion can have only one completed result per attempt." });
      }
      completed.add(check.n);
      const expected = expectationFor(entry);
      if (!expected || JSON.stringify(expected) !== JSON.stringify(check.expect)) {
        context.addIssue({ code: "custom", path: [...location, "expect"], message: "The result must use this entry's exact expectation; INFO entries have no assertion." });
      }
      const [expectedKey, expectedValue] = Object.entries(check.expect)[0]!;
      const [actualKey, actualValue] = Object.entries(check.actual)[0]!;
      if (expectedKey !== actualKey) {
        context.addIssue({ code: "custom", path: [...location, "actual"], message: "Actual and expected values must describe the same predicate." });
      } else if ((check.result === "pass") !== (expectedValue === actualValue)) {
        context.addIssue({ code: "custom", path: [...location, "result"], message: "The pass/fail result contradicts the actual and expected values." });
      }
    }
    for (const [index, error] of evaluation.errors.entries()) {
      if (!entries[error.n - 1]) {
        context.addIssue({ code: "custom", path: ["errors", index, "n"], message: "This error number does not belong to the step." });
      }
      errored.add(error.n);
    }
    for (const entry of entries) {
      if (!options.interrupted && expectationFor(entry) && !completed.has(entry.n) && !errored.has(entry.n)) {
        context.addIssue({ code: "custom", path: ["checks"], message: `Entry ${entry.n} needs a completed assertion result or an explicit error; it cannot silently count as passed.` });
      }
    }
  }).parse(input);

  const checks = validated.checks.sort((left, right) => left.n - right.n);
  const errors = validated.errors.sort((left, right) => left.n - right.n);
  const passed = checks.filter((check) => check.result === "pass").length;
  const failed = checks.length - passed;
  return {
    result: options.interrupted || errors.length > 0 ? "error" : failed > 0 ? "failed" : "passed",
    checkCounts: { total: checks.length, passed, failed },
    checks,
    errors,
  };
}

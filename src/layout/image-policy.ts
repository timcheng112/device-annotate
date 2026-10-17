import * as z from "zod";
import { summarizeStepEvaluation, type EntryError } from "../manifest/evaluation.js";
import { numberStepEntries } from "../spec/numbered-entries.js";
import type { StepInput } from "../spec/step.js";

const readinessSchema = z.strictObject({
  screenshotUsable: z.boolean(),
  cropUsable: z.boolean(),
  drawableNumbers: z.array(z.number().int().positive()),
});

type OmissionReason =
  | { code: "SCREENSHOT_UNUSABLE" | "CROP_UNUSABLE" }
  | { code: "MASK_UNUSABLE"; n: number };

export type AnnotatedImagePolicy =
  | { kind: "omit"; result: "error"; reasons: OmissionReason[] }
  | {
      kind: "render";
      result: "passed" | "failed" | "error";
      drawableNumbers: number[];
      legendNumbers: number[];
      errors: EntryError[];
    };

/** Eligibility only. Resolution/layout supplies readiness; successful rendering is still required. */
export function decideAnnotatedImage(step: StepInput, evaluation: unknown, readiness: z.input<typeof readinessSchema>, options: { interrupted?: boolean } = {}): AnnotatedImagePolicy {
  const entries = numberStepEntries(step);
  const summary = summarizeStepEvaluation(step, evaluation, options);
  const checked = readinessSchema.superRefine((value, context) => {
    const seen = new Set<number>();
    for (const [index, n] of value.drawableNumbers.entries()) {
      if (!entries[n - 1] || seen.has(n)) {
        context.addIssue({ code: "custom", path: ["drawableNumbers", index], message: "Supply each drawable entry number once, using numbers from this step." });
      }
      if (summary.errors.some((error) => error.n === n && error.code !== "CHECK_UNAVAILABLE")) {
        context.addIssue({ code: "custom", path: ["drawableNumbers", index], message: "A missing, ambiguous, or fully off-screen target cannot have a drawable marker." });
      }
      const check = summary.checks.find((item) => item.n === n);
      if (check && (("absent" in check.actual && check.actual.absent) || ("hidden" in check.actual && check.actual.hidden))) {
        context.addIssue({ code: "custom", path: ["drawableNumbers", index], message: "An absent or hidden target cannot receive an on-screen marker." });
      }
      seen.add(n);
    }
  }).parse(readiness);

  const drawable = new Set(checked.drawableNumbers);
  const reasons: OmissionReason[] = [];
  if (!checked.screenshotUsable) reasons.push({ code: "SCREENSHOT_UNUSABLE" });
  if (!checked.cropUsable) reasons.push({ code: "CROP_UNUSABLE" });
  for (const entry of entries) {
    if (entry.kind === "annotation" && "mask" in entry.annotation && !drawable.has(entry.n)) {
      reasons.push({ code: "MASK_UNUSABLE", n: entry.n });
    }
  }
  if (reasons.length > 0) return { kind: "omit", result: "error", reasons };

  // Only proven absence/hidden checks are intentionally legend-only. Other
  // entries need drawable evidence or a diagnostic row; never silently drop them.
  for (const entry of entries) {
    const check = summary.checks.find((item) => item.n === entry.n);
    const legendOnly = entry.kind === "check" && check && (("absent" in check.actual && check.actual.absent) || ("hidden" in check.actual && check.actual.hidden));
    if (!legendOnly && !drawable.has(entry.n) && !summary.errors.some((error) => error.n === entry.n)) {
      throw new Error(`Entry ${entry.n} has neither drawable evidence nor an error for the legend.`);
    }
  }
  return {
    kind: "render",
    result: summary.result,
    drawableNumbers: [...drawable].sort((left, right) => left - right),
    legendNumbers: entries.map((entry) => entry.n),
    errors: summary.errors,
  };
}

import type { Annotation } from "./annotation.js";
import type { StandaloneCheck } from "./check.js";
import { stepSchema, type StepInput } from "./step.js";

export type NumberedEntry =
  | { n: number; kind: "annotation"; annotation: Annotation }
  | { n: number; kind: "check"; check: StandaloneCheck };

/** Shared numbering for later evaluation, manifest records, and layout (T48). */
export function numberStepEntries(input: StepInput): NumberedEntry[] {
  const step = stepSchema.parse(input);
  return [
    ...step.annotate.map((annotation, index): NumberedEntry => ({
      n: index + 1, kind: "annotation", annotation,
    })),
    ...step.checks.map((check, index): NumberedEntry => ({
      n: step.annotate.length + index + 1, kind: "check", check,
    })),
  ];
}

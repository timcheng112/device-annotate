import * as z from "zod";
import { annotationSchema } from "../spec/annotation.js";
import { buildIdentitySchema } from "../spec/build-identity.js";
import { standaloneCheckSchema } from "../spec/check.js";
import { cropSchema } from "../spec/crop.js";
import { normalizeStep } from "../spec/effective-step.js";
import { criterionSchema, localPathSchema } from "../spec/values.js";
import { attemptArtifactsSchema, attemptArtifactsStructureSchema } from "./artifacts.js";
import { environmentSchema, environmentStructureSchema } from "./environment.js";
import { completedCheckSchema, entryErrorSchema, summarizeStepEvaluation } from "./evaluation.js";
import { geometryStructureSchema, validateStepGeometry } from "./geometry.js";

export const checkCountsSchema = z.strictObject({
  total: z.number().int().nonnegative(), passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
});
export const effectiveConfigurationSchema = z.strictObject({
  criterion: criterionSchema, annotate: z.array(annotationSchema), checks: z.array(standaloneCheckSchema), crop: cropSchema.nullable(),
});
const timestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?![\s\S])/, "Use a UTC timestamp with millisecond precision.");
const failureSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*(?![\s\S])/),
  message: z.string().regex(/\S/),
});

/** Captured evidence and original-coordinate geometry, including partial error attempts. */
export const attemptStructureSchema = z.strictObject({
  ...attemptArtifactsStructureSchema.shape,
  attemptedAt: timestampSchema,
  capturedAt: timestampSchema.optional(),
  configuration: effectiveConfigurationSchema,
  build: buildIdentitySchema.optional(),
  environment: environmentStructureSchema.optional(),
  geometry: geometryStructureSchema.optional(),
  result: z.enum(["passed", "failed", "error"]),
  checkCounts: checkCountsSchema,
  checks: z.array(completedCheckSchema),
  errors: z.array(entryErrorSchema),
  error: failureSchema.optional(),
  recordings: z.array(localPathSchema),
}).describe("An immutable capture-attempt ledger record. Complete validation uses attemptSchema; only saved artifacts and available provenance are recorded.");

/** Forward nested validation diagnostics without allowing safeParse to throw on format errors. */
export function validateNested(schema: z.ZodType, value: unknown, context: z.RefinementCtx, prefix: (string | number)[] = []): boolean {
  const result = schema.safeParse(value);
  if (result.success) return true;
  for (const issue of result.error.issues) {
    context.addIssue({ code: "custom", path: [...prefix, ...issue.path], message: issue.message });
  }
  return false;
}

export function validateConfiguration(configuration: z.output<typeof effectiveConfigurationSchema>, context: z.RefinementCtx, prefix: (string | number)[]): void {
  const { criterion, ...step } = configuration;
  try {
    const normalized = normalizeStep({ criterion, step });
    if (JSON.stringify(normalized) !== JSON.stringify(configuration)) {
      context.addIssue({ code: "custom", path: prefix, message: "Store the normalized effective configuration, including sorted, unique crop targets." });
    }
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    for (const issue of error.issues) context.addIssue({ code: "custom", path: [...prefix, ...issue.path], message: issue.message });
  }
}

export const attemptSchema = attemptStructureSchema.superRefine((attempt, context) => {
  const { step, attemptId, image, raw, snapshot } = attempt;
  validateNested(attemptArtifactsSchema, { step, attemptId, image, raw, snapshot }, context);
  validateConfiguration(attempt.configuration, context, ["configuration"]);
  if (attempt.environment !== undefined) validateNested(environmentSchema, attempt.environment, context, ["environment"]);
  for (const key of ["attemptedAt", "capturedAt"] as const) {
    const value = attempt[key];
    if (value === undefined) continue;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
      context.addIssue({ code: "custom", path: [key], message: "Supply a real UTC date and time with millisecond precision." });
    }
  }
  if (attempt.capturedAt !== undefined && attempt.capturedAt < attempt.attemptedAt) {
    context.addIssue({ code: "custom", path: ["capturedAt"], message: "Capture time cannot precede the attempt start." });
  }
  if ((image !== undefined || raw !== undefined) && attempt.capturedAt === undefined) {
    context.addIssue({ code: "custom", path: ["capturedAt"], message: "A saved screenshot or annotated image requires the original capture time." });
  }
  if (image !== undefined && attempt.geometry === undefined) context.addIssue({ code: "custom", path: ["geometry"], message: "A saved annotated image requires validated geometry." });
  if (attempt.geometry !== undefined && attempt.capturedAt === undefined) context.addIssue({ code: "custom", path: ["capturedAt"], message: "Screenshot geometry requires the original capture timestamp." });
  if (attempt.result !== "error") {
    for (const key of ["image", "raw", "snapshot", "capturedAt", "environment"] as const) {
      if (attempt[key] === undefined) context.addIssue({ code: "custom", path: [key], message: "A successful evidence attempt requires this field." });
    }
  }
  const { criterion: _criterion, ...configuration } = attempt.configuration;
  if (attempt.geometry !== undefined) {
    try {
      validateStepGeometry(configuration, attempt.geometry, { checks: attempt.checks, errors: attempt.errors }, { imageAvailable: image !== undefined, interrupted: attempt.error !== undefined });
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      for (const issue of error.issues) context.addIssue({ code: "custom", path: ["geometry", ...issue.path], message: issue.message });
    }
  }
  try {
    const summary = summarizeStepEvaluation(configuration, { checks: attempt.checks, errors: attempt.errors }, { interrupted: attempt.error !== undefined });
    if (attempt.result !== summary.result) context.addIssue({ code: "custom", path: ["result"], message: "The attempt outcome contradicts its completed checks and errors." });
    if (JSON.stringify(attempt.checkCounts) !== JSON.stringify(summary.checkCounts)) {
      context.addIssue({ code: "custom", path: ["checkCounts"], message: "Count only completed checks; total must equal passed plus failed." });
    }
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    for (const issue of error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});

export type Attempt = z.output<typeof attemptSchema>;

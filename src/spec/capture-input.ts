import * as z from "zod";
import { buildIdentitySchema, type BuildIdentity } from "./build-identity.js";
import { normalizeStep, type EffectiveStep } from "./effective-step.js";
import { inputErrorResult, PreCaptureError } from "./errors.js";
import type { Spec } from "./schema.js";
import { stepNameSchema } from "./step-name.js";
import { stepSchema } from "./step.js";
import { validate } from "./validate.js";
import { criterionSchema } from "./values.js";

const selectionSchema = z.strictObject({ spec: z.unknown(), step: stepNameSchema, build: z.unknown().optional() });
const oneOffSchema = z.strictObject({
  step: stepNameSchema,
  criterion: criterionSchema,
  config: stepSchema,
  build: z.unknown().optional(),
});
const buildOptionsSchema = z.object({ build: buildIdentitySchema });

/** Internal preparation shared by future capture adapters. No device or filesystem access. */
export type PreparedCapture = {
  spec: Spec;
  step: string;
  effectiveStep: EffectiveStep;
  build?: BuildIdentity;
};

function contextOf(input: unknown): { step?: unknown; criterion?: unknown } {
  if (typeof input !== "object" || input === null) return {};
  return {
    ...(Object.hasOwn(input, "step") ? { step: Reflect.get(input, "step") } : {}),
    ...(Object.hasOwn(input, "criterion") ? { criterion: Reflect.get(input, "criterion") } : {}),
  };
}

/** Validate the whole flow before selecting a step or admitting its build identity. */
export function prepareSpecCapture(input: unknown): PreparedCapture {
  const selection = selectionSchema.safeParse(input);
  if (!selection.success) throw new PreCaptureError(inputErrorResult(selection.error, { step: contextOf(input).step }));
  const { step, build } = selection.data;
  const validated = validate(selection.data.spec);
  if (!validated.valid) throw new PreCaptureError({ result: "error", step, error: validated.error });
  const spec = validated.spec;
  const group = spec.criteria.find((candidate) => Object.hasOwn(candidate.steps, step));
  if (!group) {
    throw new PreCaptureError({
      result: "error", step,
      error: { code: "INVALID_INPUT", message: "The requested step is absent from the spec.", issues: [{ path: ["step"], message: `Choose a step declared in this spec; ${JSON.stringify(step)} was not found.` }] },
    });
  }

  const context = { step, criterion: group.criterion };
  const multipleSteps = spec.criteria.reduce((count, item) => count + Object.keys(item.steps).length, 0) > 1;
  let identity: BuildIdentity | undefined;
  if (build !== undefined || multipleSteps) {
    // Wrapping the schema keeps build-field diagnostics relative to the capture input.
    const checked = buildOptionsSchema.safeParse({ build });
    if (!checked.success) {
      const failure = inputErrorResult(checked.error, context);
      failure.error.message = multipleSteps
        ? "Multi-step captures require complete build identity. Supply appId, native, and runtime through --build or the API build object."
        : "The supplied build identity is incomplete or invalid. Correct the fields listed in issues.";
      throw new PreCaptureError(failure);
    }
    identity = checked.data.build;
  }

  return {
    spec, step,
    effectiveStep: normalizeStep({
      criterion: group.criterion, step: group.steps[step]!,
      ...(spec.defaults === undefined ? {} : { defaults: spec.defaults }),
    }),
    ...(identity === undefined ? {} : { build: identity }),
  };
}

/** One-off inputs use the same root validation, defaults, and effective-step normalization. */
export function prepareOneOffCapture(input: unknown): PreparedCapture {
  const parsed = oneOffSchema.safeParse(input);
  if (!parsed.success) throw new PreCaptureError(inputErrorResult(parsed.error, contextOf(input)));
  const { step, criterion, config, build } = parsed.data;
  return prepareSpecCapture({ spec: { criteria: [{ criterion, steps: { [step]: config } }] }, step, build });
}

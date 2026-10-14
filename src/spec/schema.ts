import * as z from "zod";
import { defaultsSchema, stepSchema } from "./step.js";
import { criterionSchema } from "./values.js";

const stepNameSchema = z.string()
  .regex(/\S/, "Supply a non-blank step name.")
  .regex(/^(?!__proto__$)/, "The step name __proto__ is reserved; choose another name.");

const minimumSteps = 1;
const stepsSchema = z.record(stepNameSchema, stepSchema)
  .refine((steps) => Object.keys(steps).length >= minimumSteps, "Supply at least one step for this criterion.")
  // minProperties represents this local structural rule in JSON Schema.
  .meta({ minProperties: minimumSteps });

/** Export this structural schema; arbitrary whole-file refinements cannot be exported. */
export const specStructureSchema = z.strictObject({
  out: z.string().regex(/\S/, "Supply a non-blank output folder, or omit out for the default.").optional(),
  defaults: defaultsSchema.optional(),
  criteria: z.array(z.strictObject({
    criterion: criterionSchema,
    steps: stepsSchema,
  })).min(1, "Supply at least one acceptance criterion."),
}).describe("Structural spec validation only. Run device-proof validate for complete offline validation, including unique step names across criteria.");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Zod 4.6.7 strips __proto__ record entries before validating their keys.
// Reject them before parsing so a requested step can never silently disappear.
const admittedSpecSchema = z.preprocess((input, context) => {
  if (!isRecord(input) || !Array.isArray(input.criteria)) return input;
  for (const [index, group] of input.criteria.entries()) {
    if (isRecord(group) && isRecord(group.steps) && Object.hasOwn(group.steps, "__proto__")) {
      context.addIssue({
        code: "custom",
        path: ["criteria", index, "steps", "__proto__"],
        message: "The step name __proto__ is reserved; choose another name.",
      });
    }
  }
  return input;
}, specStructureSchema);

/** Shared complete spec validation for future CLI, Node API, and capture preflight. */
export const specSchema = admittedSpecSchema.superRefine((spec, context) => {
  const firstCriterionByStep = new Map<string, number>();
  for (const [index, group] of spec.criteria.entries()) {
    for (const name of Object.keys(group.steps)) {
      const first = firstCriterionByStep.get(name);
      if (first !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["criteria", index, "steps", name],
          message: `Step ${JSON.stringify(name)} is duplicated; its first occurrence is at criteria[${first}].steps[${JSON.stringify(name)}]. Step names must be unique across the file.`,
        });
      } else {
        firstCriterionByStep.set(name, index);
      }
    }
  }
});

export type SpecInput = z.input<typeof specStructureSchema>;
export type Spec = z.output<typeof specSchema>;

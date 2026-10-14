import type { Annotation } from "./annotation.js";
import type { StandaloneCheck } from "./check.js";
import type { Crop } from "./crop.js";
import { defaultsSchema, stepSchema, type DefaultsInput, type StepInput } from "./step.js";
import { criterionSchema } from "./values.js";

/** Semantic capture configuration. The unique step name is the separate matching key. */
export type EffectiveStep = {
  criterion: string;
  annotate: Annotation[];
  checks: StandaloneCheck[];
  crop: Crop | null;
};

/** Pure normalization for T27/T40. Reuse additionally requires build/environment compatibility. */
export function normalizeStep(input: {
  criterion: string;
  step: StepInput;
  defaults?: DefaultsInput;
}): EffectiveStep {
  const criterion = criterionSchema.parse(input.criterion);
  const step = stepSchema.parse(input.step);
  const defaults = defaultsSchema.parse(input.defaults === undefined ? {} : input.defaults);
  const crop = step.crop === undefined ? defaults.crop ?? null : step.crop;

  return {
    criterion,
    // Annotation and check order affects numbering and legend rows, so preserve it.
    annotate: step.annotate,
    checks: step.checks,
    // Crop targets form a union; repetition and order do not change its geometry.
    crop: crop === null ? null : { targets: [...new Set(crop.targets)].sort(), padding: crop.padding },
  };
}

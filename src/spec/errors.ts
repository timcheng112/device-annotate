import * as z from "zod";
import { stepNameSchema } from "./step-name.js";
import { criterionSchema } from "./values.js";

const messageSchema = z.string().regex(/\S/, "Supply a diagnostic message.");
const issueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  message: messageSchema,
});

/** Initial pre-capture failures; post-capture errors and device provenance are separate contracts. */
export const preCaptureErrorSchema = z.strictObject({
  result: z.literal("error"),
  step: stepNameSchema.optional(),
  criterion: criterionSchema.optional(),
  error: z.strictObject({
    code: z.enum(["INVALID_INPUT", "RECORDING_UNAVAILABLE"]),
    message: messageSchema,
    issues: z.array(issueSchema).min(1).optional(),
  }),
}).describe("Failure before evidence capture. Unknown step/criterion and unavailable device or artifact fields are omitted.");

export type PreCaptureErrorResult = z.output<typeof preCaptureErrorSchema>;

/** Include only validated context, even when the requested step or criterion caused the error. */
export function inputErrorResult(error: z.ZodError, context: { step?: unknown; criterion?: unknown } = {}): PreCaptureErrorResult {
  const step = stepNameSchema.safeParse(context.step);
  const criterion = criterionSchema.safeParse(context.criterion);
  return preCaptureErrorSchema.parse({
    result: "error",
    ...(step.success ? { step: step.data } : {}),
    ...(criterion.success ? { criterion: criterion.data } : {}),
    error: {
      code: "INVALID_INPUT",
      message: "Input validation failed. Correct the fields listed in issues.",
      issues: error.issues.map((issue) => ({
        path: issue.path.map((part) => typeof part === "symbol" ? String(part) : part),
        message: issue.message,
      })),
    },
  });
}

/** Preserve the local cause while exposing only the reviewed result as JSON. */
export class PreCaptureError extends Error {
  readonly result: PreCaptureErrorResult;

  constructor(result: PreCaptureErrorResult, options?: ErrorOptions) {
    const checked = preCaptureErrorSchema.parse(result);
    super(checked.error.message, options);
    this.name = "PreCaptureError";
    this.result = checked;
  }

  toJSON(): PreCaptureErrorResult {
    return this.result;
  }
}

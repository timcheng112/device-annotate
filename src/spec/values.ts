import * as z from "zod";

// Shape checks preserve wording. Selector parsing and resolution happen separately.
export const selectorSchema = z.string().regex(/\S/, "Supply a non-blank agent-device selector.");
export const legendTextSchema = z.string().regex(/\S/, "Supply non-blank annotation text, or omit it where optional.");
export const criterionSchema = z.string().regex(/\S/, "Supply a non-blank acceptance criterion.");

export const localPathSchema = z.string()
  .regex(/\S/, "Supply a non-blank local path.")
  .regex(/^[^\u0000]*$/, "Local paths must not contain a null character.");

import * as z from "zod";
import { expectationSchema } from "./check.js";
import { legendTextSchema, selectorSchema } from "./values.js";

const targetAnnotationSchema = z.strictObject({
  target: selectorSchema,
  text: legendTextSchema.optional(),
  expect: expectationSchema.optional(),
});

/** Input contract only. Drawable bounds are checked against the capture in M2. */
export const annotationSchema = z.union([
  z.strictObject({ box: targetAnnotationSchema }),
  z.strictObject({ marker: targetAnnotationSchema }),
  z.strictObject({ arrow: z.strictObject({
    to: selectorSchema,
    text: legendTextSchema,
    expect: expectationSchema.optional(),
  }) }),
  z.strictObject({ callout: z.strictObject({
    ...targetAnnotationSchema.shape,
    text: legendTextSchema,
  }) }),
  z.strictObject({ mask: targetAnnotationSchema }),
]).describe("Exactly one annotation primitive. An omitted expectation means INFO, not a passing check.");

export type Annotation = z.infer<typeof annotationSchema>;

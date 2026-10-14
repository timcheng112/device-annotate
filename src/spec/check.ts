import * as z from "zod";
import { selectorSchema } from "./values.js";

/** One invocation of an agent-device predicate, per DESIGN.md T36. */
export const expectationSchema = z.union([
  z.strictObject({ visible: z.literal(true) }),
  z.strictObject({ hidden: z.literal(true) }),
  z.strictObject({ exists: z.literal(true) }),
  z.strictObject({ absent: z.literal(true) }),
  z.strictObject({ editable: z.literal(true) }),
  z.strictObject({ selected: z.literal(true) }),
  z.strictObject({ focused: z.literal(true) }),
  // agent-device 0.21.27's isCommand rejects empty expectedText before capture.
  // Whitespace remains meaningful: its evaluator compares text exactly.
  z.strictObject({ text: z.string().min(1, "Supply the expected text; agent-device rejects an empty text expectation.") }),
]).describe("Exactly one predicate. State predicates take true; text takes the exact expected string.");

/** Shape validation only; selector syntax and resolution are separate stages. */
export const standaloneCheckSchema = z.strictObject({
  target: selectorSchema,
  expect: expectationSchema,
}).describe("A standalone check against the accepted capture snapshot.");

export type Expectation = z.infer<typeof expectationSchema>;
export type StandaloneCheck = z.infer<typeof standaloneCheckSchema>;

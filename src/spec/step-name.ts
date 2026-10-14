import * as z from "zod";

/** Shared by spec keys and, when implemented, one-off capture names. */
export const stepNameSchema = z.string()
  .min(1, "Supply a step name.")
  .max(64, "Use at most 64 characters for a step name.")
  // Unlike $, this end assertion also rejects a trailing line terminator.
  .regex(/^[a-z][a-z0-9_-]*(?![\s\S])/, "Start the step name with a lowercase letter and use only lowercase letters, digits, hyphens, and underscores.")
  .regex(/^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)/, "This step name is a reserved filename; choose another name, such as cart-total-2.");

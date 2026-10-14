import * as z from "zod";

/** History policy only. Current attempts and caller-owned recordings are protected. */
export const retentionSchema = z.strictObject({
  maxAttemptsPerStep: z.number().int().nonnegative().default(3)
    .describe("Maximum previous attempts per step, excluding the current attempt."),
  maxAgeDays: z.number().int().nonnegative().default(7)
    .describe("Maximum historical age measured in elapsed 24-hour days from capture time."),
  maxBytes: z.number().int().nonnegative().default(500_000_000)
    .describe("Combined byte budget for package-managed historical artifacts in the output folder."),
}).describe("All limits apply together. Zero in any limit disables history; current evidence stays protected. Cleanup runs after a safe save or on explicit cleanup.");

export type RetentionInput = z.input<typeof retentionSchema>;
export type Retention = z.output<typeof retentionSchema>;

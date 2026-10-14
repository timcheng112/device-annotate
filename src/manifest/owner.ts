import * as z from "zod";
import { PreCaptureError } from "../spec/errors.js";
import { stepNameSchema } from "../spec/step-name.js";
import { localPathSchema } from "../spec/values.js";

export const outputOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("spec"),
    specPath: localPathSchema.describe("Canonical absolute spec path supplied by the filesystem boundary."),
  }),
  z.strictObject({ kind: z.literal("one-off"), step: stepNameSchema }),
]);

export type OutputOwner = z.output<typeof outputOwnerSchema>;

function describeOwner(owner: OutputOwner): string {
  return owner.kind === "spec" ? `spec ${JSON.stringify(owner.specPath)}` : `one-off capture ${JSON.stringify(owner.step)}`;
}

/** Pure gate over a saved manifest. undefined means the caller verified no manifest exists. */
export function assertOutputOwner(existingManifest: unknown, requested: OutputOwner): void {
  const next = outputOwnerSchema.parse(requested);
  if (existingManifest === undefined) return;
  // Inspect the owner without claiming to validate the rest of the manifest.
  // An existing manifest with a missing owner must never be treated as unclaimed.
  const previous = z.object({ owner: outputOwnerSchema }).safeParse(existingManifest);
  if (!previous.success) {
    throw new PreCaptureError({
      result: "error",
      error: {
        code: "OUTPUT_OWNER_INVALID",
        message: "This evidence folder has an invalid ownership record. Choose another output folder; existing evidence has been preserved.",
      },
    });
  }
  const owner = previous.data.owner;
  const same = owner.kind === "spec" && next.kind === "spec"
    ? owner.specPath === next.specPath
    : owner.kind === "one-off" && next.kind === "one-off" && owner.step === next.step;
  if (!same) {
    throw new PreCaptureError({
      result: "error",
      ...(next.kind === "one-off" ? { step: next.step } : {}),
      error: {
        code: "OUTPUT_OWNER_MISMATCH",
        message: `This evidence folder belongs to ${describeOwner(owner)} and cannot be used by ${describeOwner(next)}. Choose another output folder.`,
      },
    });
  }
}

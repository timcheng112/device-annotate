import * as z from "zod";

// Keep checks representable in JSON Schema so both validators accept the same input.
// Preserve opaque identifiers verbatim: normalization could conflate two builds.
const identity = z.string().regex(/\S/, "Supply a non-blank immutable build identifier.");

/** The caller identifies the installed app and all runtime code, per DESIGN.md T34. */
export const buildIdentitySchema = z.strictObject({
  appId: z.string().regex(/\S/, "Supply a non-blank app identifier."),
  native: identity.describe("Content hash or immutable identifier of the installed native build."),
  runtime: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("embedded"),
    }),
    z.strictObject({
      kind: z.literal("external"),
      revision: identity.describe("Content hash or immutable identifier of separately delivered runtime code."),
    }),
  ]),
}).describe("Caller-supplied build identity. Validation cannot verify that it matches the running app.");

export type BuildIdentity = z.infer<typeof buildIdentitySchema>;

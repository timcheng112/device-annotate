import * as z from "zod";

const text = z.string().regex(/\S/, "Supply a nonblank observed value.");
const pixels = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const textSizeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ios-content-size"), value: z.enum([
    "extra-small", "small", "medium", "large", "extra-large", "extra-extra-large", "extra-extra-extra-large",
    "accessibility-medium", "accessibility-large", "accessibility-extra-large", "accessibility-extra-extra-large", "accessibility-extra-extra-extra-large",
  ]) }),
  z.strictObject({ kind: z.literal("android-font-scale"), value: z.number().positive() }),
  z.strictObject({ kind: z.literal("platform-native"), unit: text, value: text }),
]);

// Each path names one independently unavailable observation. Compound observations
// such as identity are all-or-unknown, so incomplete identities cannot compare equal.
const fieldPaths = [
  ["device", "platform"], ["device", "identity"], ["device", "osVersion"],
  ["display", "pixelWidth"], ["display", "pixelHeight"], ["display", "pixelDensity"],
  ["display", "rotation"], ["display", "appearance"], ["display", "textSize"],
  ["versions", "deviceProof"], ["versions", "agentDevice"],
] as const;
const pathSchema = z.union(fieldPaths.map(([group, field]) => z.tuple([z.literal(group), z.literal(field)])));

/** Structural export. Use environmentSchema for null/reason and platform consistency checks. */
export const environmentStructureSchema = z.strictObject({
  device: z.strictObject({
    platform: text.nullable(),
    identity: z.strictObject({
      scope: text.describe("Stable local host/provider and simulator-set scope established by the capture adapter."),
      id: text.describe("Persistent device identity within that scope; an emulator port or display name alone is insufficient."),
    }).nullable(),
    osVersion: text.nullable(),
  }),
  display: z.strictObject({
    pixelWidth: pixels.nullable().describe("Active display pixel width at the observed rotation, before screenshot resizing or cropping."),
    pixelHeight: pixels.nullable().describe("Active display pixel height at the observed rotation, before screenshot resizing or cropping."),
    pixelDensity: z.number().positive().nullable().describe("Native UI scale, such as iOS 3 or Android 440/160. Not a rectangle projection multiplier."),
    rotation: z.enum(["portrait", "portrait-upside-down", "landscape-left", "landscape-right"]).nullable(),
    appearance: z.enum(["light", "dark"]).nullable().describe("Observed effective appearance; an automatic-mode preference alone is insufficient."),
    textSize: textSizeSchema.nullable(),
  }),
  versions: z.strictObject({ deviceProof: text.nullable(), agentDevice: text.nullable() }),
  unavailable: z.array(z.strictObject({ path: pathSchema, message: text })),
}).describe("Environment compatibility observations. Every field is explicit; each null requires exactly one unavailable reason. Complete semantic validation uses environmentSchema.");

type EnvironmentStructure = z.output<typeof environmentStructureSchema>;

function observation(environment: EnvironmentStructure, [group, field]: readonly [string, string]): unknown {
  return Reflect.get(Reflect.get(environment, group), field);
}

export const environmentSchema = environmentStructureSchema.superRefine((environment, context) => {
  const reasons = new Set<string>();
  for (const [index, reason] of environment.unavailable.entries()) {
    const key = reason.path.join(".");
    if (reasons.has(key)) {
      context.addIssue({ code: "custom", path: ["unavailable", index, "path"], message: "Supply exactly one reason per unavailable field." });
    }
    reasons.add(key);
    if (observation(environment, reason.path) !== null) {
      context.addIssue({ code: "custom", path: ["unavailable", index, "path"], message: "An unavailable reason must refer to a null field, not a known value." });
    }
  }
  for (const path of fieldPaths) {
    if (observation(environment, path) === null && !reasons.has(path.join("."))) {
      context.addIssue({ code: "custom", path: [...path], message: "Explain this null value with a field-specific unavailable reason." });
    }
  }
  const platform = environment.device.platform;
  const size = environment.display.textSize;
  if (size !== null && platform !== null) {
    const requiredKind = platform === "ios" ? "ios-content-size" : platform === "android" ? "android-font-scale" : undefined;
    if ((requiredKind !== undefined && size.kind !== requiredKind) ||
        (size.kind === "ios-content-size" && platform !== "ios") ||
        (size.kind === "android-font-scale" && platform !== "android")) {
      context.addIssue({ code: "custom", path: ["display", "textSize"], message: "Use the exact native text-size representation for the observed platform." });
    }
  }
});

export type Environment = z.output<typeof environmentSchema>;

/** Environment gate only. Capture readiness and build/spec compatibility are separate gates. */
export function assessEnvironment(input: unknown, stepCount: number): {
  environment: Environment; complete: boolean; captureAllowed: boolean;
} {
  const count = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(stepCount);
  const environment = environmentSchema.parse(input);
  const complete = environment.unavailable.length === 0;
  return { environment, complete, captureAllowed: count === 1 || complete };
}

function sameObservation(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameObservation(Reflect.get(left, key), Reflect.get(right, key)));
}

/** Environment compatibility only. Build and effective-step compatibility are separate gates. */
export function environmentsMatch(previous: unknown, current: unknown): boolean {
  const before = environmentSchema.parse(previous);
  const after = environmentSchema.parse(current);
  if (before.unavailable.length > 0 || after.unavailable.length > 0) return false;
  return fieldPaths.every((path) => sameObservation(observation(before, path), observation(after, path)));
}

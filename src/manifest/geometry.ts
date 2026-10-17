import * as z from "zod";
import { decideAnnotatedImage } from "../layout/image-policy.js";
import { numberStepEntries } from "../spec/numbered-entries.js";
import { stepSchema, type StepInput } from "../spec/step.js";
import { selectorSchema } from "../spec/values.js";
import { summarizeStepEvaluation } from "./evaluation.js";

const coordinate = z.number().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const size = z.number().positive().max(Number.MAX_SAFE_INTEGER);
const pixel = z.number().int().nonnegative();
const pixelSize = z.number().int().positive();
const originalRectSchema = z.strictObject({ x: coordinate, y: coordinate, width: size, height: size });
const rectSchema = z.strictObject({ x: coordinate.nonnegative(), y: coordinate.nonnegative(), width: size, height: size });
const cropRectSchema = z.strictObject({ x: pixel, y: pixel, width: pixelSize, height: pixelSize });
const targetFields = {
  targetId: z.string().regex(/\S/).describe("Resolved component identity within this accepted snapshot; equal rectangles do not establish equal identities."),
  rect: rectSchema.describe("Visible target bounds in full original screenshot pixels."),
  originalRect: originalRectSchema.optional().describe("Unclipped bounds, only when the source actually supplies them, in the same screenshot coordinate space."),
};
const nSchema = z.number().int().positive();
const warningFields = {
  code: z.enum(["PARTIALLY_OFFSCREEN", "EDGE_EXTENT_UNKNOWN"]),
  message: z.string().regex(/\S/),
};
const warningSchema = z.union([
  z.strictObject({ n: nSchema, ...warningFields }),
  z.strictObject({ cropTarget: selectorSchema, ...warningFields }),
]);

export const geometryStructureSchema = z.strictObject({
  screenshot: z.strictObject({ width: pixelSize, height: pixelSize }),
  crop: cropRectSchema.optional().describe("Accepted crop in original screenshot pixels. Omit if no usable crop was established."),
  targets: z.array(z.strictObject({ n: nSchema, ...targetFields })),
  cropTargets: z.array(z.strictObject({ target: selectorSchema, ...targetFields })),
  groups: z.array(z.strictObject({ numbers: z.array(nSchema).min(1) })),
  warnings: z.array(warningSchema),
}).describe("Resolved screenshot geometry, grouped entry numbers, and clipping warnings. Use geometrySchema and validateStepGeometry for complete validation. Final label placement belongs to layout.");

export type Geometry = z.output<typeof geometryStructureSchema>;
type Rect = z.output<typeof originalRectSchema>;
type Target = { rect: Rect; originalRect?: Rect | undefined; targetId: string };
const rectKey = (rect: Rect) => JSON.stringify([rect.x, rect.y, rect.width, rect.height]);
const sameRect = (a: Rect, b: Rect) => rectKey(a) === rectKey(b);
const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-7;
const warningMessages = {
  PARTIALLY_OFFSCREEN: "Partly off-screen; only the visible bounds are shown.",
  EDGE_EXTENT_UNKNOWN: "Touches screen edge; full extent unknown",
} as const;

function warningFor(target: Target, screen: Rect): keyof typeof warningMessages | undefined {
  const { rect, originalRect } = target;
  if (originalRect) return inside(originalRect, screen) ? undefined : "PARTIALLY_OFFSCREEN";
  return rect.x === 0 || rect.y === 0 || rect.x + rect.width === screen.width || rect.y + rect.height === screen.height
    ? "EDGE_EXTENT_UNKNOWN" : undefined;
}
function addIssue(context: z.RefinementCtx, path: (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path, message });
}

export const geometrySchema = geometryStructureSchema.superRefine((geometry, context) => {
  const screen = { x: 0, y: 0, ...geometry.screenshot };
  if (geometry.crop && !inside(geometry.crop, screen)) addIssue(context, ["crop"], "The crop must stay inside the original screenshot.");
  const identities = new Map<string, Target>();
  const numbers = new Map<number, Geometry["targets"][number]>();
  const cropSelectors = new Set<string>();
  const expectedWarnings = new Map<string, { code: keyof typeof warningMessages; message: string }>();
  function inspect(target: Target, path: (string | number)[], warningKey: string) {
    if (!inside(target.rect, screen)) addIssue(context, [...path, "rect"], "Visible bounds must stay inside the original screenshot.");
    if (target.originalRect) {
      const source = target.originalRect;
      const left = Math.max(0, source.x), top = Math.max(0, source.y);
      const right = Math.min(screen.width, source.x + source.width), bottom = Math.min(screen.height, source.y + source.height);
      if (right <= left || bottom <= top || !near(target.rect.x, left) || !near(target.rect.y, top) || !near(target.rect.width, right - left) || !near(target.rect.height, bottom - top)) {
        addIssue(context, [...path, "originalRect"], "Original bounds must intersect the screenshot at the recorded visible rectangle.");
      }
    }
    const previous = identities.get(target.targetId);
    if (previous && (!sameRect(previous.rect, target.rect) || (previous.originalRect && target.originalRect && !sameRect(previous.originalRect, target.originalRect)))) {
      addIssue(context, [...path, "targetId"], "One resolved component cannot have contradictory bounds in the accepted snapshot.");
    }
    if (!previous || (!previous.originalRect && target.originalRect)) identities.set(target.targetId, target);
    const code = warningFor(target, screen);
    if (code) expectedWarnings.set(warningKey, { code, message: warningMessages[code] });
  }
  geometry.targets.forEach((target, index) => {
    if (numbers.has(target.n)) addIssue(context, ["targets", index, "n"], "Each entry can have only one drawable target.");
    numbers.set(target.n, target);
    inspect(target, ["targets", index], `n:${target.n}`);
  });
  geometry.cropTargets.forEach((target, index) => {
    if (cropSelectors.has(target.target)) addIssue(context, ["cropTargets", index, "target"], "Each explicit crop selector can have only one resolved target.");
    cropSelectors.add(target.target);
    inspect(target, ["cropTargets", index], `crop:${target.target}`);
  });
  const grouped = new Set<number>();
  const groupedRects = new Set<string>();
  geometry.groups.forEach((group, index) => {
    let bounds: Rect | undefined;
    group.numbers.forEach((n, item) => {
      const target = numbers.get(n);
      if (!target || grouped.has(n)) addIssue(context, ["groups", index, "numbers", item], "Group each drawable entry exactly once; legend-only entries have no group.");
      grouped.add(n);
      if (item > 0 && n <= group.numbers[item - 1]!) addIssue(context, ["groups", index, "numbers"], "Keep group numbers in ascending order.");
      if (target) {
        if (bounds && !sameRect(bounds, target.rect)) addIssue(context, ["groups", index], "Only identical rendered rectangles share a group.");
        bounds ??= target.rect;
      }
    });
    if (bounds) {
      const key = rectKey(bounds);
      if (groupedRects.has(key)) addIssue(context, ["groups", index], "Identical rectangles must share one group, including distinct component identities.");
      groupedRects.add(key);
    }
  });
  for (const n of numbers.keys()) if (!grouped.has(n)) addIssue(context, ["groups"], `Drawable entry ${n} is missing from its group.`);
  const warnings = new Set<string>();
  geometry.warnings.forEach((warning, index) => {
    const key = "n" in warning ? `n:${warning.n}` : `crop:${warning.cropTarget}`;
    const expected = expectedWarnings.get(key);
    if (warnings.has(key) || !expected || warning.code !== expected.code || warning.message !== expected.message) {
      addIssue(context, ["warnings", index], "Warnings must match the available clipping evidence exactly, once per affected entry or crop selector.");
    }
    warnings.add(key);
  });
  for (const key of expectedWarnings.keys()) if (!warnings.has(key)) addIssue(context, ["warnings"], `Missing clipping warning for ${key}.`);
});

/** Match raw-coordinate geometry to the exact step, evaluation, crop, and image eligibility. */
export function validateStepGeometry(stepInput: StepInput, input: unknown, evaluation: unknown, options: { imageAvailable: boolean; interrupted?: boolean }): Geometry {
  const step = stepSchema.parse(stepInput);
  const entries = numberStepEntries(step);
  const summary = summarizeStepEvaluation(step, evaluation, options);
  return geometrySchema.superRefine((geometry, context) => {
    const screen = { x: 0, y: 0, ...geometry.screenshot };
    const selectorFor = (n: number): string | undefined => {
      const entry = entries[n - 1];
      if (!entry) return undefined;
      if (entry.kind === "check") return entry.check.target;
      const primitive = Object.values(entry.annotation)[0]!;
      return "to" in primitive ? primitive.to : primitive.target;
    };
    const unavailableSelectors = new Set<string>();
    for (const error of summary.errors) {
      const selector = selectorFor(error.n);
      if (selector !== undefined && error.code !== "CHECK_UNAVAILABLE") unavailableSelectors.add(selector);
    }
    for (const check of summary.checks) {
      const selector = selectorFor(check.n);
      if (selector !== undefined && (("absent" in check.actual && check.actual.absent) || ("hidden" in check.actual && check.actual.hidden))) unavailableSelectors.add(selector);
    }
    const identityBySelector = new Map<string, string>();
    const inspectSelector = (selector: string, targetId: string, path: (string | number)[]) => {
      if (unavailableSelectors.has(selector)) addIssue(context, path, "This selector cannot be recorded as drawable because its evaluation or resolution proves it unavailable.");
      const previous = identityBySelector.get(selector);
      if (previous !== undefined && previous !== targetId) addIssue(context, path, "The same selector must resolve to the same component in the accepted snapshot.");
      identityBySelector.set(selector, targetId);
    };
    for (const [index, target] of geometry.targets.entries()) {
      if (!entries[target.n - 1]) addIssue(context, ["targets", index, "n"], "This entry number does not belong to the step.");
      const selector = selectorFor(target.n);
      if (selector !== undefined) inspectSelector(selector, target.targetId, ["targets", index]);
      const error = summary.errors.find((item) => item.n === target.n && item.code !== "CHECK_UNAVAILABLE");
      const check = summary.checks.find((item) => item.n === target.n);
      if (error || (check && (("absent" in check.actual && check.actual.absent) || ("hidden" in check.actual && check.actual.hidden)))) {
        addIssue(context, ["targets", index], "A missing, ambiguous, off-screen, absent, or hidden target cannot be recorded as drawable.");
      }
    }
    const requestedCrop = step.crop ?? null;
    const selectors = new Set(requestedCrop?.targets ?? []);
    geometry.cropTargets.forEach((target, index) => {
      if (!selectors.has(target.target)) addIssue(context, ["cropTargets", index, "target"], "This selector is not an explicit crop target for the effective step.");
      inspectSelector(target.target, target.targetId, ["cropTargets", index]);
    });
    if (geometry.crop) {
      if (!requestedCrop) {
        if (!sameRect(geometry.crop, screen)) addIssue(context, ["crop"], "Full-frame configuration requires the full screenshot rectangle.");
      } else if (geometry.cropTargets.length !== selectors.size || [...selectors].some((target) => !geometry.cropTargets.some((item) => item.target === target))) {
        addIssue(context, ["cropTargets"], "An accepted crop requires every explicit crop selector to resolve.");
      } else {
        const rects = [...geometry.targets, ...geometry.cropTargets].map((target) => target.rect);
        const padding = requestedCrop.padding;
        let left = screen.width, top = screen.height, right = 0, bottom = 0;
        for (const rect of rects) {
          left = Math.min(left, rect.x); top = Math.min(top, rect.y);
          right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.height);
        }
        left = Math.max(0, Math.floor(left - padding)); top = Math.max(0, Math.floor(top - padding));
        right = Math.min(screen.width, Math.ceil(right + padding)); bottom = Math.min(screen.height, Math.ceil(bottom + padding));
        if (!sameRect(geometry.crop, { x: left, y: top, width: right - left, height: bottom - top })) {
          addIssue(context, ["crop"], "The crop must include all explicit and drawable targets, with configured padding clamped to the screenshot.");
        }
      }
    }
    if (options.imageAvailable) {
      if (!geometry.crop) addIssue(context, ["crop"], "A saved annotated image requires an accepted crop rectangle.");
      try {
        const policy = decideAnnotatedImage(step, evaluation, { screenshotUsable: true, cropUsable: geometry.crop !== undefined, drawableNumbers: geometry.targets.map((target) => target.n) }, options);
        if (policy.kind === "omit") addIssue(context, [], "The image must be omitted because screenshot, crop, or mask readiness failed.");
      } catch (error) {
        addIssue(context, [], error instanceof Error ? error.message : "Invalid image readiness.");
      }
    }
  }).parse(input);
}

/** Translation only; the original target record remains in full screenshot coordinates. */
export function rectWithinCrop(rectInput: unknown, cropInput: unknown): Rect {
  const rect = rectSchema.parse(rectInput), crop = cropRectSchema.parse(cropInput);
  if (!inside(rect, crop)) throw new Error("The target must be fully contained by the crop.");
  return { ...rect, x: rect.x - crop.x, y: rect.y - crop.y };
}

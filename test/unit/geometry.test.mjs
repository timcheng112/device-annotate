import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { geometrySchema, validateStepGeometry, rectWithinCrop } from "../../dist/manifest/geometry.js";
import { attemptSchema } from "../../dist/manifest/attempt.js";

const root = new URL("../../", import.meta.url);
const structural = new Ajv2020({ strict: true, strictTypes: false, allErrors: true }).compile(JSON.parse(readFileSync(new URL("src/manifest/geometry.schema.json", root), "utf8")));
const step = { annotate: [{ box: { target: "id=total" } }], crop: null };
const evaluation = { checks: [], errors: [] };
const bounds = { x: 100, y: 200, width: 50, height: 30 };
const geometry = {
  screenshot: { width: 400, height: 800 }, crop: { x: 0, y: 0, width: 400, height: 800 },
  targets: [{ n: 1, targetId: "node-1", rect: bounds }], cropTargets: [], groups: [{ numbers: [1] }], warnings: [],
};
const clone = (value = geometry) => structuredClone(value);
const valid = (value = geometry, inputStep = step, inputEvaluation = evaluation, imageAvailable = true) => validateStepGeometry(inputStep, value, inputEvaluation, { imageAvailable });

test("geometry example composes crops, distinct identities, shared numbers, and both warnings", () => {
  const example = JSON.parse(readFileSync(new URL("examples/geometry.json", root), "utf8"));
  assert.deepEqual(valid(example.geometry, example.step, example.evaluation), example.geometry);
  assert.equal(structural(example.geometry), true);
});

test("full-frame geometry preserves raw pixel coordinates and source data", () => {
  assert.deepEqual(valid(), geometry);
  assert.equal(structural(geometry), true);
  const result = valid(); result.targets[0].rect.x = 99;
  assert.equal(geometry.targets[0].rect.x, 100);
});

test("cropping translates only the display location, keeping original target positions", () => {
  const value = clone();
  value.cropTargets = [{ target: "id=total", targetId: "node-1", rect: bounds }];
  value.crop = { x: 80, y: 180, width: 90, height: 70 };
  const result = valid(value, { ...step, crop: { targets: ["id=total"], padding: 20 } });
  assert.deepEqual(result.targets[0].rect, bounds);
  assert.deepEqual(rectWithinCrop(bounds, result.crop), { x: 20, y: 20, width: 50, height: 30 });
  assert.throws(() => rectWithinCrop(bounds, { x: 110, y: 200, width: 40, height: 30 }));
});

test("crop padding includes every drawable target and clamps to screenshot bounds", () => {
  const value = clone();
  value.cropTargets = [{ target: "id=corner", targetId: "node-2", rect: { x: 5, y: 5, width: 10, height: 10 } }];
  value.crop = { x: 0, y: 0, width: 174, height: 254 };
  const spec = { ...step, crop: { targets: ["id=corner"], padding: 24 } };
  assert.doesNotThrow(() => valid(value, spec));
  value.crop.width = 39;
  assert.throws(() => valid(value, spec), /include all/);
});

test("fractional bounds round crops outward without changing recorded target bounds", () => {
  const value = clone();
  value.targets[0].rect = { x: 100.25, y: 200.5, width: 50.5, height: 30.25 };
  value.cropTargets = [{ target: "id=total", targetId: "node-1", rect: clone(value.targets[0].rect) }];
  value.crop = { x: 100, y: 200, width: 51, height: 31 };
  assert.doesNotThrow(() => valid(value, { ...step, crop: { targets: ["id=total"], padding: 0 } }));
});

test("missing crop targets prevent a cropped image but permit diagnostic-only partial geometry", () => {
  const value = clone(); delete value.crop;
  const spec = { ...step, crop: { targets: ["id=missing"] } };
  assert.doesNotThrow(() => valid(value, spec, evaluation, false));
  assert.throws(() => valid(value, spec));
  value.crop = clone(geometry.crop);
  assert.throws(() => valid(value, spec, evaluation, false), /every explicit crop selector/);
});

test("full-frame steps reject an unexpected crop or crop-only selector", () => {
  const cropped = clone(); cropped.crop.x = 20; cropped.crop.width -= 20;
  assert.throws(() => valid(cropped), /full screenshot/);
  const extra = clone(); extra.cropTargets = [{ target: "id=extra", targetId: "node-1", rect: bounds }];
  assert.throws(() => valid(extra), /not an explicit crop target/);
});

test("identical rectangles share numbers while preserving distinct target identities", () => {
  const value = clone();
  value.targets.push({ n: 2, targetId: "node-2", rect: clone(bounds) });
  value.groups = [{ numbers: [1, 2] }];
  const spec = { annotate: [step.annotate[0], { marker: { target: "id=other" } }] };
  const result = valid(value, spec);
  assert.equal(new Set(result.targets.map((target) => target.targetId)).size, 2);
  value.groups = [{ numbers: [1] }, { numbers: [2] }];
  assert.throws(() => valid(value, spec), /share one group/);
});

test("overlapping but unequal rectangles retain separate groups", () => {
  const value = clone();
  value.targets.push({ n: 2, targetId: "node-2", rect: { ...bounds, x: 110 } });
  value.groups.push({ numbers: [2] });
  assert.equal(geometrySchema.safeParse(value).success, true);
  value.groups = [{ numbers: [1, 2] }];
  assert.equal(geometrySchema.safeParse(value).success, false);
});

test("group numbers cannot be missing, duplicated, unknown, or reordered", () => {
  for (const groups of [[], [{ numbers: [1, 1] }], [{ numbers: [99] }], [{ numbers: [2, 1] }]]) {
    assert.equal(geometrySchema.safeParse({ ...geometry, groups }).success, false);
  }
});

test("one component identity cannot claim different bounds in a snapshot", () => {
  const value = clone();
  value.cropTargets = [{ target: "id=alias", targetId: "node-1", rect: { ...bounds, x: 101 } }];
  assert.equal(geometrySchema.safeParse(value).success, false);
  const aliases = clone();
  aliases.targets = [
    { n: 1, targetId: "node-1", rect: { ...bounds, x: 0 }, originalRect: { ...bounds, x: -20, width: 70 } },
    { n: 2, targetId: "node-1", rect: { ...bounds, x: 0 }, originalRect: { ...bounds, x: -30, width: 80 } },
  ];
  aliases.groups = [{ numbers: [1, 2] }];
  aliases.warnings = [1, 2].map((n) => ({ n, code: "PARTIALLY_OFFSCREEN", message: "Partly off-screen; only the visible bounds are shown." }));
  const parsed = geometrySchema.safeParse(aliases);
  assert.equal(parsed.success, false);
  assert.ok(parsed.error.issues.some((issue) => issue.message.includes("contradictory bounds")));
});

test("repeated selectors cannot invent distinct component identities for grouping", () => {
  const value = clone();
  value.targets.push({ n: 2, targetId: "invented-second-component", rect: clone(bounds) });
  value.groups = [{ numbers: [1, 2] }];
  assert.throws(() => valid(value, { annotate: [step.annotate[0], step.annotate[0]] }), /same selector must resolve/);
  const cropAlias = clone();
  cropAlias.cropTargets = [{ target: "id=total", targetId: "invented-crop-component", rect: clone(bounds) }];
  cropAlias.crop = clone(bounds);
  assert.throws(() => valid(cropAlias, { ...step, crop: { targets: ["id=total"], padding: 0 } }), /same selector must resolve/);
});

test("an explicit crop target cannot contradict an absent or hidden result for its selector", () => {
  for (const predicate of ["absent", "hidden"]) {
    const spec = { checks: [{ target: "id=total", expect: { [predicate]: true } }], crop: { targets: ["id=total"], padding: 0 } };
    const value = clone(); value.targets = []; value.groups = [];
    value.crop = clone(bounds); value.cropTargets = [{ target: "id=total", targetId: "node-1", rect: clone(bounds) }];
    const result = { checks: [{ n: 1, expect: { [predicate]: true }, actual: { [predicate]: true }, result: "pass" }], errors: [] };
    assert.throws(() => valid(value, spec, result), /cannot be recorded as drawable/);
  }
});

test("unknown edge bounds require the exact uncertainty warning", () => {
  const value = clone(); value.targets[0].rect.x = 0;
  assert.equal(geometrySchema.safeParse(value).success, false);
  value.warnings = [{ n: 1, code: "EDGE_EXTENT_UNKNOWN", message: "Touches screen edge; full extent unknown" }];
  assert.doesNotThrow(() => valid(value));
  value.warnings[0].code = "PARTIALLY_OFFSCREEN";
  assert.equal(geometrySchema.safeParse(value).success, false);
});

test("known partial clipping is supported by original bounds and has a distinct warning", () => {
  const value = clone();
  value.targets[0].rect = { x: 0, y: 200, width: 30, height: 30 };
  value.targets[0].originalRect = { x: -20, y: 200, width: 50, height: 30 };
  value.warnings = [{ n: 1, code: "PARTIALLY_OFFSCREEN", message: "Partly off-screen; only the visible bounds are shown." }];
  assert.doesNotThrow(() => valid(value));
  value.targets[0].originalRect.width = 40;
  assert.equal(geometrySchema.safeParse(value).success, false);
});

test("verified complete bounds touching an edge do not invent clipping uncertainty", () => {
  const value = clone(); value.targets[0].rect.x = 0;
  value.targets[0].originalRect = clone(value.targets[0].rect);
  assert.doesNotThrow(() => valid(value));
  value.warnings = [{ n: 1, code: "EDGE_EXTENT_UNKNOWN", message: "Touches screen edge; full extent unknown" }];
  assert.equal(geometrySchema.safeParse(value).success, false);
});

test("crop-only edge targets require their own correctly addressed warning", () => {
  const value = clone();
  value.cropTargets = [{ target: "id=edge", targetId: "node-2", rect: { x: 0, y: 0, width: 20, height: 20 } }];
  value.crop = { x: 0, y: 0, width: 150, height: 230 };
  const spec = { ...step, crop: { targets: ["id=edge"], padding: 0 } };
  assert.throws(() => valid(value, spec));
  value.warnings = [{ cropTarget: "id=edge", code: "EDGE_EXTENT_UNKNOWN", message: "Touches screen edge; full extent unknown" }];
  assert.doesNotThrow(() => valid(value, spec));
  value.warnings.push(clone(value.warnings[0]));
  assert.equal(geometrySchema.safeParse(value).success, false);
});

test("unknown and duplicate entries, selectors, and warning references are rejected", () => {
  for (const edit of [
    (value) => value.targets.push(clone(value.targets[0])),
    (value) => { value.targets[0].n = 99; value.groups = [{ numbers: [99] }]; },
    (value) => { value.cropTargets = Array.from({ length: 2 }, () => ({ target: "id=total", targetId: "node-1", rect: clone(bounds) })); },
    (value) => value.warnings.push({ n: 99, code: "EDGE_EXTENT_UNKNOWN", message: "Touches screen edge; full extent unknown" }),
  ]) {
    const value = clone(); edit(value); assert.throws(() => valid(value));
  }
});

test("legend-only absence and hidden checks have no drawable target or group", () => {
  for (const predicate of ["absent", "hidden"]) {
    const spec = { checks: [{ target: "id=hidden", expect: { [predicate]: true } }] };
    const result = { checks: [{ n: 1, expect: { [predicate]: true }, actual: { [predicate]: true }, result: "pass" }], errors: [] };
    const value = clone(); value.targets = []; value.groups = [];
    assert.doesNotThrow(() => valid(value, spec, result));
    assert.throws(() => valid(geometry, spec, result), /cannot be recorded as drawable/);
  }
});

test("partial images retain errors and original numbering while missing masks suppress images", () => {
  const value = clone(); value.targets[0].n = 2; value.groups = [{ numbers: [2] }];
  const partialStep = { annotate: [{ box: { target: "missing" } }, { marker: { target: "id=total" } }] };
  const result = { checks: [], errors: [{ n: 1, code: "TARGET_NOT_FOUND", message: "Target was not found." }] };
  assert.doesNotThrow(() => valid(value, partialStep, result));
  const masked = { annotate: [{ mask: { target: "missing" } }, partialStep.annotate[1]] };
  assert.throws(() => valid(value, masked, result), /image must be omitted/);
  assert.doesNotThrow(() => valid(value, masked, result, false));
});

test("drawable entries cannot contradict resolution errors", () => {
  assert.throws(() => valid(geometry, step, { checks: [], errors: [{ n: 1, code: "TARGET_OFFSCREEN", message: "Offscreen." }] }), /cannot be recorded as drawable/);
});

test("saved images cannot silently omit drawable standalone checks", () => {
  const spec = { checks: [{ target: "id=total", expect: { exists: true } }] };
  const result = { checks: [{ n: 1, expect: { exists: true }, actual: { exists: true }, result: "pass" }], errors: [] };
  const value = clone(); value.targets = []; value.groups = [];
  assert.throws(() => valid(value, spec, result), /neither drawable evidence nor an error/);
  assert.doesNotThrow(() => valid(value, spec, { ...result, errors: [{ n: 1, code: "TARGET_OFFSCREEN", message: "The existing target is off-screen." }] }));
});

test("all annotation primitives participate in geometry and mask readiness", () => {
  for (const annotation of [
    { box: { target: "x" } }, { marker: { target: "x" } }, { mask: { target: "x" } },
    { arrow: { to: "x", text: "Here" } }, { callout: { target: "x", text: "Here" } },
  ]) assert.doesNotThrow(() => valid(geometry, { annotate: [annotation] }));
});

for (const [name, edit] of [
  ["negative visible x", (value) => { value.targets[0].rect.x = -1; }],
  ["zero width", (value) => { value.targets[0].rect.width = 0; }],
  ["infinite width", (value) => { value.targets[0].rect.width = Infinity; }],
  ["NaN coordinate", (value) => { value.targets[0].rect.x = NaN; }],
  ["fractional crop", (value) => { value.crop.x = 0.5; }],
  ["zero screenshot", (value) => { value.screenshot.height = 0; }],
  ["unknown field", (value) => { value.extra = true; }],
]) {
  test(`geometry structural rejection: ${name}`, () => {
    const value = clone(); edit(value);
    assert.equal(geometrySchema.safeParse(value).success, false);
    assert.equal(structural(value), false);
  });
}

test("visible targets and crops cannot exceed screenshot boundaries", () => {
  const target = clone(); target.targets[0].rect.width = 500;
  assert.equal(geometrySchema.safeParse(target).success, false);
  const crop = clone(); crop.crop.width = 401;
  assert.equal(geometrySchema.safeParse(crop).success, false);
});

test("attempts require valid geometry for images and a capture time for any geometry", () => {
  const example = JSON.parse(readFileSync(new URL("examples/manifest-ledger.json", root), "utf8"));
  const attempt = example.criteria[0].steps[0];
  assert.equal(attemptSchema.safeParse(attempt).success, true);
  const missing = clone(attempt); delete missing.geometry;
  assert.equal(attemptSchema.safeParse(missing).success, false);
  const partial = clone(attempt); delete partial.image; delete partial.raw; delete partial.capturedAt;
  partial.result = "error"; partial.error = { code: "CAPTURE_FAILED", message: "Failed." };
  assert.equal(attemptSchema.safeParse(partial).success, false);
});

test("the complete attempt validator prevents saved images with unresolved masks", () => {
  const example = JSON.parse(readFileSync(new URL("examples/manifest-ledger.json", root), "utf8"));
  const attempt = clone(example.criteria[0].steps[0]);
  attempt.configuration.annotate = [{ mask: { target: "id=private" } }]; attempt.configuration.checks = [];
  attempt.geometry.targets = []; attempt.geometry.groups = [];
  attempt.checks = []; attempt.checkCounts = { total: 0, passed: 0, failed: 0 };
  attempt.result = "error";
  attempt.errors = [{ n: 1, code: "TARGET_NOT_FOUND", message: "Mask target missing." }];
  assert.equal(attemptSchema.safeParse(attempt).success, false);
  delete attempt.image;
  assert.equal(attemptSchema.safeParse(attempt).success, true);
});

test("an edge warning preserves a passing assertion and its check count", () => {
  const example = JSON.parse(readFileSync(new URL("examples/manifest-ledger.json", root), "utf8"));
  const attempt = clone(example.criteria[0].steps[0]);
  attempt.geometry.targets[0].rect.x = 0;
  attempt.geometry.warnings = [{ n: 1, code: "EDGE_EXTENT_UNKNOWN", message: "Touches screen edge; full extent unknown" }];
  const result = attemptSchema.parse(attempt);
  assert.equal(result.result, "passed");
  assert.deepEqual(result.checkCounts, { total: 1, passed: 1, failed: 0 });
});

test("geometry and coordinate translation work with host and device imports blocked", () => {
  const code = `
    const { validateStepGeometry, rectWithinCrop } = await import(${JSON.stringify(new URL("dist/manifest/geometry.js", root).href)});
    validateStepGeometry(${JSON.stringify(step)}, ${JSON.stringify(geometry)}, { checks: [], errors: [] }, { imageAvailable: true });
    const translated = rectWithinCrop(${JSON.stringify(bounds)}, { x: 80, y: 160, width: 100, height: 100 });
    if (translated.x !== 20 || translated.y !== 40) throw new Error("Wrong crop offset");
    console.log("offline geometry passed");
  `;
  assert.equal(execFileSync(process.execPath, ["--no-warnings", "--experimental-loader", fileURLToPath(new URL("test/fixtures/offline-validation-loader.mjs", root)), "--input-type=module", "--eval", code], { encoding: "utf8", timeout: 10_000 }).trim(), "offline geometry passed");
});

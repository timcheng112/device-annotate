import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideAnnotatedImage } from "../../dist/layout/image-policy.js";

const example = JSON.parse(readFileSync(new URL("../../examples/partial-evaluation.json", import.meta.url), "utf8"));
const ready = { screenshotUsable: true, cropUsable: true, drawableNumbers: [1, 2] };
const maskStep = { annotate: [{ mask: { target: 'id="account-number"' } }] };
const noChecks = { checks: [], errors: [] };

test("partial evidence keeps original numbers and all error rows with an error outcome", () => {
  assert.deepEqual(decideAnnotatedImage(example.step, example.evaluation, ready), {
    kind: "render", result: "error", drawableNumbers: [1, 2], legendNumbers: [1, 2, 3, 4], errors: example.evaluation.errors,
  });
});

test("an unresolved non-mask annotation receives a legend error instead of an invented marker", () => {
  const step = { annotate: [{ box: { target: 'id="missing"' } }, { marker: { target: 'id="cart"' } }] };
  const evaluation = { checks: [], errors: [{ n: 1, code: "TARGET_NOT_FOUND", message: "No target matches missing." }] };
  const result = decideAnnotatedImage(step, evaluation, { ...ready, drawableNumbers: [2] });
  assert.equal(result.kind, "render");
  assert.equal(result.result, "error");
  assert.deepEqual(result.drawableNumbers, [2]);
  assert.deepEqual(result.legendNumbers, [1, 2]);
});

test("unusable screenshot or crop suppresses the annotated image", () => {
  for (const [field, code] of [["screenshotUsable", "SCREENSHOT_UNUSABLE"], ["cropUsable", "CROP_UNUSABLE"]]) {
    assert.deepEqual(decideAnnotatedImage(example.step, example.evaluation, { ...ready, [field]: false }), {
      kind: "omit", result: "error", reasons: [{ code }],
    });
  }
});

test("every requested mask needs positive drawable readiness, even without an error record", () => {
  assert.deepEqual(decideAnnotatedImage(maskStep, noChecks, { ...ready, drawableNumbers: [] }), {
    kind: "omit", result: "error", reasons: [{ code: "MASK_UNUSABLE", n: 1 }],
  });
  const multiple = { annotate: [maskStep.annotate[0], { marker: { target: 'id="cart"' } }, maskStep.annotate[0]] };
  assert.deepEqual(decideAnnotatedImage(multiple, noChecks, { ...ready, drawableNumbers: [1, 2] }).reasons, [{ code: "MASK_UNUSABLE", n: 3 }]);
  assert.equal(decideAnnotatedImage(maskStep, noChecks, { ...ready, drawableNumbers: [1] }).kind, "render");
});

test("mask resolution errors suppress output while preserving completed results in the input", () => {
  const step = { ...example.step, annotate: [...example.step.annotate, maskStep.annotate[0]] };
  const evaluation = {
    checks: [{ ...example.evaluation.checks[0] }, { ...example.evaluation.checks[1], n: 5 }],
    errors: [
      { n: 3, code: "TARGET_NOT_FOUND", message: "Mask target missing." },
      { ...example.evaluation.errors[0], n: 4 },
    ],
  };
  const original = structuredClone(evaluation);
  assert.deepEqual(decideAnnotatedImage(step, evaluation, ready), {
    kind: "omit", result: "error", reasons: [{ code: "MASK_UNUSABLE", n: 3 }],
  });
  assert.deepEqual(evaluation, original);
});

test("a mask's failed or unavailable assertion does not imply that the mask cannot be drawn", () => {
  const step = { annotate: [{ mask: { target: 'id="account-number"', expect: { text: "Expected" } } }] };
  const failed = { checks: [{ n: 1, expect: { text: "Expected" }, actual: { text: "Different" }, result: "fail" }], errors: [] };
  const failurePolicy = decideAnnotatedImage(step, failed, { ...ready, drawableNumbers: [1] });
  assert.equal(failurePolicy.kind, "render");
  assert.equal(failurePolicy.result, "failed");
  const unavailable = { checks: [], errors: [{ n: 1, code: "CHECK_UNAVAILABLE", message: "Expectation could not be evaluated." }] };
  const errorPolicy = decideAnnotatedImage(step, unavailable, { ...ready, drawableNumbers: [1] });
  assert.equal(errorPolicy.kind, "render");
  assert.equal(errorPolicy.result, "error");
});

test("contradictory geometry, unknown numbers, and duplicates are rejected", () => {
  for (const drawableNumbers of [[1, 2, 3], [1, 2, 99], [1, 1, 2]]) {
    assert.throws(() => decideAnnotatedImage(example.step, example.evaluation, { ...ready, drawableNumbers }));
  }
  assert.throws(() => decideAnnotatedImage({ annotate: [{ box: { target: 'id="cart"' } }] }, noChecks, { ...ready, drawableNumbers: [] }), /neither drawable evidence nor an error/);
});

test("legend-only checks need no drawable target and capture-only images need no entries", () => {
  const step = { checks: [{ target: 'id="error"', expect: { absent: true } }] };
  const evaluation = { checks: [{ n: 1, expect: { absent: true }, actual: { absent: true }, result: "pass" }], errors: [] };
  assert.deepEqual(decideAnnotatedImage(step, evaluation, { ...ready, drawableNumbers: [] }), {
    kind: "render", result: "passed", drawableNumbers: [], legendNumbers: [1], errors: [],
  });
  assert.deepEqual(decideAnnotatedImage({}, noChecks, { ...ready, drawableNumbers: [] }).legendNumbers, []);
});

test("policy generation preserves caller data and returns independent diagnostic rows", () => {
  const evaluation = structuredClone(example.evaluation);
  const readiness = { ...ready, drawableNumbers: [2, 1] };
  const result = decideAnnotatedImage(example.step, evaluation, readiness);
  assert.deepEqual(result.drawableNumbers, [1, 2]);
  result.errors[0].message = "Changed";
  assert.deepEqual(evaluation, example.evaluation);
  assert.deepEqual(readiness.drawableNumbers, [2, 1]);
});

test("readiness cannot invent markers for targets already proven absent or hidden", () => {
  for (const predicate of ["absent", "hidden"]) {
    const expect = { [predicate]: true };
    const step = { checks: [{ target: 'id="target"', expect }] };
    const evaluation = { checks: [{ n: 1, expect, actual: expect, result: "pass" }], errors: [] };
    assert.throws(() => decideAnnotatedImage(step, evaluation, { ...ready, drawableNumbers: [1] }), /cannot receive an on-screen marker/);
    assert.equal(decideAnnotatedImage(step, evaluation, { ...ready, drawableNumbers: [] }).kind, "render");
  }
});

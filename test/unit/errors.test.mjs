import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { preCaptureErrorSchema, inputErrorResult, PreCaptureError } from "../../dist/spec/errors.js";
import { recordingOptionsSchema } from "../../dist/spec/recordings.js";
import { specSchema } from "../../dist/spec/schema.js";

const root = new URL("../../", import.meta.url);
const readJSON = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));
const validateJSON = new Ajv2020({ strict: true, allErrors: true }).compile(readJSON("src/spec/pre-capture-error.schema.json"));
const minimum = { result: "error", error: { code: "INVALID_INPUT", message: "Supply a spec." } };
const cases = [
  ["unknown context", minimum, true],
  ["reviewable example", readJSON("examples/pre-capture-error.json"), true],
  ["known step only", { ...minimum, step: "after" }, true],
  ["known criterion only", { ...minimum, criterion: "  Cart is visible.  " }, true],
  ["root input issue", { ...minimum, error: { ...minimum.error, issues: [{ path: [], message: "Supply an object." }] } }, true],
  ["missing error", { result: "error" }, false],
  ["incorrect result", { ...minimum, result: "failed" }, false],
  ["blank message", { ...minimum, error: { ...minimum.error, message: " " } }, false],
  ["unknown code", { ...minimum, error: { ...minimum.error, code: "TYPO" } }, false],
  ["null step", { ...minimum, step: null }, false],
  ["invalid step", { ...minimum, step: "../after" }, false],
  ["blank criterion", { ...minimum, criterion: " " }, false],
  ["empty issues", { ...minimum, error: { ...minimum.error, issues: [] } }, false],
  ["negative field index", { ...minimum, error: { ...minimum.error, issues: [{ path: ["recordings", -1], message: "Invalid." }] } }, false],
  ["stack in public diagnostic", { ...minimum, error: { ...minimum.error, stack: "internal" } }, false],
  ...["device", "image", "raw", "snapshot", "capturedAt", "annotations"].map((key) => [`unavailable ${key}`, { ...minimum, [key]: null }, false]),
];
for (const [name, input, valid] of cases) {
  test(`pre-capture error: ${name}`, () => {
    const original = structuredClone(input);
    assert.equal(preCaptureErrorSchema.safeParse(input).success, valid);
    assert.equal(validateJSON(input), valid, JSON.stringify(validateJSON.errors));
    assert.deepEqual(input, original);
  });
}

test("invalid input preserves every issue location without manufacturing context or artifacts", () => {
  const validation = recordingOptionsSchema.safeParse({ recordings: ["", "ok.mp4", " "] });
  assert.equal(validation.success, false);
  const result = inputErrorResult(validation.error);
  assert.deepEqual(Object.keys(result), ["result", "error"]);
  assert.deepEqual(result.error.issues.map((issue) => issue.path), [["recordings", 0], ["recordings", 2]]);
  assert.equal(validateJSON(result), true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("only valid known context is included and criterion wording stays verbatim", () => {
  const validation = recordingOptionsSchema.safeParse({ recordings: [null] });
  const result = inputErrorResult(validation.error, { step: "after", criterion: "  Cart is visible.\n" });
  assert.equal(result.step, "after");
  assert.equal(result.criterion, "  Cart is visible.\n");
  const unknown = inputErrorResult(validation.error, { step: "../after", criterion: " " });
  assert.equal(Object.hasOwn(unknown, "step"), false);
  assert.equal(Object.hasOwn(unknown, "criterion"), false);
});

test("whole-file semantic errors retain exact step-key locations", () => {
  const group = { criterion: "Cart is visible", steps: { after: {} } };
  const validation = specSchema.safeParse({ criteria: [group, group] });
  const result = inputErrorResult(validation.error);
  assert.deepEqual(result.error.issues[0].path, ["criteria", 1, "steps", "after"]);
  assert.match(result.error.issues[0].message, /first occurrence/);
});

test("error serialization excludes local cause and stack", () => {
  const cause = new Error("local diagnostic");
  const error = new PreCaptureError(minimum, { cause });
  assert.equal(error.cause, cause);
  assert.deepEqual(JSON.parse(JSON.stringify(error)), minimum);
  assert.equal(error.message, minimum.error.message);
  assert.notEqual(error.result, minimum);
});

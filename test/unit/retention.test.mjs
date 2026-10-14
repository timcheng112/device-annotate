import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { retentionSchema } from "../../dist/spec/retention.js";
import { specSchema } from "../../dist/spec/schema.js";
import { normalizeStep } from "../../dist/spec/effective-step.js";

const root = new URL("../../", import.meta.url);
const readJSON = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateJSON = ajv.compile(readJSON("src/spec/retention.schema.json"));
const validateSpecJSON = ajv.compile(readJSON("src/spec/spec.schema.json"));
const defaults = { maxAttemptsPerStep: 3, maxAgeDays: 7, maxBytes: 500_000_000 };
const example = readJSON("examples/retention.json");

test("omitted, empty, and explicit default retention normalize identically without mutating input", () => {
  const inputs = [{ criteria: example.criteria }, { ...example, retention: {} }, example];
  for (const input of inputs) {
    const original = structuredClone(input);
    assert.deepEqual(specSchema.parse(input).retention, defaults);
    assert.equal(validateSpecJSON(input), true, JSON.stringify(validateSpecJSON.errors));
    assert.deepEqual(input, original);
  }
});

for (const field of Object.keys(defaults)) {
  for (const [label, value, valid] of [
    ["zero", 0, true], ["custom value", 14, true], ["maximum safe integer", Number.MAX_SAFE_INTEGER, true],
    ["negative", -1, false], ["fractional", 0.5, false], ["string", "3", false],
    ["null", null, false], ["boolean", false, false], ["unsafe integer", Number.MAX_SAFE_INTEGER + 1, false],
    ["infinity", Infinity, false], ["NaN", NaN, false],
  ]) {
    test(`retention ${field}: ${label}`, () => {
      const input = { [field]: value };
      const original = structuredClone(input);
      const result = retentionSchema.safeParse(input);
      const fullInput = { ...example, retention: input };
      const fullResult = specSchema.safeParse(fullInput);
      assert.equal(result.success, valid);
      assert.equal(fullResult.success, valid);
      assert.equal(validateJSON(input), valid, JSON.stringify(validateJSON.errors));
      assert.equal(validateSpecJSON(fullInput), valid, JSON.stringify(validateSpecJSON.errors));
      assert.deepEqual(input, original);
      if (result.success) {
        assert.deepEqual(result.data, { ...defaults, [field]: value }, "partial overrides preserve explicit zero and fill other defaults");
      } else {
        assert.deepEqual(result.error.issues[0].path, [field]);
        assert.deepEqual(fullResult.error.issues[0].path, ["retention", field]);
      }
    });
  }
}

test("retention rejects malformed objects, unknown fields, and per-step overrides", () => {
  for (const retention of [null, [], false, "default", { maxAge: 7 }, { enabled: false }]) {
    assert.equal(retentionSchema.safeParse(retention).success, false);
    assert.equal(validateJSON(retention), false);
    assert.equal(specSchema.safeParse({ ...example, retention }).success, false);
    assert.equal(validateSpecJSON({ ...example, retention }), false);
  }
  for (const input of [
    { ...example, defaults: { retention: defaults } },
    { criteria: [{ ...example.criteria[0], retention: defaults }] },
    { criteria: [{ ...example.criteria[0], steps: { before: { retention: defaults } } }] },
  ]) {
    assert.equal(specSchema.safeParse(input).success, false);
    assert.equal(validateSpecJSON(input), false);
  }
});

test("retention changes leave effective capture configuration unchanged", () => {
  const effective = (input) => {
    const parsed = specSchema.parse(input);
    const group = parsed.criteria[0];
    return normalizeStep({ criterion: group.criterion, step: group.steps.before, defaults: parsed.defaults });
  };
  assert.deepEqual(effective(example), effective({ ...example, retention: { maxAttemptsPerStep: 0 } }));
});

test("normalized retention is independent between calls and from caller input", () => {
  const first = specSchema.parse({ criteria: example.criteria });
  first.retention.maxBytes = 0;
  assert.deepEqual(specSchema.parse({ criteria: example.criteria }).retention, defaults);
  const explicit = specSchema.parse(example);
  explicit.retention.maxAgeDays = 0;
  assert.deepEqual(example.retention, defaults);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { specSchema, specStructureSchema } from "../../dist/spec/schema.js";

const root = new URL("../../", import.meta.url);
const readJSON = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const exported = readJSON("src/spec/spec.schema.json");
const validateJSON = new Ajv2020({ strict: true, allErrors: true }).compile(exported);
const group = { criterion: "Cart total updates", steps: { before: {}, after: {} } };
const spec = { criteria: [group] };
const cases = [
  ["minimal spec", spec, true],
  ["inheritance example", readJSON("examples/step-defaults.json"), true],
  ["explicit output folder", { ...spec, out: "evidence/cart" }, true],
  ["same criterion wording with distinct steps", { criteria: [group, { criterion: group.criterion, steps: { checkout: {} } }] }, true],
  ["all approved annotations and checks in a step", { criteria: [{ ...group, steps: { after: { annotate: readJSON("examples/annotations.json"), checks: readJSON("examples/checks.json"), crop: readJSON("examples/crop.json") } } }] }, true],
  ["missing spec", undefined, false],
  ["null spec", null, false],
  ["array instead of spec", [spec], false],
  ["missing criteria", {}, false],
  ["empty criteria", { criteria: [] }, false],
  ["object instead of criteria array", { criteria: group }, false],
  ["missing criterion wording", { criteria: [{ steps: group.steps }] }, false],
  ["blank criterion wording", { criteria: [{ ...group, criterion: " \n\t" }] }, false],
  ["numeric criterion", { criteria: [{ ...group, criterion: 42 }] }, false],
  ["missing steps", { criteria: [{ criterion: group.criterion }] }, false],
  ["empty steps", { criteria: [{ ...group, steps: {} }] }, false],
  ["array instead of steps", { criteria: [{ ...group, steps: [] }] }, false],
  ["blank step name", { criteria: [{ ...group, steps: { " ": {} } }] }, false],
  ["empty output folder", { ...spec, out: "" }, false],
  ["null output folder", { ...spec, out: null }, false],
  ["shared checks forbidden", { ...spec, defaults: { checks: [] } }, false],
  ["unknown root field", { ...spec, typo: true }, false],
  ["unknown criterion field", { criteria: [{ ...group, typo: true }] }, false],
  ["root actions forbidden", { ...spec, actions: [{ tap: 'id="cart"' }] }, false],
  ["criterion actions forbidden", { criteria: [{ ...group, tap: 'id="cart"' }] }, false],
  ["step actions forbidden", { criteria: [{ ...group, steps: { before: { tap: 'id="cart"' } } }] }, false],
  ["invalid nested expectation", { criteria: [{ ...group, steps: { after: { checks: [{ target: 'id="cart"', expect: { enabled: true } }] } } }] }, false],
];

for (const [name, value, valid] of cases) {
  test(`spec structural validation: ${name}`, () => {
    const original = structuredClone(value);
    const result = specSchema.safeParse(value);
    assert.equal(result.success, valid, result.success ? "unexpected success" : result.error.message);
    assert.equal(validateJSON(value), valid, JSON.stringify(validateJSON.errors));
    assert.deepEqual(value, original, "validation must not mutate the input document");
  });
}

test("complete validation rejects all repeated names with the first occurrence identified", () => {
  const input = { criteria: [group, { criterion: "Checkout succeeds", steps: { after: {} } }, { criterion: "Confirmation appears", steps: { before: {}, after: {} } }] };
  assert.equal(specStructureSchema.safeParse(input).success, true);
  assert.equal(validateJSON(input), true, "T41 explicitly limits the exported schema to structural checks");
  const result = specSchema.safeParse(input);
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues.map((issue) => issue.path), [
    ["criteria", 1, "steps", "after"],
    ["criteria", 2, "steps", "before"],
    ["criteria", 2, "steps", "after"],
  ]);
  for (const issue of result.error.issues) assert.match(issue.message, /first occurrence is at criteria\[0\]/);
});

test("step matching handles ordinary object-property names without false duplicates", () => {
  const input = { criteria: [{ ...group, steps: { constructor: {}, toString: {}, hasOwnProperty: {} } }] };
  const result = specSchema.parse(input);
  assert.deepEqual(Object.keys(result.criteria[0].steps), ["constructor", "toString", "hasOwnProperty"]);
});

test("a reserved prototype key is rejected instead of silently losing a step", () => {
  const input = JSON.parse('{"criteria":[{"criterion":"All steps survive validation","steps":{"before":{},"__proto__":{}}}]}');
  const result = specSchema.safeParse(input);
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues[0].path, ["criteria", 0, "steps", "__proto__"]);
  assert.equal(validateJSON(input), false);
});

test("criterion wording and empty-step normalization survive whole-file validation", () => {
  const wording = "  Cart total updates\nwhen quantity changes.  ";
  const result = specSchema.parse({ criteria: [{ criterion: wording, steps: { before: {} } }] });
  assert.equal(result.criteria[0].criterion, wording);
  assert.deepEqual(result.criteria[0].steps.before, { annotate: [], checks: [] });
});

test("the generated schema explains its structural-validation boundary", () => {
  assert.match(exported.$comment, /device-proof validate/);
  assert.match(exported.description, /unique step names across criteria/);
});

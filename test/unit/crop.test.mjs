import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { cropSchema } from "../../dist/spec/crop.js";

const root = new URL("../../", import.meta.url);
const readJSON = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const validateJSON = new Ajv2020({ strict: true, allErrors: true }).compile(readJSON("src/spec/crop.schema.json"));
const targets = ['id="cart-total"'];

const cases = [
  ["approved example", readJSON("examples/crop.json"), true],
  ["default padding", { targets }, true],
  ["zero padding", { targets, padding: 0 }, true],
  ["multiple targets", { targets: [...targets, 'id="checkout"'], padding: 24 }, true],
  ["selector wording preserved", { targets: ['  id="cart-total"  '], padding: 12 }, true],
  ["large safe integer padding", { targets, padding: Number.MAX_SAFE_INTEGER }, true],
  ["missing crop object", undefined, false],
  ["null crop object", null, false],
  ["boolean crop object", false, false],
  ["array instead of crop object", targets, false],
  ["missing targets", { padding: 24 }, false],
  ["empty target list", { targets: [] }, false],
  ["target string instead of array", { targets: targets[0] }, false],
  ["empty selector", { targets: [""] }, false],
  ["blank selector", { targets: [" \n\t\u00a0"] }, false],
  ["null selector", { targets: [null] }, false],
  ["negative padding", { targets, padding: -1 }, false],
  ["fractional padding", { targets, padding: 0.5 }, false],
  ["string padding", { targets, padding: "24" }, false],
  ["null padding", { targets, padding: null }, false],
  ["infinite padding", { targets, padding: Infinity }, false],
  ["NaN padding", { targets, padding: NaN }, false],
  ["unsafe integer padding", { targets, padding: Number.MAX_SAFE_INTEGER + 1 }, false],
  ["unknown setting", { targets, scale: 0.5 }, false],
  ["action inside crop", { targets, scroll: "down" }, false],
];

for (const [name, value, valid] of cases) {
  test(`crop: ${name}`, () => {
    const original = structuredClone(value);
    const parsed = cropSchema.safeParse(value);
    assert.equal(parsed.success, valid, parsed.success ? "unexpected success" : parsed.error.message);
    assert.equal(validateJSON(value), valid, JSON.stringify(validateJSON.errors));
    assert.deepEqual(value, original, "validation must not modify caller input");
    if (parsed.success) {
      assert.deepEqual(parsed.data, { ...original, padding: original.padding ?? 24 });
    }
  });
}

test("omitted and explicit default padding normalize identically", () => {
  assert.deepEqual(cropSchema.parse({ targets }), cropSchema.parse({ targets, padding: 24 }));
  assert.equal(cropSchema.parse({ targets, padding: 0 }).padding, 0);
});

test("crop errors retain target-index and padding locations", () => {
  const result = cropSchema.safeParse({ targets: [targets[0], " "], padding: -1 });
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues.map((issue) => issue.path), [["targets", 1], ["padding"]]);
});

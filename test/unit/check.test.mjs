import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { expectationSchema, standaloneCheckSchema } from "../../dist/spec/check.js";

const root = new URL("../../", import.meta.url);
const readJSON = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const validateJSON = new Ajv2020({ strict: true, allErrors: true }).compile(readJSON("src/spec/check.schema.json"));
const target = 'id="cart-total"';
const states = ["visible", "hidden", "exists", "absent", "editable", "selected", "focused"];
const check = { target, expect: { visible: true } };

function verify(value, valid) {
  const original = structuredClone(value);
  const parsed = standaloneCheckSchema.safeParse(value);
  assert.equal(parsed.success, valid, parsed.success ? "unexpected success" : parsed.error.message);
  assert.equal(validateJSON(value), valid, JSON.stringify(validateJSON.errors));
  assert.deepEqual(value, original, "validation must not mutate input");
  if (parsed.success) assert.deepEqual(parsed.data, original, "selectors and expected text must remain verbatim");
}

for (const predicate of states) {
  test(`standalone check: ${predicate} invokes the named state predicate`, () => {
    verify({ target, expect: { [predicate]: true } }, true);
    for (const value of [false, "true", 1, null]) {
      verify({ target, expect: { [predicate]: value } }, false);
    }
  });
}

const cases = [
  ["exact expected text", { target, expect: { text: "£12.00" } }, true],
  ["whitespace-only expected text", { target, expect: { text: " \n\t" } }, true],
  ["Unicode and multiline text", { target, expect: { text: "  Total: £12.00\n商品 🛒  " } }, true],
  ["selector wording is preserved", { target: '  id="cart-total"  ', expect: { visible: true } }, true],
  ["missing check", undefined, false],
  ["null check", null, false],
  ["missing target", { expect: { visible: true } }, false],
  ["empty target", { ...check, target: "" }, false],
  ["blank target", { ...check, target: " \n\u00a0" }, false],
  ["numeric target", { ...check, target: 123 }, false],
  ["missing expectation", { target }, false],
  ["null expectation", { target, expect: null }, false],
  ["empty expectation", { target, expect: {} }, false],
  ["array expectation", { target, expect: [{ visible: true }] }, false],
  ["unsupported predicate", { target, expect: { enabled: true } }, false],
  ["predicate typo", { target, expect: { visibile: true } }, false],
  ["empty text rejected by upstream admission", { target, expect: { text: "" } }, false],
  ["numeric text", { target, expect: { text: 12 } }, false],
  ["boolean text", { target, expect: { text: true } }, false],
  ["regex text", { target, expect: { text: { regex: "Total.*" } } }, false],
  ["unknown top-level field", { ...check, timeout: 5000 }, false],
  ["unknown expectation field", { target, expect: { visible: true, message: "Shown" } }, false],
  ["action added to check", { ...check, tap: target }, false],
  ["action used as expectation", { target, expect: { tap: true } }, false],
];

for (const [name, value, valid] of cases) {
  test(`standalone check: ${name}`, () => verify(value, valid));
}

test("all pairs of different predicates are rejected in a single expectation", () => {
  const predicates = [...states.map((predicate) => [predicate, true]), ["text", "£12.00"]];
  for (let i = 0; i < predicates.length; i += 1) {
    for (let j = i + 1; j < predicates.length; j += 1) {
      const expect = Object.fromEntries([predicates[i], predicates[j]]);
      assert.equal(expectationSchema.safeParse(expect).success, false);
      verify({ target, expect }, false);
    }
  }
});

test("approved standalone examples keep multiple checks on the same target separate", () => {
  const examples = readJSON("examples/checks.json");
  assert.equal(examples.length, 3);
  assert.equal(examples[0].target, examples[1].target);
  assert.notDeepEqual(examples[0].expect, examples[1].expect);
  for (const example of examples) verify(example, true);
});

function leafPaths(issues) {
  return issues.flatMap((issue) => issue.code === "invalid_union"
    ? issue.errors.flatMap(leafPaths)
    : [issue.path]);
}

test("invalid check fields retain locations for the eventual validation-error formatter", () => {
  const missingTarget = standaloneCheckSchema.safeParse({ expect: { visible: true } });
  assert.equal(missingTarget.success, false);
  assert.deepEqual(missingTarget.error.issues[0].path, ["target"]);

  const invalidText = standaloneCheckSchema.safeParse({ target, expect: { text: "" } });
  assert.equal(invalidText.success, false);
  assert.ok(leafPaths(invalidText.error.issues).some((path) => JSON.stringify(path) === '["expect","text"]'));
});

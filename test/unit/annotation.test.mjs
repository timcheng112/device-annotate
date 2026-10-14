import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { annotationSchema } from "../../dist/spec/annotation.js";

const root = new URL("../../", import.meta.url);
const readJSON = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const validateJSON = new Ajv2020({ strict: true, allErrors: true }).compile(readJSON("src/spec/annotation.schema.json"));
const kinds = ["box", "marker", "arrow", "callout", "mask"];
const target = 'id="cart-total"';
const states = ["visible", "hidden", "exists", "absent", "editable", "selected", "focused"];

function settings(kind) {
  if (kind === "arrow") return { to: target, text: "Total" };
  if (kind === "callout") return { target, text: "Total" };
  return { target };
}

function verify(value, valid) {
  const original = structuredClone(value);
  const parsed = annotationSchema.safeParse(value);
  assert.equal(parsed.success, valid, parsed.success ? "unexpected success" : parsed.error.message);
  assert.equal(validateJSON(value), valid, JSON.stringify(validateJSON.errors));
  assert.deepEqual(value, original, "validation must not mutate input");
  if (parsed.success) assert.deepEqual(parsed.data, original, "validation must preserve wording and omitted expectations");
  return parsed;
}

for (const kind of kinds) {
  test(`${kind}: INFO remains assertion-free`, () => {
    const parsed = verify({ [kind]: settings(kind) }, true);
    assert.equal(Object.hasOwn(parsed.data[kind], "expect"), false);
  });

  test(`${kind}: accepts each supported single expectation`, () => {
    for (const expect of [...states.map((name) => ({ [name]: true })), { text: "£12.00" }]) {
      verify({ [kind]: { ...settings(kind), expect } }, true);
    }
  });

  test(`${kind}: requires a selector under the correct key`, () => {
    const key = kind === "arrow" ? "to" : "target";
    const otherKey = kind === "arrow" ? "target" : "to";
    const base = settings(kind);
    delete base[key];
    verify({ [kind]: base }, false);
    verify({ [kind]: { ...base, [otherKey]: target } }, false);
    for (const value of ["", " \n\t", null, 42, { id: "cart-total" }]) {
      verify({ [kind]: { ...base, [key]: value } }, false);
    }
  });

  test(`${kind}: preserves label wording and requires meaningful supplied text`, () => {
    verify({ [kind]: { ...settings(kind), text: "  Total: £12.00\n商品 🛒  " } }, true);
    for (const text of ["", " \n\t", null, 42]) {
      verify({ [kind]: { ...settings(kind), text } }, false);
    }
    const base = settings(kind);
    delete base.text;
    verify({ [kind]: base }, kind !== "arrow" && kind !== "callout");
  });

  test(`${kind}: rejects invalid expectations and extra fields`, () => {
    for (const expect of [{}, null, { text: "" }, { enabled: true }, { visible: false }, { visible: true, selected: true }]) {
      verify({ [kind]: { ...settings(kind), expect } }, false);
    }
    verify({ [kind]: { ...settings(kind), color: "red" } }, false);
    verify({ [kind]: { ...settings(kind), tap: target } }, false);
    verify({ [kind]: settings(kind), expect: { visible: true } }, false);
  });
}

test("an annotation must contain exactly one known primitive", () => {
  for (const value of [undefined, null, {}, [], { circle: { target } }, { tap: target }]) verify(value, false);
  for (let i = 0; i < kinds.length; i += 1) {
    for (let j = i + 1; j < kinds.length; j += 1) {
      verify({ [kinds[i]]: settings(kinds[i]), [kinds[j]]: settings(kinds[j]) }, false);
    }
  }
});

test("approved annotation examples validate", () => {
  const examples = readJSON("examples/annotations.json");
  assert.deepEqual(examples.map((example) => Object.keys(example)[0]), kinds);
  for (const example of examples) verify(example, true);
});

function leafPaths(issues) {
  return issues.flatMap((issue) => issue.code === "invalid_union"
    ? issue.errors.flatMap(leafPaths)
    : [issue.path]);
}

test("annotation errors retain nested field locations", () => {
  for (const [value, path] of [
    [{ arrow: { to: target } }, ["arrow", "text"]],
    [{ box: { target, expect: { text: "" } } }, ["box", "expect", "text"]],
  ]) {
    const parsed = annotationSchema.safeParse(value);
    assert.equal(parsed.success, false);
    assert.ok(leafPaths(parsed.error.issues).some((actual) => JSON.stringify(actual) === JSON.stringify(path)));
  }
});

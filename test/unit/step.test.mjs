import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { defaultsSchema, stepSchema } from "../../dist/spec/step.js";
import { normalizeStep } from "../../dist/spec/effective-step.js";

const root = new URL("../../", import.meta.url);
const readJSON = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const validators = {
  defaults: new Ajv2020({ strict: true, allErrors: true }).compile(readJSON("src/spec/defaults.schema.json")),
  step: new Ajv2020({ strict: true, allErrors: true }).compile(readJSON("src/spec/step.schema.json")),
};
const schemas = { defaults: defaultsSchema, step: stepSchema };
const criterion = "Cart total updates when quantity changes";
const crop = { targets: ['id="cart"'], padding: 72 };
const annotation = { box: { target: 'id="cart-total"' } };
const check = { target: 'id="error"', expect: { absent: true } };

const cases = [
  ["defaults", "empty defaults", {}, true],
  ["defaults", "shared crop", { crop }, true],
  ["defaults", "shared crop with default padding", { crop: { targets: crop.targets } }, true],
  ["defaults", "null defaults", null, false],
  ["defaults", "null default crop", { crop: null }, false],
  ["defaults", "annotations cannot be inherited", { annotate: [annotation] }, false],
  ["defaults", "checks cannot be inherited", { checks: [check] }, false],
  ["defaults", "actions cannot be inherited", { tap: 'id="cart"' }, false],
  ["step", "capture-only step", {}, true],
  ["step", "explicit empty entries", { annotate: [], checks: [] }, true],
  ["step", "full-frame override", { crop: null }, true],
  ["step", "crop object override", { crop }, true],
  ["step", "annotations and standalone checks together", { annotate: [annotation], checks: [check] }, true],
  ["step", "null step", null, false],
  ["step", "array instead of step", [], false],
  ["step", "null annotations", { annotate: null }, false],
  ["step", "object instead of check array", { checks: check }, false],
  ["step", "boolean crop", { crop: false }, false],
  ["step", "partial crop override without targets", { crop: { padding: 12 } }, false],
  ["step", "invalid nested expectation", { annotate: [{ box: { ...annotation.box, expect: { enabled: true } } }] }, false],
  ["step", "local defaults block", { defaults: { crop } }, false],
  ["step", "local criterion", { criterion }, false],
  ["step", "action in step", { tap: 'id="cart"' }, false],
];

for (const [schema, name, value, valid] of cases) {
  test(`${schema}: ${name}`, () => {
    const original = structuredClone(value);
    const parsed = schemas[schema].safeParse(value);
    assert.equal(parsed.success, valid, parsed.success ? "unexpected success" : parsed.error.message);
    assert.equal(validators[schema](value), valid, JSON.stringify(validators[schema].errors));
    assert.deepEqual(value, original);
  });
}

test("omitted crop inherits; null explicitly selects the full screenshot", () => {
  const inherited = normalizeStep({ criterion, step: {}, defaults: { crop } });
  assert.deepEqual(inherited, { criterion, annotate: [], checks: [], crop });
  assert.equal(normalizeStep({ criterion, step: { crop: null }, defaults: { crop } }).crop, null);
  assert.equal(normalizeStep({ criterion, step: {} }).crop, null);
});

test("a step replaces the entire shared crop and receives its own padding default", () => {
  const local = { targets: ['id="checkout"'] };
  assert.deepEqual(normalizeStep({ criterion, step: { crop: local }, defaults: { crop } }).crop, {
    targets: local.targets,
    padding: 24,
  });
  assert.equal(normalizeStep({ criterion, step: { crop: { ...local, padding: 0 } }, defaults: { crop } }).crop.padding, 0);
});

test("default changes affect only steps whose effective crop changes", () => {
  const steps = { inherited: {}, own: { crop }, full: { crop: null } };
  const before = { crop };
  const after = { crop: { targets: ['id="checkout"'], padding: 0 } };
  const changed = Object.entries(steps).filter(([, step]) => {
    return JSON.stringify(normalizeStep({ criterion, step, defaults: before })) !==
      JSON.stringify(normalizeStep({ criterion, step, defaults: after }));
  }).map(([name]) => name);
  assert.deepEqual(changed, ["inherited"]);
});

test("equivalent crops normalize identically across explicit and inherited forms", () => {
  const expected = normalizeStep({ criterion, step: { crop: { targets: ['id="a"', 'id="b"'], padding: 24 } } });
  const actual = normalizeStep({ criterion, step: {}, defaults: { crop: { targets: ['id="b"', 'id="a"', 'id="b"'] } } });
  assert.deepEqual(actual, expected);
  assert.deepEqual(normalizeStep({ criterion, step: {} }), normalizeStep({ criterion, step: { annotate: [], checks: [], crop: null } }));
});

test("object key order is irrelevant while annotation and check order is preserved", () => {
  const secondAnnotation = { marker: { target: 'id="checkout"' } };
  const secondCheck = { target: 'id="cart-total"', expect: { text: "£12.00" } };
  const step = { annotate: [annotation, secondAnnotation], checks: [check, secondCheck] };
  const normalized = normalizeStep({ criterion, step });
  const reorderedKeys = { checks: [check, { expect: secondCheck.expect, target: secondCheck.target }], annotate: step.annotate };
  assert.equal(JSON.stringify(normalized), JSON.stringify(normalizeStep({ criterion, step: reorderedKeys })));
  assert.deepEqual(normalized.annotate, step.annotate);
  assert.deepEqual(normalized.checks, step.checks);
  assert.notDeepEqual(normalized, normalizeStep({ criterion, step: { ...step, annotate: [...step.annotate].reverse() } }));
  assert.notDeepEqual(normalized, normalizeStep({ criterion, step: { ...step, checks: [...step.checks].reverse() } }));
});

test("criterion wording is required and preserved verbatim", () => {
  const wording = "  Cart total updates.\nExact wording from the plan.  ";
  assert.equal(normalizeStep({ criterion: wording, step: {} }).criterion, wording);
  for (const value of [undefined, null, "", " \n\t", 42]) {
    assert.throws(() => normalizeStep({ criterion: value, step: {} }));
  }
  assert.notDeepEqual(normalizeStep({ criterion, step: {} }), normalizeStep({ criterion: `${criterion}!`, step: {} }));
});

test("normalization does not mutate or share mutable data with inputs", () => {
  const input = { criterion, step: { annotate: [annotation], checks: [check] }, defaults: { crop } };
  const original = structuredClone(input);
  const normalized = normalizeStep(input);
  normalized.annotate[0].box.target = 'id="changed"';
  normalized.checks[0].expect.absent = false;
  normalized.crop.targets.push('id="extra"');
  assert.deepEqual(input, original);
});

test("invalid defaults are rejected even when a step overrides crop", () => {
  assert.throws(() => normalizeStep({ criterion, step: { crop: null }, defaults: null }));
  assert.throws(() => normalizeStep({ criterion, step: { crop: null }, defaults: { crop: { padding: 24 } } }));
});

test("approved inheritance example normalizes before and after as described", () => {
  const example = readJSON("examples/step-defaults.json");
  const group = example.criteria[0];
  assert.deepEqual(normalizeStep({ criterion: group.criterion, step: group.steps.before, defaults: example.defaults }).crop, example.defaults.crop);
  assert.equal(normalizeStep({ criterion: group.criterion, step: group.steps.after, defaults: example.defaults }).crop, null);
});

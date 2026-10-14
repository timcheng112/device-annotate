import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validate } from "device-proof";
import { diagnosticSchema } from "../../dist/spec/errors.js";

const root = new URL("../../", import.meta.url);
const source = readFileSync(new URL("examples/cart.yaml", root), "utf8");
const spec = { criteria: [{ criterion: "Cart is visible", steps: { after: {} } }] };

test("the public API accepts YAML, JSON text, and parsed objects with identical normalization", () => {
  const yaml = "criteria:\n  - criterion: Cart is visible\n    steps:\n      after: {}\n";
  const original = structuredClone(spec);
  const fromObject = validate(spec);
  assert.equal(fromObject.valid, true);
  assert.deepEqual(validate(yaml), fromObject);
  assert.deepEqual(validate(JSON.stringify(spec)), fromObject);
  assert.deepEqual(fromObject.spec.retention, { maxAttemptsPerStep: 3, maxAgeDays: 7, maxBytes: 500000000 });
  assert.deepEqual(fromObject.spec.criteria[0].steps.after, { annotate: [], checks: [] });
  fromObject.spec.criteria[0].criterion = "Changed";
  assert.deepEqual(spec, original);
});

test("the shipping YAML example validates and preserves criterion and expectation wording", () => {
  const result = validate(source);
  assert.equal(result.valid, true);
  assert.equal(result.spec.criteria[0].criterion, "Cart total updates when quantity changes");
  assert.deepEqual(result.spec.criteria[0].steps.after.annotate[0].box.expect, { text: "£12.00" });
  assert.equal(validate({ criteria: [{ ...spec.criteria[0], criterion: "  Exact wording\n" }] }).spec.criteria[0].criterion, "  Exact wording\n");
});

test("YAML aliases work without mutating or sharing normalized step inputs", () => {
  const text = 'defaults:\n  crop: &crop\n    targets: [\'id="cart"\']\ncriteria:\n  - criterion: Cart\n    steps:\n      before: { crop: *crop }\n      after: { crop: *crop }\n';
  const result = validate(text);
  assert.equal(result.valid, true);
  result.spec.criteria[0].steps.before.crop.targets.push("changed");
  assert.equal(result.spec.criteria[0].steps.after.crop.targets.length, 1);
  assert.equal(result.spec.defaults.crop.targets.length, 1);
});

const invalidYAML = [
  ["malformed sequence", "criteria: [\n"],
  ["duplicate step keys", "criteria:\n - criterion: Cart\n   steps:\n     after: {}\n     after: {}\n"],
  ["duplicate root keys", "criteria: []\ncriteria: []\n"],
  ["multiple documents", "criteria: []\n---\ncriteria: []\n"],
  ["unknown tag", "criteria: !custom []\n"],
  ["unsupported version", "%YAML 1.1\n---\ncriteria: []\n"],
  ["unresolved alias", "criteria: *missing\n"],
  ["non-string mapping key", "? [a, b]\n: value\n"],
];
for (const [name, input] of invalidYAML) {
  test(`YAML failure is structured: ${name}`, () => {
    const result = validate(input);
    assert.equal(result.valid, false);
    assert.equal(result.error.code, "INVALID_YAML");
    assert.equal(diagnosticSchema.safeParse(result.error).success, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });
}

test("malformed YAML includes a source location", () => {
  const result = validate("criteria:\n - criterion: Cart\n   steps:\n     after: {}\n     after: {}\n");
  assert.deepEqual(result.error.issues[0].location, { line: 5, column: 6 });
});

test("semantic duplicate step names retain the later path and YAML location", () => {
  const result = validate("criteria:\n - criterion: Cart\n   steps:\n     after: {}\n - criterion: Checkout\n   steps:\n     after: {}\n");
  assert.equal(result.valid, false);
  assert.equal(result.error.code, "INVALID_INPUT");
  assert.deepEqual(result.error.issues[0].path, ["criteria", 1, "steps", "after"]);
  assert.equal(result.error.issues[0].location.line, 7);
  assert.match(result.error.issues[0].message, /first occurrence/);
});

test("unknown fields and invalid values identify their own YAML fields", () => {
  const result = validate("retention:\n  maxBytes: -1\ncriteria: []\ntap: cart\n");
  assert.equal(result.valid, false);
  const budget = result.error.issues.find((issue) => issue.path.join(".") === "retention.maxBytes");
  assert.deepEqual(budget.location, { line: 2, column: 13 });
  const action = result.error.issues.find((issue) => issue.path[0] === "tap");
  assert.equal(action.location.line, 4);
  assert.match(action.message, /Unknown field/);
});

test("missing fields fall back to an existing parent location", () => {
  const result = validate("criteria:\n - steps:\n     after: {}\n");
  assert.equal(result.valid, false);
  assert.deepEqual(result.error.issues[0].path, ["criteria", 0, "criterion"]);
  assert.equal(result.error.issues[0].location.line, 2);
});

test("invalid parsed values return diagnostics without fabricated source locations", () => {
  for (const input of [undefined, null, [], 42, {}, { ...spec, tap: "cart" }]) {
    const result = validate(input);
    assert.equal(result.valid, false);
    assert.equal(result.error.code, "INVALID_INPUT");
    for (const issue of result.error.issues) assert.equal(Object.hasOwn(issue, "location"), false);
  }
});

test("reserved prototype keys survive YAML parsing long enough to be rejected", () => {
  const result = validate("criteria:\n - criterion: Cart\n   steps:\n     after: {}\n     __proto__: {}\n");
  assert.equal(result.valid, false);
  assert.deepEqual(result.error.issues[0].path, ["criteria", 0, "steps", "__proto__"]);
});

test("empty text, scalar documents, cyclic aliases, and unsupported merge keys fail as specs", () => {
  for (const input of ["", "# empty\n", "examples/cart.yaml", "criteria: &cycle [*cycle]\n", "<<: { criteria: [] }\n"]) {
    assert.equal(validate(input).valid, false);
  }
});

test("excessive alias expansion returns an error instead of escaping the API", () => {
  const aliases = Array.from({ length: 120 }, () => "*group").join(", ");
  const result = validate(`criteria: [&group { criterion: Cart, steps: { after: {} } }, ${aliases}]`);
  assert.equal(result.valid, false);
  assert.equal(result.error.code, "INVALID_YAML");
  assert.match(result.error.issues[0].message, /alias/i);
});

test("the public API validates YAML with all host built-ins and device imports blocked", () => {
  const loader = fileURLToPath(new URL("test/fixtures/offline-validation-loader.mjs", root));
  const code = `
    const { validate } = await import("device-proof");
    if (!validate(${JSON.stringify(source)}).valid) throw new Error("Valid YAML rejected");
    if (validate("criteria: !custom []").valid) throw new Error("Unknown tag accepted");
    console.log("offline API passed");
  `;
  const output = execFileSync(process.execPath, ["--no-warnings", "--experimental-loader", loader, "--input-type=module", "--eval", code], { cwd: fileURLToPath(root), encoding: "utf8", timeout: 10000 });
  assert.equal(output, "offline API passed\n");
});

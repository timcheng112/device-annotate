import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareOneOffCapture, prepareSpecCapture } from "../../dist/spec/capture-input.js";
import { PreCaptureError, preCaptureErrorSchema } from "../../dist/spec/errors.js";

const build = { appId: "com.example.shop", native: " build:42 ", runtime: { kind: "embedded" } };
const criterion = "  Cart total updates exactly.\n";
const config = { checks: [{ target: 'id="total"', expect: { text: "£12.00" } }] };
const single = { criteria: [{ criterion, steps: { after: config } }] };
const multi = { criteria: [{ criterion, steps: { before: {}, after: config } }] };

function failure(run) {
  try { run(); } catch (error) {
    assert.ok(error instanceof PreCaptureError);
    assert.deepEqual(preCaptureErrorSchema.parse(error.result), error.result);
    return error.result;
  }
  assert.fail("Expected pre-capture rejection");
}

test("one-off and single-step specs normalize identically and preserve criterion wording", () => {
  const prepared = prepareSpecCapture({ spec: single, step: "after" });
  assert.deepEqual(prepareOneOffCapture({ step: "after", criterion, config }), prepared);
  assert.equal(prepared.effectiveStep.criterion, criterion);
  assert.equal(prepared.effectiveStep.crop, null);
  assert.equal(Object.hasOwn(prepared, "build"), false);
});

for (const value of [undefined, "", " \t\n", null]) {
  test(`one-off rejects criterion ${JSON.stringify(value)} before capture`, () => {
    const result = failure(() => prepareOneOffCapture({ step: "after", criterion: value, config }));
    assert.equal(result.error.code, "INVALID_INPUT");
    assert.equal(result.step, "after");
    assert.equal(Object.hasOwn(result, "criterion"), false);
    assert.ok(result.error.issues.some((issue) => issue.path[0] === "criterion"));
  });
}

test("every step in a multi-step flow requires complete build identity", () => {
  for (const step of ["before", "after"]) {
    const result = failure(() => prepareSpecCapture({ spec: multi, step }));
    assert.equal(result.step, step);
    assert.equal(result.criterion, criterion);
    assert.match(result.error.message, /Multi-step.*appId, native, and runtime/);
    assert.deepEqual(result.error.issues[0].path, ["build"]);
  }
  const acrossCriteria = { criteria: [...single.criteria, { criterion: "Other", steps: { other: {} } }] };
  failure(() => prepareSpecCapture({ spec: acrossCriteria, step: "after" }));
});

test("incomplete external build reports its exact field for single and multi-step captures", () => {
  for (const spec of [single, multi]) {
    const result = failure(() => prepareSpecCapture({ spec, step: "after", build: { ...build, runtime: { kind: "external" } } }));
    assert.deepEqual(result.error.issues[0].path, ["build", "runtime", "revision"]);
    assert.equal(result.criterion, criterion);
  }
  failure(() => prepareOneOffCapture({ step: "after", criterion, config, build: null }));
});

test("complete identities remain verbatim and detached from caller data", () => {
  for (const runtime of [{ kind: "embedded" }, { kind: "external", revision: " ota:ABC " }]) {
    const input = { spec: structuredClone(multi), step: "after", build: { ...build, runtime } };
    const original = structuredClone(input);
    const prepared = prepareSpecCapture(input);
    assert.deepEqual(prepared.build, input.build);
    prepared.build.runtime.kind = "changed";
    prepared.effectiveStep.checks[0].expect.text = "changed";
    prepared.spec.criteria[0].steps.after.checks[0].expect.text = "changed";
    assert.deepEqual(input, original);
  }
});

test("preparation inherits crop defaults and honors explicit full-frame override", () => {
  const spec = { ...multi, defaults: { crop: { targets: ["z", "a", "z"] } } };
  assert.deepEqual(prepareSpecCapture({ spec, step: "after", build }).effectiveStep.crop, { targets: ["a", "z"], padding: 24 });
  const overridden = structuredClone(spec);
  overridden.criteria[0].steps.after.crop = null;
  assert.equal(prepareSpecCapture({ spec: overridden, step: "after", build }).effectiveStep.crop, null);
});

test("capture preparation invokes complete validation across unselected steps", () => {
  const duplicated = { criteria: [...single.criteria, ...single.criteria] };
  const duplicate = failure(() => prepareSpecCapture({ spec: duplicated, step: "after", build }));
  assert.deepEqual(duplicate.error.issues[0].path, ["criteria", 1, "steps", "after"]);
  const malformed = structuredClone(multi);
  malformed.criteria[0].steps.before.actions = [{ tap: "Continue" }];
  failure(() => prepareSpecCapture({ spec: malformed, step: "after", build }));
});

test("YAML capture input retains source locations and matches parsed input", () => {
  const yaml = 'criteria:\n  - criterion: Cart\n    steps:\n      after: {}\n';
  assert.deepEqual(prepareSpecCapture({ spec: yaml, step: "after" }), prepareSpecCapture({ spec: { criteria: [{ criterion: "Cart", steps: { after: {} } }] }, step: "after" }));
  const result = failure(() => prepareSpecCapture({ spec: yaml.replace("after: {}", "after: {actions: []}"), step: "after" }));
  assert.equal(result.error.issues[0].location.line, 4);
  assert.equal(failure(() => prepareSpecCapture({ spec: "[", step: "after" })).error.code, "INVALID_YAML");
});

test("unknown step fails without inventing a criterion or artifact", () => {
  const result = failure(() => prepareSpecCapture({ spec: single, step: "missing" }));
  assert.deepEqual(Object.keys(result).sort(), ["error", "result", "step"]);
  assert.deepEqual(result.error.issues[0].path, ["step"]);
  const invalid = failure(() => prepareSpecCapture({ spec: single, step: "after", criterion: "Not the spec criterion" }));
  assert.equal(Object.hasOwn(invalid, "criterion"), false);
});

test("invalid step names and capture fields fail before preparation", () => {
  for (const step of [undefined, "../after", "con", "__proto__", "after\n"]) {
    const result = failure(() => prepareSpecCapture({ spec: single, step }));
    assert.equal(Object.hasOwn(result, "step"), false);
    failure(() => prepareOneOffCapture({ step, criterion, config }));
  }
  for (const input of [null, [], {}, { spec: single, step: "after", actions: [] }]) failure(() => prepareSpecCapture(input));
  failure(() => prepareOneOffCapture({ step: "after", criterion, config: { actions: [] } }));
});

test("capture preparation works with all device and host built-in imports blocked", () => {
  const root = new URL("../../", import.meta.url);
  const code = `
    const { prepareSpecCapture, prepareOneOffCapture } = await import(${JSON.stringify(new URL("dist/spec/capture-input.js", root).href)});
    prepareOneOffCapture({ step: "after", criterion: "Cart", config: {} });
    prepareSpecCapture({ spec: ${JSON.stringify(multi)}, step: "after", build: ${JSON.stringify(build)} });
    for (const run of [
      () => prepareOneOffCapture({ step: "after", config: {} }),
      () => prepareSpecCapture({ spec: ${JSON.stringify(multi)}, step: "after" }),
    ]) {
      try { run(); throw new Error("Invalid capture admitted"); }
      catch (error) { if (error.result?.error.code !== "INVALID_INPUT") throw error; }
    }
    console.log("offline preparation passed");
  `;
  const output = execFileSync(process.execPath, ["--no-warnings", "--experimental-loader", fileURLToPath(new URL("test/fixtures/offline-validation-loader.mjs", root)), "--input-type=module", "--eval", code], { encoding: "utf8", timeout: 10_000 });
  assert.equal(output.trim(), "offline preparation passed");
});

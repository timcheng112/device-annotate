import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { completedCheckSchema, entryErrorSchema, summarizeStepEvaluation } from "../../dist/manifest/evaluation.js";

const root = new URL("../../", import.meta.url);
const readJSON = (file) => JSON.parse(readFileSync(new URL(file, root), "utf8"));
const example = readJSON("examples/partial-evaluation.json");
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateCheck = ajv.compile(readJSON("src/manifest/completed-check.schema.json"));
const validateError = ajv.compile(readJSON("src/manifest/entry-error.schema.json"));

test("an unresolved target preserves completed checks before and after it and dominates failure", () => {
  const summary = summarizeStepEvaluation(example.step, example.evaluation);
  assert.equal(summary.result, "error");
  assert.deepEqual(summary.checkCounts, { total: 2, passed: 1, failed: 1 });
  assert.deepEqual(summary.checks, example.evaluation.checks);
  assert.deepEqual(summary.errors, example.evaluation.errors);
});

test("a completed assertion survives a drawing error on that same entry", () => {
  const step = { annotate: [{ box: { target: 'id="total"', expect: { exists: true } } }] };
  const summary = summarizeStepEvaluation(step, {
    checks: [{ n: 1, expect: { exists: true }, actual: { exists: true }, result: "pass" }],
    errors: [{ n: 1, code: "TARGET_OFFSCREEN", message: "The box target is fully off-screen." }],
  });
  assert.equal(summary.result, "error");
  assert.deepEqual(summary.checkCounts, { total: 1, passed: 1, failed: 0 });
});

test("INFO and unresolved assertions never become passing or failing checks", () => {
  const step = { annotate: [{ marker: { target: 'id="cart"' } }], checks: [{ target: 'id="total"', expect: { visible: true } }] };
  const summary = summarizeStepEvaluation(step, { checks: [], errors: [{ n: 2, code: "TARGET_NOT_FOUND", message: "No total target found." }] });
  assert.deepEqual(summary.checkCounts, { total: 0, passed: 0, failed: 0 });
  assert.equal(summary.result, "error");
  const info = summarizeStepEvaluation({ annotate: step.annotate }, { checks: [], errors: [] });
  assert.equal(info.result, "passed");
  assert.deepEqual(info.checkCounts, summary.checkCounts);
  assert.deepEqual(summarizeStepEvaluation({}, { checks: [], errors: [] }), info);
});

for (const predicate of ["visible", "hidden", "exists", "absent", "editable", "selected", "focused", "text"]) {
  test(`completed ${predicate} results preserve actual values and determine counts`, () => {
    const expect = { [predicate]: predicate === "text" ? "Exact text" : true };
    const step = { checks: [{ target: 'id="target"', expect }] };
    for (const pass of [true, false]) {
      const actual = pass ? expect : { [predicate]: predicate === "text" ? "" : false };
      const check = { n: 1, expect, actual, result: pass ? "pass" : "fail" };
      assert.equal(completedCheckSchema.safeParse(check).success, true);
      assert.equal(validateCheck(check), true, JSON.stringify(validateCheck.errors));
      const summary = summarizeStepEvaluation(step, { checks: [check], errors: [] });
      assert.equal(summary.result, pass ? "passed" : "failed");
      assert.deepEqual(summary.checkCounts, { total: 1, passed: pass ? 1 : 0, failed: pass ? 0 : 1 });
      assert.deepEqual(summary.checks[0], check);
    }
  });
}

test("structural schemas reject malformed results and error records", () => {
  const validCheck = example.evaluation.checks[0];
  for (const check of [
    { ...validCheck, n: 0 }, { ...validCheck, actual: null }, { ...validCheck, result: "error" },
    { ...validCheck, expect: { text: "£12.00", visible: true } }, { ...validCheck, actual: { text: "£6.00", visible: true } },
  ]) {
    assert.equal(completedCheckSchema.safeParse(check).success, false);
    assert.equal(validateCheck(check), false);
  }
  for (const error of [example.evaluation.errors[0], { n: 0, code: "TARGET_NOT_FOUND", message: "No match." }, { n: 1, code: "TYPO", message: "No match." }]) {
    assert.equal(validateError(error), entryErrorSchema.safeParse(error).success);
  }
});

test("semantic validation prevents unknown numbers, duplicate counts, INFO checks, and missing results", () => {
  const mutations = [
    (report) => report.checks.push(structuredClone(report.checks[0])),
    (report) => { report.checks[0].n = 99; },
    (report) => { report.checks[0].n = 1; },
    (report) => { report.errors[0].n = 99; },
    (report) => { report.checks = []; },
    (report) => { report.errors = []; },
    (report) => { report.checks[0].expect.text = "Weakened expectation"; },
    (report) => { report.checks[0].actual = { visible: false }; },
    (report) => { report.checks[0].result = "pass"; },
  ];
  for (const mutate of mutations) {
    const report = structuredClone(example.evaluation);
    mutate(report);
    assert.throws(() => summarizeStepEvaluation(example.step, report));
  }
  const inconsistent = { ...example.evaluation.checks[0], result: "pass" };
  assert.equal(validateCheck(inconsistent), true, "structural schema cannot establish full semantic consistency");
});

test("results are ordered by entry number and share no mutable caller data", () => {
  const input = structuredClone(example.evaluation);
  input.checks.reverse();
  const original = structuredClone(input);
  const summary = summarizeStepEvaluation(example.step, input);
  assert.deepEqual(summary.checks.map((check) => check.n), [2, 4]);
  summary.checks[0].actual.text = "Changed";
  summary.errors[0].message = "Changed";
  assert.deepEqual(input, original);
});

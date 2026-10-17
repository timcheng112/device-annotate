import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { attemptSchema } from "../../dist/manifest/attempt.js";
import { manifestSchema, summarizeManifest } from "../../dist/manifest/schema.js";
import { planAttemptArtifacts } from "../../dist/manifest/artifacts.js";

const root = new URL("../../", import.meta.url);
const readJSON = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const example = readJSON("examples/manifest-ledger.json");
const current = example.criteria[0].steps[0];
const zero = { total: 0, passed: 0, failed: 0 };
// Zod emits reused types through $ref beside refinements. Ajv's strictTypes lint
// does not infer those referenced types; ordinary type validation remains enabled.
const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
const structural = ajv.compile(readJSON("src/manifest/manifest.schema.json"));
const attemptStructural = ajv.compile(readJSON("src/manifest/attempt.schema.json"));
const clone = (value = example) => structuredClone(value);
function incomplete(name = "before") {
  return { step: name, configuration: clone(current.configuration), result: "incomplete", checkCounts: { ...zero } };
}
function errorAttempt() {
  const value = clone(current);
  for (const key of ["image", "raw", "snapshot", "capturedAt", "environment"]) delete value[key];
  return { ...value, result: "error", checkCounts: { ...zero }, checks: [], error: { code: "CAPTURE_FAILED", message: "The device disconnected before a screenshot was captured." } };
}
function another(attempt, step = "before") {
  const value = clone(attempt);
  value.step = step;
  value.attemptId = "33333333-3333-4333-8333-333333333333";
  const paths = planAttemptArtifacts(valueIdentity(value));
  for (const key of ["image", "raw", "snapshot"]) if (key in value) value[key] = paths[key];
  return value;
}
function valueIdentity(value) { return { step: value.step, attemptId: value.attemptId }; }

test("manifest example preserves a current pass and a historical failure separately", () => {
  assert.deepEqual(manifestSchema.parse(example), example);
  assert.equal(structural(example), true, JSON.stringify(structural.errors));
  assert.equal(attemptStructural(current), true);
  assert.deepEqual(summarizeManifest(example).checkCounts, { total: 1, passed: 1, failed: 0 });
});

test("history never changes current outcomes or counts, even when it contains an error", () => {
  const value = clone();
  value.history = [another(errorAttempt(), "removed-step")];
  value.history[0].configuration.criterion = "Original criterion before removal";
  const result = summarizeManifest(value);
  assert.equal(result.result, "passed");
  assert.deepEqual(result.checkCounts, current.checkCounts);
  assert.deepEqual(result.history, value.history);
  value.checkCounts.total = 2;
  assert.equal(manifestSchema.safeParse(value).success, false);
});

test("current errors supersede older passes without losing the old record", () => {
  const value = clone();
  value.criteria[0].steps = [errorAttempt()];
  value.history = [another(current, "after")];
  const result = summarizeManifest(value);
  assert.equal(result.result, "error");
  assert.deepEqual(result.checkCounts, zero);
  assert.equal(result.history[0].result, "passed");
  assert.equal(Object.hasOwn(result.criteria[0].steps[0], "image"), false);
});

test("an incomplete step carries no fabricated capture identity, artifacts, or counts", () => {
  const value = clone();
  value.criteria[0].steps = [incomplete()];
  const result = summarizeManifest(value);
  assert.equal(result.result, "incomplete");
  assert.deepEqual(result.checkCounts, zero);
  for (const patch of [{ attemptId: current.attemptId }, { image: current.image }, { checkCounts: current.checkCounts }]) {
    value.criteria[0].steps = [{ ...incomplete(), ...patch }];
    assert.equal(manifestSchema.safeParse(value).success, false);
    assert.equal(structural(value), false);
  }
});

test("current result precedence is error, failed, incomplete, passed", () => {
  for (const [steps, expected] of [
    [[current], "passed"],
    [[current, incomplete()], "incomplete"],
    [[example.history[0], incomplete()], "failed"],
    [[example.history[0], another(errorAttempt())], "error"],
  ]) {
    const value = clone();
    value.history = [];
    value.criteria[0].steps = clone(steps);
    assert.equal(summarizeManifest(value).result, expected);
  }
});

test("criterion and manifest totals count current completed checks exactly once", () => {
  const value = clone();
  const second = another(example.history[0]);
  second.configuration.criterion = "Another criterion";
  value.history = [];
  value.criteria.push({ criterion: second.configuration.criterion, result: "failed", checkCounts: clone(second.checkCounts), steps: [second] });
  const result = summarizeManifest(value);
  assert.equal(result.result, "failed");
  assert.deepEqual(result.checkCounts, { total: 2, passed: 1, failed: 1 });
  const invalid = clone(result);
  invalid.criteria[0].checkCounts.total++;
  assert.equal(manifestSchema.safeParse(invalid).success, false);
});

test("attempt IDs are unique across every current and historical occurrence", () => {
  for (const edit of [
    (value) => value.history.push(clone(current)),
    (value) => value.history.push(clone(value.history[0])),
    (value) => { value.criteria[0].steps.push(another(current)); value.criteria[0].steps[1].attemptId = current.attemptId; },
  ]) {
    const value = clone(); edit(value);
    assert.equal(manifestSchema.safeParse(value).success, false);
  }
});

test("reusing a current attempt keeps its time and does not duplicate it into history", () => {
  const result = summarizeManifest(example);
  assert.deepEqual(result, example);
  assert.equal(result.criteria[0].steps[0].capturedAt, current.capturedAt);
  assert.equal(result.history.length, 1);
  result.history[0].configuration.criterion = "changed";
  assert.notEqual(example.history[0].configuration.criterion, "changed");
});

test("current steps must match their criterion while history keeps original wording", () => {
  const value = clone();
  value.history[0].configuration.criterion = "Original wording";
  assert.equal(manifestSchema.safeParse(value).success, true);
  value.criteria[0].steps[0].configuration.criterion += " changed";
  assert.equal(manifestSchema.safeParse(value).success, false);
});

test("current step names remain globally unique and one-off owners match exactly", () => {
  const value = clone();
  value.criteria.push({ criterion: current.configuration.criterion, result: "incomplete", checkCounts: { ...zero }, steps: [incomplete("after")] });
  assert.equal(manifestSchema.safeParse(value).success, false);
  const oneOff = clone();
  oneOff.owner = { kind: "one-off", step: "after" };
  assert.equal(manifestSchema.safeParse(oneOff).success, true);
  oneOff.owner.step = "before";
  assert.equal(manifestSchema.safeParse(oneOff).success, false);
});

test("multi-step current evidence requires complete shared build and environment identity", () => {
  const value = clone();
  value.criteria[0].steps.push(incomplete());
  assert.doesNotThrow(() => summarizeManifest(value));
  delete value.criteria[0].steps[0].build;
  assert.throws(() => summarizeManifest(value));
  const partial = clone();
  partial.criteria[0].steps[0].environment.display.appearance = null;
  partial.criteria[0].steps[0].environment.unavailable.push({ path: ["display", "appearance"], message: "Appearance query failed." });
  assert.equal(manifestSchema.safeParse(partial).success, true, "fresh single-step attempt may have partial metadata");
  partial.criteria[0].steps.push(incomplete());
  assert.throws(() => summarizeManifest(partial));
  for (const change of [
    (attempt) => { attempt.build.native = "other-build"; },
    (attempt) => { attempt.environment.display.appearance = "dark"; },
  ]) {
    const mismatch = clone();
    const second = another(current); change(second);
    mismatch.criteria[0].steps.push(second);
    assert.throws(() => summarizeManifest(mismatch));
  }
});

test("terminal errors preserve completed checks while permitting unevaluated remaining checks", () => {
  const value = clone(current);
  value.configuration.checks.push({ target: 'id="next"', expect: { visible: true } });
  value.result = "error";
  value.error = { code: "ARTIFACT_SAVE_FAILED", message: "Snapshot write failed." };
  assert.equal(attemptSchema.safeParse(value).success, true);
  assert.deepEqual(attemptSchema.parse(value).checkCounts, { total: 1, passed: 1, failed: 0 });
  delete value.error;
  assert.equal(attemptSchema.safeParse(value).success, false);
});

test("interrupted attempts still reject contradictory and invented check results", () => {
  for (const edit of [
    (value) => { value.checks[0].actual.text = "different"; },
    (value) => { value.checks[0].n = 99; },
    (value) => { value.checkCounts.total = 99; },
  ]) {
    const value = clone(current); value.result = "error"; value.error = { code: "CAPTURE_FAILED", message: "Interrupted." }; edit(value);
    assert.equal(attemptSchema.safeParse(value).success, false);
  }
});

test("successful assertion-free captures explicitly report zero checks", () => {
  const value = clone(current);
  value.configuration.checks = []; value.checks = []; value.checkCounts = { ...zero };
  assert.equal(attemptSchema.safeParse(value).success, true);
});

test("attempts require real capture provenance and truthful outcome/error fields", () => {
  for (const edit of [
    (value) => { delete value.image; }, (value) => { delete value.raw; }, (value) => { delete value.snapshot; },
    (value) => { delete value.environment; }, (value) => { delete value.capturedAt; },
    (value) => { value.result = "error"; },
    (value) => { value.result = "failed"; },
    (value) => { value.configuration.crop = { targets: ["z", "a", "z"], padding: 24 }; },
    (value) => { value.environment.display.appearance = null; },
    (value) => { value.raw = value.raw.replace("/after/", "/other/"); },
  ]) {
    const value = clone(current); edit(value);
    assert.equal(attemptSchema.safeParse(value).success, false);
  }
  assert.equal(attemptSchema.safeParse(errorAttempt()).success, true);
});

for (const stamp of ["2026-02-30T00:00:00.000Z", "2026-10-18T25:00:00.000Z", "not a date", "2026-10-18T00:00:00Z", "2026-10-18T00:00:00.000Z\n"]) {
  test(`attempt timestamps reject ${JSON.stringify(stamp)}`, () => {
    assert.equal(attemptSchema.safeParse({ ...current, attemptedAt: stamp }).success, false);
  });
}

test("capture time cannot precede attempt start", () => {
  assert.equal(attemptSchema.safeParse({ ...current, capturedAt: "2026-10-17T23:59:59.000Z" }).success, false);
});

test("structural schema rejects unknown versions, malformed records, and incomplete history", () => {
  for (const edit of [
    (value) => { value.schemaVersion = 2; }, (value) => { value.extra = true; },
    (value) => { value.history = [incomplete()]; }, (value) => { value.criteria = []; },
    (value) => { value.criteria[0].steps = []; }, (value) => { delete value.history; },
    (value) => { value.owner.specPath = 42; }, (value) => { value.retention.maxBytes = "100"; },
    (value) => { value.criteria[0].steps[0].recordings = [42]; },
    (value) => { value.checkCounts.total = "1"; },
  ]) {
    const value = clone(); edit(value);
    assert.equal(structural(value), false);
    assert.equal(manifestSchema.safeParse(value).success, false);
  }
  const contradictory = clone(); contradictory.checkCounts.total = 99;
  assert.equal(structural(contradictory), true);
  assert.equal(manifestSchema.safeParse(contradictory).success, false);
});

test("manifest validation and summarization work with host and device imports blocked", () => {
  const code = `
    const { manifestSchema, summarizeManifest } = await import(${JSON.stringify(new URL("dist/manifest/schema.js", root).href)});
    const example = ${JSON.stringify(example)};
    if (!manifestSchema.safeParse(example).success) throw new Error("Valid manifest rejected");
    const result = summarizeManifest(example);
    if (result.result !== "passed" || result.checkCounts.total !== 1 || result.history.length !== 1) throw new Error("History polluted current summary");
    console.log("offline manifest passed");
  `;
  assert.equal(execFileSync(process.execPath, ["--no-warnings", "--experimental-loader", fileURLToPath(new URL("test/fixtures/offline-validation-loader.mjs", root)), "--input-type=module", "--eval", code], { encoding: "utf8", timeout: 10_000 }).trim(), "offline manifest passed");
});

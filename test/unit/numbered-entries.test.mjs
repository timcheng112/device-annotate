import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { numberStepEntries } from "../../dist/spec/numbered-entries.js";

const readJSON = (file) => JSON.parse(readFileSync(new URL(`../../examples/${file}.json`, import.meta.url), "utf8"));
const example = readJSON("numbering");

test("annotations including INFO precede standalone absence and hidden checks", () => {
  const result = numberStepEntries(example);
  assert.deepEqual(result, [
    { n: 1, kind: "annotation", annotation: example.annotate[0] },
    { n: 2, kind: "annotation", annotation: example.annotate[1] },
    { n: 3, kind: "check", check: example.checks[0] },
    { n: 4, kind: "check", check: example.checks[1] },
  ]);
  assert.equal(Object.hasOwn(result[0].annotation.marker, "expect"), false);
  for (const entry of result) {
    assert.equal(Object.hasOwn(entry, "result"), false, "numbering must not manufacture check outcomes");
    assert.equal(Object.hasOwn(entry, "rect"), false, "numbering does not imply a drawable target");
  }
});

test("numbering restarts at one for every step, including check-only steps", () => {
  assert.deepEqual(numberStepEntries({}), []);
  assert.deepEqual(numberStepEntries({ annotate: [], checks: [] }), []);
  assert.deepEqual(numberStepEntries({ checks: example.checks }).map((entry) => entry.n), [1, 2]);
  assert.deepEqual(numberStepEntries({ annotate: example.annotate }).map((entry) => entry.n), [1, 2]);
  assert.deepEqual(numberStepEntries(example), numberStepEntries(example));
});

test("all primitives and predicates keep their array order regardless of object key order", () => {
  const annotate = readJSON("annotations");
  const checks = readJSON("checks");
  const result = numberStepEntries({ checks, annotate });
  assert.deepEqual(result.map((entry) => entry.n), Array.from({ length: annotate.length + checks.length }, (_, index) => index + 1));
  assert.deepEqual(result.filter((entry) => entry.kind === "annotation").map((entry) => entry.annotation), annotate);
  assert.deepEqual(result.filter((entry) => entry.kind === "check").map((entry) => entry.check), checks);
  assert.deepEqual(result, numberStepEntries({ annotate, checks }));
});

test("repeated target selectors retain individual numbers for later grouped tags", () => {
  const target = 'id="cart-total"';
  const result = numberStepEntries({
    annotate: [{ marker: { target } }, { box: { target, expect: { text: "£12.00" } } }],
    checks: [{ target, expect: { visible: true } }, { target, expect: { exists: true } }],
  });
  assert.deepEqual(result.map((entry) => entry.n), [1, 2, 3, 4]);
  assert.equal(result.length, 4, "sharing a target never merges legend entries");
});

test("changing entry order changes its number, while crop changes do not", () => {
  const reordered = numberStepEntries({ annotate: [...example.annotate].reverse(), checks: [...example.checks].reverse() });
  assert.deepEqual(reordered[0].annotation, example.annotate[1]);
  assert.deepEqual(reordered[2].check, example.checks[1]);
  assert.deepEqual(numberStepEntries({ ...example, crop: null }), numberStepEntries({ ...example, crop: { targets: ['id="cart"'], padding: 0 } }));
});

test("numbered entries do not mutate or share mutable input data", () => {
  const input = structuredClone(example);
  const result = numberStepEntries(input);
  assert.deepEqual(input, example);
  result[0].annotation.marker.text = "Changed label";
  result[1].annotation.box.expect.text = "Changed text";
  result[2].check.expect.absent = false;
  assert.deepEqual(input, example);
});

test("invalid entry definitions fail before any numbered list is returned", () => {
  assert.throws(() => numberStepEntries({ annotate: [{ box: { target: "" } }], checks: example.checks }));
  assert.throws(() => numberStepEntries({ checks: [{ target: 'id="cart"', expect: { visible: true, exists: true } }] }));
});

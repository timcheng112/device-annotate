import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { attemptIdSchema, attemptArtifactsSchema, planAttemptArtifacts, referencedAttemptArtifacts } from "../../dist/manifest/artifacts.js";

const root = new URL("../../", import.meta.url);
const example = JSON.parse(readFileSync(new URL("examples/attempt-artifacts.json", root), "utf8"));
const jsonSchema = new Ajv2020({ strict: true, allErrors: true }).compile(JSON.parse(readFileSync(new URL("src/manifest/attempt-artifacts.schema.json", root), "utf8")));
const identity = { step: example.step, attemptId: example.attemptId };
const nextId = "22222222-2222-4222-a222-222222222222";
const kinds = ["image", "raw", "snapshot"];

test("artifact example agrees with planned paths and structural validation", () => {
  const { directory, ...paths } = planAttemptArtifacts(identity);
  assert.equal(directory, `attempts/${identity.step}/${identity.attemptId}`);
  assert.deepEqual({ ...identity, ...paths }, example);
  assert.deepEqual(attemptArtifactsSchema.parse(example), example);
  assert.equal(jsonSchema(example), true, JSON.stringify(jsonSchema.errors));
});

test("every partial artifact combination preserves only recorded files", () => {
  for (let mask = 0; mask < 8; mask++) {
    const selected = kinds.filter((_, index) => mask & (1 << index));
    const record = { ...identity, ...Object.fromEntries(selected.map((kind) => [kind, example[kind]])) };
    assert.deepEqual(attemptArtifactsSchema.parse(record), record);
    assert.equal(jsonSchema(record), true);
    assert.deepEqual(referencedAttemptArtifacts(record), selected.map((kind) => ({ kind, path: example[kind] })));
  }
});

test("new attempts receive different paths while earlier references remain intact", () => {
  const original = structuredClone(example);
  const next = planAttemptArtifacts({ ...identity, attemptId: nextId });
  for (const kind of kinds) assert.notEqual(next[kind], example[kind]);
  assert.deepEqual(example, original);
  assert.deepEqual(referencedAttemptArtifacts(example), kinds.map((kind) => ({ kind, path: example[kind] })));
});

for (const [name, id] of [
  ["missing", undefined], ["empty", ""], ["timestamp", "2026-10-16T00:00:00Z"],
  ["nil", "00000000-0000-0000-0000-000000000000"],
  ["version 1", "11111111-1111-1111-8111-111111111111"],
  ["invalid variant", "11111111-1111-4111-7111-111111111111"],
  ["uppercase", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"],
  ["newline", `${identity.attemptId}\n`], ["slash", `../${identity.attemptId}`],
  ["extra suffix", `${identity.attemptId}.old`],
]) {
  test(`attempt identity rejects ${name}`, () => {
    assert.equal(attemptIdSchema.safeParse(id).success, false);
    assert.throws(() => planAttemptArtifacts({ step: "after", attemptId: id }));
    const value = { ...identity, attemptId: id };
    assert.equal(attemptArtifactsSchema.safeParse(value).success, false);
    assert.equal(jsonSchema(value), false);
  });
}

test("all UUID v4 variants and portable step names remain valid", () => {
  for (const variant of ["8", "9", "a", "b"]) {
    const id = `abcdefab-cdef-4abc-${variant}def-abcdefabcdef`;
    assert.equal(attemptIdSchema.safeParse(id).success, true);
    for (const step of ["a", "cart-total_2", "a".repeat(64)]) {
      const { directory, ...paths } = planAttemptArtifacts({ step, attemptId: id });
      assert.equal(directory, `attempts/${step}/${id}`);
      assert.equal(attemptArtifactsSchema.safeParse({ step, attemptId: id, ...paths }).success, true);
    }
  }
});

for (const step of ["../after", "After", "con", "__proto__", "a".repeat(65), "after\n"]) {
  test(`artifact identity rejects step ${JSON.stringify(step)}`, () => {
    assert.throws(() => planAttemptArtifacts({ ...identity, step }));
    assert.equal(attemptArtifactsSchema.safeParse({ ...identity, step }).success, false);
    assert.equal(jsonSchema({ ...identity, step }), false);
  });
}

for (const [name, path] of [
  ["absolute", `/${example.image}`],
  ["Windows absolute", `C:/${example.image}`],
  ["backslashes", example.image.replaceAll("/", "\\")],
  ["parent traversal", example.image.replace("/after/", "/after/../before/")],
  ["dot alias", example.image.replace("/after/", "/./after/")],
  ["repeated separator", example.image.replace("/after/", "//after/")],
  ["URL encoding", example.image.replace("/after/", "/%2e%2e/")],
  ["URL", `file:///${example.image}`],
  ["NUL", `${example.image}\0`],
  ["trailing newline", `${example.image}\n`],
  ["unexpected suffix", `${example.image}.old`],
  ["external recording", "recordings/cart.mp4"],
  ["wrong artifact role", example.raw],
  ["caller file under attempt directory", example.image.replace("image.png", "clip.mp4")],
]) {
  test(`artifact references reject ${name}`, () => {
    const record = { ...identity, image: path };
    assert.equal(attemptArtifactsSchema.safeParse(record).success, false);
    assert.equal(jsonSchema(record), false);
    assert.throws(() => referencedAttemptArtifacts(record));
  });
}

test("complete validation binds references to their exact step and attempt", () => {
  for (const [kind, path] of [
    ["image", example.image.replace("/after/", "/before/")],
    ["raw", example.raw.replace(identity.attemptId, nextId)],
    ["snapshot", example.snapshot.replace("/after/", "/con/")],
  ]) {
    const record = { ...identity, [kind]: path };
    assert.equal(jsonSchema(record), true, "structural validation cannot compare sibling values");
    const result = attemptArtifactsSchema.safeParse(record);
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues[0].path, [kind]);
  }
});

test("caller recordings, arbitrary metadata, and null paths cannot become managed artifacts", () => {
  for (const record of [
    { ...identity, recordings: ["external.mp4"] },
    { ...identity, directory: planAttemptArtifacts(identity).directory },
    { ...identity, image: null },
    { ...identity, raw: { path: example.raw } },
  ]) {
    assert.equal(attemptArtifactsSchema.safeParse(record).success, false);
    assert.equal(jsonSchema(record), false);
  }
});

test("artifact validation and enumeration preserve caller data", () => {
  const input = structuredClone(example);
  const parsed = attemptArtifactsSchema.parse(input);
  parsed.image = "changed";
  const references = referencedAttemptArtifacts(input);
  references[0].path = "changed";
  assert.deepEqual(input, example);
});

test("artifact planning and validation work with host and device imports blocked", () => {
  const code = `
    const { attemptArtifactsSchema, planAttemptArtifacts, referencedAttemptArtifacts } = await import(${JSON.stringify(new URL("dist/manifest/artifacts.js", root).href)});
    const example = ${JSON.stringify(example)};
    const identity = ${JSON.stringify(identity)};
    if (planAttemptArtifacts(identity).image !== example.image) throw new Error("Wrong path");
    if (referencedAttemptArtifacts(identity).length !== 0) throw new Error("Invented artifacts");
    if (!attemptArtifactsSchema.safeParse(example).success) throw new Error("Valid record rejected");
    if (attemptArtifactsSchema.safeParse({ ...example, image: "../external.png" }).success) throw new Error("Traversal accepted");
    console.log("offline artifacts passed");
  `;
  assert.equal(execFileSync(process.execPath, ["--no-warnings", "--experimental-loader", fileURLToPath(new URL("test/fixtures/offline-validation-loader.mjs", root)), "--input-type=module", "--eval", code], { encoding: "utf8", timeout: 10_000 }).trim(), "offline artifacts passed");
});

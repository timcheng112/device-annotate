import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { outputOwnerSchema, assertOutputOwner } from "../../dist/manifest/owner.js";
import { identifySpecOwner } from "../../dist/capture/owner.js";

const exported = JSON.parse(await readFile(new URL("../../src/manifest/owner.schema.json", import.meta.url), "utf8"));
const validateJSON = new Ajv2020({ strict: true, allErrors: true }).compile(exported);
const cart = { kind: "spec", specPath: path.resolve("/fixtures/cart.yaml") };
const checkout = { kind: "spec", specPath: path.resolve("/fixtures/checkout.yaml") };
const oneOff = { kind: "one-off", step: "after" };
for (const [name, owner, valid] of [
  ["spec", cart, true], ["one-off", oneOff, true],
  ["missing kind", { specPath: cart.specPath }, false], ["unknown kind", { kind: "unknown" }, false],
  ["missing spec path", { kind: "spec" }, false], ["blank spec path", { kind: "spec", specPath: " " }, false],
  ["invalid step name", { kind: "one-off", step: "../after" }, false],
  ["mixed owner", { ...cart, step: "after" }, false], ["unknown field", { ...oneOff, extra: true }, false],
]) {
  test(`output owner schema: ${name}`, () => {
    assert.equal(outputOwnerSchema.safeParse(owner).success, valid);
    assert.equal(validateJSON(owner), valid, JSON.stringify(validateJSON.errors));
  });
}

test("a verified unowned folder and a matching owner are admitted without mutation", () => {
  for (const owner of [cart, oneOff]) {
    const original = structuredClone(owner);
    assert.doesNotThrow(() => assertOutputOwner(undefined, owner));
    assert.doesNotThrow(() => assertOutputOwner({ owner: structuredClone(owner), criteria: [] }, owner));
    assert.deepEqual(owner, original);
  }
});

test("different specs, one-off names, and owner kinds cannot share a folder", () => {
  for (const [existing, requested] of [[cart, checkout], [cart, oneOff], [oneOff, cart], [oneOff, { kind: "one-off", step: "before" }]]) {
    const original = structuredClone(existing);
    assert.throws(() => assertOutputOwner({ owner: existing }, requested), (error) => {
      assert.equal(error.result.result, "error");
      assert.equal(error.result.error.code, "OUTPUT_OWNER_MISMATCH");
      assert.match(error.message, /Choose another output folder/);
      const result = JSON.parse(JSON.stringify(error));
      assert.equal(Object.hasOwn(result, "image"), false);
      return true;
    });
    assert.deepEqual(existing, original);
  }
});

test("invalid saved ownership is refused rather than treated as an unowned folder", () => {
  for (const existing of [null, {}, [], { owner: undefined }, { owner: null }, { owner: { kind: "spec" } }, { owner: { ...cart, unknown: true } }]) {
    assert.throws(() => assertOutputOwner(existing, cart), (error) => error.result.error.code === "OUTPUT_OWNER_INVALID");
  }
});

test("invalid requested ownership is rejected even when the folder has no owner", () => {
  assert.throws(() => assertOutputOwner(undefined, { kind: "one-off", step: "../after" }));
});

async function fixture(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), "device-proof-owner-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const specPath = path.join(cwd, "cart.yaml");
  await writeFile(specPath, "# fixture spec path; YAML parsing is separate\n");
  return { cwd, specPath };
}

test("symlink and lexical aliases of a spec resolve to the same owner", async (t) => {
  const { cwd, specPath } = await fixture(t);
  const alias = path.join(cwd, "alias.yaml");
  await symlink("cart.yaml", alias);
  const expected = { kind: "spec", specPath: await realpath(specPath) };
  assert.deepEqual(await identifySpecOwner(specPath), expected);
  assert.deepEqual(await identifySpecOwner(alias), expected);
  assert.deepEqual(await identifySpecOwner(path.join(cwd, ".", "cart.yaml")), expected);
  assert.doesNotThrow(() => assertOutputOwner({ owner: expected }, expected));
});

test("editing spec contents preserves ownership while a separate copy has another owner", async (t) => {
  const { cwd, specPath } = await fixture(t);
  const original = await identifySpecOwner(specPath);
  await writeFile(specPath, "# changed criterion\n");
  assert.deepEqual(await identifySpecOwner(specPath), original);
  const other = path.join(cwd, "checkout.yaml");
  await writeFile(other, await readFile(specPath));
  const requested = await identifySpecOwner(other);
  assert.throws(() => assertOutputOwner({ owner: original }, requested), (error) => error.result.error.code === "OUTPUT_OWNER_MISMATCH");
});

test("missing and directory spec paths produce structured errors", async (t) => {
  const { cwd } = await fixture(t);
  for (const file of [path.join(cwd, "missing.yaml"), cwd]) {
    await assert.rejects(identifySpecOwner(file), (error) => {
      assert.equal(error.result.error.code, "SPEC_UNAVAILABLE");
      assert.deepEqual(error.result.error.issues[0].path, ["spec"]);
      return true;
    });
  }
  await assert.rejects(identifySpecOwner("relative.yaml"));
});

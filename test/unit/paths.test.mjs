import assert from "node:assert/strict";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { resolveArgumentPath, resolveSpecPaths } from "../../dist/cli/paths.js";
import { specSchema } from "../../dist/spec/schema.js";

// These directories are deliberately hypothetical; resolution must not require them to exist.
const project = path.resolve("/device-proof-path-tests/project");
const specPath = path.join(project, "specs", "cart.yaml");
const spec = { criteria: [{ criterion: "Cart is visible", steps: { cart: {} } }] };

test("YAML out resolves beside the spec regardless of the invocation directory", () => {
  const expected = { specPath, outDir: path.join(project, "specs/evidence/cart") };
  const inputs = [
    { cwd: project, specPath: "specs/cart.yaml", out: "evidence/cart" },
    { cwd: path.join(project, "specs"), specPath: "cart.yaml", out: "evidence/cart" },
    { cwd: path.dirname(project), specPath, out: "evidence/cart" },
  ];
  for (const input of inputs) {
    const original = structuredClone(input);
    assert.deepEqual(resolveSpecPaths(input), expected);
    assert.deepEqual(input, original);
  }
});

test("default output uses the spec basename without its final extension", () => {
  for (const [file, name] of [["cart.yaml", "cart"], ["cart.yml", "cart"], ["cart.checkout.yaml", "cart.checkout"], ["cart", "cart"], ["Cart flow.yaml", "Cart flow"]]) {
    assert.equal(resolveSpecPaths({ cwd: project, specPath: `specs/${file}` }).outDir, path.join(project, "specs/evidence", name));
  }
});

test("absolute output paths and explicit parent-relative output paths are respected", () => {
  const absoluteOut = path.resolve("/device-proof-path-tests/other-output");
  assert.equal(resolveSpecPaths({ cwd: project, specPath, out: absoluteOut }).outDir, absoluteOut);
  assert.equal(resolveSpecPaths({ cwd: project, specPath, out: "../evidence/cart" }).outDir, path.join(project, "evidence/cart"));
});

test("CLI path arguments use the invocation directory", () => {
  assert.equal(resolveArgumentPath("evidence/cart.png", project), path.join(project, "evidence/cart.png"));
  assert.equal(resolveArgumentPath("build/identity.json", project), path.join(project, "build/identity.json"));
  assert.equal(resolveArgumentPath(specPath, project), specPath);
});

test("path resolution preserves spaces and treats shell-looking text literally", () => {
  for (const value of [" output folder ", "~/evidence", "$HOME/evidence"]) {
    assert.equal(resolveArgumentPath(value, project), path.join(project, value));
    assert.equal(resolveSpecPaths({ cwd: project, specPath, out: value }).outDir, path.join(project, "specs", value));
  }
});

test("path resolution rejects invalid values before resolving them", () => {
  for (const value of ["", " \t\n", "evidence\u0000/cart", null, 42]) {
    assert.throws(() => resolveArgumentPath(value, project));
    for (const field of ["specPath", "out", "cwd"]) {
      assert.throws(() => resolveSpecPaths({ cwd: project, specPath, [field]: value }), (error) => {
        assert.ok(error.issues.some((issue) => issue.path[0] === field));
        return true;
      });
    }
  }
  assert.throws(() => resolveArgumentPath("evidence", "relative-cwd"));
  assert.throws(() => resolveSpecPaths({ cwd: "relative-cwd", specPath }));
});

test("root schema and exported schema reject unusable output paths with a field location", () => {
  const exported = JSON.parse(readFileSync(new URL("../../src/spec/spec.schema.json", import.meta.url), "utf8"));
  const validateJSON = new Ajv2020({ strict: true, allErrors: true }).compile(exported);
  for (const out of ["", " \t\n", "evidence\u0000/cart"]) {
    const result = specSchema.safeParse({ ...spec, out });
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues[0].path, ["out"]);
    assert.equal(validateJSON({ ...spec, out }), false);
  }
});

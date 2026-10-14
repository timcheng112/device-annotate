import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { buildIdentitySchema } from "../../dist/spec/build-identity.js";

const root = new URL("../../", import.meta.url);
const example = (name) => JSON.parse(readFileSync(new URL(`examples/build.${name}.json`, root), "utf8"));
const embedded = example("embedded");
const external = example("external");
const jsonSchema = JSON.parse(readFileSync(new URL("src/spec/build.schema.json", root), "utf8"));
const validateJSON = new Ajv2020({ strict: true, allErrors: true }).compile(jsonSchema);

const cases = [
  ["embedded example", embedded, true],
  ["external example", external, true],
  ["content hashes", { ...external, native: `sha256:${"a".repeat(64)}`, runtime: { kind: "external", revision: `sha256:${"b".repeat(64)}` } }, true],
  ["opaque identifiers are preserved", { ...embedded, native: " ci:Build/ABC+123 " }, true],
  ["missing identity", undefined, false],
  ["null identity", null, false],
  ["array instead of object", [embedded], false],
  ["missing app", { native: embedded.native, runtime: embedded.runtime }, false],
  ["empty app", { ...embedded, appId: "" }, false],
  ["blank app", { ...embedded, appId: " \n\t" }, false],
  ["missing native identity", { appId: embedded.appId, runtime: embedded.runtime }, false],
  ["numeric native identity", { ...embedded, native: 123 }, false],
  ["blank native identity", { ...embedded, native: "\u00a0\n" }, false],
  ["missing runtime declaration", { appId: embedded.appId, native: embedded.native }, false],
  ["null runtime declaration", { ...embedded, runtime: null }, false],
  ["missing runtime kind", { ...embedded, runtime: {} }, false],
  ["unsupported runtime kind", { ...embedded, runtime: { kind: "metro" } }, false],
  ["embedded runtime with a stray revision", { ...embedded, runtime: { kind: "embedded", revision: "bundle-1" } }, false],
  ["external runtime without revision", { ...embedded, runtime: { kind: "external" } }, false],
  ["external runtime with empty revision", { ...embedded, runtime: { kind: "external", revision: "" } }, false],
  ["external runtime with blank revision", { ...embedded, runtime: { kind: "external", revision: " \n\t" } }, false],
  ["external runtime with numeric revision", { ...embedded, runtime: { kind: "external", revision: 42 } }, false],
  ["typo in field name", { ...embedded, nativ: "other-build" }, false],
  ["unknown nested field", { ...external, runtime: { ...external.runtime, url: "http://localhost:8081" } }, false],
  ["actions are rejected", { ...embedded, actions: [{ tap: "Continue" }] }, false],
];

for (const [name, value, valid] of cases) {
  test(`build identity: ${name}`, () => {
    const original = structuredClone(value);
    const parsed = buildIdentitySchema.safeParse(value);
    assert.equal(parsed.success, valid, parsed.success ? "unexpected success" : parsed.error.message);
    assert.equal(validateJSON(value), valid, JSON.stringify(validateJSON.errors));
    assert.deepEqual(value, original, "validation must not modify caller input");
    if (parsed.success) assert.deepEqual(parsed.data, original, "identity strings must remain verbatim");
  });
}

test("incomplete external identity reports the missing field", () => {
  const result = buildIdentitySchema.safeParse({ ...embedded, runtime: { kind: "external" } });
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues.map((issue) => issue.path), [["runtime", "revision"]]);
});

test("validation works with device-client and all built-in module imports blocked", () => {
  const schemaURL = new URL("dist/spec/build-identity.js", root).href;
  const checkSchemaURL = new URL("dist/spec/check.js", root).href;
  const loader = fileURLToPath(new URL("test/fixtures/offline-validation-loader.mjs", root));
  const code = `
    // Verify that the guard is active before exercising the validator.
    for (const name of ["node:net", "node:fs", "agent-device", "agent-device/selectors"]) {
      try {
        await import(name);
        throw new Error("Guard allowed " + name);
      } catch (error) {
        if (!error.message.startsWith("OFFLINE_BOUNDARY:")) throw error;
      }
    }
    const { buildIdentitySchema } = await import(${JSON.stringify(schemaURL)});
    if (!buildIdentitySchema.safeParse(${JSON.stringify(embedded)}).success) throw new Error("Valid identity rejected");
    if (buildIdentitySchema.safeParse({}).success) throw new Error("Invalid identity accepted");
    const { standaloneCheckSchema } = await import(${JSON.stringify(checkSchemaURL)});
    if (!standaloneCheckSchema.safeParse({ target: 'id="cart-total"', expect: { text: "£12.00" } }).success) throw new Error("Valid check rejected");
    if (standaloneCheckSchema.safeParse({ target: 'id="cart-total"', expect: { visible: true, selected: true } }).success) throw new Error("Combined check accepted");
    console.log("offline validation passed");
  `;
  const output = execFileSync(process.execPath, ["--no-warnings", "--experimental-loader", loader, "--input-type=module", "--eval", code], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(output.trim(), "offline validation passed");
});

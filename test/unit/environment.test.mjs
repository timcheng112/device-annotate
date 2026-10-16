import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { environmentSchema, assessEnvironment, environmentsMatch } from "../../dist/manifest/environment.js";

const root = new URL("../../", import.meta.url);
const readJSON = (file) => JSON.parse(readFileSync(new URL(file, root), "utf8"));
const complete = readJSON("examples/environment.complete.json");
const partial = readJSON("examples/environment.partial.json");
const jsonSchema = new Ajv2020({ strict: true, allErrors: true }).compile(readJSON("src/manifest/environment.schema.json"));
const fields = Object.entries(complete).filter(([group]) => group !== "unavailable")
  .flatMap(([group, values]) => Object.keys(values).map((field) => [group, field]));

test("complete and partial examples validate without changing observations", () => {
  for (const example of [complete, partial]) {
    const original = structuredClone(example);
    assert.deepEqual(environmentSchema.parse(example), original);
    assert.equal(jsonSchema(example), true, JSON.stringify(jsonSchema.errors));
    assert.deepEqual(example, original);
  }
});

test("partial observations allow fresh single-step capture and refuse multi-step capture", () => {
  assert.equal(assessEnvironment(partial, 1).captureAllowed, true);
  assert.equal(assessEnvironment(partial, 1).complete, false);
  assert.equal(assessEnvironment(partial, 2).captureAllowed, false);
  assert.equal(assessEnvironment(complete, 2).captureAllowed, true);
  assert.equal(assessEnvironment(complete, 2).complete, true);
  assert.deepEqual(assessEnvironment(partial, 1).environment.unavailable, partial.unavailable);
  for (const count of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.throws(() => assessEnvironment(complete, count));
  }
});

test("all-unknown environment remains explicit, diagnosable, and incompatible with itself", () => {
  const unknown = structuredClone(complete);
  for (const [group, field] of fields) {
    unknown[group][field] = null;
    unknown.unavailable.push({ path: [group, field], message: `Could not establish ${group}.${field}.` });
  }
  assert.equal(environmentSchema.safeParse(unknown).success, true);
  assert.equal(environmentsMatch(unknown, unknown), false);
  assert.equal(assessEnvironment(unknown, 2).captureAllowed, false);
});

test("unknown values never match known values or identical unknown records", () => {
  for (const [before, after] of [[partial, partial], [partial, complete], [complete, partial]]) {
    assert.equal(environmentsMatch(before, after), false);
  }
});

test("each nullable observation requires its own reason", () => {
  for (const [group, field] of fields) {
    const missing = structuredClone(complete);
    missing[group][field] = null;
    const parsed = environmentSchema.safeParse(missing);
    assert.equal(parsed.success, false);
    assert.ok(parsed.error.issues.some((issue) => JSON.stringify(issue.path) === JSON.stringify([group, field])));
    // Cross-field null/reason rules belong to complete semantic validation.
    assert.equal(jsonSchema(missing), true);
    missing.unavailable.push({ path: [group, field], message: "This observation was unavailable." });
    assert.equal(environmentSchema.safeParse(missing).success, true);
    assert.equal(environmentsMatch(missing, missing), false);
  }
});

test("reasons cannot be duplicated or attached to known values", () => {
  const duplicate = structuredClone(partial);
  duplicate.unavailable.push(structuredClone(partial.unavailable[0]));
  assert.equal(environmentSchema.safeParse(duplicate).success, false);
  const contradictory = structuredClone(complete);
  contradictory.unavailable.push({ path: ["display", "appearance"], message: "Unavailable." });
  assert.equal(environmentSchema.safeParse(contradictory).success, false);
});

for (const [name, edit] of [
  ["omitted field", (value) => { delete value.display.appearance; }],
  ["undefined field", (value) => { value.display.appearance = undefined; }],
  ["unknown field", (value) => { value.display.guessed = true; }],
  ["unknown root field", (value) => { value.extra = true; }],
  ["omitted reasons", (value) => { delete value.unavailable; }],
  ["blank reason", (value) => { value.unavailable = [{ path: ["display", "appearance"], message: " \n" }]; }],
  ["invalid reason path", (value) => { value.unavailable = [{ path: ["display", "unknown"], message: "Unavailable." }]; }],
  ["mixed reason path", (value) => { value.unavailable = [{ path: ["device", "appearance"], message: "Unavailable." }]; }],
  ["parent reason path", (value) => { value.unavailable = [{ path: ["display"], message: "Unavailable." }]; }],
  ["nested identity reason path", (value) => { value.unavailable = [{ path: ["device", "identity", "id"], message: "Unavailable." }]; }],
  ["incomplete identity", (value) => { delete value.device.identity.scope; }],
  ["blank identity", (value) => { value.device.identity.id = " "; }],
  ["automatic appearance", (value) => { value.display.appearance = "auto"; }],
  ["guessed rotation", (value) => { value.display.rotation = "landscape"; }],
  ["zero width", (value) => { value.display.pixelWidth = 0; }],
  ["fractional pixels", (value) => { value.display.pixelHeight = 1.5; }],
  ["unsafe pixels", (value) => { value.display.pixelWidth = Number.MAX_SAFE_INTEGER + 1; }],
  ["negative density", (value) => { value.display.pixelDensity = -1; }],
  ["unknown iOS text category", (value) => { value.display.textSize.value = "giant"; }],
  ["zero font scale", (value) => { value.display.textSize = { kind: "android-font-scale", value: 0 }; }],
  ["blank tool version", (value) => { value.versions.agentDevice = ""; }],
]) {
  test(`environment structural validation: ${name}`, () => {
    const value = structuredClone(complete);
    edit(value);
    assert.equal(environmentSchema.safeParse(value).success, false);
    assert.equal(jsonSchema(value), false, JSON.stringify(jsonSchema.errors));
  });
}

test("platform text-size representation cannot hide the precise native value", () => {
  const android = structuredClone(complete);
  android.device.platform = "android";
  android.display.textSize = { kind: "android-font-scale", value: 1.13 };
  assert.equal(environmentSchema.safeParse(android).success, true);
  const changed = structuredClone(android);
  changed.display.textSize.value = 1.14;
  assert.equal(environmentsMatch(android, changed), false);
  for (const size of [{ kind: "ios-content-size", value: "large" }, { kind: "platform-native", unit: "category", value: "large" }]) {
    assert.equal(environmentSchema.safeParse({ ...android, display: { ...android.display, textSize: size } }).success, false);
  }
  const other = structuredClone(complete);
  other.device.platform = "other-native-platform";
  other.display.textSize = { kind: "platform-native", unit: "vendor-scale", value: "125%" };
  assert.equal(environmentSchema.safeParse(other).success, true);
});

test("every changed compatibility observation prevents reuse", () => {
  for (const [group, field] of fields) {
    const changed = structuredClone(complete);
    const value = changed[group][field];
    if (field === "platform") {
      changed.device.platform = "android";
      changed.display.textSize = { kind: "android-font-scale", value: 1 };
    } else if (field === "identity") changed.device.identity.id += "-other";
    else if (field === "textSize") changed.display.textSize.value = "small";
    else if (field === "rotation") changed.display.rotation = "landscape-left";
    else if (field === "appearance") changed.display.appearance = "dark";
    else changed[group][field] = typeof value === "number" ? value + 1 : value + "-other";
    assert.equal(environmentsMatch(complete, changed), false, `${group}.${field}`);
  }
  const otherScope = structuredClone(complete);
  otherScope.device.identity.scope += "-other";
  assert.equal(environmentsMatch(complete, otherScope), false);
});

test("equality ignores object key order and never changes caller data", () => {
  const reordered = { ...complete, device: { ...complete.device, identity: { id: complete.device.identity.id, scope: complete.device.identity.scope } } };
  const original = structuredClone(reordered);
  assert.equal(environmentsMatch(complete, reordered), true);
  const result = assessEnvironment(reordered, 1);
  result.environment.device.identity.id = "changed";
  assert.deepEqual(reordered, original);
  assert.throws(() => environmentsMatch({}, complete));
});

test("environment validation and compatibility work with device and host imports blocked", () => {
  const code = `
    const { assessEnvironment, environmentsMatch } = await import(${JSON.stringify(new URL("dist/manifest/environment.js", root).href)});
    const complete = ${JSON.stringify(complete)};
    const partial = ${JSON.stringify(partial)};
    if (!environmentsMatch(complete, complete)) throw new Error("Identical complete environment rejected");
    if (environmentsMatch(partial, partial)) throw new Error("Unknown environment matched");
    if (assessEnvironment(partial, 2).captureAllowed) throw new Error("Incomplete multi-step environment admitted");
    console.log("offline environment passed");
  `;
  assert.equal(execFileSync(process.execPath, ["--no-warnings", "--experimental-loader", fileURLToPath(new URL("test/fixtures/offline-validation-loader.mjs", root)), "--input-type=module", "--eval", code], { encoding: "utf8", timeout: 10_000 }).trim(), "offline environment passed");
});

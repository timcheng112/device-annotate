import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { recordingOptionsSchema } from "../../dist/spec/recordings.js";
import { specSchema } from "../../dist/spec/schema.js";
import { prepareRecordings } from "../../dist/capture/recordings.js";

const root = new URL("../../", import.meta.url);
const readJSON = async (file) => JSON.parse(await readFile(new URL(file, root), "utf8"));
const validateJSON = new Ajv2020({ strict: true, allErrors: true }).compile(await readJSON("src/spec/recordings.schema.json"));
const cases = [
  ["omitted recordings", {}, true], ["empty recordings", { recordings: [] }, true],
  ["example", await readJSON("examples/recordings.json"), true],
  ["verbatim paths", { recordings: [" video clip.mp4 ", "../recordings/cart.mp4"] }, true],
  ["null", { recordings: null }, false], ["string", { recordings: "cart.mp4" }, false],
  ["blank path", { recordings: ["  "] }, false], ["null byte", { recordings: ["cart\u0000.mp4"] }, false],
  ["non-string path", { recordings: [42] }, false], ["unknown field", { recording: "cart.mp4" }, false],
];
for (const [label, input, valid] of cases) {
  test(`recording options: ${label}`, () => {
    const original = structuredClone(input);
    const result = recordingOptionsSchema.safeParse(input);
    assert.equal(result.success, valid);
    assert.equal(validateJSON(input), valid, JSON.stringify(validateJSON.errors));
    assert.deepEqual(input, original);
    if (result.success) assert.deepEqual(result.data.recordings, input.recordings ?? []);
  });
}

async function fixture(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), "device-proof-recordings-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  // Deliberately opaque bytes: this preflight verifies file access, not video validity.
  await writeFile(path.join(cwd, "clip.mp4"), "test-only opaque recording bytes");
  return cwd;
}

test("recordings are capture inputs, not fields in the reusable YAML spec", () => {
  const group = { criterion: "Cart is visible", steps: { cart: {} } };
  for (const input of [
    { criteria: [group], recordings: ["clip.mp4"] },
    { criteria: [{ ...group, recordings: ["clip.mp4"] }] },
    { criteria: [{ ...group, steps: { cart: { recordings: ["clip.mp4"] } } }] },
  ]) assert.equal(specSchema.safeParse(input).success, false);
});

test("preflight returns absolute references without changing or copying caller files", async (t) => {
  const cwd = await fixture(t);
  await mkdir(path.join(cwd, "nested"));
  const file = path.join(cwd, "clip.mp4");
  const before = await stat(file);
  const input = { cwd, recordings: ["clip.mp4", file, "nested/../clip.mp4"] };
  assert.deepEqual(await prepareRecordings(input), [file, file, file]);
  assert.deepEqual(input.recordings, ["clip.mp4", file, "nested/../clip.mp4"]);
  assert.equal(await readFile(file, "utf8"), "test-only opaque recording bytes");
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.deepEqual((await readdir(cwd)).sort(), ["clip.mp4", "nested"]);
  assert.deepEqual(await prepareRecordings({ cwd }), []);
});

test("all input shapes are checked before opening even the first recording", async (t) => {
  const cwd = await fixture(t);
  await assert.rejects(prepareRecordings({ cwd, recordings: ["missing.mp4", ""] }), (error) => {
    assert.deepEqual(error.issues[0].path, ["recordings", 1]);
    return true;
  });
});

test("missing files and directories fail with the attachment index and path", async (t) => {
  const cwd = await fixture(t);
  for (const name of ["missing.mp4", "."]) {
    await assert.rejects(prepareRecordings({ cwd, recordings: ["clip.mp4", name] }), (error) => {
      assert.match(error.message, /recordings\[1\]/);
      assert.ok(error.message.includes(JSON.stringify(path.resolve(cwd, name))));
      assert.ok(error.cause);
      assert.equal(error.result.error.code, "RECORDING_UNAVAILABLE");
      assert.deepEqual(error.result.error.issues[0].path, ["recordings", 1]);
      assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(error))), ["result", "error"]);
      return true;
    });
  }
});

test("unreadable files fail preflight", { skip: process.getuid?.() === 0 ? "Root bypasses file mode restrictions" : false }, async (t) => {
  const cwd = await fixture(t);
  const file = path.join(cwd, "clip.mp4");
  await chmod(file, 0);
  try {
    await assert.rejects(prepareRecordings({ cwd, recordings: [file] }), /recordings\[0\]/);
  } finally {
    await chmod(file, 0o600);
  }
});

test("symlink references preserve caller paths and broken links fail", async (t) => {
  const cwd = await fixture(t);
  await symlink("clip.mp4", path.join(cwd, "linked.mp4"));
  await symlink("missing.mp4", path.join(cwd, "broken.mp4"));
  assert.deepEqual(await prepareRecordings({ cwd, recordings: ["linked.mp4"] }), [path.join(cwd, "linked.mp4")]);
  await assert.rejects(prepareRecordings({ cwd, recordings: ["broken.mp4"] }), /recordings\[0\]/);
});

test("a FIFO is rejected without waiting for a writer", { skip: process.platform === "win32" }, async (t) => {
  const cwd = await fixture(t);
  const fifo = path.join(cwd, "pipe.mp4");
  execFileSync("mkfifo", [fifo]);
  const moduleURL = new URL("dist/capture/recordings.js", root).href;
  const code = `
    import { prepareRecordings } from ${JSON.stringify(moduleURL)};
    try {
      await prepareRecordings(${JSON.stringify({ cwd, recordings: [fifo] })});
      process.exitCode = 1;
    } catch (error) {
      if (!error.message.includes("recordings[0]")) throw error;
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", code], { timeout: 3000 });
});

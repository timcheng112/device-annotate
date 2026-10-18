import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validate } from "device-annotate";

const root = new URL("../../", import.meta.url);
const bin = fileURLToPath(new URL("bin/device-annotate.mjs", root));
const loader = fileURLToPath(new URL("test/fixtures/no-device-loader.mjs", root));
const example = readFileSync(new URL("examples/cart.yaml", root), "utf8");
const run = (args, cwd) => spawnSync(process.execPath, ["--no-warnings", "--experimental-loader", loader, bin, ...args], { cwd, encoding: "utf8", timeout: 5000 });

function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), "device-annotate-validate-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

test("validate CLI and Node API return the same normalized result without creating evidence", (t) => {
  const cwd = fixture(t);
  writeFileSync(path.join(cwd, "cart flow.yaml"), example);
  const result = run(["validate", "cart flow.yaml"], cwd);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), validate(example));
  assert.deepEqual(readdirSync(cwd), ["cart flow.yaml"]);
});

test("CLI reports YAML and semantic errors as JSON with exit 2 and readable field diagnostics", (t) => {
  const cwd = fixture(t);
  for (const source of ["criteria: [", "criteria: []\ntap: cart\n"]) {
    writeFileSync(path.join(cwd, "invalid.yaml"), source);
    const result = run(["validate", "invalid.yaml"], cwd);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), validate(source));
    assert.match(result.stderr, /INVALID_(YAML|INPUT)/);
    assert.match(result.stderr, / at \d+:\d+:/);
  }
});

test("CLI distinguishes file failures, including invalid UTF-8 and directories", (t) => {
  const cwd = fixture(t);
  writeFileSync(path.join(cwd, "bad-encoding.yaml"), Buffer.from([0xff, 0xfe, 0xff]));
  for (const file of ["missing.yaml", ".", "bad-encoding.yaml"]) {
    const result = run(["validate", file], cwd);
    assert.equal(result.status, 2);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.error.code, "SPEC_UNAVAILABLE");
    assert.match(result.stderr, /readable UTF-8 spec/);
  }
});

test("CLI rejects missing/extra arguments and unsupported commands without capture", (t) => {
  const cwd = fixture(t);
  for (const args of [[], ["validate"], ["validate", "one.yaml", "two.yaml"], ["validate", "--unknown"], ["unknown-command", "cart.yaml"]]) {
    const result = run(args, cwd);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "INVALID_INPUT");
    assert.match(result.stderr, /Usage: device-annotate validate/);
  }
  assert.deepEqual(readdirSync(cwd), []);
});

test("CLI supports literal dash-prefixed paths after -- and explicit help", (t) => {
  const cwd = fixture(t);
  writeFileSync(path.join(cwd, "-cart.yaml"), example);
  assert.equal(run(["validate", "--", "-cart.yaml"], cwd).status, 0);
  const help = run(["validate", "--help"], cwd);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /validates YAML or JSON offline/);
  assert.equal(help.stderr, "");
});

test("CLI refuses a FIFO without waiting for input", { skip: process.platform === "win32" }, (t) => {
  const cwd = fixture(t);
  execFileSync("mkfifo", [path.join(cwd, "pipe.yaml")]);
  const result = run(["validate", "pipe.yaml"], cwd);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).error.code, "SPEC_UNAVAILABLE");
});

test('capture CLI rejects invalid inputs and recordings before importing device clients', (t) => {
  const cwd = fixture(t);
  const base = ['capture', '--step', 'sample', '--criterion', 'Neutral criterion', '--out', 'output'];
  for (const [args, code] of [
    [['capture', '--step', 'sample', '--out', 'output'], 'INVALID_INPUT'],
    [[...base, '--recording', 'missing.mp4'], 'RECORDING_UNAVAILABLE'],
    [[...base, '--build', 'missing.json'], 'INVALID_INPUT'],
    [[...base, '--platform', 'invalid'], 'INVALID_INPUT'],
  ]) {
    const result = run(args, cwd);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code, code);
    assert.doesNotMatch(result.stderr, /OFFLINE_BOUNDARY/);
  }
  assert.deepEqual(readdirSync(cwd), []);
});

test('all help aliases work without loading the device client or writing evidence', (t) => {
  const cwd = fixture(t);
  const reference = run(['help'], cwd);
  assert.equal(reference.status, 0, reference.stderr);
  for (const args of [['--help'], ['-h'], ['capture', '--help'], ['cleanup', '--help']]) {
    const result = run(args, cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, reference.stdout);
  }
  for (const match of reference.stdout.matchAll(/```yaml\n([\s\S]*?)```/g)) assert.equal(validate(match[1]).valid, true);
  assert.deepEqual(readdirSync(cwd), []);
});

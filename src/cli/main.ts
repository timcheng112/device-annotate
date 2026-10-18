import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { validate, type ValidationResult, type Diagnostic } from "../index.js";
import { resolveArgumentPath } from "./paths.js";

const usage = "Usage: device-proof validate <spec.yaml>\nValidates a spec offline.\ndevice-proof capture [spec.yaml] --step <name> [--platform ios|android] [--session <name>] [--build <file>] [--recording <file>]\nOne-off: --criterion <text> --box <selector> --out <folder>\ndevice-proof cleanup <folder> [--apply] [--finished]\n";

async function readAndValidate(file: string): Promise<ValidationResult> {
  let source: string;
  try {
    const absolute = resolveArgumentPath(file, process.cwd());
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) throw new Error("Expected a regular file.");
      source = new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile());
    } finally {
      await handle.close();
    }
  } catch (error) {
    return {
      valid: false,
      error: {
        code: "SPEC_UNAVAILABLE",
        message: `Cannot read spec ${JSON.stringify(file)}. Supply a readable UTF-8 spec file.`,
        issues: [{ path: ["spec"], message: error instanceof Error ? error.message : "File access failed." }],
      },
    };
  }
  return validate(source);
}

function writeDiagnostic(error: Diagnostic): void {
  process.stderr.write(`${error.code}: ${error.message}\n`);
  for (const issue of error.issues ?? []) {
    const position = issue.location ? ` at ${issue.location.line}:${issue.location.column}` : "";
    process.stderr.write(`  ${JSON.stringify(issue.path)}${position}: ${issue.message}\n`);
  }
}

const args = process.argv.slice(2);
if (args[0] === 'capture' || args[0] === 'cleanup') {
  const { captureCommand, cleanupCommand } = await import('./capture.js');
  const result = args[0] === 'capture' ? await captureCommand(args.slice(1)) : await cleanupCommand(args.slice(1));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if ('error' in result && result.error) process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
  process.exitCode = result.result === 'passed' ? 0 : result.result === 'failed' ? 1 : 2;
} else if ((args.length === 1 && ["help", "--help", "-h"].includes(args[0]!)) ||
    (args.length === 2 && args[0] === "validate" && ["--help", "-h"].includes(args[1]!))) {
  process.stdout.write(usage);
} else {
  const file = args[0] === "validate"
    ? args.length === 2 && !args[1]!.startsWith("-") ? args[1]
      : args.length === 3 && args[1] === "--" ? args[2] : undefined
    : undefined;
  const result: ValidationResult = file
    ? await readAndValidate(file)
    : { valid: false, error: { code: "INVALID_INPUT", message: usage.trimEnd() } };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.valid) writeDiagnostic(result.error);
  process.exitCode = result.valid ? 0 : 2;
}

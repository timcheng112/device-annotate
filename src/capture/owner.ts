import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { type OutputOwner } from "../manifest/owner.js";
import { PreCaptureError } from "../spec/errors.js";
import { localPathSchema } from "../spec/values.js";

const absoluteSpecPathSchema = localPathSchema.refine(isAbsolute, "Resolve the spec path to an absolute path before identifying its owner.");

/** Resolve symlink aliases before the pure ownership comparison. No device or writes. */
export async function identifySpecOwner(specPath: string): Promise<Extract<OutputOwner, { kind: "spec" }>> {
  const supplied = absoluteSpecPathSchema.parse(specPath);
  try {
    const canonical = await realpath(supplied);
    if (!(await stat(canonical)).isFile()) throw new Error("Expected a regular spec file.");
    return { kind: "spec", specPath: canonical };
  } catch (cause) {
    throw new PreCaptureError({
      result: "error",
      error: {
        code: "SPEC_UNAVAILABLE",
        message: `Cannot identify spec ${JSON.stringify(supplied)}. Supply an existing regular spec file.`,
        issues: [{ path: ["spec"], message: "The spec path could not be resolved to a regular file." }],
      },
    }, { cause });
  }
}

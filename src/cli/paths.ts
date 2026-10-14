import * as path from "node:path";
import * as z from "zod";
import { localPathSchema } from "../spec/values.js";

const cwdSchema = localPathSchema.refine(path.isAbsolute, "Supply an absolute working directory.");
const specPathsInputSchema = z.strictObject({
  cwd: cwdSchema,
  specPath: localPathSchema,
  out: localPathSchema.optional(),
});

/** Resolve CLI-supplied paths without reading process state or touching the filesystem. */
export function resolveArgumentPath(value: string, cwd: string): string {
  return path.resolve(cwdSchema.parse(cwd), localPathSchema.parse(value));
}

/** Resolve YAML output relative to the spec path supplied by the caller (T44). */
export function resolveSpecPaths(input: {
  cwd: string;
  specPath: string;
  out?: string;
}): { specPath: string; outDir: string } {
  const parsed = specPathsInputSchema.parse(input);
  const specPath = path.resolve(parsed.cwd, parsed.specPath);
  const out = parsed.out ?? path.join("evidence", path.parse(specPath).name);
  return { specPath, outDir: path.resolve(path.dirname(specPath), out) };
}

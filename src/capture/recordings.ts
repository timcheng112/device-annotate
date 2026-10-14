import { constants } from "node:fs";
import { open } from "node:fs/promises";
import * as path from "node:path";
import * as z from "zod";
import { recordingOptionsSchema, type RecordingOptionsInput } from "../spec/recordings.js";
import { localPathSchema } from "../spec/values.js";

const inputSchema = recordingOptionsSchema.extend({
  cwd: localPathSchema.refine(path.isAbsolute, "Supply an absolute working directory."),
});

/** Validate references before device access. Does not copy, annotate, or decode video. */
export async function prepareRecordings(input: RecordingOptionsInput & { cwd: string }): Promise<string[]> {
  // Validate every input before opening any file.
  const parsed = inputSchema.parse(input);
  const resolved = parsed.recordings.map((file) => path.resolve(parsed.cwd, file));
  for (const [index, file] of resolved.entries()) {
    try {
      // Nonblocking prevents a FIFO or a replaced path from hanging preflight.
      const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        if (!(await handle.stat()).isFile()) throw new Error("Expected a regular file.");
        // Probe readability without loading a potentially large recording into memory.
        await handle.read(Buffer.alloc(1), 0, 1, 0);
      } finally {
        await handle.close();
      }
    } catch (cause) {
      throw new Error(`Cannot use recordings[${index}] (${JSON.stringify(file)}). Supply an existing, readable regular video file.`, { cause });
    }
  }
  return resolved;
}

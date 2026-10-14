import * as z from "zod";
import { localPathSchema } from "./values.js";

/** Per-capture inputs, separate from the YAML spec and effective step configuration. */
export const recordingOptionsSchema = z.strictObject({
  recordings: z.array(localPathSchema).default([])
    .describe("Existing local video files attached to this capture. References only; files remain caller-owned."),
});

export type RecordingOptionsInput = z.input<typeof recordingOptionsSchema>;

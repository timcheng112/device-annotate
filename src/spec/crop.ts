import * as z from "zod";
import { selectorSchema } from "./values.js";

/** Input contract only; snapshot resolution and crop geometry follow in M2/M3. */
export const cropSchema = z.strictObject({
  targets: z.array(selectorSchema).min(1, "Supply at least one crop target, or omit crop for the full screenshot."),
  padding: z.number().int().nonnegative().default(24)
    .describe("Padding in screenshot pixels, limited to the screenshot bounds during layout."),
}).describe("Crop around these targets and all drawable annotations/checks. Raw evidence remains complete.");

export type CropInput = z.input<typeof cropSchema>;
export type Crop = z.output<typeof cropSchema>;

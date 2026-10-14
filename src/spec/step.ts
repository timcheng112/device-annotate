import * as z from "zod";
import { annotationSchema } from "./annotation.js";
import { standaloneCheckSchema } from "./check.js";
import { cropSchema } from "./crop.js";

export const defaultsSchema = z.strictObject({
  crop: cropSchema.optional(),
}).describe("Shared step defaults. Only crop is inherited in v1.");

export const stepSchema = z.strictObject({
  annotate: z.array(annotationSchema).default([]),
  checks: z.array(standaloneCheckSchema).default([]),
  crop: cropSchema.nullable().optional(),
}).describe("One capture step. Omit crop to inherit; use null for the full screenshot.");

export type DefaultsInput = z.input<typeof defaultsSchema>;
export type StepInput = z.input<typeof stepSchema>;
export type Step = z.output<typeof stepSchema>;

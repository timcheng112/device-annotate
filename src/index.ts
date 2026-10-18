export { validate, type ValidationResult } from "./spec/validate.js";
export type { Spec, SpecInput } from "./spec/schema.js";
export type { Diagnostic, DiagnosticIssue } from "./spec/errors.js";
import type { CaptureOptions } from './capture/public.js';
export type { CaptureOptions } from './capture/public.js';
export async function capture(options: CaptureOptions) {
  return (await import('./capture/public.js')).capture(options);
}
export async function cleanup(options: Parameters<typeof import('./capture/cleanup.js').cleanup>[0]) {
  return (await import('./capture/cleanup.js')).cleanup(options);
}

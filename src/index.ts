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

export type { VideoStartOptions, VideoMarkOptions, VideoFolderOptions } from './video/public.js';
export async function videoStart(options: import('./video/public.js').VideoStartOptions) {
  return (await import('./video/public.js')).startVideo(options);
}
export async function videoMark(options: import('./video/public.js').VideoMarkOptions) {
  return (await import('./video/public.js')).markVideo(options);
}
export async function videoStop(options: import('./video/public.js').VideoFolderOptions) {
  return (await import('./video/public.js')).stopVideo(options);
}
export async function videoRender(options: import('./video/public.js').VideoFolderOptions) {
  return (await import('./video/public.js')).renderVideo(options);
}

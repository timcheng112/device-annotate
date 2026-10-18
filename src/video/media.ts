import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CaptureFailure } from '../capture/failure.js';
const exec = promisify(execFile);
export async function mediaCommand(file: 'ffmpeg' | 'ffprobe', args: string[], timeout = 120_000) {
  try { return (await exec(file, args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout; }
  catch (cause) { throw new CaptureFailure('VIDEO_TOOL_FAILED', `${file} could not finish. Ensure FFmpeg with libx264 and ffprobe are on PATH, the input is playable, and disk space is available. Raw evidence was preserved.`, { cause }); }
}
export async function preflightMedia() {
  await Promise.all([mediaCommand('ffmpeg', ['-version'], 10_000), mediaCommand('ffprobe', ['-version'], 10_000)]);
}
export const sourceVideoLimits = { width: 8192, height: 8192, durationMs: 3_600_000 };
export const exportedVideoLimits = { width: 8192, height: 16384, durationMs: 3_602_000 };

export async function probeVideo(path: string, kind: 'source' | 'export' = 'source') {
  const raw = JSON.parse(await mediaCommand('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration,sample_aspect_ratio:stream_side_data=rotation:format=duration', '-of', 'json', path]));
  return validateVideoProbe(raw, kind);
}

/** Validate ffprobe metadata with distinct recording and composed-output limits. */
export function validateVideoProbe(raw: { streams?: { width?: number; height?: number; duration?: string; sample_aspect_ratio?: string; side_data_list?: { rotation?: number }[] }[]; format?: { duration?: string } }, kind: 'source' | 'export' = 'source') {
  const limits = kind === 'source' ? sourceVideoLimits : exportedVideoLimits;
  const stream = raw.streams?.[0];
  let width = stream?.width, height = stream?.height;
  const rotation = stream?.side_data_list?.find((s: { rotation?: number }) => s.rotation !== undefined)?.rotation ?? 0;
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const durationMs = Number(stream?.duration ?? raw.format?.duration) * 1000;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width === undefined || height === undefined || width < 1 || height < 1 || width > limits.width || height > limits.height || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > limits.durationMs || rotation % 90 !== 0 || (stream?.sample_aspect_ratio && !['1:1', 'N/A'].includes(stream?.sample_aspect_ratio))) {
    throw new CaptureFailure('VIDEO_UNSUPPORTED', `Video needs a playable, square-pixel stream, quarter-turn rotation, dimensions up to ${limits.width} × ${limits.height}, and duration up to ${limits.durationMs / 1000} seconds.`);
  }
  return { width: width as number, height: height as number, durationMs };
}

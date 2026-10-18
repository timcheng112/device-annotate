import { mkdtemp, writeFile, rm, link, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { checklistRenderer } from './render.js';
import { mediaCommand, probeVideo, exportedVideoLimits } from './media.js';
import { regularFile, videoDigest } from './store.js';
import type { VideoRun } from './schema.js';
import { CaptureFailure } from '../capture/failure.js';

/** Burn deterministic PNG footer states below a decoded video. Never overwrite raw evidence. */
export async function exportVideo(directory: string, run: VideoRun): Promise<NonNullable<VideoRun['export']>> {
  if (run.state !== 'stopped') throw new CaptureFailure('VIDEO_NOT_STOPPED', 'Stop recording before exporting.');
  const raw = join(directory, run.raw);
  await regularFile(raw);
  const source = await probeVideo(raw);
  const durationMs = Math.max(source.durationMs, run.stoppedMs ?? 0, ...run.marks.map(m => m.completedMs ?? m.startedMs)) + 2000;
  if (durationMs > exportedVideoLimits.durationMs) throw new CaptureFailure('VIDEO_TOO_LONG', 'Split recordings longer than one hour.');
  const times = [...new Set([0, source.durationMs, ...(run.stoppedMs === undefined ? [] : [run.stoppedMs]), ...run.marks.flatMap(m => [m.startedMs, ...(m.completedMs === undefined ? [] : [m.completedMs])])])].sort((a, b) => a - b);
  // Round up transitions to the next output frame so a result is never shown early.
  const fps = 30;
  const frameTimes = [...new Set(times.map(ms => Math.ceil(ms * fps / 1000) * 1000 / fps))];
  const width = Math.ceil(Math.max(source.width, 480) / 2) * 2;
  const screenHeight = Math.ceil(source.height * width / source.width / 2) * 2;
  const renderer = await checklistRenderer(run, width, frameTimes, source.durationMs);
  if (screenHeight + renderer.height > exportedVideoLimits.height) throw new CaptureFailure('VIDEO_LEGEND_TOO_LARGE', 'Video and checklist exceed supported output dimensions. Split this flow.');
  const work = await mkdtemp(join(directory, '.export-'));
  try {
    const list: string[] = ['ffconcat version 1.0'];
    for (const [i, time] of frameTimes.entries()) {
      await writeFile(join(work, `frame-${i}.png`), renderer.render(i).png);
      list.push(`file frame-${i}.png`, 'option framerate 30', `duration ${((frameTimes[i + 1] ?? durationMs) - time) / 1000}`);
    }
    list.push(`file frame-${frameTimes.length - 1}.png`, 'option framerate 30');
    await writeFile(join(work, 'footer.ffconcat'), list.join('\n') + '\n');
    const output = join(work, 'annotated.mp4');
    const filter = `[0:v:0]setpts=PTS-STARTPTS,scale=${width}:${screenHeight},setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${(durationMs - source.durationMs) / 1000}[screen];[1:v:0]fps=30,format=yuv420p[footer];[screen][footer]vstack=inputs=2:shortest=1[v]`;
    await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-n', '-i', raw, '-safe', '0', '-f', 'concat', '-i', join(work, 'footer.ffconcat'),
      '-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-map_metadata', '-1', '-movflags', '+faststart', '-t', String(durationMs / 1000), output], 30 * 60_000);
    const verified = await probeVideo(output, 'export');
    if (verified.width !== width || verified.height !== screenHeight + renderer.height || Math.abs(verified.durationMs - durationMs) > 100) throw new CaptureFailure('VIDEO_EXPORT_INVALID', 'The exported video dimensions or duration do not match the checklist. Raw evidence was preserved.');
    await mediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'], 30 * 60_000);
    const handle = await open(output, 'r'); try { await handle.sync(); } finally { await handle.close(); }
    // Same-volume hard-link publication is exclusive and atomic, including interrupted exports.
    try { await link(output, join(directory, 'annotated.mp4')); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      // Recover publication-before-ledger crashes only when a fresh deterministic export is identical.
      const existing = join(directory, 'annotated.mp4');
      await regularFile(existing);
      if (await videoDigest(existing) !== await videoDigest(output)) throw new CaptureFailure('VIDEO_OUTPUT_EXISTS', 'An existing annotated.mp4 differs from this export. Preserve it and choose a new recording folder; it was not overwritten.');
    }
    await unlink(output);
    return { path: 'annotated.mp4', ...verified };
  } finally { await rm(work, { recursive: true, force: true }); }
}

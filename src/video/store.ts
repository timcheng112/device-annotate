import { constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, rename, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { videoSchema, type VideoRun } from './schema.js';
import { CaptureFailure } from '../capture/failure.js';

export async function readRun(directory: string): Promise<VideoRun> {
  const handle = await open(join(directory, 'video.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Not a regular file.');
    return videoSchema.parse(JSON.parse(await handle.readFile('utf8')));
  } catch { throw new CaptureFailure('VIDEO_INVALID', 'The video ledger is invalid. Existing files were preserved.'); }
  finally { await handle.close(); }
}
export async function saveRun(directory: string, run: VideoRun) {
  const bytes = JSON.stringify(videoSchema.parse(run), null, 2) + '\n';
  const temporary = join(directory, `.video-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, join(directory, 'video.json'));
    const dir = await open(directory, constants.O_RDONLY); try { await dir.sync(); } finally { await dir.close(); }
  } finally { await unlink(temporary).catch(() => {}); }
}
export async function regularFile(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size === 0) throw new CaptureFailure('VIDEO_UNAVAILABLE', 'Expected a nonempty regular video file, not a symlink or special file.');
}

export async function videoDigest(path: string) {
  await regularFile(path);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

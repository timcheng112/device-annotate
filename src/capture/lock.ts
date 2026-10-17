import { mkdir, realpath, readdir, readlink, symlink, lstat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaptureFailure } from './failure.js';

const busy = () => new CaptureFailure('OUTPUT_BUSY', 'This evidence folder is busy. Retry after its capture or cleanup command finishes.');

/** Immutable lock generations avoid stale-lock unlink races.
 * Each atomic symlink is a complete owner record, including during process death.
 * A released or provably dead generation is superseded, never removed or overwritten.
 * No timeout can evict a live owner. Unknown or foreign-host owners fail closed.
 */
export async function lockOutput(outDir: string): Promise<{ directory: string; release(): Promise<void> }> {
  if (!isAbsolute(outDir)) throw new CaptureFailure('INVALID_INPUT', 'Supply an absolute evidence output directory.');
  await mkdir(outDir, { recursive: true });
  const directory = await realpath(outDir);
  const journal = join(directory, '.device-proof-lock');
  await mkdir(journal, { recursive: true });
  if (!(await lstat(journal)).isDirectory()) throw busy();
  const entries = await readdir(journal);
  if (entries.some((name) => !/^[1-9][0-9]*\.owner$|^[1-9][0-9]*\.released$/.test(name))) throw busy();
  const generations = entries.filter((name) => name.endsWith('.owner')).map((name) => BigInt(name.split('.')[0]!));
  const last = generations.reduce((a, b) => a > b ? a : b, 0n);
  if (last > 0n) {
    const owner = await readlink(join(journal, `${last}.owner`)).catch(() => { throw busy(); });
    const released = await readlink(join(journal, `${last}.released`)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw busy();
    });
    if (released !== owner) {
      let record: { host?: unknown; pid?: unknown };
      try { record = JSON.parse(owner) as typeof record; } catch { throw busy(); }
      if (record?.host !== hostname() || !Number.isSafeInteger(record.pid) || Number(record.pid) <= 0) throw busy();
      try { process.kill(Number(record.pid), 0); throw busy(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw busy(); }
    }
  }
  const next = last + 1n;
  const owner = JSON.stringify({ host: hostname(), pid: process.pid, nonce: randomUUID() });
  try { await symlink(owner, join(journal, `${next}.owner`)); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw busy();
    throw cause;
  }
  let released = false;
  return { directory, async release() {
    if (released) return;
    await symlink(owner, join(journal, `${next}.released`));
    released = true;
  } };
}

import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { manifestSchema, type Manifest } from '../manifest/schema.js';
import { assertOutputOwner, type OutputOwner } from '../manifest/owner.js';
import { stepNameSchema } from '../spec/step-name.js';
import { CaptureFailure } from './failure.js';

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function managedDirectory(parent: string, name: string): Promise<string> {
  const directory = join(parent, name);
  try { await mkdir(directory); await syncDirectory(parent); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if (!(await lstat(directory)).isDirectory()) throw new CaptureFailure('ARTIFACT_PATH_UNSAFE', 'A managed artifact directory is a symlink or special file. Choose a clean output folder.');
  return directory;
}

/** Caller holds lockOutput for the complete store lifetime. */
export function evidenceStore(directory: string) {
  return {
    async read(owner?: OutputOwner): Promise<Manifest | undefined> {
      let handle;
      try { handle = await open(join(directory, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
      let value: unknown;
      try {
        if (!(await handle.stat()).isFile()) throw new Error('Manifest is not a regular file.');
        value = JSON.parse(await handle.readFile('utf8'));
      } catch (cause) {
        throw new CaptureFailure('OUTPUT_OWNER_INVALID', 'The saved manifest is unreadable or malformed. Choose another output folder; existing evidence has been preserved.', { cause });
      } finally { await handle.close(); }
      if (owner) assertOutputOwner(value, owner);
      const parsed = manifestSchema.safeParse(value);
      if (!parsed.success) throw new CaptureFailure('MANIFEST_INVALID', 'The saved evidence ledger is invalid. Choose another output folder; existing evidence has been preserved.');
      return parsed.data;
    },
    async publish(manifest: Manifest): Promise<void> {
      const bytes = JSON.stringify(manifestSchema.parse(manifest), null, 2) + '\n';
      const temporary = join(directory, `.manifest-${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, join(directory, 'manifest.json'));
        await syncDirectory(directory);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      }
    },
    async allocate(step: string) {
      stepNameSchema.parse(step);
      const attempts = await managedDirectory(directory, 'attempts');
      const steps = await managedDirectory(attempts, step);
      for (let retry = 0; retry < 4; retry++) {
        const attemptId = randomUUID();
        const folder = join(steps, attemptId);
        try { await mkdir(folder, { mode: 0o700 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
        await syncDirectory(steps);
        return {
          attemptId,
          async save(kind: 'image' | 'raw' | 'snapshot', bytes: Uint8Array | string): Promise<string> {
            const name = kind === 'snapshot' ? 'snapshot.json' : `${kind}.png`;
            const handle = await open(join(folder, name), 'wx', 0o600);
            try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
            await syncDirectory(folder);
            return `attempts/${step}/${attemptId}/${name}`;
          },
        };
      }
      throw new CaptureFailure('ATTEMPT_COLLISION', 'Could not allocate a unique evidence attempt. Existing attempts were preserved.');
    },
  };
}

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CaptureFailure } from './failure.js';

/** A recording alias of the shared manifest cannot survive manifest replacement. */
export async function protectManifestRecording(directory: string, recordings: string[]): Promise<void> {
  let manifest;
  try { manifest = await stat(join(directory, 'manifest.json')); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return; throw cause; }
  for (const path of recordings) {
    let recording;
    try { recording = await stat(path); }
    catch (cause) { throw new CaptureFailure('RECORDING_IDENTITY_UNAVAILABLE', 'Restore access to referenced recordings before changing this evidence folder.', { cause }); }
    if (manifest.dev === recording.dev && manifest.ino === recording.ino) {
      throw new CaptureFailure('RECORDING_OUTPUT_CONFLICT', 'A recording aliases manifest.json. Choose another evidence folder or recording; the existing file was preserved.');
    }
  }
}

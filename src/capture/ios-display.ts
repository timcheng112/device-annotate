import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { environmentSchema } from '../manifest/environment.js';
import type { ReadProbe } from './environment.js';

const observationSchema = z.strictObject({ version: z.literal(1), orientation: environmentSchema.shape.display.shape.rotation.unwrap() });

/** One integrated panel only. Never derive directional orientation from its aspect ratio. */
export function integratedPanel(enumeration: string) {
  const connected = enumeration.split('Connected Screens:');
  if (connected.length !== 2) return undefined;
  const panels = connected[1]!.split(/\n\s*\(\d+\)/).filter(part => /Screen Type:\s*Integrated\s*(?:\n|$)/.test(part));
  if (panels.length !== 1) return undefined;
  const panel = panels[0]!;
  const dimensions = panel.match(/Pixel Size:\s*\{(\d+),\s*(\d+)\}/);
  const density = Number(panel.match(/Preferred UI Scale:\s*([\d.]+)/)?.[1]);
  if (!dimensions || !Number.isFinite(density) || density <= 0) return undefined;
  const width = Number(dimensions[1]), height = Number(dimensions[2]);
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) return undefined;
  return { width, height, density };
}

/** Compile shipped source with local Xcode, run only in the selected simulator, remove all temporary files. */
export async function simulatorInterfaceOrientation(set: string, udid: string, probe: ReadProbe) {
  const directory = await mkdtemp(join(tmpdir(), 'device-annotate-orientation-'));
  try {
    const binary = join(directory, 'orientation');
    const source = fileURLToPath(new URL('../../src/capture/ios-orientation.m', import.meta.url));
    await probe('xcrun', ['--sdk', 'iphonesimulator', 'clang', '-arch', 'arm64', '-arch', 'x86_64', '-mios-simulator-version-min=15.0', '-fobjc-arc', '-framework', 'Foundation', source, '-o', binary]);
    const raw = await probe('xcrun', ['simctl', '--set', set, 'spawn', udid, binary]);
    return observationSchema.parse(JSON.parse(raw)).orientation;
  } catch { return undefined; }
  finally { await rm(directory, { recursive: true, force: true }); }
}

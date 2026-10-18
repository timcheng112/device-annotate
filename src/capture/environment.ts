import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentDeviceSession, AgentDeviceDevice } from 'agent-device';
import { environmentSchema, type Environment } from '../manifest/environment.js';
import { integratedPanel, simulatorInterfaceOrientation } from './ios-display.js';

const exec = promisify(execFile);
export type ReadProbe = (file: string, args: string[]) => Promise<string>;
/** No shell, boot helpers, settings writes, or unbounded subprocesses. */
const readProbe: ReadProbe = async (file, args) => (await exec(file, args, { timeout: args.includes('clang') ? 30_000 : 5_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();

export async function collectEnvironment(session: AgentDeviceSession, device: AgentDeviceDevice, agentDevice: string, probe: ReadProbe = readProbe): Promise<Environment> {
  const environment: Environment = {
    device: { platform: device.platform, identity: null, osVersion: device.osVersion ?? null },
    display: { pixelWidth: null, pixelHeight: null, pixelDensity: null, rotation: null, appearance: null, textSize: null },
    versions: { deviceProof: null, agentDevice }, unavailable: [],
  };
  const query = async (file: string, args: string[]) => { try { return await probe(file, args); } catch { return ''; } };
  try {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    if (typeof pkg.version === 'string') environment.versions.deviceProof = pkg.version;
  } catch { /* Field remains unknown. */ }
  let host = (await query('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])).match(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]+)"/)?.[1];
  if (process.platform === 'linux') {
    try {
      const machine = (await readFile('/etc/machine-id', 'utf8')).trim();
      if (/^[a-f0-9]{32}$/.test(machine)) host = `linux:${machine}`;
    } catch { /* Host identity remains unknown. */ }
  }
  if (device.platform === 'ios' && device.kind === 'simulator' && session.device.ios?.udid === device.id) {
    const set = session.device.ios.simulatorSetPath ?? join(homedir(), 'Library/Developer/CoreSimulator/Devices');
    try {
      const canonical = await realpath(set);
      if (host) environment.device.identity = { scope: `apple:${host}:${canonical}`, id: device.id };
    } catch { /* Unavailable simulator set cannot establish identity. */ }
    const simctl = (...args: string[]) => query('xcrun', ['simctl', '--set', set, ...args]);
    const [display, appearance, textSize] = await Promise.all([
      simctl('io', device.id, 'enumerate'), simctl('ui', device.id, 'appearance'), simctl('ui', device.id, 'content_size'),
    ]);
    const panel = integratedPanel(display);
    if (panel) environment.display.pixelDensity = panel.density;
    if (appearance === 'light' || appearance === 'dark') environment.display.appearance = appearance;
    const size = environmentSchema.shape.display.shape.textSize.safeParse({ kind: 'ios-content-size', value: textSize });
    if (size.success) environment.display.textSize = size.data;
    if (panel) {
      const orientation = await simulatorInterfaceOrientation(set, device.id, probe);
      if (orientation) {
        environment.display.rotation = orientation;
        const landscape = orientation.startsWith('landscape');
        environment.display.pixelWidth = landscape ? panel.height : panel.width;
        environment.display.pixelHeight = landscape ? panel.width : panel.height;
      }
    }
  } else if (device.platform === 'android' && device.kind === 'emulator' && session.device.android?.serial === device.id) {
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    const adb = sdk ? join(sdk, 'platform-tools/adb') : process.platform === 'darwin' ? join(homedir(), 'Library/Android/sdk/platform-tools/adb') : 'adb';
    const read = (...args: string[]) => query(adb, ['-s', device.id, ...args]);
    const [display, configuration, density, avdPath, androidId] = await Promise.all([
      read('shell', 'dumpsys', 'display'), read('shell', 'am', 'get-config'), read('shell', 'wm', 'density'), read('emu', 'avd', 'path'),
      read('shell', 'settings', 'get', 'secure', 'android_id'),
    ]);
    const path = avdPath.split(/\r?\n/).filter((line) => line !== 'OK').join('\n').trim();
    if (host && path.startsWith('/') && !path.includes('\n') && /^[a-f0-9]{16}$/i.test(androidId)) {
      try { environment.device.identity = { scope: `android:${host}`, id: `${await realpath(path)}:${androidId}` }; } catch { /* Unknown AVD. */ }
    }
    const info = display.match(/DisplayViewport\{type=INTERNAL, valid=true, isActive=true, displayId=0,[^\n}]*?orientation=([0-3]), logicalFrame=Rect\(0, 0 - (\d+), (\d+)\)/);
    if (info && Number.isSafeInteger(Number(info[2])) && Number(info[2]) > 0 && Number.isSafeInteger(Number(info[3])) && Number(info[3]) > 0) {
      environment.display.pixelWidth = Number(info[2]); environment.display.pixelHeight = Number(info[3]);
      environment.display.rotation = (['portrait', 'landscape-left', 'portrait-upside-down', 'landscape-right'] as const)[Number(info[1])] ?? null;
    }
    const dpi = density.match(/Override density:\s*(\d+)/)?.[1] ?? density.match(/Physical density:\s*(\d+)/)?.[1];
    if (dpi && Number.isFinite(Number(dpi)) && Number(dpi) > 0) environment.display.pixelDensity = Number(dpi) / 160;
    // am get-config reports effective configuration, including automatic night mode's resolved value.
    const config = configuration.match(/^config:\s*(.+)$/m)?.[1];
    if (config && /(?:^|-)notnight(?:-|$)/.test(config)) environment.display.appearance = 'light';
    else if (config && /(?:^|-)night(?:-|$)/.test(config)) environment.display.appearance = 'dark';
    const activity = await read('shell', 'dumpsys', 'activity');
    const font = activity.match(/^\s*mGlobalConfiguration:\s*\{(\d+(?:\.\d+)?)\s/m)?.[1];
    // Read the effective Configuration, including the actual default when no settings row exists.
    // The settings database alone is a preference and can lag the running configuration.
    if (font && Number.isFinite(Number(font)) && Number(font) > 0) environment.display.textSize = { kind: 'android-font-scale', value: Number(font) };
  }
  for (const group of ['device', 'display', 'versions'] as const) {
    for (const [field, value] of Object.entries(environment[group])) {
      if (value === null) environment.unavailable.push({
        path: [group, field] as Environment['unavailable'][number]['path'],
        message: `Could not observe ${group}.${field} from the selected local device. Check native tooling and device support; use a fresh single-step capture while this metadata is unavailable.`,
      });
    }
  }
  return environmentSchema.parse(environment);
}

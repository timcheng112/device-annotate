import { createAgentDeviceClient, type AgentDeviceSession } from 'agent-device';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { guardedTransport, installedAgentVersion } from './daemon.js';
import { CaptureFailure } from './failure.js';
import type { EvidenceAdapter } from './execute.js';
import { waitForQuietSnapshots } from './stable.js';
import { collectEnvironment } from './environment.js';
import type { SnapshotState } from '../resolve/targets.js';

export type DeviceOptions = { cwd: string; platform?: 'ios' | 'android'; session?: string };

/** Inventory is already scoped by the public client's cwd metadata. Never choose by list order. */
export function selectSession(sessions: AgentDeviceSession[], options: Pick<DeviceOptions, 'platform' | 'session'>): AgentDeviceSession {
  const candidates = sessions.filter((entry) =>
    (!options.platform || entry.device.platform === options.platform) &&
    (options.session ? entry.address === options.session : entry.name === 'default' && /^cwd:[^:]+:/.test(entry.address ?? '')));
  const platformOwned = options.platform && !options.session
    ? candidates.filter((entry) => entry.address?.endsWith(`:${options.platform}`)) : [];
  const selected = platformOwned.length ? platformOwned : candidates;
  if (selected.length !== 1 || !selected[0]!.address) {
    throw new CaptureFailure('SESSION_UNAVAILABLE', 'Select exactly one existing session with --platform or --session. Open it with agent-device before capturing.');
  }
  return selected[0]!;
}

/** Only the guarded public transport may dispatch commands. No session lifecycle calls. */
export async function localDeviceAdapter(options: DeviceOptions): Promise<EvidenceAdapter> {
  const version = await installedAgentVersion();
  const transport = await guardedTransport({ version });
  const inventory = createAgentDeviceClient({ cwd: options.cwd, ...(options.platform ? { lockPlatform: options.platform } : {}) }, { transport });
  const selected = selectSession(await inventory.sessions.list(), options);
  const platform = selected.device.platform;
  if (platform !== 'ios' && platform !== 'android') throw new CaptureFailure('PLATFORM_UNSUPPORTED', 'Capture supports existing local iOS and Android sessions.');
  // Pin the daemon-provided address, including implicit workspace addresses, for every subsequent call.
  const client = createAgentDeviceClient({ cwd: options.cwd, session: selected.address!, lockPlatform: platform }, { transport });
  const checkSession = async () => {
    const current = (await client.sessions.list()).find((entry) => entry.address === selected.address);
    if (!current || current.createdAt !== selected.createdAt || !isDeepStrictEqual(current.device, selected.device)) {
      throw new CaptureFailure('SESSION_CHANGED', 'The selected session changed during capture. Recheck the intended device and retry.');
    }
  };
  const devices = await client.devices.list({ platform });
  const device = devices.find((entry) => entry.id === selected.device.id && entry.platform === platform);
  if (!device || device.booted === false || ((device.kind === 'simulator' || device.kind === 'emulator') && device.booted !== true)) {
    throw new CaptureFailure('DEVICE_UNAVAILABLE', 'The selected local device is unavailable. Prepare it with agent-device; device-proof will not boot or select another device.');
  }
  const directory = await mkdtemp(join(tmpdir(), 'device-proof-capture-'));
  let density: number | null = null;
  const snapshot = async () => {
    await checkSession();
    let value;
    try {
      value = await client.capture.snapshot({ platform, noRecord: true, ...(platform === 'ios' ? { observeOnly: true } : {}), timeoutMs: 15_000 });
    } catch (cause) {
      if (cause instanceof CaptureFailure || platform !== 'ios') throw cause;
      throw new CaptureFailure('IOS_OBSERVATION_UNAVAILABLE', 'Observe-only iOS capture was refused. Foreground the intended app and prepare its compatible runner with agent-device, then retry. Device-proof will not activate the app or fall back to ordinary snapshots.', { cause });
    }
    if (platform === 'ios' && (value.observation?.mode !== 'observe-only' || value.observation.activationPerformed !== false || value.observation.appState !== 'runningForeground' || value.targetActivation !== undefined)) {
      throw new CaptureFailure('IOS_OBSERVATION_UNAVAILABLE', 'The iOS response did not confirm an observe-only foreground capture. Prepare a compatible runner with agent-device and retry.');
    }
    await checkSession();
    // The pinned public and vendored viewport types carry distinct compile-time brands.
    // Preserve every response field; resolution validates the actual dimensions.
    return { ...value, createdAt: Date.now() } as unknown as SnapshotState;
  };
  return {
    platform,
    async environment() {
      await checkSession();
      const environment = await collectEnvironment(selected, device, version);
      density = environment.display.pixelDensity;
      await checkSession();
      return environment;
    },
    async wait() {
      if (platform === 'ios') await waitForQuietSnapshots(snapshot);
      else {
        await checkSession();
        await client.command.wait({ platform, stable: true, quietMs: 500, timeoutMs: 60_000 });
        await checkSession();
      }
    },
    snapshot,
    async screenshot() {
      await checkSession();
      if (platform === 'ios' && density === null) throw new CaptureFailure('DENSITY_UNAVAILABLE', 'Native iOS display density could not be observed. Check simulator tooling before capturing.');
      const path = join(directory, 'raw.png');
      await client.capture.screenshot({ path, stabilize: false, normalizeStatusBar: false, ...(platform === 'ios' ? { pixelDensity: density! } : {}) });
      await checkSession();
      return new Uint8Array(await readFile(path));
    },
    async close() { await rm(directory, { recursive: true, force: true }); },
  };
}

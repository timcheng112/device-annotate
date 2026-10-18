import { createAgentDeviceClient } from 'agent-device';
import { guardedTransport, installedAgentVersion } from '../capture/daemon.js';
import { selectSession, type DeviceOptions } from '../capture/device.js';
import { CaptureFailure } from '../capture/failure.js';
import type { SessionIdentity } from './schema.js';

export async function recordingDevice(options: DeviceOptions, expected?: SessionIdentity) {
  const version = await installedAgentVersion();
  const transport = await guardedTransport({ version, timeoutMs: 180_000 });
  const inventory = createAgentDeviceClient({ cwd: options.cwd }, { transport });
  const selected = selectSession(await inventory.sessions.list(), options);
  if (selected.device.platform !== 'ios' && selected.device.platform !== 'android') throw new CaptureFailure('PLATFORM_UNSUPPORTED', 'Video supports existing local iOS and Android sessions.');
  const identity: SessionIdentity = { address: selected.address!, createdAt: selected.createdAt, platform: selected.device.platform, deviceId: selected.device.id, agentDevice: version };
  if (expected && Object.entries(expected).some(([key, value]) => identity[key as keyof SessionIdentity] !== value)) throw new CaptureFailure('SESSION_CHANGED', 'The recording session or peer version changed. Existing video evidence was preserved.');
  const client = createAgentDeviceClient({ cwd: options.cwd, session: identity.address, lockPlatform: identity.platform }, { transport });
  return { identity,
    start: (path: string) => client.recording.record({ action: 'start', path, recordingScope: 'app' }),
    stop: () => client.recording.record({ action: 'stop' }),
  };
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../..', import.meta.url));
export const here = fileURLToPath(new URL('.', import.meta.url));
export const stateDir = path.join(here, '.local/state');
export const version = JSON.parse(readFileSync(path.join(here, 'node_modules/agent-device/package.json'))).version;

// M0 only: explicit, isolated, installed-package state. No production path resolver yet.
export function inspectDaemon(expectedVersion = version, directory = stateDir) {
  const info = JSON.parse(readFileSync(path.join(directory, 'daemon.json'), 'utf8'));
  if (info.version !== expectedVersion) {
    const error = new Error(`Daemon version ${info.version}; client version ${expectedVersion}. Capture refused before any agent-device call.`);
    error.code = 'DAEMON_VERSION_MISMATCH';
    throw error;
  }
  if (info.codeOrigin !== 'installed') throw new Error('Unverified daemon code origin');
  process.kill(info.pid, 0);
  return { version: info.version, pid: info.pid, processStartTime: info.processStartTime, codeOrigin: info.codeOrigin };
}

export async function clientFor(platform, session) {
  inspectDaemon();
  process.env.AGENT_DEVICE_STATE_DIR = stateDir;
  const { createAgentDeviceClient } = await import('agent-device');
  return createAgentDeviceClient({ cwd: root, lockPlatform: platform, ...(session ? { session } : {}) });
}

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AgentDeviceDaemonTransport } from 'agent-device';
import * as z from 'zod';
import { CaptureFailure } from './failure.js';

const metadataSchema = z.object({
  pid: z.number().int().positive(), token: z.string().min(1), version: z.string().min(1),
  codeOrigin: z.literal('installed'),
  port: z.number().int().min(1).max(65535).optional(),
  httpPort: z.number().int().min(1).max(65535).optional(),
}).refine((info) => info.port !== undefined || info.httpPort !== undefined);

export function daemonStateDirectory(value = process.env.AGENT_DEVICE_STATE_DIR, cwd = process.cwd()): string {
  const path = value?.trim();
  if (!path) return join(homedir(), '.agent-device');
  return resolve(cwd, path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
}

export async function installedAgentVersion(): Promise<string> {
  // Resolve the very same public peer entry point the adapter imports.
  const entry = fileURLToPath(import.meta.resolve('agent-device'));
  const pkg = JSON.parse(await readFile(resolve(dirname(entry), '../../package.json'), 'utf8')) as { version?: unknown };
  if (typeof pkg.version !== 'string') throw new CaptureFailure('DAEMON_UNAVAILABLE', 'Cannot identify the installed agent-device peer version.');
  return pkg.version;
}

/** Passive inspection only. Credentials never leave this closure or enter diagnostics. */
export async function guardedTransport(options: { stateDir?: string; version: string; timeoutMs?: number }): Promise<AgentDeviceDaemonTransport> {
  const metadataPath = join(options.stateDir ?? daemonStateDirectory(), 'daemon.json');
  const inspect = async () => {
    try {
      const bytes = await readFile(metadataPath, 'utf8');
      const raw: unknown = JSON.parse(bytes);
      // Report a version mismatch even when another metadata field is unsupported.
      const version = z.object({ version: z.string() }).safeParse(raw);
      if (version.success && version.data.version !== options.version) {
        throw new CaptureFailure('DAEMON_VERSION_MISMATCH', `Running daemon version ${JSON.stringify(version.data.version)} differs from agent-device ${JSON.stringify(options.version)}. Use matching versions before capturing.`);
      }
      const parsed = metadataSchema.safeParse(raw);
      if (!parsed.success) throw new Error('Unsupported daemon metadata.');
      process.kill(parsed.data.pid, 0);
      return { bytes, info: parsed.data };
    } catch (cause) {
      if (cause instanceof CaptureFailure) throw cause;
      throw new CaptureFailure('DAEMON_UNAVAILABLE', 'No verified installed local daemon is available. Open the intended session with the matching agent-device CLI, then retry.', { cause });
    }
  };
  const initial = await inspect();
  const verify = async () => {
    const current = await inspect();
    if (current.bytes !== initial.bytes) throw new CaptureFailure('DAEMON_CHANGED', 'The daemon changed during capture. Recheck the intended session and retry.');
  };
  return async (command, context) => {
    await verify();
    if (context?.signal?.aborted) throw new CaptureFailure('CAPTURE_CANCELLED', 'Capture was cancelled.');
    const payload = { ...command, token: initial.info.token };
    type Response = Awaited<ReturnType<AgentDeviceDaemonTransport>>;
    const response = await new Promise<Response>((resolveResponse, reject) => {
      let settled = false;
      let destroy = () => {};
      const finish = (error?: Error, response?: Response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context?.signal?.removeEventListener('abort', abort);
        destroy();
        if (error) reject(error); else resolveResponse(response!);
      };
      const failed = () => finish(new CaptureFailure('DAEMON_TRANSPORT_FAILED', 'The verified daemon connection failed. Check the session and retry.'));
      const abort = () => finish(new CaptureFailure('CAPTURE_CANCELLED', 'Capture was cancelled.'));
      const timer = setTimeout(() => finish(new CaptureFailure('CAPTURE_TIMEOUT', 'The daemon did not finish within the capture timeout. Check the device and retry.')), options.timeoutMs ?? 90_000);
      context?.signal?.addEventListener('abort', abort, { once: true });
      const accept = (value: unknown) => {
        if (typeof value !== 'object' || value === null || !('ok' in value) || typeof value.ok !== 'boolean') return failed();
        finish(undefined, value as Response);
      };
      let bytes = 0;
      let body = '';
      const append = (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 64 * 1024 * 1024) { failed(); return false; }
        body += chunk;
        return true;
      };
      if (initial.info.port !== undefined) {
        const socket = createConnection({ host: '127.0.0.1', port: initial.info.port });
        destroy = () => socket.destroy();
        socket.setEncoding('utf8');
        socket.on('connect', () => {
          void verify().then(() => { if (!settled) socket.write(`${JSON.stringify(payload)}\n`); }, (error: Error) => finish(error));
        });
        socket.on('data', (chunk: string) => {
          if (settled || !append(chunk)) return;
          let newline: number;
          while (!settled && (newline = body.indexOf('\n')) >= 0) {
            const line = body.slice(0, newline); body = body.slice(newline + 1);
            try {
              const value = JSON.parse(line) as { type?: string; response?: unknown };
              if (value.type === 'progress') continue;
              accept(value.type === 'response' ? value.response : value);
            } catch { failed(); }
          }
        });
        socket.on('error', failed);
        socket.on('end', () => { if (!settled) { try { accept(JSON.parse(body)); } catch { failed(); } } });
        socket.on('close', () => { if (!settled) failed(); });
      } else {
        const id = command.meta?.requestId ?? randomUUID();
        const request = httpRequest({ host: '127.0.0.1', port: initial.info.httpPort!, path: '/rpc', method: 'POST', headers: { 'content-type': 'application/json' } }, (response) => {
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => { append(chunk); });
          response.on('error', failed);
          response.on('end', () => {
            try {
              const value = JSON.parse(body) as { id?: string; result?: unknown };
              if (response.statusCode !== 200 || value.id !== id) return failed();
              accept(value.result);
            } catch { failed(); }
          });
        });
        destroy = () => request.destroy();
        request.on('error', failed);
        request.end(JSON.stringify({ jsonrpc: '2.0', id, method: 'agent_device.command', params: payload }));
      }
    });
    await verify();
    return response;
  };
}

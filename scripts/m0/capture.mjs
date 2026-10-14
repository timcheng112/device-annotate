import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { clientFor, inspectDaemon, root, version } from './runtime.mjs';

process.on('uncaughtException', error => {
  console.error(JSON.stringify({ message: error.message, code: error.code, details: error.details }, null, 2));
  process.exitCode = 1;
});

const [platform, session] = process.argv.slice(2);
assert(['ios', 'android'].includes(platform), 'Usage: capture.mjs ios|android [session]');
const folder = path.join(root, 'test/fixtures/capture-spike', platform);
mkdirSync(folder, { recursive: true });
const client = await clientFor(platform, session);
const daemonBefore = inspectDaemon();
const sessions = await client.sessions.list();
console.log('sessions', sessions.map(s => s.address));
await client.command.wait({ platform, stable: true, quietMs: 500, timeoutMs: 60000 });
const before = await client.capture.snapshot({ platform, noRecord: true });
assert(before.nodes.some(n => n.identifier?.includes('center') || n.label === 'center'), 'Must capture neutral fixture only');
assert(before.nodes.every(n => !n.bundleId || ['dev.deviceproof.fixture', 'com.android.systemui'].includes(n.bundleId)), 'Foreign app content must never enter fixtures');
const screenshotOptions = { stabilize: false, normalizeStatusBar: false, ...(platform === 'ios' ? { pixelDensity: 3 } : {}) };
const screenshot = await client.capture.screenshot({ path: path.join(folder, 'capture.raw.png'), ...screenshotOptions });
const after = await client.capture.snapshot({ platform, noRecord: true });
const stableNodes = s => s.nodes.map(({ ref, ...node }) => node);
assert.deepEqual(stableNodes(before), stableNodes(after), 'Fixture changed during capture');
const png = PNG.sync.read(readFileSync(screenshot.path));
writeFileSync(path.join(folder, 'capture.snapshot.json'), JSON.stringify(before, null, 2) + '\n');
writeFileSync(path.join(folder, 'after.snapshot.json'), JSON.stringify(after, null, 2) + '\n');
const activeSession = sessions.find(s => s.device.platform === platform && (session ? s.name === session : s.name === 'default'));
assert(activeSession, 'Expected fixture session');
const devices = (await client.devices.list({ platform })).filter(d => d.id === activeSession.device.id);
const record = { capturedAt: new Date().toISOString(), agentDevice: version, daemonBefore,
  daemonAfter: inspectDaemon(), platform, requestedSession: session ?? null,
  sessions: [{ name: activeSession.name, address: activeSession.address, createdAt: activeSession.createdAt, device: activeSession.device, identifiers: activeSession.identifiers }],
  screenshotOptions, screenshot: { ...screenshot, path: 'capture.raw.png' }, png: { width: png.width, height: png.height },
  devices, stableIgnoringRefs: true };
writeFileSync(path.join(folder, 'capture.runtime.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ platform, png: record.png, viewport: before.viewport, stableIgnoringRefs: true }, null, 2));

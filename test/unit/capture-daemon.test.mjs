import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { once } from 'node:events';
import { guardedTransport, installedAgentVersion } from '../../dist/capture/daemon.js';

async function setup(t, overrides = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), 'device-proof-daemon-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const info = { pid: process.pid, token: 'test-only-secret', version: '0.21.27', codeOrigin: 'installed', port: 1234, ...overrides };
  const save = () => writeFile(join(stateDir, 'daemon.json'), JSON.stringify(info));
  await save();
  return { stateDir, info, save, options: { stateDir, version: '0.21.27' } };
}
test('resolves the installed peer version without daemon calls', async () => {
  assert.equal(await installedAgentVersion(), '0.21.27');
});
test('version mismatch refuses passively and preserves metadata', async (t) => {
  const state = await setup(t, { version: '0.21.26' });
  const before = await readFile(join(state.stateDir, 'daemon.json'));
  await assert.rejects(guardedTransport(state.options), (error) => {
    assert.equal(error.code, 'DAEMON_VERSION_MISMATCH');
    assert.match(error.message, /0\.21\.26.*0\.21\.27/);
    assert.doesNotMatch(error.message, /test-only-secret/);
    return true;
  });
  assert.deepEqual(await readFile(join(state.stateDir, 'daemon.json')), before);
});
for (const [name, overrides] of [['checkout', { codeOrigin: 'checkout' }], ['unknown origin', { codeOrigin: null }], ['invalid port', { port: -1 }], ['missing credentials', { token: '' }]]) {
  test(`rejects ${name} without starting a daemon`, async (t) => {
    const state = await setup(t, overrides);
    await assert.rejects(guardedTransport(state.options), { code: 'DAEMON_UNAVAILABLE' });
  });
}
test('changed metadata refuses before dispatch', async (t) => {
  const state = await setup(t);
  const transport = await guardedTransport(state.options);
  state.info.token = 'different-secret'; await state.save();
  await assert.rejects(transport({ command: 'snapshot' }), { code: 'DAEMON_CHANGED' });
});
test('socket dispatch uses verified credentials and parses chunked progress envelopes', async (t) => {
  let received;
  const server = createServer((socket) => {
    socket.once('data', (data) => {
      received = JSON.parse(data.toString());
      socket.write('{"type":"progress","event":{}}\n{"type":"res');
      socket.end('ponse","response":{"ok":true,"data":{"accepted":true}}}\n');
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const state = await setup(t, { port: server.address().port });
  const transport = await guardedTransport(state.options);
  assert.deepEqual(await transport({ command: 'snapshot' }), { ok: true, data: { accepted: true } });
  assert.equal(received.token, state.info.token);
  assert.equal(received.command, 'snapshot');
});
test('HTTP-only local daemons use the pinned command RPC envelope', async (t) => {
  let received;
  const server = httpServer((req, res) => {
    let body = ''; req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { received = JSON.parse(body); res.end(JSON.stringify({ jsonrpc: '2.0', id: received.id, result: { ok: true, data: {} } })); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const state = await setup(t, { port: undefined, httpPort: server.address().port });
  const transport = await guardedTransport(state.options);
  assert.deepEqual(await transport({ command: 'snapshot' }), { ok: true, data: {} });
  assert.equal(received.method, 'agent_device.command'); assert.equal(received.params.token, state.info.token);
});
test('transport timeout closes the connection without daemon recovery', async (t) => {
  const sockets = new Set();
  const server = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise((resolve) => server.close(resolve)); });
  const state = await setup(t, { port: server.address().port });
  const transport = await guardedTransport({ ...state.options, timeoutMs: 30 });
  await assert.rejects(transport({ command: 'snapshot' }), { code: 'CAPTURE_TIMEOUT' });
});

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { clientFor, root } from './runtime.mjs';

process.on('uncaughtException', error => { console.error(error.message); process.exitCode = 1; });
const platform = process.argv[2];
const client = await clientFor(platform);
const folder = path.join(root, 'test/fixtures/capture-spike', platform);
const raw = await client.capture.snapshot({ platform, raw: true, noRecord: true });
assert(raw.nodes.some(n => n.identifier?.includes('center')));
writeFileSync(path.join(folder, 'raw-tree.snapshot.json'), JSON.stringify(raw, null, 2) + '\n');
const options = platform === 'ios' ? {} : { overlayRefs: true, scale: 0.5 };
const shot = await client.capture.screenshot({ path: path.join(folder, 'extra.raw.png'), ...options });
const png = PNG.sync.read(readFileSync(shot.path));
const appState = await client.command.appState({ platform });
const results = { options, screenshot: { ...shot, path: 'extra.raw.png' }, actualPng: { width: png.width, height: png.height }, appState,
  rawTree: { viewport: raw.viewport ?? null, root: raw.nodes[0], partialTargets: raw.nodes.filter(n => n.identifier?.includes('partial')) } };
writeFileSync(path.join(folder, 'experiments.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ platform, rawViewport: raw.viewport ?? null, partialTargets: results.rawTree.partialTargets.map(n => ({id:n.identifier,rect:n.rect})), png: results.actualPng }, null, 2));

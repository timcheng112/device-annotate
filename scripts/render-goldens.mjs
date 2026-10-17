// Generate candidates only. Promote reviewed PNGs explicitly after visual inspection.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cases, setup, loadCase } from '../test/golden/helpers.mjs';
const destination = process.argv[2];
if (!destination) throw new Error('Supply a candidate output directory.');
if (resolve(destination) === resolve('test/golden/approved')) throw new Error('Generate candidates separately, then promote only reviewed output.');
await mkdir(destination, { recursive: true });
const renderer = await setup();
for (const name of cases) {
  const result = renderer.render(await loadCase(name));
  if (result.kind !== 'rendered') throw new Error(`${name} unexpectedly omitted`);
  await writeFile(resolve(destination, `${name}.png`), result.png);
  await writeFile(resolve(destination, `${name}.svg`), result.svg);
  console.log(`${name}: ${result.layout.width} x ${result.layout.height}`);
}
const items = cases.map((name) => `<section><h2>${name}</h2><a href="${name}.png" target="_blank">Open full-size image</a><img src="${name}.png" alt="${name} rendered evidence"></section>`).join('');
await writeFile(resolve(destination, 'index.html'), `<!doctype html><meta charset="utf-8"><title>M4 render review</title><style>body{font:16px system-ui;background:#e5e7eb;margin:24px}main{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}section{width:480px;background:white;padding:16px}img{width:100%;height:auto;margin-top:12px}h1{margin:0}p{max-width:70ch}</style><h1>M4 rendering review</h1><p>Neutral captures and synthetic fixtures. Full-size PNG links preserve the original pixel resolution. Candidate images are awaiting visual review.</p><main>${items}</main>`);

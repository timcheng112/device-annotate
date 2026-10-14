import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { root } from './runtime.mjs';

const colors = ['14b8a6', 'f59e0b', '3b82f6', 'a78bfa', 'fb7185', '22c55e'];
const ids = ['top-left', 'top-right', 'center', 'partial-left', 'bottom-right', 'partial-bottom'];
const panels = [];
const records = [];
for (const platform of ['ios', 'android', 'ios-compat']) {
  const folder = path.join(root, 'test/fixtures/capture-spike', platform);
  const bytes = readFileSync(path.join(folder, 'capture.raw.png'));
  const png = PNG.sync.read(bytes);
  const snapshot = JSON.parse(readFileSync(path.join(folder, 'capture.snapshot.json')));
  const { width: w, height: h } = snapshot.viewport;
  const isAndroid = platform === 'android';
  const expected = isAndroid ? [[8,100,240,96],[w-248,100,240,96],[80,400,w-160,200],[-40,720,240,120],[w-248,h-220,240,96],[80,h-40,320,120]] :
    [[8,70,120,48],[w-128,70,120,48],[40,200,w-80,100],[-20,360,120,60],[w-128,h-100,120,48],[40,h-20,160,60]];
  const sx = png.width / w, sy = png.height / h;
  if (isAndroid) assert.equal(sx, 1);
  if (platform === 'ios') assert.equal(sx, 3);
  const rows = ids.map((id, i) => {
    const matches = snapshot.nodes.filter(n => n.identifier === id || n.identifier === `dev.deviceproof.fixture:id/${id.replaceAll('-', '_')}`);
    assert.equal(matches.length, 1, `${platform}: unique ${id}`);
    const node = matches[0];
    const [x,y,width,height] = expected[i];
    const visible = {x:Math.max(0,x), y:Math.max(0,y), width:Math.min(w,x+width)-Math.max(0,x), height:Math.min(h,y+height)-Math.max(0,y)};
    assert.deepEqual(node.rect, visible, `${platform}: known geometry ${id}`);
    const projected = {x:Math.round(node.rect.x*sx), y:Math.round(node.rect.y*sy), width:Math.round(node.rect.width*sx), height:Math.round(node.rect.height*sy)};
    const rgb = colors[i].match(/../g).map(c => parseInt(c,16));
    let left=png.width, top=png.height, right=-1, bottom=-1, pixels=0;
    for (let py=0;py<png.height;py++) for (let px=0;px<png.width;px++) {
      const offset=(py*png.width+px)*4;
      if (rgb.every((v,c)=>Math.abs(png.data[offset+c]-v)<=2)) {
        left=Math.min(left,px); top=Math.min(top,py); right=Math.max(right,px); bottom=Math.max(bottom,py); pixels++;
      }
    }
    assert(pixels>100, `${platform}: colored fixture pixels ${id}`);
    const measured={x:left,y:top,width:right-left+1,height:bottom-top+1};
    const error=Math.max(...Object.keys(projected).map(k=>Math.abs(projected[k]-measured[k])));
    assert(error<=2, `${platform}: ${id} projection differs from colored pixels by ${error}px`);
    return { id, sourceBounds:{x,y,width,height}, snapshotBounds:node.rect, projected, measured, maximumErrorPixels:error, sourceIsClipped:width!==visible.width||height!==visible.height };
  });
  records.push({platform,png:{width:png.width,height:png.height},viewport:snapshot.viewport,scale:{x:sx,y:sy},rows});
  const rects=rows.map(({projected:r},i)=>`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="white" stroke-width="5"/><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="#111827" stroke-width="2" stroke-dasharray="10 7"/><text x="${r.x+10}" y="${r.y+26}" fill="white" stroke="#111827" stroke-width="5" paint-order="stroke" font-size="23" font-family="system-ui">${i+1}</text>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${png.width} ${png.height}"><image href="data:image/png;base64,${bytes.toString('base64')}" width="${png.width}" height="${png.height}"/><g class="overlay">${rects}</g></svg>`;
  writeFileSync(path.join(folder,'coordinate-overlay.svg'),svg+'\n');
  panels.push(`<article><h2>${platform==='ios'?'iOS native':platform==='android'?'Android native':'iOS compatibility diagnostic'}</h2><p>${w} × ${h} snapshot → ${png.width} × ${png.height} PNG<br>Projection: ${sx.toFixed(4)} × ${sy.toFixed(4)}</p>${svg}<table><thead><tr><th>Target</th><th>Pixel error</th><th>Clipping</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}. ${r.id}</td><td>${r.maximumErrorPixels} px</td><td>${r.sourceIsClipped?'Original bounds clipped':'Within screen'}</td></tr>`).join('')}</tbody></table></article>`);
}
const out=path.join(root,'docs/prototypes/capture-spike');
mkdirSync(out,{recursive:true});
writeFileSync(path.join(root,'test/fixtures/capture-spike/geometry.json'),JSON.stringify(records,null,2)+'\n');
writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M0 capture geometry | device-proof</title><style>*{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#172033;font:16px/1.5 system-ui;padding:32px}h1{margin:0}header{max-width:1000px;margin:0 auto 28px}button{font:inherit;padding:10px 18px;background:#172033;color:white;border:0;border-radius:8px;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;max-width:1400px;margin:auto}article{background:white;border:1px solid #d5dce6;border-radius:16px;padding:20px}h2{margin-top:0}svg{width:100%;background:#101728;border-radius:12px}table{border-collapse:collapse;width:100%;font-size:13px;margin-top:16px}td,th{padding:7px 3px;border-bottom:1px solid #e2e8f0;text-align:left}body.raw .overlay{display:none}.note{background:#fff3cd;border-left:4px solid #bf8b00;padding:14px}</style><header><h1>M0: coordinates checked against real pixels</h1><p>Neutral native fixtures captured through agent-device 0.21.27. Each outline uses the returned snapshot rectangle, projected onto the captured PNG. Six targets per capture pass the known-geometry and colored-pixel checks.</p><p class="note">Partial targets are clipped in regular snapshots. The app's original geometry is known here because this is a controlled fixture. This page is an M0 diagnostic, not the production annotation design.</p><button onclick="document.body.classList.toggle('raw')" aria-label="Toggle snapshot outlines">Toggle outlines / raw capture</button></header><main class="grid">${panels.join('')}</main></html>\n`);
console.log(JSON.stringify(records.map(r=>({platform:r.platform,targets:r.rows.length,maxError:Math.max(...r.rows.map(x=>x.maximumErrorPixels))})),null,2));

// Re-emit earlier spike metadata using the capture harness's current neutral-only projection.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './runtime.mjs';
for (const platform of ['ios','android','ios-compat']) {
  const file=path.join(root,'test/fixtures/capture-spike',platform,'capture.runtime.json');
  const data=JSON.parse(readFileSync(file));
  const active=data.sessions.find(s=>s.device.platform===data.platform);
  const {name,address,createdAt,device,identifiers}=active;
  data.sessions=[{name,address,createdAt,device,identifiers}];
  data.devices=data.devices.filter(d=>d.id===device.id).map(({claimedBy,...d})=>d);
  writeFileSync(file,JSON.stringify(data,null,2)+'\n');
}

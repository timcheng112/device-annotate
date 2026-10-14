import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clientFor, inspectDaemon, here, root, stateDir } from './runtime.mjs';

process.on('uncaughtException', error => { console.error(JSON.stringify({message:error.message,details:error.details})); process.exitCode=1; });
const daemonBefore = inspectDaemon();
const results=[];
for(const platform of ['ios','android']) {
  const folder=path.join(root,'test/fixtures/capture-spike',platform);
  const initial=JSON.parse(readFileSync(path.join(folder,'capture.runtime.json')));
  const session=initial.sessions.find(s=>s.device.platform===platform);
  assert(session);
  const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.join(here,'node_modules/agent-device/bin/agent-device.mjs'),...args,'--json'],{cwd:root,env:{...process.env,AGENT_DEVICE_STATE_DIR:stateDir},encoding:'utf8'}));
  const beforeClient=await clientFor(platform);
  const before=await beforeClient.capture.snapshot({platform,noRecord:true});
  assert(before.nodes.some(n=>n.identifier?.includes('center')));
  assert(cli('close','--session',session.address).success);
  const name=`m0-${platform}-named`;
  const selection=platform==='ios'?['--udid',session.device.id]:['--serial',session.device.id,'--activity','.FixtureActivity'];
  const opened=cli('open','dev.deviceproof.fixture','--platform',platform,...selection,'--session',name);
  assert(opened.success);
  const client=await clientFor(platform,name);
  const snapshot=await client.capture.snapshot({platform,noRecord:true});
  assert(snapshot.nodes.some(n=>n.identifier?.includes('center')));
  assert.equal(snapshot.identifiers.session,name);
  const screenshot=await client.capture.screenshot({path:path.join(folder,'named.raw.png'),stabilize:false,normalizeStatusBar:false,...(platform==='ios'?{pixelDensity:3}:{})});
  assert.equal(screenshot.identifiers.session,name);
  writeFileSync(path.join(folder,'named.snapshot.json'),JSON.stringify(snapshot,null,2)+'\n');
  const live=(await client.sessions.list()).find(s=>s.name===name);
  assert.equal(live.device.id,session.device.id);
  results.push({platform,implicitAddress:session.address,explicitName:name,explicitAddress:live.address,deviceId:live.device.id,createdAt:live.createdAt,snapshotSession:snapshot.identifiers.session,screenshotSession:screenshot.identifiers.session,neutralTargetPresent:true});
  assert(cli('close','--session',name).success);
}
assert.deepEqual(inspectDaemon(),daemonBefore);
writeFileSync(path.join(root,'test/fixtures/capture-spike/sessions.json'),JSON.stringify({daemonBefore,daemonAfter:inspectDaemon(),results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));

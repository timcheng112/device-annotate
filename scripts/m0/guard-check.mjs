import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectDaemon, here, root, version } from './runtime.mjs';

process.on('uncaughtException', error=>{console.error(JSON.stringify({message:error.message,details:error.details}));process.exitCode=1;});
const directory=path.join(here,'.local/mismatch-state');
const oldRoot=path.join(here,'.local/older/node_modules/agent-device');
const oldVersion=JSON.parse(readFileSync(path.join(oldRoot,'package.json'))).version;
assert.notEqual(oldVersion,version);
const currentDaemon=inspectDaemon();
const serial=JSON.parse(readFileSync(path.join(root,'test/fixtures/capture-spike/android/capture.runtime.json'))).devices[0].id;
const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.join(oldRoot,'bin/agent-device.mjs'),...args,'--json'],{cwd:root,env:{...process.env,AGENT_DEVICE_STATE_DIR:directory},encoding:'utf8'}));
const name='m0-disposable-mismatch';
assert(cli('open','dev.deviceproof.fixture','--platform','android','--serial',serial,'--activity','.FixtureActivity','--session',name).success);
process.env.AGENT_DEVICE_STATE_DIR=directory;
const {createAgentDeviceClient}=await import(pathToFileURL(path.join(oldRoot,'dist/src/index.js')));
const oldClient=createAgentDeviceClient({cwd:root,session:name});
const beforeSessions=await oldClient.sessions.list();
assert(beforeSessions.some(s=>s.name===name));
const beforeInfo=readFileSync(path.join(directory,'daemon.json'));
const beforeDaemon=inspectDaemon(oldVersion,directory);
let refusal;
try {
  inspectDaemon(version,directory);
  assert.fail('Mismatched daemon must be refused before importing or calling the newer client');
} catch(error) {
  assert.equal(error.code,'DAEMON_VERSION_MISMATCH');
  refusal={code:error.code,message:error.message};
}
assert.deepEqual(readFileSync(path.join(directory,'daemon.json')),beforeInfo);
assert.deepEqual(inspectDaemon(oldVersion,directory),beforeDaemon);
const afterSessions=await oldClient.sessions.list();
assert.deepEqual(afterSessions,beforeSessions);
const snapshot=await oldClient.capture.snapshot({platform:'android',noRecord:true});
assert(snapshot.nodes.some(n=>n.identifier?.includes('center')));
assert.deepEqual(inspectDaemon(),currentDaemon);
const result={clientVersion:version,daemonVersion:oldVersion,refusal,daemonBefore:beforeDaemon,daemonAfter:inspectDaemon(oldVersion,directory),metadataBytesUnchanged:true,sessionInventoryUnchanged:true,sessionRemainsUsable:true,otherDaemonUnchanged:true,session:beforeSessions.find(s=>s.name===name).address};
writeFileSync(path.join(root,'test/fixtures/capture-spike/daemon-guard.json'),JSON.stringify(result,null,2)+'\n');
assert(cli('close','--session',name).success);
console.log(JSON.stringify(result,null,2));

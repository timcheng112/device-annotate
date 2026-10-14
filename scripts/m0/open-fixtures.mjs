import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { here, root, stateDir } from './runtime.mjs';
const [udid,serial]=process.argv.slice(2);
assert(udid && serial, 'Usage: open-fixtures.mjs <dedicated-ios-udid> <dedicated-android-serial>');
for(const platform of ['ios','android']) {
  const selection=platform==='ios'?['--udid',udid]:['--serial',serial,'--activity','.FixtureActivity'];
  const result=JSON.parse(execFileSync(process.execPath,[path.join(here,'node_modules/agent-device/bin/agent-device.mjs'),'open','dev.deviceproof.fixture','--platform',platform,...selection,'--json'],{cwd:root,env:{...process.env,AGENT_DEVICE_STATE_DIR:stateDir},encoding:'utf8'}));
  assert(result.success);
  console.log(`Opened neutral ${platform} fixture through CLI in ${root}`);
}

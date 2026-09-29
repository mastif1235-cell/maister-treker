'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8'),settingsDomain=fs.readFileSync(path.join(root,'js','settings-domain.js'),'utf8'),runtime=fs.readFileSync(path.join(root,'js','security-runtime-v65-9.js'),'utf8'),backup=require('../js/backup-system.js');
const ticketsRecovery=app.slice(app.indexOf('async function loadFromCloud()'),app.indexOf('async function sendAllToCloud()'));
assert.match(ticketsRecovery,/restoreFromGoogleSheets\('tickets'\)/);
assert.doesNotMatch(ticketsRecovery,/\bfetch\b|\bres\b|getScriptUrl|saveTickets|saveShifts|ADMIN_RECOVERY_REQUIRED/);
for(const id of ['loadShiftsCloudBtn','restoreShiftsCloudBtn']){
  assert.match(settingsDomain,new RegExp(`getElementById\\('${id}'\\)\\.addEventListener\\('click', \\(?\\)=>restoreFromGoogleSheets\\('shifts'\\)`),'shifts recovery button delegates to the safe restore flow');
}
assert.doesNotMatch(app,/loadShiftsFromCloud/,'unused shifts wrapper stays removed');
assert.doesNotMatch(runtime,/if\s*\(\s*false\s*&&\s*typeof securityValidateBackupEnvelope/);
const unsafe=JSON.parse('{"__proto__":{"polluted":true}}');
assert.equal(backup.hasUnsafeKeys(unsafe),true);
assert.equal(backup.validatePayload({app:'master-tracker',tickets:[unsafe],shifts:[],settings:{}}),false);
console.log('PASS cloud recovery delegates to the safe restore flow and backup validation blocks unsafe keys');

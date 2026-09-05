'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8'),runtime=fs.readFileSync(path.join(root,'js','security-runtime-v65-9.js'),'utf8'),backup=require('../js/backup-system.js');
const ticketsRecovery=app.slice(app.indexOf('async function loadFromCloud()'),app.indexOf('async function sendAllToCloud()'));
const shiftsRecovery=app.slice(app.indexOf('async function loadShiftsFromCloud()'),app.indexOf('async function sendShiftsToCloud()'));
for(const body of [ticketsRecovery,shiftsRecovery]){
  assert.match(body,/recovery protocol/);
  assert.doesNotMatch(body,/\bfetch\b|\bres\b|getScriptUrl|saveTickets|saveShifts|ADMIN_RECOVERY_REQUIRED/);
}
assert.doesNotMatch(runtime,/if\s*\(\s*false\s*&&\s*typeof securityValidateBackupEnvelope/);
const unsafe=JSON.parse('{"__proto__":{"polluted":true}}');
assert.equal(backup.hasUnsafeKeys(unsafe),true);
assert.equal(backup.validatePayload({app:'master-tracker',tickets:[unsafe],shifts:[],settings:{}}),false);
console.log('PASS cloud recovery stays inert and active backup validation blocks unsafe keys');

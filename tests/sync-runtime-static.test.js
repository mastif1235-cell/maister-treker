'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');const storage=fs.readFileSync('js/storage-orchestration.js','utf8');const index=fs.readFileSync('index.html','utf8');const sw=fs.readFileSync('sw.js','utf8');
for(const owner of ['function postToUrl','basePostToUrl','function syncShiftPostGet','function syncShiftPost','function syncPendingCloudDelete','function verifyTicketSyncedOnServer','security-sync-hmac','security-sync-race','security-sync-delete-repair','security-sync-latency','security-sync-locksplit','security-sync-fastverify']){
  assert.equal((app+index+sw).includes(owner),false,`legacy runtime owner removed: ${owner}`);
}
assert.equal(/(?:\?|&)secret=/.test(app),false,'no URL query secrets in app sync paths');
const ticketStorage=fs.readFileSync('js/ticket-state-storage.js','utf8');
assert.match(ticketStorage,/syncEngine\.recordDiff\('ticket'/);assert.match(storage,/syncEngine\.recordDiff\('shift'/);
const saveTicketsSource=ticketStorage.slice(ticketStorage.indexOf('function saveTickets()'));
const saveShiftsSource=storage.slice(storage.indexOf('function saveShifts()'));
assert.ok(saveTicketsSource.indexOf("syncEngine.recordDiff('ticket'")<saveTicketsSource.indexOf('ticketsDbPut(tickets)'),'ticket journal is persisted before ticket storage');
assert.ok(saveShiftsSource.indexOf("syncEngine.recordDiff('shift'")<saveShiftsSource.indexOf("localStorage.setItem('shifts'"),'shift journal is persisted before shift storage');
const journalStorage=fs.readFileSync('js/sync-journal-storage.js','utf8');
assert.match(journalStorage,/DB_NAME='maisterTrackerSync'/);assert.match(journalStorage,/STORE='journal'/);assert.match(journalStorage,/KEY='state-v1'/);
for(const file of ['sync-contract.js','sync-engine-core.js','sync-journal-storage.js','sync-transport.js','sync-engine-runtime.js']){
  assert.match(index,new RegExp(`js/${file.replace('.','\\.')}`));assert.match(sw,new RegExp(`js/${file.replace('.','\\.')}`));
}
assert.match(app,/await new MTSyncEngineRuntime\.Engine/);assert.match(app,/window\.addEventListener\('online',[\s\S]*syncEngine\.flush\(\)/);
console.log('PASS single sync owner/runtime wiring/no URL query secrets');

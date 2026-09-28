'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const backup=require('../js/backup-system.js');

const source=fs.readFileSync(path.join(__dirname,'..','js','backup-system.js'),'utf8');
const photoSource=fs.readFileSync(path.join(__dirname,'..','js','security-dom-final-v65-18.js'),'utf8');
assert.match(photoSource,/SECURITY_DOM_MAX_PHOTO_URL_CHARS\s*=\s*16\s*\*\s*1024\s*\*\s*1024/,'backup guard follows the supported legacy photo limit');
assert.equal(backup.MAX_LEGACY_DATA_URL_CHARS,16*1024*1024);

function harness(){
  const writes={photoDbPut:0,saveTicketsLocalOnly:0,saveShiftsLocalOnly:0,saveSettings:0,toolsRestoreData:0,backupDbPut:0};
  let confirms=0;
  const instrumented=source.replace('  async function mtBackupMigrateLegacySlots(){','  globalThis.__restore=mtBackupRestore;\n  async function mtBackupMigrateLegacySlots(){');
  const context={
    console,crypto:webcrypto,TextEncoder,TextDecoder,Blob,btoa,atob,
    URL:{createObjectURL:()=>'',revokeObjectURL(){}},setTimeout:()=>1,
    window:{},document:{getElementById:()=>null,createElement:()=>({click(){}})},
    MTBackupSystem:backup,showToast(){},
    openConfirmModal:async()=>{confirms++;return true;},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    backupDbGet:async()=>null,backupDbPut:async()=>{writes.backupDbPut++;return true;},
    backupDbDelete:async()=>true,localDateKey:()=>'',
    blankTicketObject:()=>({}),securityRuntimeSanitizeTicket:value=>value,
    securitySanitizeSettingsForBackup:value=>value,
    securityMergeImportedSettings:value=>value,
    settings:{theme:'light'},tickets:[{id:'local'}],shifts:[{id:'local-shift'}],
    syncTicketsSnapshot:[],syncShiftsSnapshot:[],
    MTSyncEngineRuntime:{uuid:()=> 'new-id'},
    saveTicketsLocalOnly:async()=>{writes.saveTicketsLocalOnly++;return true;},
    saveShiftsLocalOnly:async()=>{writes.saveShiftsLocalOnly++;return true;},
    saveSettings(){writes.saveSettings++;},
    photoDbPut:async()=>{writes.photoDbPut++;return true;},
    migrateLegacyPhotosToIdb:async()=>{},
    toolsRestoreData(){writes.toolsRestoreData++;},
    renderTicketsScreen(){},renderShiftsScreen(){},renderSettingsScreen(){}
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(instrumented,context);
  return{context,writes,confirms:()=>confirms};
}
function intoRealm(context,payload){
  context.importJson=JSON.stringify(payload);
  return vm.runInContext('JSON.parse(importJson)',context);
}

(async()=>{
  const limit=backup.MAX_LEGACY_DATA_URL_CHARS;
  const oversized='data:image/png;base64,'+'A'.repeat(limit);
  const validLegacyPhoto='data:image/png;base64,AA==';
  const boundaryPhoto='data:image/png;base64,'+'A'.repeat(limit-'data:image/png;base64,'.length);
  assert.equal(boundaryPhoto.length,limit);
  assert.equal(backup.validatePayload({tickets:[{id:'boundary',photo:boundaryPhoto}]}),true,'supported 16 MiB legacy photo boundary remains valid');
  const badPayloads=[
    {tickets:[{id:'bad-note',backupNote:oversized}]},
    {tickets:[{id:'bad-nested',someLegacyObject:{payload:oversized}}]},
    {tickets:[{id:'bad-array',legacyValues:['normal',oversized]}]},
    {tickets:[],syncJournal:{legacy:{value:oversized}}},
    {tickets:[],photoData:{'idb:bad':'data:image/png;base64,'+'A'.repeat(12*1024*1024)}}
  ];
  for(const payload of badPayloads){
    assert.equal(backup.validatePayload(payload),false,'oversized data URL is rejected at the payload boundary');
    const h=harness(),oldTickets=h.context.tickets,oldShifts=h.context.shifts,oldSettings=h.context.settings;
    await assert.rejects(()=>h.context.__restore(intoRealm(h.context,payload)),/BAD_PAYLOAD/);
    assert.deepEqual(h.writes,{photoDbPut:0,saveTicketsLocalOnly:0,saveShiftsLocalOnly:0,saveSettings:0,toolsRestoreData:0,backupDbPut:0},'no persistent writes precede rejection');
    assert.equal(h.confirms(),0,'unsafe import is rejected before confirmation');
    assert.equal(h.context.tickets,oldTickets);
    assert.equal(h.context.shifts,oldShifts);
    assert.equal(h.context.settings,oldSettings);
  }

  const valid={app:'master-tracker',tickets:[{id:'safe',note:'ordinary text',photo:validLegacyPhoto}],photoData:{'idb:photo':validLegacyPhoto}};
  assert.equal(backup.validatePayload(valid),true,'ordinary text, legacy photo and photoData remain valid');
  const h=harness();
  assert.equal(await h.context.__restore(intoRealm(h.context,valid)),true,'valid legacy import still restores');
  assert.equal(h.context.tickets[0].photo,validLegacyPhoto);
  assert.equal(h.writes.photoDbPut,1,'valid photoData is written');
  assert.equal(h.writes.saveTicketsLocalOnly,1,'valid ticket is saved');

  const encrypted=await backup.encrypt(valid,'correct password');
  assert.deepEqual(await backup.decrypt(encrypted,'correct password'),valid,'encrypted backup round-trip remains compatible');
  const polluted=JSON.parse('{"tickets":[{"id":"unsafe","nested":{"__proto__":{"polluted":true}}}]}');
  assert.equal(backup.validatePayload(polluted),false,'prototype-polluted import remains rejected');
  console.log('PASS oversized data URLs rejected before writes; legacy photos, photoData and encrypted backups preserved');
})().catch(error=>{console.error(error);process.exitCode=1;});

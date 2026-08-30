'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'js','backup-system.js'),'utf8');
const vault=new Map(),local=new Map(),prompts=[],usedPasswords=[],capturedPayloads=[];
const elements={
  backupPasswordStatus:{textContent:''},
  backupPasswordSaveBtn:{classList:{toggle(){}}},
  backupPasswordChangeBtn:{classList:{toggle(){}}},
  backupPasswordForgetBtn:{classList:{toggle(){}}},
  externalDailyBackupRoot:{innerHTML:''}
};
const context={
  console,crypto:webcrypto,TextEncoder,TextDecoder,Blob,btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary'),setTimeout:()=>1,clearTimeout:()=>{},window:{},
  URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},
  prompt:()=>prompts.length?prompts.shift():null,confirm:()=>true,showToast:()=>{},
  document:{getElementById:id=>elements[id]||null,createElement:()=>({href:'',download:'',click(){}})},
  localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,String(value)),removeItem:key=>local.delete(key)},
  backupDbGet:async key=>vault.get(key)||null,
  backupDbPut:async(key,value)=>{vault.set(key,value);return true;},
  backupDbDelete:async key=>vault.delete(key),
  localDateKey:()=> '2026-08-30',tickets:[],shifts:[],settings:{theme:'dark',syncHmacSecret:'server-secret'},
  securitySanitizeSettingsForBackup:value=>({theme:value.theme}),blankTicketObject:()=>({signal:''}),securityRuntimeSanitizeTicket:value=>value,
  collectLocalPhotoData:async()=>({photoData:{},missingPhotos:0}),photoDbPut:async()=>true,migrateLegacyPhotosToIdb:async()=>{},
  saveTickets:async()=>{},saveShifts:async()=>{},saveSettings:()=>{},renderTicketsScreen:()=>{},renderShiftsScreen:()=>{},renderSettingsScreen:()=>{},
  securityMergeImportedSettings:(_imported,current)=>current
};
context.window=context;
vm.createContext(context);vm.runInContext(source,context);
const originalEncrypt=context.MTBackupSystem.encrypt.bind(context.MTBackupSystem);
context.MTBackupSystem.encrypt=async(payload,password)=>{usedPasswords.push(password);capturedPayloads.push(JSON.parse(JSON.stringify(payload)));return originalEncrypt(payload,password);};

(async()=>{
  prompts.push('stored password','stored password');
  assert.equal(await context.saveBackupPasswordCredential(),true,'password is saved in the local encrypted vault');
  assert.equal(local.size,0,'password vault never uses ordinary localStorage');
  assert.equal(JSON.stringify([...vault.values()]).includes('stored password'),false,'vault records contain no plaintext password');

  const promptCountAfterSave=prompts.length;
  await context.downloadExternalDailyBackup();
  assert.equal(prompts.length,promptCountAfterSave,'saved password is used without a prompt');
  assert.equal(usedPasswords.at(-1),'stored password','saved password encrypts the backup');
  assert.equal(JSON.stringify(capturedPayloads.at(-1)).includes('stored password'),false,'password is absent from backup payload and safe settings');

  prompts.push('changed password','changed password');
  assert.equal(await context.saveBackupPasswordCredential(),true,'changing the saved password succeeds');
  await context.downloadExternalDailyBackup();
  assert.equal(usedPasswords.at(-1),'changed password','changed password is used for subsequent backups');

  assert.equal(await context.forgetBackupPasswordCredential(),true,'forget removes the saved credential');
  assert.equal(vault.size,0,'forget removes both wrapped password and non-extractable key');
  prompts.push('fallback password','fallback password');
  await context.downloadExternalDailyBackup();
  assert.equal(usedPasswords.at(-1),'fallback password','missing saved password keeps the prompt fallback');

  prompts.push('current password','current password');
  await context.saveBackupPasswordCredential();
  const currentPayload=vm.runInContext('({app:"master-tracker",backupVersion:6,tickets:[{id:"saved"}],shifts:[],settings:{}})',context);
  const currentEnvelope=await originalEncrypt(currentPayload,'current password');
  const promptCountBeforeImport=prompts.length;
  await context.handleJsonImportFile({size:100,text:async()=>JSON.stringify(currentEnvelope)});
  assert.equal(prompts.length,promptCountBeforeImport,'encrypted import tries the saved password first');

  const oldPayload=vm.runInContext('({app:"master-tracker",backupVersion:6,tickets:[{id:"legacy"}],shifts:[],settings:{}})',context);
  const oldEnvelope=await originalEncrypt(oldPayload,'different old password');
  prompts.push('different old password');
  await context.handleJsonImportFile({size:100,text:async()=>JSON.stringify(oldEnvelope)});
  assert.equal(context.tickets[0].id,'legacy','wrong saved password falls back to manual password and opens an older backup');
  assert.deepEqual(JSON.parse(JSON.stringify(await context.MTBackupSystem.decrypt(oldEnvelope,'different old password'))),{app:'master-tracker',backupVersion:6,tickets:[{id:'legacy'}],shifts:[],settings:{}},'existing encrypted backup format remains compatible');
  console.log('PASS encrypted local backup-password vault, fallback, rotation, forget and import compatibility');
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto'),backup=require('../js/backup-system.js');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'js','backup-system.js'),'utf8');
const b64=bytes=>Buffer.from(bytes).toString('base64');
async function encryptedRaw(text,password){const salt=webcrypto.getRandomValues(new Uint8Array(16)),iv=webcrypto.getRandomValues(new Uint8Array(12)),material=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'PBKDF2'},false,['deriveKey']),key=await webcrypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:backup.ITERATIONS},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']),cipher=new Uint8Array(await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text)));return{format:backup.FORMAT,version:backup.VERSION,app:'master-tracker',algorithm:'AES-GCM-256',kdf:'PBKDF2-SHA256',iterations:backup.ITERATIONS,salt:b64(salt),iv:b64(iv),ciphertext:b64(cipher)};}
(async()=>{
  const valid={app:'master-tracker',backupVersion:6,tickets:[{id:'safe'}],shifts:[],settings:{theme:'dark'}},envelope=await backup.encrypt(valid,'correct password');
  await assert.rejects(()=>backup.decrypt({...envelope,ciphertext:envelope.ciphertext.slice(0,-8)},'correct password'),'truncated encrypted backup is rejected');
  await assert.rejects(()=>backup.decrypt(envelope,'wrong password'),'wrong password is rejected');
  const corrupt={...envelope,ciphertext:'A'+envelope.ciphertext.slice(1)};await assert.rejects(()=>backup.decrypt(corrupt,'correct password'),'corrupted cipher is rejected');
  const brokenJsonEnvelope=await encryptedRaw('{broken','correct password');await assert.rejects(()=>backup.decrypt(brokenJsonEnvelope,'correct password'),'broken decrypted JSON is rejected');
  assert.equal(backup.validatePayload({app:'master-tracker'}),false,'missing collections are rejected');
  assert.equal(backup.validatePayload({app:'master-tracker',tickets:[null],shifts:[],settings:{}}),false,'malformed ticket is rejected');
  assert.equal(backup.validatePayload({app:'master-tracker',tickets:[],shifts:['bad'],settings:{}}),false,'malformed shift is rejected');
  assert.equal(backup.validatePayload({app:'master-tracker',tickets:[],shifts:[],settings:[]}),false,'malformed settings are rejected');
  const deep={};let cursor=deep;for(let i=0;i<30;i++){cursor.next={};cursor=cursor.next;}assert.equal(backup.validatePayload({tickets:[deep],shifts:[],settings:{}}),false,'oversized/deep partial objects are rejected');
  assert.deepEqual(await backup.decrypt(envelope,'correct password'),valid,'valid encrypted backup remains compatible');

  const instrumented=source.replace('  async function mtBackupMigrateLegacySlots(){','  globalThis.__restore=mtBackupRestore;\n  async function mtBackupMigrateLegacySlots(){');let writes=0,confirms=0;
  const currentTickets=[{id:'current'}],currentShifts=[{id:'shift'}],currentSettings={theme:'light'};
  const context={console,crypto:webcrypto,TextEncoder,TextDecoder,Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}},setTimeout:()=>1,btoa,atob,window:{},document:{getElementById:()=>null,createElement:()=>({click(){}})},prompt:()=>null,confirm:()=>{confirms++;return true;},showToast(){},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},backupDbGet:async()=>null,backupDbPut:async()=>true,backupDbDelete:async()=>true,localDateKey:()=>'',blankTicketObject:()=>({}),securityRuntimeSanitizeTicket:value=>value,securitySanitizeSettingsForBackup:value=>value,securityMergeImportedSettings:value=>value,saveSettings(){writes++;},settings:currentSettings,tickets:currentTickets,shifts:currentShifts,syncTicketsSnapshot:[],syncShiftsSnapshot:[],MTSyncEngineRuntime:{uuid:()=> 'uuid'},saveTicketsLocalOnly:async()=>{writes++;return true;},saveShiftsLocalOnly:async()=>{writes++;return true;},photoDbPut:async()=>{writes++;return true;},migrateLegacyPhotosToIdb:async()=>{},renderTicketsScreen(){},renderShiftsScreen(){},renderSettingsScreen(){}};context.window=context;vm.createContext(context);vm.runInContext(instrumented,context);
  await assert.rejects(()=>context.__restore(vm.runInContext('({app:"master-tracker",tickets:[null],shifts:[],settings:{}})',context)));
  assert.equal(writes,0);assert.equal(confirms,0,'invalid restore is rejected before confirmation or any write');assert.equal(context.tickets,currentTickets);assert.equal(context.shifts,currentShifts);assert.equal(context.settings,currentSettings);
  assert.match(source,/confirm\('Це legacy незашифрований бекап/,'legacy import remains explicit');assert.doesNotMatch(source,/console\.(?:log|error)\([^)]*(?:password|token|ciphertext)/i,'secret material is not logged');
  console.log('PASS corrupted/truncated backup rejection and pre-mutation atomic validation');
})().catch(error=>{console.error(error);process.exitCode=1;});

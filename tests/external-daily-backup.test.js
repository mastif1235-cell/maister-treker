'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js','backup-system.js'),'utf8');
const store=new Map(),elements={},downloads=[];let capturedPayload=null;
function button(){return{disabled:false,onclick:null};}
const offerRoot={_html:'',set innerHTML(value){this._html=String(value);if(this._html.includes('externalDailyBackupSaveBtn'))elements.externalDailyBackupSaveBtn=button();},get innerHTML(){return this._html;}};
elements.externalDailyBackupRoot=offerRoot;
const context={
  console,crypto:webcrypto,TextEncoder,TextDecoder,Blob,
  URL:{createObjectURL:()=> 'blob:daily',revokeObjectURL:()=>{}},
  setTimeout:()=>1,clearTimeout:()=>{},
  prompt:()=> 'daily backup password',showToast:()=>{},
  confirm:()=>true,window:{},
  document:{getElementById:id=>elements[id]||null,createElement:tag=>tag==='a'?{href:'',download:'',click(){downloads.push(this.download);}}:{}},
  localStorage:{getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)},
  localDateKey:date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,
  tickets:[{id:'ticket-1',content:'safe',photo:'idb:photo-1',photoData:{raw:'data:image/png;base64,forbidden'}}],shifts:[{id:'shift-1',date:'30.08.2026',hours:8,coworker:'Сам'}],
  settings:{theme:'dark',syncHmacSecret:'must-not-export',tgBotToken:'must-not-export-either'},
  securitySanitizeSettingsForBackup:value=>({theme:value.theme,syncHmacSecret:'',tgBotToken:''}),
  blankTicketObject:()=>({}),securityRuntimeSanitizeTicket:value=>value
};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context);
context.MTBackupSystem.encrypt=async payload=>{capturedPayload=JSON.parse(JSON.stringify(payload));return{format:'encrypted-test-envelope'};};

(async()=>{
  const dayOne=new Date(2026,7,30,8,0,0),dayTwo=new Date(2026,7,31,8,0,0);
  assert.equal(context.maybeOfferExternalDailyBackup(dayOne),true,'first launch of a new day offers external backup');
  assert.match(offerRoot.innerHTML,/Сохранить ежедневный бэкап/,'daily offer renders an explicit user-action button');
  assert.equal(downloads.length,0,'daily offer never starts a silent download');
  await elements.externalDailyBackupSaveBtn.onclick();
  assert.equal(store.get('externalDailyBackupDate'),'2026-08-30','successful download launch stores the local calendar date');
  assert.deepEqual(downloads,['master-tracker-daily-2026-08-30-encrypted.json'],'daily filename follows the required convention');
  assert.equal(Object.prototype.hasOwnProperty.call(capturedPayload,'photoData'),false,'external daily payload never contains photoData');
  assert.equal(JSON.stringify(capturedPayload).includes('photoData'),false,'nested ticket photoData is stripped from the external payload');
  assert.equal(JSON.stringify(capturedPayload).includes('must-not-export'),false,'safe settings export excludes secrets');
  assert.equal(context.maybeOfferExternalDailyBackup(dayOne),false,'second launch on the same day does not offer again');
  assert.equal(offerRoot.innerHTML,'','same-day offer remains hidden');
  assert.equal(context.maybeOfferExternalDailyBackup(dayTwo),true,'a new calendar day offers again');
  assert.match(offerRoot.innerHTML,/externalDailyBackupSaveBtn/,'new-day offer restores the action button');
  await context.downloadExternalDailyBackup({dateKey:'2026-08-31'});
  assert.equal(downloads.at(-1),'master-tracker-daily-2026-08-31-encrypted.json','manual daily download uses the same photo-free encrypted flow');
  assert.equal(store.get('externalDailyBackupDate'),'2026-08-31','manual successful download also satisfies today’s offer');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const settingsDomain=fs.readFileSync(path.join(root,'js','settings-domain.js'),'utf8');
  assert.match(html,/id="downloadExternalBackupNowBtn"[^>]*>Скачать бэкап сейчас</,'settings exposes the manual download button');
  assert.match(settingsDomain,/downloadExternalBackupNowBtn[^\n]+downloadExternalDailyBackup/,'manual settings button invokes external daily download');
  console.log('PASS external daily encrypted backup offer/date/photo-free/secrets/manual download');
})().catch(error=>{console.error(error);process.exitCode=1;});

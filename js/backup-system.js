(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTBackupSystem=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const FORMAT='master-tracker-encrypted-backup';
  const VERSION=1,ITERATIONS=310000,MIN_ITERATIONS=100000,MAX_ITERATIONS=1000000;
  const MAX_FILE_BYTES=220*1024*1024,MAX_PLAIN_BYTES=120*1024*1024,MAX_ITEMS=50000,MAX_PHOTOS=10000,MAX_PHOTO_CHARS=12*1024*1024;
  const enc=new TextEncoder(),dec=new TextDecoder();
  function bytesToBase64(bytes){let out='';for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return btoa(out);}
  function base64ToBytes(value){const text=String(value||'');if(!text||!/^[A-Za-z0-9+/]+={0,2}$/.test(text))throw new Error('BAD_BASE64');const raw=atob(text);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
  function hasUnsafeKeys(value,depth=0,seen=new Set()){if(depth>24)return true;if(value===null||typeof value!=='object')return false;if(seen.has(value))return false;seen.add(value);for(const key of Object.keys(value)){if(key==='__proto__'||key==='prototype'||key==='constructor'||hasUnsafeKeys(value[key],depth+1,seen))return true;}return false;}
  function isPlainObject(value){if(!value||typeof value!=='object'||Array.isArray(value))return false;const proto=Object.getPrototypeOf(value);return proto===Object.prototype||proto===null;}
  function validatePayload(data){
    if(!isPlainObject(data)||hasUnsafeKeys(data))return false;
    if(data.app&&data.app!=='master-tracker')return false;
    if(data.tickets!==undefined&&(!Array.isArray(data.tickets)||data.tickets.length>MAX_ITEMS))return false;
    if(data.shifts!==undefined&&(!Array.isArray(data.shifts)||data.shifts.length>MAX_ITEMS))return false;
    if(data.settings!==undefined&&!isPlainObject(data.settings))return false;
    if(data.photoData!==undefined){if(!isPlainObject(data.photoData)||Object.keys(data.photoData).length>MAX_PHOTOS)return false;for(const [key,value] of Object.entries(data.photoData)){if(!String(key).startsWith('idb:')||typeof value!=='string'||!value.startsWith('data:image/')||value.length>MAX_PHOTO_CHARS)return false;}}
    return Array.isArray(data.tickets)||Array.isArray(data.shifts)||isPlainObject(data.settings);
  }
  function validateEnvelope(value){
    if(!isPlainObject(value)||hasUnsafeKeys(value)||value.format!==FORMAT||Number(value.version)!==VERSION||value.algorithm!=='AES-GCM-256'||value.kdf!=='PBKDF2-SHA256')return false;
    const iterations=Number(value.iterations);if(!Number.isInteger(iterations)||iterations<MIN_ITERATIONS||iterations>MAX_ITERATIONS)return false;
    try{const salt=base64ToBytes(value.salt),iv=base64ToBytes(value.iv),cipher=base64ToBytes(value.ciphertext);return salt.length===16&&iv.length===12&&cipher.length>=16&&cipher.length<=MAX_FILE_BYTES;}catch(_e){return false;}
  }
  async function derive(password,salt,iterations){const material=await crypto.subtle.importKey('raw',enc.encode(String(password)),{name:'PBKDF2'},false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
  async function encrypt(payload,password){if(!validatePayload(payload))throw new Error('BAD_PAYLOAD');const plain=enc.encode(JSON.stringify(payload));if(plain.length>MAX_PLAIN_BYTES)throw new Error('BACKUP_TOO_LARGE');const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await derive(password,salt,ITERATIONS);const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain));return{format:FORMAT,version:VERSION,app:'master-tracker',algorithm:'AES-GCM-256',kdf:'PBKDF2-SHA256',iterations:ITERATIONS,salt:bytesToBase64(salt),iv:bytesToBase64(iv),ciphertext:bytesToBase64(cipher)};}
  async function decrypt(envelope,password){if(!validateEnvelope(envelope))throw new Error('BAD_ENVELOPE');const key=await derive(password,base64ToBytes(envelope.salt),Number(envelope.iterations));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(envelope.iv)},key,base64ToBytes(envelope.ciphertext));if(plain.byteLength>MAX_PLAIN_BYTES)throw new Error('BACKUP_TOO_LARGE');const data=JSON.parse(dec.decode(plain));if(!validatePayload(data))throw new Error('BAD_PAYLOAD');return data;}
  return{FORMAT,VERSION,ITERATIONS,MAX_FILE_BYTES,MAX_PLAIN_BYTES,hasUnsafeKeys,validatePayload,validateEnvelope,encrypt,decrypt};
});

if(typeof window!=='undefined'){
  const MT_BACKUP_MIN_PASSWORD=8;
  function mtBackupPassword(confirmNew=false){const first=prompt(confirmNew?'🔐 Створіть пароль бекапу (мінімум 8 символів):':'🔐 Введіть пароль бекапу:');if(first===null)return null;if(first.length<MT_BACKUP_MIN_PASSWORD){showToast('Пароль бекапу — мінімум 8 символів');return null;}if(confirmNew){const second=prompt('Повторіть пароль бекапу:');if(second===null||first!==second){showToast('Паролі бекапу не збігаються');return null;}}return first;}
  const MT_EXTERNAL_DAILY_BACKUP_DATE_KEY='externalDailyBackupDate';
  function mtBackupDownload(value,name){try{const blob=new Blob([JSON.stringify(value)],{type:'application/json;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);return true;}catch(_e){return false;}}
  function mtBackupCleanTicket(ticket,index){const source=(ticket&&typeof ticket==='object'&&!Array.isArray(ticket))?ticket:{};const clean=Object.assign(blankTicketObject(),source);if(typeof securityRuntimeSanitizeTicket==='function')return securityRuntimeSanitizeTicket(clean,index);return clean;}
  function mtBackupStripPhotoData(value){if(Array.isArray(value))return value.map(mtBackupStripPhotoData);if(!value||typeof value!=='object')return value;const clean={};Object.keys(value).forEach(key=>{if(key!=='photoData')clean[key]=mtBackupStripPhotoData(value[key]);});return clean;}
  function mtExternalDailyPayload(){return{app:'master-tracker',backupVersion:6,exportedAt:new Date().toISOString(),tickets:mtBackupStripPhotoData(tickets||[]),shifts:mtBackupStripPhotoData(shifts||[]),settings:securitySanitizeSettingsForBackup(settings),secretsExcluded:true};}
  function mtHideExternalDailyBackupOffer(){const root=document.getElementById('externalDailyBackupRoot');if(root)root.innerHTML='';}
  function mtRenderExternalDailyBackupOffer(dateKey){const root=document.getElementById('externalDailyBackupRoot');if(!root)return;root.innerHTML=`<div class="card" style="position:fixed; left:12px; right:12px; bottom:82px; z-index:115; max-width:560px; margin:auto; display:flex; align-items:center; gap:10px; box-shadow:0 10px 28px rgba(0,0,0,.28);"><div style="flex:1; font-size:13px; line-height:1.35;">Збережіть зовнішню зашифровану копію за сьогодні.</div><button type="button" class="btn btn-accent btn-sm" id="externalDailyBackupSaveBtn">Сохранить ежедневный бэкап</button></div>`;const button=document.getElementById('externalDailyBackupSaveBtn');if(button)button.onclick=async()=>{button.disabled=true;const ok=await downloadExternalDailyBackup({dateKey});if(!ok)button.disabled=false;};}
  downloadExternalDailyBackup=async function(opts={}){const dateKey=String(opts.dateKey||localDateKey(new Date()));const password=mtBackupPassword(true);if(!password)return false;try{const payload=mtExternalDailyPayload();if(Object.prototype.hasOwnProperty.call(payload,'photoData'))throw new Error('PHOTO_DATA_FORBIDDEN');const envelope=await MTBackupSystem.encrypt(payload,password);if(!mtBackupDownload(envelope,`master-tracker-daily-${dateKey}-encrypted.json`))throw new Error('DOWNLOAD_FAILED');localStorage.setItem(MT_EXTERNAL_DAILY_BACKUP_DATE_KEY,dateKey);mtHideExternalDailyBackupOffer();showToast('🔐 Щоденний файл бекапу збережено');return true;}catch(_e){showToast('Не вдалося створити щоденний файл бекапу');return false;}};
  maybeOfferExternalDailyBackup=function(now=new Date()){const today=localDateKey(now);if(localStorage.getItem(MT_EXTERNAL_DAILY_BACKUP_DATE_KEY)===today){mtHideExternalDailyBackupOffer();return false;}mtRenderExternalDailyBackupOffer(today);return true;};
  async function mtBackupRestore(data){
    if(!MTBackupSystem.validatePayload(data))throw new Error('BAD_PAYLOAD');
    const hasTickets=Array.isArray(data.tickets),hasShifts=Array.isArray(data.shifts),hasSettings=data.settings&&typeof data.settings==='object';
    if(!confirm(`Відновити ${[hasTickets?'заявки':'',hasShifts?'зміни':'',hasSettings?'налаштування':''].filter(Boolean).join(', ')}? Поточні дані відповідного типу буде замінено; локальні secrets/lock залишаться.`))return false;
    if(hasTickets){const next=data.tickets.map(mtBackupCleanTicket);if(data.photoData){for(const [key,value] of Object.entries(data.photoData))if(!await photoDbPut(key,value))throw new Error('PHOTO_WRITE_FAILED');}tickets=next;await saveTickets();await migrateLegacyPhotosToIdb();}
    if(hasShifts){shifts=data.shifts.map(s=>({id:String(s?.id||MTSyncEngineRuntime.uuid()),date:String(s?.date||''),hours:Number(s?.hours)||0,coworker:String(s?.coworker||'Сам')}));await saveShifts();}
    if(hasSettings){settings=typeof securityMergeImportedSettings==='function'?securityMergeImportedSettings(data.settings,settings):settings;saveSettings();}
    renderTicketsScreen();renderShiftsScreen();renderSettingsScreen();return true;
  }
  async function mtBackupMigrateLegacySlots(){
    const raw=localStorage.getItem('autoBackupSlots');if(!raw||!backupDb)return;
    let slots;try{slots=JSON.parse(raw);}catch(_e){return;}if(!Array.isArray(slots)||slots.length>3)return;
    const index=loadDailyBackupIndex();
    for(let i=0;i<slots.length;i++){
      const slot=slots[i],payload={app:'master-tracker',backupVersion:6,exportedAt:new Date(Number(slot?.ts)||Date.now()).toISOString(),tickets:slot?.tickets,shifts:slot?.shifts,settings:{},legacyMigrated:true};
      if(!MTBackupSystem.validatePayload(payload))return;
      const key=`legacy-${Number(slot.ts)||i}`;if(!await backupDbPut(key,payload))return;
      if(!index.some(x=>x?.date===key))index.push({date:key,ts:Number(slot.ts)||Date.now(),ticketsCount:payload.tickets?.length||0,shiftsCount:payload.shifts?.length||0,legacyMigrated:true});
    }
    saveDailyBackupIndex(index.slice(0,DAILY_BACKUP_MAX));localStorage.removeItem('autoBackupSlots');
  }
  exportJsonBackup=async function(){const password=mtBackupPassword(true);if(!password)return;try{const photos=await collectLocalPhotoData(tickets);const payload={app:'master-tracker',backupVersion:6,exportedAt:new Date().toISOString(),tickets,shifts,settings:securitySanitizeSettingsForBackup(settings),photoData:photos.photoData};const envelope=await MTBackupSystem.encrypt(payload,password);mtBackupDownload(envelope,`master-tracker-backup-${localDateKey(new Date())}-encrypted.json`);showToast(photos.missingPhotos?`Бекап зашифровано; не знайдено фото: ${photos.missingPhotos}`:'🔐 Бекап зашифровано AES-GCM');}catch(_e){showToast('Не вдалося створити зашифрований бекап');}};
  handleJsonImportFile=async function(file){if(!file)return;if(file.size>MTBackupSystem.MAX_FILE_BYTES){showToast('Файл бекапу завеликий');return;}try{const parsed=JSON.parse(await file.text());let payload;if(parsed?.format===MTBackupSystem.FORMAT){const password=mtBackupPassword(false);if(!password)return;payload=await MTBackupSystem.decrypt(parsed,password);}else{if(!MTBackupSystem.validatePayload(parsed))throw new Error('BAD_LEGACY');if(!confirm('Це legacy незашифрований бекап. Імпортувати після перевірки схеми?'))return;payload=parsed;}if(await mtBackupRestore(payload))showToast('✅ Бекап відновлено');}catch(_e){showToast('❌ Невірний пароль, пошкоджений або небезпечний файл');}};
  maybeRunDailyBackup=async function(){if(!backupDb)return;try{await mtBackupMigrateLegacySlots();const today=localDateKey(new Date()),index=loadDailyBackupIndex();if(index.some(x=>x?.date===today))return;const payload={app:'master-tracker',backupVersion:6,exportedAt:new Date().toISOString(),tickets,shifts,settings:securitySanitizeSettingsForBackup(settings),secretsExcluded:true};if(!await backupDbPut(today,payload))return;const next=index.filter(x=>x?.date!==today);next.unshift({date:today,ts:Date.now(),ticketsCount:tickets.length,shiftsCount:shifts.length});const overflow=next.splice(DAILY_BACKUP_MAX);for(const old of overflow)await backupDbDelete(old.date);saveDailyBackupIndex(next);}catch(_e){console.error('Daily backup failed');}};
  downloadDailyBackup=async function(dateKey,opts={}){if(opts.silent)return;const payload=await backupDbGet(dateKey);if(!payload){showToast('Бекап не знайдено');return;}const password=mtBackupPassword(true);if(!password)return;try{const clean={app:'master-tracker',backupVersion:6,exportedAt:payload.exportedAt,tickets:payload.tickets||[],shifts:payload.shifts||[],settings:securitySanitizeSettingsForBackup(payload.settings||{})};mtBackupDownload(await MTBackupSystem.encrypt(clean,password),`master-tracker-backup-${dateKey}-encrypted.json`);showToast('🔐 Щоденний бекап зашифровано');}catch(_e){showToast('Не вдалося зашифрувати бекап');}};
  restoreDailyBackup=async function(dateKey){const payload=await backupDbGet(dateKey);if(!payload){showToast('Бекап не знайдено');return;}try{if(await mtBackupRestore(payload))showToast('✅ Щоденний бекап відновлено');}catch(_e){showToast('Щоденний бекап пошкоджено');}};
}

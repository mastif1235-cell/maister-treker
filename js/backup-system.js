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
    const validCollection=value=>Array.isArray(value)&&value.length<=MAX_ITEMS&&value.every(isPlainObject);
    if(data.tickets!==undefined&&!validCollection(data.tickets))return false;
    if(data.shifts!==undefined&&!validCollection(data.shifts))return false;
    if(data.diagnostics!==undefined&&!validCollection(data.diagnostics))return false;
    if(data.networkPoints!==undefined&&!validCollection(data.networkPoints))return false;
    if(data.settings!==undefined&&!isPlainObject(data.settings))return false;
    if(data.photoData!==undefined){if(!isPlainObject(data.photoData)||Object.keys(data.photoData).length>MAX_PHOTOS)return false;for(const [key,value] of Object.entries(data.photoData)){if(!String(key).startsWith('idb:')||typeof value!=='string'||!value.startsWith('data:image/')||value.length>MAX_PHOTO_CHARS)return false;}}
    if(data.syncJournal!==undefined&&!isPlainObject(data.syncJournal))return false;
    try{if(enc.encode(JSON.stringify(data)).byteLength>MAX_PLAIN_BYTES)return false;}catch(_e){return false;}
    return Array.isArray(data.tickets)||Array.isArray(data.shifts)||isPlainObject(data.settings)||Array.isArray(data.diagnostics)||Array.isArray(data.networkPoints);
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
  const MT_BACKUP_VAULT_KEY_RECORD='__backupPasswordKeyV1';
  const MT_BACKUP_VAULT_SECRET_RECORD='__backupPasswordSecretV1';
  async function mtBackupVaultStoredKey(){const key=await backupDbGet(MT_BACKUP_VAULT_KEY_RECORD);return key&&key.type==='secret'&&key.algorithm?.name==='AES-GCM'?key:null;}
  async function mtBackupVaultCreateKey(){const existing=await mtBackupVaultStoredKey();if(existing)return existing;try{const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);return await backupDbPut(MT_BACKUP_VAULT_KEY_RECORD,key)?key:null;}catch(_e){return null;}}
  async function mtBackupVaultSave(password){if(String(password||'').length<MT_BACKUP_MIN_PASSWORD)return false;try{const key=await mtBackupVaultCreateKey();if(!key)return false;const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(String(password))));return backupDbPut(MT_BACKUP_VAULT_SECRET_RECORD,{version:1,iv,ciphertext});}catch(_e){return false;}}
  async function mtBackupVaultRead(){try{const [key,record]=await Promise.all([mtBackupVaultStoredKey(),backupDbGet(MT_BACKUP_VAULT_SECRET_RECORD)]);if(!key||!record||Number(record.version)!==1)return null;const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(record.iv)},key,new Uint8Array(record.ciphertext));const password=new TextDecoder().decode(plain);return password.length>=MT_BACKUP_MIN_PASSWORD?password:null;}catch(_e){return null;}}
  async function mtBackupVaultForget(){const secretDeleted=await backupDbDelete(MT_BACKUP_VAULT_SECRET_RECORD);const keyDeleted=await backupDbDelete(MT_BACKUP_VAULT_KEY_RECORD);return secretDeleted&&keyDeleted;}
  async function mtBackupPasswordForExport(){return (await mtBackupVaultRead())||mtBackupPassword(true);}
  async function mtBackupDecryptForImport(envelope){const saved=await mtBackupVaultRead();if(saved){try{return await MTBackupSystem.decrypt(envelope,saved);}catch(_e){}}const manual=mtBackupPassword(false);return manual?MTBackupSystem.decrypt(envelope,manual):null;}
  renderBackupPasswordStatus=async function(){const saved=!!(await mtBackupVaultRead());const status=document.getElementById('backupPasswordStatus');const save=document.getElementById('backupPasswordSaveBtn');const change=document.getElementById('backupPasswordChangeBtn');const forget=document.getElementById('backupPasswordForgetBtn');if(status)status.textContent=saved?'✅ Пароль для бэкапов сохранён на этом устройстве':'Пароль для бэкапов ещё не сохранён';if(save)save.classList.toggle('hidden',saved);if(change)change.classList.toggle('hidden',!saved);if(forget)forget.classList.toggle('hidden',!saved);return saved;};
  saveBackupPasswordCredential=async function(){const password=mtBackupPassword(true);if(!password)return false;const ok=await mtBackupVaultSave(password);showToast(ok?'✅ Пароль для бекапів збережено':'Не вдалося безпечно зберегти пароль на цьому пристрої');await renderBackupPasswordStatus();return ok;};
  forgetBackupPasswordCredential=async function(){const ok=await mtBackupVaultForget();showToast(ok?'Пароль для бекапів забуто':'Не вдалося видалити збережений пароль');await renderBackupPasswordStatus();return ok;};
  const MT_EXTERNAL_DAILY_BACKUP_DATE_KEY='externalDailyBackupDate';
  function mtBackupDownload(value,name){try{const blob=new Blob([JSON.stringify(value)],{type:'application/json;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);return true;}catch(_e){return false;}}
  function mtBackupCleanTicket(ticket,index){const source=(ticket&&typeof ticket==='object'&&!Array.isArray(ticket))?ticket:{};const clean=Object.assign(blankTicketObject(),source);if(typeof securityRuntimeSanitizeTicket==='function')return securityRuntimeSanitizeTicket(clean,index);return clean;}
  function mtBackupStripPhotoData(value){if(Array.isArray(value))return value.map(mtBackupStripPhotoData);if(!value||typeof value!=='object')return value;const clean={};Object.keys(value).forEach(key=>{if(key!=='photoData')clean[key]=mtBackupStripPhotoData(value[key]);});return clean;}
  function mtBackupSafeExport(value){return typeof securityStripSystemSecrets==='function'?securityStripSystemSecrets(value):value;}
  function mtExternalDailyPayload(){const tools=typeof toolsExportData==='function'?toolsExportData():{};return{app:'master-tracker',backupVersion:6,exportedAt:new Date().toISOString(),tickets:mtBackupSafeExport(mtBackupStripPhotoData(tickets||[])),shifts:mtBackupSafeExport(mtBackupStripPhotoData(shifts||[])),settings:securitySanitizeSettingsForBackup(settings),diagnostics:mtBackupSafeExport(tools.diagnostics||[]),networkPoints:mtBackupSafeExport(tools.networkPoints||[]),secretsExcluded:true};}
  function mtHideExternalDailyBackupOffer(){const root=document.getElementById('externalDailyBackupRoot');if(root)root.innerHTML='';}
  function mtRenderExternalDailyBackupOffer(dateKey){const root=document.getElementById('externalDailyBackupRoot');if(!root)return;root.innerHTML=`<div class="card" style="position:fixed; left:12px; right:12px; bottom:82px; z-index:115; max-width:560px; margin:auto; display:flex; align-items:center; gap:10px; box-shadow:0 10px 28px rgba(0,0,0,.28);"><div style="flex:1; font-size:13px; line-height:1.35;">Збережіть зовнішню зашифровану копію за сьогодні.</div><button type="button" class="btn btn-accent btn-sm" id="externalDailyBackupSaveBtn">Сохранить ежедневный бэкап</button></div>`;const button=document.getElementById('externalDailyBackupSaveBtn');if(button)button.onclick=async()=>{button.disabled=true;const ok=await downloadExternalDailyBackup({dateKey});if(!ok)button.disabled=false;};}
  downloadExternalDailyBackup=async function(opts={}){const dateKey=String(opts.dateKey||localDateKey(new Date()));const password=await mtBackupPasswordForExport();if(!password)return false;try{const payload=mtExternalDailyPayload();if(Object.prototype.hasOwnProperty.call(payload,'photoData'))throw new Error('PHOTO_DATA_FORBIDDEN');const envelope=await MTBackupSystem.encrypt(payload,password);if(!mtBackupDownload(envelope,`master-tracker-daily-${dateKey}-encrypted.json`))throw new Error('DOWNLOAD_FAILED');localStorage.setItem(MT_EXTERNAL_DAILY_BACKUP_DATE_KEY,dateKey);mtHideExternalDailyBackupOffer();showToast('🔐 Щоденний файл бекапу збережено');return true;}catch(error){globalThis.MTSafeError?.reportError?.(error,{scope:'backup-daily-export'});showToast('Не вдалося створити щоденний файл бекапу');return false;}};
  maybeOfferExternalDailyBackup=function(now=new Date()){const today=localDateKey(now);if(localStorage.getItem(MT_EXTERNAL_DAILY_BACKUP_DATE_KEY)===today){mtHideExternalDailyBackupOffer();return false;}mtRenderExternalDailyBackupOffer(today);return true;};
  // Незмінна копія поточного стану перед заміною даних. Використовуємо той
  // самий механізм, що й відновлення з Google Sheets, щоб у користувача була
  // точка повернення навіть після невдалого імпорту бекапу.
  async function mtBackupWritePreRestoreSnapshot(){
    try{
      if(typeof mtCreatePreRestoreBackup==='function')return await mtCreatePreRestoreBackup();
      if(typeof backupDb==='undefined'||!backupDb||typeof backupDbPut!=='function')return null;
      const tools=typeof toolsExportData==='function'?toolsExportData():{};
      const payload={app:'master-tracker',backupVersion:6,exportedAt:new Date().toISOString(),tickets:mtBackupSafeExport(tickets||[]),shifts:mtBackupSafeExport(shifts||[]),settings:typeof securitySanitizeSettingsForBackup==='function'?securitySanitizeSettingsForBackup(settings):settings,diagnostics:mtBackupSafeExport(tools.diagnostics||[]),networkPoints:mtBackupSafeExport(tools.networkPoints||[]),secretsExcluded:true};
      const key='pre-restore-'+new Date().toISOString().replace(/[:.]/g,'-');
      if(!await backupDbPut(key,payload))return null;
      if(typeof loadDailyBackupIndex==='function'&&typeof saveDailyBackupIndex==='function'){
        const index=loadDailyBackupIndex();
        index.unshift({date:key,ts:Date.now(),ticketsCount:(tickets||[]).length,shiftsCount:(shifts||[]).length});
        saveDailyBackupIndex(index.slice(0,typeof DAILY_BACKUP_MAX==='number'?DAILY_BACKUP_MAX:10));
      }
      return key;
    }catch(error){
      globalThis.MTSafeError?.reportError?.(error,{scope:'backup-pre-restore'});
      return null;
    }
  }
  // Той самий контракт, що й у відновленні з хмари: після помилки на диску не
  // має лишатися частково застосована суміш старих і нових даних.
  async function mtBackupRollbackRestore(previous){
    const rollbackFailed=[];
    if(previous.tickets){
      tickets=previous.tickets;syncTicketsSnapshot=previous.ticketSnapshot;
      let saved=true;
      try{saved=typeof saveTicketsLocalOnly!=='function'||(await saveTicketsLocalOnly())!==false;}catch(_e){saved=false;}
      if(!saved)rollbackFailed.push('заявки');
    }
    if(previous.shifts){
      shifts=previous.shifts;syncShiftsSnapshot=previous.shiftSnapshot;
      let saved=true;
      try{saved=typeof saveShiftsLocalOnly!=='function'||(await saveShiftsLocalOnly())!==false;}catch(_e){saved=false;}
      if(!saved)rollbackFailed.push('зміни');
    }
    if(previous.settings){
      settings=previous.settings;
      try{if(typeof saveSettings==='function')saveSettings();}catch(_e){rollbackFailed.push('налаштування');}
    }
    if(previous.tools&&typeof toolsRestoreData==='function'){
      try{toolsRestoreData(previous.tools);}catch(_e){rollbackFailed.push('інструменти');}
    }
    return rollbackFailed;
  }
  async function mtBackupRestore(data){
    if(!MTBackupSystem.validatePayload(data))throw new Error('BAD_PAYLOAD');
    const hasTickets=Array.isArray(data.tickets),hasShifts=Array.isArray(data.shifts),hasSettings=data.settings&&typeof data.settings==='object',hasTools=Array.isArray(data.diagnostics)||Array.isArray(data.networkPoints);
    const nextTickets=hasTickets?data.tickets.map((ticket,index)=>mtBackupCleanTicket(JSON.parse(JSON.stringify(ticket)),index)):null;
    const nextShifts=hasShifts?data.shifts.map(s=>({id:String(s.id||MTSyncEngineRuntime.uuid()),date:String(s.date||''),hours:Number(s.hours)||0,coworker:String(s.coworker||'Сам')})):null;
    const nextSettings=hasSettings?(typeof securityMergeImportedSettings==='function'?securityMergeImportedSettings(JSON.parse(JSON.stringify(data.settings)),settings):settings):null;
    const nextTools=hasTools?{diagnostics:Array.isArray(data.diagnostics)?JSON.parse(JSON.stringify(data.diagnostics)):undefined,networkPoints:Array.isArray(data.networkPoints)?JSON.parse(JSON.stringify(data.networkPoints)):undefined}:null;
    const photoEntries=data.photoData?Object.entries(data.photoData):[];
    if(!await openConfirmModal({title:'Відновити резервну копію?',message:`Буде відновлено: ${[hasTickets?'заявки':'',hasShifts?'зміни':'',hasSettings?'налаштування':'',hasTools?'інструменти':''].filter(Boolean).join(', ')}. Поточні дані відповідного типу буде замінено; локальні secrets і захист входу залишаться.`,confirmLabel:'Відновити',danger:true}))return false;
    // Знімок робимо після підтвердження користувача й до першої заміни даних.
    const previous={
      tickets:hasTickets&&typeof tickets!=='undefined'?JSON.parse(JSON.stringify(tickets||[])):null,
      ticketSnapshot:hasTickets&&typeof syncTicketsSnapshot!=='undefined'?JSON.parse(JSON.stringify(syncTicketsSnapshot||[])):null,
      shifts:hasShifts&&typeof shifts!=='undefined'?JSON.parse(JSON.stringify(shifts||[])):null,
      shiftSnapshot:hasShifts&&typeof syncShiftsSnapshot!=='undefined'?JSON.parse(JSON.stringify(syncShiftsSnapshot||[])):null,
      settings:hasSettings&&typeof settings!=='undefined'?JSON.parse(JSON.stringify(settings||{})):null,
      tools:hasTools&&typeof toolsExportData==='function'?JSON.parse(JSON.stringify(toolsExportData())):null
    };
    await mtBackupWritePreRestoreSnapshot();
    try{
      if(hasTickets){for(const [key,value] of photoEntries)if(!await photoDbPut(key,value))throw new Error('PHOTO_WRITE_FAILED');tickets=nextTickets;syncTicketsSnapshot=JSON.parse(JSON.stringify(nextTickets));if(!await saveTicketsLocalOnly())throw new Error('TICKET_WRITE_FAILED');await migrateLegacyPhotosToIdb();}
      if(hasShifts){shifts=nextShifts;syncShiftsSnapshot=JSON.parse(JSON.stringify(nextShifts));if(!await saveShiftsLocalOnly())throw new Error('SHIFT_WRITE_FAILED');}
      if(hasSettings){settings=nextSettings;saveSettings();}
      if(hasTools&&typeof toolsRestoreData==='function')toolsRestoreData(nextTools);
      if(data.syncJournal){
        try{
          const journalState=JSON.parse(JSON.stringify(data.syncJournal));
          if(typeof MTSyncJournalStorage!=='undefined'&&MTSyncJournalStorage&&typeof MTSyncJournalStorage.save==='function')await MTSyncJournalStorage.save(journalState);
          if(typeof syncEngine!=='undefined'&&syncEngine&&typeof syncEngine.replaceState==='function')await syncEngine.replaceState(journalState);
        }catch(_journalError){}
      }
    }catch(error){
      const rollbackFailed=await mtBackupRollbackRestore(previous);
      renderTicketsScreen();renderShiftsScreen();renderSettingsScreen();
      showToast(rollbackFailed.length?'❌ Відновлення не вдалося, частину даних не вдалося повернути':'❌ Відновлення не вдалося. Локальні дані повернено');
      throw error;
    }
    renderTicketsScreen();renderShiftsScreen();renderSettingsScreen();showToast('Відновлені дані збережено локально й не відправлено в хмару');return true;
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
  exportJsonBackup=async function(){const password=await mtBackupPasswordForExport();if(!password)return;try{const tools=typeof toolsExportData==='function'?toolsExportData():{},photos=await collectLocalPhotoData(tickets.concat(typeof toolsPhotoOwnerRecords==='function'?toolsPhotoOwnerRecords():[]));const payload={app:'master-tracker',backupVersion:6,exportedAt:new Date().toISOString(),tickets:mtBackupSafeExport(tickets),shifts:mtBackupSafeExport(shifts),settings:securitySanitizeSettingsForBackup(settings),diagnostics:mtBackupSafeExport(tools.diagnostics||[]),networkPoints:mtBackupSafeExport(tools.networkPoints||[]),photoData:photos.photoData};const envelope=await MTBackupSystem.encrypt(payload,password);mtBackupDownload(envelope,`master-tracker-backup-${localDateKey(new Date())}-encrypted.json`);showToast(photos.missingPhotos?`Бекап зашифровано; не знайдено фото: ${photos.missingPhotos}`:'🔐 Бекап зашифровано AES-GCM');}catch(error){globalThis.MTSafeError?.reportError?.(error,{scope:'backup-export'});showToast('Не вдалося створити зашифрований бекап');}};
  handleJsonImportFile=async function(file){if(!file)return;if(file.size>MTBackupSystem.MAX_FILE_BYTES){showToast('Файл бекапу завеликий');return;}try{const parsed=JSON.parse(await file.text());let payload;if(parsed?.format===MTBackupSystem.FORMAT){payload=await mtBackupDecryptForImport(parsed);if(!payload)return;}else{if(!MTBackupSystem.validatePayload(parsed))throw new Error('BAD_LEGACY');if(!await openConfirmModal({title:'Імпортувати незашифрований бекап?',message:'Це старий незашифрований файл. Його схема перевірена, але після підтвердження поточні дані відповідного типу можуть бути замінені.',confirmLabel:'Імпортувати',danger:true}))return;payload=parsed;}if(await mtBackupRestore(payload))showToast('✅ Бекап відновлено');}catch(error){globalThis.MTSafeError?.reportError?.(error,{scope:'backup-import'});showToast('❌ Невірний пароль, пошкоджений або небезпечний файл');}};
  maybeRunDailyBackup=async function(){if(!backupDb)return;try{await mtBackupMigrateLegacySlots();const today=localDateKey(new Date()),index=loadDailyBackupIndex();if(index.some(x=>x?.date===today))return;const tools=typeof toolsExportData==='function'?toolsExportData():{},payload={app:'master-tracker',backupVersion:6,exportedAt:new Date().toISOString(),tickets:mtBackupSafeExport(tickets),shifts:mtBackupSafeExport(shifts),settings:securitySanitizeSettingsForBackup(settings),diagnostics:mtBackupSafeExport(tools.diagnostics||[]),networkPoints:mtBackupSafeExport(tools.networkPoints||[]),secretsExcluded:true};if(!await backupDbPut(today,payload))return;const next=index.filter(x=>x?.date!==today);next.unshift({date:today,ts:Date.now(),ticketsCount:tickets.length,shiftsCount:shifts.length});const overflow=next.splice(DAILY_BACKUP_MAX);for(const old of overflow)await backupDbDelete(old.date);saveDailyBackupIndex(next);}catch(error){globalThis.MTSafeError?.reportError?.(error,{scope:'backup-daily-snapshot'});}};
  downloadDailyBackup=async function(dateKey,opts={}){if(opts.silent)return;const payload=await backupDbGet(dateKey);if(!payload){showToast('Бекап не знайдено');return;}const password=await mtBackupPasswordForExport();if(!password)return;try{const clean={app:'master-tracker',backupVersion:6,exportedAt:payload.exportedAt,tickets:mtBackupSafeExport(payload.tickets||[]),shifts:mtBackupSafeExport(payload.shifts||[]),settings:securitySanitizeSettingsForBackup(payload.settings||{}),diagnostics:mtBackupSafeExport(payload.diagnostics||[]),networkPoints:mtBackupSafeExport(payload.networkPoints||[])};mtBackupDownload(await MTBackupSystem.encrypt(clean,password),`master-tracker-backup-${dateKey}-encrypted.json`);showToast('🔐 Щоденний бекап зашифровано');}catch(_e){showToast('Не вдалося зашифрувати бекап');}};
  restoreDailyBackup=async function(dateKey){const payload=await backupDbGet(dateKey);if(!payload){showToast('Бекап не знайдено');return;}try{if(await mtBackupRestore(payload))showToast('✅ Щоденний бекап відновлено');}catch(_e){showToast('Щоденний бекап пошкоджено');}};
}

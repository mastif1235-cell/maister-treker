/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — backup password vault + recovery key (v65 security.8)
   Пароль бекапу зберігається лише на цьому пристрої: зашифрований AES-GCM
   неекспортованим CryptoKey, який лежить в окремому IndexedDB vault.
   ===================================================================== */

const SECURITY_BACKUP_VAULT_RELEASE_LABEL = 'v65.0-security.8 · 2026-08-18';
const SECURITY_BACKUP_VAULT_DB = 'maister-tracker-security-vault-v1';
const SECURITY_BACKUP_VAULT_STORE = 'keys';
const SECURITY_BACKUP_VAULT_KEY_ID = 'backup-password-wrap-key';
const SECURITY_BACKUP_VAULT_STATE_KEY = 'backupPasswordVaultV1';

function securityBackupVaultOpenDb(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(SECURITY_BACKUP_VAULT_DB,1);
    req.onupgradeneeded = ()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(SECURITY_BACKUP_VAULT_STORE)) db.createObjectStore(SECURITY_BACKUP_VAULT_STORE);
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error || new Error('VAULT_DB_OPEN'));
  });
}

async function securityBackupVaultGetDeviceKey(createIfMissing=true){
  const db=await securityBackupVaultOpenDb();
  try{
    const existing=await new Promise((resolve,reject)=>{
      const tx=db.transaction(SECURITY_BACKUP_VAULT_STORE,'readonly');
      const req=tx.objectStore(SECURITY_BACKUP_VAULT_STORE).get(SECURITY_BACKUP_VAULT_KEY_ID);
      req.onsuccess=()=>resolve(req.result || null);
      req.onerror=()=>reject(req.error || new Error('VAULT_KEY_READ'));
    });
    if(existing || !createIfMissing) return existing;
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(SECURITY_BACKUP_VAULT_STORE,'readwrite');
      tx.objectStore(SECURITY_BACKUP_VAULT_STORE).put(key,SECURITY_BACKUP_VAULT_KEY_ID);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error || new Error('VAULT_KEY_WRITE'));
    });
    return key;
  } finally { db.close(); }
}

function securityBackupRecoveryKeyGenerate(){
  const bytes=crypto.getRandomValues(new Uint8Array(24));
  return securityBackupBytesToBase64(bytes).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function securityBackupRecoveryKeyNormalize(value){ return String(value||'').trim().replace(/\s+/g,''); }

async function securityBackupVaultSave(password,recoveryKey){
  if(!password || password.length < SECURITY_BACKUP_MIN_PASSWORD) throw new Error('PASSWORD_TOO_SHORT');
  recoveryKey=securityBackupRecoveryKeyNormalize(recoveryKey) || securityBackupRecoveryKeyGenerate();
  const deviceKey=await securityBackupVaultGetDeviceKey(true);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=new TextEncoder().encode(JSON.stringify({password,recoveryKey,createdAt:new Date().toISOString()}));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},deviceKey,plain));
  localStorage.setItem(SECURITY_BACKUP_VAULT_STATE_KEY,JSON.stringify({version:1,iv:securityBackupBytesToBase64(iv),ciphertext:securityBackupBytesToBase64(cipher)}));
  return {password,recoveryKey};
}

async function securityBackupVaultLoad(){
  const raw=localStorage.getItem(SECURITY_BACKUP_VAULT_STATE_KEY);
  if(!raw) return null;
  try{
    const state=JSON.parse(raw);
    const deviceKey=await securityBackupVaultGetDeviceKey(false);
    if(!deviceKey) return null;
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:securityBackupBase64ToBytes(state.iv)},deviceKey,securityBackupBase64ToBytes(state.ciphertext));
    const value=JSON.parse(new TextDecoder().decode(plain));
    return value && value.password && value.recoveryKey ? value : null;
  }catch(err){ console.error('Backup vault read failed:',err); return null; }
}

async function securityBackupVaultForget(){
  localStorage.removeItem(SECURITY_BACKUP_VAULT_STATE_KEY);
  try{
    const db=await securityBackupVaultOpenDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(SECURITY_BACKUP_VAULT_STORE,'readwrite');
      tx.objectStore(SECURITY_BACKUP_VAULT_STORE).delete(SECURITY_BACKUP_VAULT_KEY_ID);
      tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
    });
    db.close();
  }catch(e){}
}

async function securityBackupWrapPasswordForRecovery(password,recoveryKey){
  recoveryKey=securityBackupRecoveryKeyNormalize(recoveryKey);
  if(!recoveryKey) return null;
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await securityBackupDeriveKey(recoveryKey,salt,180000);
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(password)));
  return {version:1,iterations:180000,salt:securityBackupBytesToBase64(salt),iv:securityBackupBytesToBase64(iv),ciphertext:securityBackupBytesToBase64(cipher)};
}

async function securityBackupUnwrapPasswordWithRecovery(wrap,recoveryKey){
  if(!wrap) throw new Error('NO_RECOVERY_WRAP');
  const key=await securityBackupDeriveKey(securityBackupRecoveryKeyNormalize(recoveryKey),securityBackupBase64ToBytes(wrap.salt),wrap.iterations);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:securityBackupBase64ToBytes(wrap.iv)},key,securityBackupBase64ToBytes(wrap.ciphertext));
  return new TextDecoder().decode(plain);
}

async function securityBackupGetOrCreateCredentials(){
  const saved=await securityBackupVaultLoad();
  if(saved) return saved;
  const password=securityBackupAskNewPassword();
  if(!password) return null;
  try{
    const creds=await securityBackupVaultSave(password,securityBackupRecoveryKeyGenerate());
    setTimeout(()=>securityBackupShowRecoveryKey(creds.recoveryKey,true),50);
    return creds;
  }catch(err){
    console.error('Backup vault setup failed:',err);
    showToast('Не вдалося безпечно запам’ятати пароль бекапу на цьому пристрої');
    return null;
  }
}

function securityBackupShowRecoveryKey(key,firstTime=false){
  if(!key) return;
  openModal(firstTime ? '🛟 Збережіть ключ відновлення' : '🛟 Ключ відновлення',`
    <div style="font-size:12.5px;color:var(--text-dim);line-height:1.55;margin-bottom:10px;">
      ${firstTime?'Це запасний ключ на випадок втрати пароля або переходу на інший телефон.':'Цим ключем можна відновити доступ до зашифрованих бекапів, якщо пароль забуто.'}
      Не надсилайте його стороннім.
    </div>
    <div style="font-family:var(--mono);font-size:13px;overflow-wrap:anywhere;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);" id="backupRecoveryKeyText">${escapeHtml(key)}</div>
    <button type="button" class="btn btn-accent btn-block" id="backupRecoveryCopyBtn" style="margin-top:10px;">📋 Копіювати ключ</button>
  `,{onOpen:root=>{
    root.querySelector('#backupRecoveryCopyBtn').onclick=async()=>{
      try{ await navigator.clipboard.writeText(key); showToast('Ключ відновлення скопійовано'); }
      catch(e){ showToast('Не вдалося скопіювати ключ'); }
    };
  }});
}

async function securityBackupConfigurePassword(){
  const current=await securityBackupVaultLoad();
  const p1=prompt(`${current?'🔐 Новий пароль резервних копій':'🔐 Пароль резервних копій'}\n\nМінімум ${SECURITY_BACKUP_MIN_PASSWORD} символів.`);
  if(p1===null) return;
  if(p1.length<SECURITY_BACKUP_MIN_PASSWORD){ showToast(`Пароль бекапу — мінімум ${SECURITY_BACKUP_MIN_PASSWORD} символів`); return; }
  const p2=prompt('Повторіть пароль:');
  if(p2===null) return;
  if(p1!==p2){ showToast('Паролі не збігаються'); return; }
  const recoveryKey=current?.recoveryKey || securityBackupRecoveryKeyGenerate();
  await securityBackupVaultSave(p1,recoveryKey);
  showToast(current?'✅ Пароль бекапу змінено':'✅ Пароль бекапу збережено на цьому пристрої');
  if(!current) securityBackupShowRecoveryKey(recoveryKey,true);
  securityBackupRenderVaultCard();
}

async function securityBackupRenderVaultCard(){
  const status=document.getElementById('backupVaultStatus');
  if(!status) return;
  const saved=await securityBackupVaultLoad();
  status.textContent=saved?'✅ Пароль збережено на цьому пристрої':'Пароль ще не збережено';
  const showBtn=document.getElementById('backupVaultRecoveryBtn');
  const forgetBtn=document.getElementById('backupVaultForgetBtn');
  if(showBtn) showBtn.classList.toggle('hidden',!saved);
  if(forgetBtn) forgetBtn.classList.toggle('hidden',!saved);
}

function securityBackupEnsureVaultSettingsCard(){
  if(document.getElementById('backupVaultSettingsCard')) return;
  const screen=document.getElementById('screen-settings');
  if(!screen) return;
  const details=document.createElement('details');
  details.className='card acc-card';
  details.id='backupVaultSettingsCard';
  details.innerHTML=`
    <summary>Пароль резервних копій <span class="acc-chevron">▾</span></summary>
    <div style="font-size:12.5px;color:var(--text-dim);line-height:1.5;margin-bottom:10px;">Вводиться один раз і потім використовується автоматично для зашифрованих бекапів на цьому телефоні.</div>
    <div id="backupVaultStatus" style="font-size:13px;margin-bottom:10px;"></div>
    <button type="button" class="btn btn-block" id="backupVaultSetBtn">🔐 Встановити / змінити пароль</button>
    <button type="button" class="btn btn-block hidden" id="backupVaultRecoveryBtn" style="margin-top:8px;">🛟 Показати ключ відновлення</button>
    <button type="button" class="btn btn-block btn-danger hidden" id="backupVaultForgetBtn" style="margin-top:8px;">🧹 Забути пароль на цьому пристрої</button>
  `;
  screen.appendChild(details);
  details.querySelector('#backupVaultSetBtn').onclick=()=>securityBackupConfigurePassword();
  details.querySelector('#backupVaultRecoveryBtn').onclick=async()=>{ const saved=await securityBackupVaultLoad(); if(saved) securityBackupShowRecoveryKey(saved.recoveryKey,false); };
  details.querySelector('#backupVaultForgetBtn').onclick=async()=>{
    if(!confirm('Забути збережений пароль бекапу на цьому телефоні? Уже створені зашифровані файли не зміняться. Для них знадобиться пароль або ключ відновлення.')) return;
    await securityBackupVaultForget(); showToast('Пароль бекапу забуто на цьому пристрої'); securityBackupRenderVaultCard();
  };
  securityBackupRenderVaultCard();
}

if(typeof securityBackupEncryptObject==='function'){
  const securityBackupEncryptObjectV7=securityBackupEncryptObject;
  securityBackupEncryptObject=async function(payload,password){
    const saved=await securityBackupVaultLoad();
    const actualPassword=password || saved?.password;
    if(!actualPassword) throw new Error('NO_BACKUP_PASSWORD');
    const envelope=await securityBackupEncryptObjectV7(payload,actualPassword);
    const recoveryKey=saved?.recoveryKey;
    if(recoveryKey) envelope.recoveryPasswordWrap=await securityBackupWrapPasswordForRecovery(actualPassword,recoveryKey);
    envelope.vaultVersion=1;
    return envelope;
  };
}

if(typeof exportJsonBackup==='function'){
  exportJsonBackup=async function(){
    if(!window.crypto?.subtle){ showToast('Цей браузер не підтримує безпечне шифрування бекапу'); return; }
    const creds=await securityBackupGetOrCreateCredentials();
    if(!creds) return;
    try{
      showToast('🔐 Готую та шифрую повний бекап…');
      const {photoData,missingPhotos}=await collectLocalPhotoData(tickets);
      const payload={app:'master-tracker',backupVersion:4,encryptedSource:true,exportedAt:new Date().toISOString(),tickets,shifts,settings:typeof securitySanitizeSettingsForBackup==='function'?securitySanitizeSettingsForBackup(settings):settings,photoData};
      const envelope=await securityBackupEncryptObject(payload,creds.password);
      securityBackupDownloadEnvelope(envelope,`master-tracker-backup-${localDateKey(new Date())}-encrypted.json`);
      showToast(missingPhotos?`🔐 Бекап зашифровано, але ${missingPhotos} фото локально не знайдено`:'🔐 Повний бекап зашифровано — пароль взято з цього пристрою');
    }catch(err){ console.error('Vault encrypted export failed:',err); showToast('Не вдалося зашифрувати бекап'); }
  };
}

if(typeof downloadDailyBackup==='function'){
  downloadDailyBackup=async function(dateKey,opts={}){
    const payload=await backupDbGet(dateKey);
    if(!payload){ if(!opts.silent) showToast('Не вдалося знайти цей бекап'); return; }
    if(opts.silent) return;
    const creds=await securityBackupGetOrCreateCredentials();
    if(!creds) return;
    try{
      const clean={app:'master-tracker',backupVersion:4,encryptedSource:true,exportedAt:payload.exportedAt,tickets:payload.tickets||[],shifts:payload.shifts||[],settings:typeof securitySanitizeSettingsForBackup==='function'?securitySanitizeSettingsForBackup(payload.settings||{}):(payload.settings||{})};
      const envelope=await securityBackupEncryptObject(clean,creds.password);
      securityBackupDownloadEnvelope(envelope,`master-tracker-backup-${dateKey}-encrypted.json`);
      showToast('🔐 Щоденний бекап зашифровано збереженим паролем');
    }catch(err){ console.error('Vault daily export failed:',err); showToast('Не вдалося зашифрувати щоденний бекап'); }
  };
}

if(typeof handleJsonImportFile==='function'){
  const securityBackupVaultPreviousImport=handleJsonImportFile;
  handleJsonImportFile=async function(file){
    if(!file) return;
    let parsed;
    try{ parsed=JSON.parse(await file.text()); }catch(e){ return securityBackupVaultPreviousImport(file); }
    if(parsed?.format!==SECURITY_BACKUP_ENVELOPE) return securityBackupVaultPreviousImport(file);

    const saved=await securityBackupVaultLoad();
    if(saved){
      try{ const payload=await securityBackupDecryptEnvelope(parsed,saved.password); await securityBackupRestorePayload(payload); return; }
      catch(e){ /* файл міг бути створений старим паролем */ }
    }

    const password=prompt('🔐 Введіть пароль зашифрованого бекапу.\n\nЯкщо забули пароль — натисніть «Скасувати», після цього можна використати ключ відновлення.');
    if(password!==null){
      try{ const payload=await securityBackupDecryptEnvelope(parsed,password); await securityBackupRestorePayload(payload); return; }
      catch(e){ showToast('Пароль не підійшов — можна спробувати ключ відновлення'); }
    }

    if(!parsed.recoveryPasswordWrap){ showToast('У цього старого бекапу немає ключа відновлення — потрібен його пароль'); return; }
    const recoveryKey=prompt('🛟 Введіть ключ відновлення бекапу:');
    if(recoveryKey===null) return;
    try{
      const recoveredPassword=await securityBackupUnwrapPasswordWithRecovery(parsed.recoveryPasswordWrap,recoveryKey);
      const payload=await securityBackupDecryptEnvelope(parsed,recoveredPassword);
      await securityBackupRestorePayload(payload);
      if(confirm('Зберегти відновлений пароль бекапу на цьому пристрої, щоб більше його не вводити?')){
        await securityBackupVaultSave(recoveredPassword,securityBackupRecoveryKeyNormalize(recoveryKey));
        showToast('✅ Пароль бекапу відновлено та збережено на цьому пристрої');
      }
    }catch(err){ console.error('Recovery key restore failed:',err); showToast('❌ Ключ відновлення не підійшов або файл пошкоджений'); }
  };
}

securityBackupEnsureVaultSettingsCard();

if(typeof renderSettingsScreen==='function'){
  const securityBackupVaultOriginalRender=renderSettingsScreen;
  renderSettingsScreen=function(){
    securityBackupEnsureVaultSettingsCard();
    const result=securityBackupVaultOriginalRender.apply(this,arguments);
    securityBackupRenderVaultCard();
    const label=document.getElementById('appVersionLabel');
    if(label) label.textContent=`Версія застосунку: ${SECURITY_BACKUP_VAULT_RELEASE_LABEL}`;
    return result;
  };
}

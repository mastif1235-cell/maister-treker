/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — encrypted backup hardening (v65 security.7)
   Повні файли бекапу шифруються локально AES-GCM-256.
   Ключ отримується з окремого пароля через PBKDF2-SHA256.
   ===================================================================== */

const SECURITY_BACKUP_RELEASE_LABEL = 'v65.0-security.7 · 2026-08-18';
const SECURITY_BACKUP_ENVELOPE = 'master-tracker-encrypted-backup';
const SECURITY_BACKUP_KDF_ITERATIONS = 310000;
const SECURITY_BACKUP_MIN_PASSWORD = 8;
const SECURITY_BACKUP_MAX_PLAINTEXT_BYTES = 150 * 1024 * 1024;

function securityBackupBytesToBase64(bytes){
  let out = '';
  const chunk = 0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i+chunk, bytes.length)));
  }
  return btoa(out);
}

function securityBackupBase64ToBytes(value){
  const raw = atob(String(value || ''));
  const out = new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function securityBackupDeriveKey(password, salt, iterations){
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(password)), {name:'PBKDF2'}, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey({
    name:'PBKDF2', hash:'SHA-256', salt,
    iterations:Number(iterations) || SECURITY_BACKUP_KDF_ITERATIONS
  }, material, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}

async function securityBackupEncryptObject(payload, password){
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  if(plain.byteLength > SECURITY_BACKUP_MAX_PLAINTEXT_BYTES) throw new Error('BACKUP_TOO_LARGE');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await securityBackupDeriveKey(password, salt, SECURITY_BACKUP_KDF_ITERATIONS);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, plain));
  return {
    format: SECURITY_BACKUP_ENVELOPE,
    version: 1,
    app: 'master-tracker',
    encryptedAt: new Date().toISOString(),
    algorithm: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256',
    iterations: SECURITY_BACKUP_KDF_ITERATIONS,
    salt: securityBackupBytesToBase64(salt),
    iv: securityBackupBytesToBase64(iv),
    ciphertext: securityBackupBytesToBase64(cipher)
  };
}

async function securityBackupDecryptEnvelope(envelope, password){
  if(!envelope || envelope.format !== SECURITY_BACKUP_ENVELOPE || Number(envelope.version)!==1) throw new Error('BAD_ENVELOPE');
  const salt = securityBackupBase64ToBytes(envelope.salt);
  const iv = securityBackupBase64ToBytes(envelope.iv);
  const cipher = securityBackupBase64ToBytes(envelope.ciphertext);
  const key = await securityBackupDeriveKey(password, salt, envelope.iterations);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

function securityBackupAskNewPassword(){
  const p1 = prompt(`🔐 Пароль для бекапу\n\nМінімум ${SECURITY_BACKUP_MIN_PASSWORD} символів. Без цього пароля відновити файл буде неможливо.`);
  if(p1 === null) return null;
  if(p1.length < SECURITY_BACKUP_MIN_PASSWORD){ showToast(`Пароль бекапу — мінімум ${SECURITY_BACKUP_MIN_PASSWORD} символів`); return null; }
  const p2 = prompt('Повторіть пароль бекапу:');
  if(p2 === null) return null;
  if(p1 !== p2){ showToast('Паролі бекапу не збігаються'); return null; }
  return p1;
}

function securityBackupDownloadEnvelope(envelope, fileName){
  const blob = new Blob([JSON.stringify(envelope)], {type:'application/json;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

async function securityBackupRestorePayload(data){
  if(typeof securityValidateBackupEnvelope === 'function' && !securityValidateBackupEnvelope(data)) throw new Error('BAD_BACKUP');
  const hasTickets = Array.isArray(data.tickets);
  const hasShifts = Array.isArray(data.shifts);
  const hasSettings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings);
  if(!hasTickets && !hasShifts && !hasSettings) throw new Error('BAD_BACKUP');

  const parts=[];
  if(hasTickets) parts.push(`заявки (${data.tickets.length})`);
  if(hasShifts) parts.push(`зміни (${data.shifts.length})`);
  if(hasSettings) parts.push('налаштування');
  if(!confirm(`🔐 Розшифровано: ${parts.join(', ')}.\n\nІмпортувати? Поточні дані відповідного типу буде замінено. Локальні Telegram/Google секрети та захист входу залишаться поточними.`)) return;

  backupLocalData();
  if(hasTickets){
    const importedTickets = data.tickets.map(t=>Object.assign(blankTicketObject(), (t && typeof t==='object' && !Array.isArray(t)) ? t : {}));
    if(data.photoData && typeof data.photoData === 'object'){
      let photoCount=0;
      for(const [key,dataUrl] of Object.entries(data.photoData)){
        if(++photoCount > 10000) throw new Error('TOO_MANY_PHOTOS');
        if(!String(key).startsWith('idb:') || typeof dataUrl!=='string' || !dataUrl.startsWith('data:image/')) continue;
        if(dataUrl.length > 12*1024*1024) throw new Error('PHOTO_TOO_LARGE');
        if(!await photoDbPut(key,dataUrl)) throw new Error('PHOTO_WRITE_FAILED');
      }
    }
    tickets = importedTickets;
    saveTickets();
    await migrateLegacyPhotosToIdb();
  }
  if(hasShifts){ shifts = data.shifts; saveShifts(); }
  if(hasSettings){
    settings = typeof securityMergeImportedSettings === 'function'
      ? securityMergeImportedSettings(data.settings, settings)
      : Object.assign({}, settings, data.settings);
    saveSettings();
  }
  renderTicketsScreen(); renderShiftsScreen(); renderSettingsScreen();
  showToast('🔐 Зашифрований бекап успішно відновлено');
}

// Повний ручний бекап тепер завжди шифрований. Логіни/паролі абонентів
// залишаються всередині для повного відновлення, але файл без пароля не читається.
if(typeof exportJsonBackup === 'function'){
  exportJsonBackup = async function(){
    if(!window.crypto?.subtle){ showToast('Цей браузер не підтримує безпечне шифрування бекапу'); return; }
    const password = securityBackupAskNewPassword();
    if(!password) return;
    try{
      showToast('🔐 Готую та шифрую повний бекап…');
      const {photoData, missingPhotos} = await collectLocalPhotoData(tickets);
      const payload = {
        app:'master-tracker', backupVersion:3, encryptedSource:true,
        exportedAt:new Date().toISOString(), tickets, shifts,
        settings: typeof securitySanitizeSettingsForBackup === 'function' ? securitySanitizeSettingsForBackup(settings) : settings,
        photoData
      };
      const envelope = await securityBackupEncryptObject(payload, password);
      securityBackupDownloadEnvelope(envelope, `master-tracker-backup-${localDateKey(new Date())}-encrypted.json`);
      showToast(missingPhotos
        ? `🔐 Бекап зашифровано, але ${missingPhotos} фото локально не знайдено`
        : '🔐 Повний бекап зашифровано AES-GCM');
    }catch(err){
      console.error('Encrypted backup export failed:', err);
      showToast(err?.message==='BACKUP_TOO_LARGE' ? 'Бекап завеликий для шифрування на цьому телефоні' : 'Не вдалося зашифрувати бекап');
    }
  };
}

// Імпорт: новий encrypted JSON розшифровуємо локально. Старі незашифровані
// файли лишаються сумісними через попередній secure-import handler.
if(typeof handleJsonImportFile === 'function'){
  const securityBackupLegacyImport = handleJsonImportFile;
  handleJsonImportFile = async function(file){
    if(!file) return;
    if(file.size > SECURITY_BACKUP_MAX_PLAINTEXT_BYTES * 2){ showToast('Файл бекапу завеликий'); return; }
    let parsed;
    try{ parsed = JSON.parse(await file.text()); }
    catch(e){ return securityBackupLegacyImport(file); }
    if(parsed?.format !== SECURITY_BACKUP_ENVELOPE) return securityBackupLegacyImport(file);

    const password = prompt('🔐 Введіть пароль зашифрованого бекапу:');
    if(password === null) return;
    try{
      const payload = await securityBackupDecryptEnvelope(parsed, password);
      await securityBackupRestorePayload(payload);
    }catch(err){
      console.error('Encrypted backup import failed:', err);
      showToast('❌ Невірний пароль або пошкоджений зашифрований бекап');
    }
  };
}

// Щоденний snapshot у IndexedDB залишається локальним на пристрої.
// Прибираємо автоматичне скачування НЕшифрованого файла на диск.
if(typeof maybeRunDailyBackup === 'function'){
  maybeRunDailyBackup = async function(){
    if(!backupDb) return;
    try{
      const todayKey=localDateKey(new Date());
      const index=loadDailyBackupIndex();
      if(index[0] && index[0].date===todayKey) return;
      const safeSettings = typeof securitySanitizeSettingsForBackup === 'function' ? securitySanitizeSettingsForBackup(settings) : settings;
      const ok=await backupDbPut(todayKey,{tickets,shifts,settings:safeSettings,exportedAt:new Date().toISOString(),secretsExcluded:true});
      if(!ok) return;
      index.unshift({date:todayKey,ts:Date.now(),ticketsCount:tickets.length,shiftsCount:shifts.length});
      const overflow=index.splice(DAILY_BACKUP_MAX);
      for(const old of overflow) await backupDbDelete(old.date);
      saveDailyBackupIndex(index);
    }catch(err){ console.error('Encrypted daily snapshot error:',err); }
  };
}

// Якщо користувач вручну завантажує daily snapshot — він теж шифрується.
if(typeof downloadDailyBackup === 'function'){
  downloadDailyBackup = async function(dateKey, opts={}){
    const payload=await backupDbGet(dateKey);
    if(!payload){ if(!opts.silent) showToast('Не вдалося знайти цей бекап'); return; }
    if(opts.silent) return; // автоматичні незашифровані downloads вимкнені
    const password=securityBackupAskNewPassword();
    if(!password) return;
    try{
      const clean={app:'master-tracker',backupVersion:3,encryptedSource:true,exportedAt:payload.exportedAt,tickets:payload.tickets||[],shifts:payload.shifts||[],settings:typeof securitySanitizeSettingsForBackup==='function'?securitySanitizeSettingsForBackup(payload.settings||{}):(payload.settings||{})};
      const envelope=await securityBackupEncryptObject(clean,password);
      securityBackupDownloadEnvelope(envelope,`master-tracker-backup-${dateKey}-encrypted.json`);
      showToast('🔐 Щоденний бекап зашифровано');
    }catch(err){ console.error('Encrypted daily download failed:',err); showToast('Не вдалося зашифрувати щоденний бекап'); }
  };
}

if(typeof renderSettingsScreen === 'function'){
  const securityBackupOriginalRenderSettings=renderSettingsScreen;
  renderSettingsScreen=function(){
    const result=securityBackupOriginalRenderSettings.apply(this,arguments);
    const label=document.getElementById('appVersionLabel');
    if(label) label.textContent=`Версія застосунку: ${SECURITY_BACKUP_RELEASE_LABEL}`;
    return result;
  };
}

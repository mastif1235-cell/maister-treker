/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — security hardening layer (v65)
   Підключається після app.js, але ДО DOMContentLoaded.
   Тут лише сумісні захисні обгортки: без зміни формату заявок/синхронізації.
   ===================================================================== */

const SECURITY_RELEASE_LABEL = 'v65.0-security.1 · 2026-08-18';
const SECURITY_BACKUP_MAX_BYTES = 120 * 1024 * 1024;
const SECURITY_SENSITIVE_SETTING_KEYS = new Set([
  'tgBotToken',
  'syncSecret',
  'appLockPasswordHash',
  'appLockCredentialId'
]);
const SECURITY_LOCK_SETTING_KEYS = new Set([
  'appLockEnabled',
  'appLockPasswordHash',
  'appLockBiometricEnabled',
  'appLockCredentialId'
]);
const SECURITY_URL_SETTING_KEYS = new Set([
  'scriptUrl',
  'shiftsScriptUrl',
  'vizitkaUrl',
  'dogovorUrl'
]);

function securityIsSafeHttpsUrl(value){
  const raw = String(value || '').trim();
  if(!raw) return true;
  try{
    const u = new URL(raw, location.href);
    return u.protocol === 'https:';
  }catch(e){ return false; }
}

function securitySanitizeSettingsForBackup(source){
  const clean = JSON.parse(JSON.stringify(source || {}));
  SECURITY_SENSITIVE_SETTING_KEYS.forEach(key=>{ if(key in clean) clean[key] = ''; });
  // Локальний lock не переносимо між пристроями: WebAuthn credential
  // прив'язаний до конкретного браузера/пристрою, а hash пароля є секретом.
  clean.appLockEnabled = false;
  clean.appLockBiometricEnabled = false;
  clean.appLockPasswordHash = '';
  clean.appLockCredentialId = '';
  return clean;
}

function securityMergeImportedSettings(imported, current){
  const base = Object.assign({}, current || {});
  if(!imported || typeof imported !== 'object' || Array.isArray(imported)) return base;

  // Whitelist: імпорт може змінювати лише ті ключі, які ця версія програми
  // вже знає. Довільні ключі з чужого JSON не потрапляють у settings.
  Object.keys(base).forEach(key=>{
    if(!Object.prototype.hasOwnProperty.call(imported, key)) return;
    if(SECURITY_SENSITIVE_SETTING_KEYS.has(key) || SECURITY_LOCK_SETTING_KEYS.has(key)) return;

    const value = imported[key];
    if(SECURITY_URL_SETTING_KEYS.has(key) && !securityIsSafeHttpsUrl(value)) return;
    base[key] = value;
  });
  return base;
}

function securityValidateBackupEnvelope(data){
  if(!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if(data.tickets !== undefined && !Array.isArray(data.tickets)) return false;
  if(data.shifts !== undefined && !Array.isArray(data.shifts)) return false;
  if(data.settings !== undefined && (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings))) return false;
  if(data.tickets && data.tickets.length > 50000) return false;
  if(data.shifts && data.shifts.length > 50000) return false;
  if(data.photoData !== undefined && (!data.photoData || typeof data.photoData !== 'object' || Array.isArray(data.photoData))) return false;
  return true;
}

// window.open: не даємо новій вкладці отримати window.opener і не передаємо
// Referrer на зовнішній сайт. Поточні виклики програми повернене вікно не використовують.
try{
  const securityNativeOpen = window.open.bind(window);
  window.open = function(url, target, features){
    const extra = String(features || '').trim();
    const safeFeatures = [extra, 'noopener', 'noreferrer'].filter(Boolean).join(',');
    return securityNativeOpen(url, target, safeFeatures);
  };
}catch(e){ /* старий webview — лишаємо штатну поведінку */ }

// Блокуємо небезпечні javascript:/data:/http: URL у двох QR-функціях.
if(typeof showVizitka === 'function'){
  const securityOriginalShowVizitka = showVizitka;
  showVizitka = function(){
    const url = String(settings.vizitkaUrl || '').trim();
    if(url && !securityIsSafeHttpsUrl(url)){
      showToast('🔒 Візитка: дозволено лише HTTPS-посилання');
      return;
    }
    return securityOriginalShowVizitka();
  };
}

if(typeof showDogovor === 'function'){
  const securityOriginalShowDogovor = showDogovor;
  showDogovor = function(id){
    const url = String(settings.dogovorUrl || '').trim();
    if(url && !securityIsSafeHttpsUrl(url)){
      showToast('🔒 Договір: дозволено лише HTTPS-посилання');
      return;
    }
    return securityOriginalShowDogovor(id);
  };
}

// Показуємо реальний security-реліз, не торкаючись старої APP_VERSION у
// великому app.js. Це тимчасово до наступного планового розбиття app.js.
if(typeof renderSettingsScreen === 'function'){
  const securityOriginalRenderSettingsScreen = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = securityOriginalRenderSettingsScreen.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_RELEASE_LABEL}`;
    return result;
  };
}

// Повний JSON-бекап: заявки/зміни/фото лишаються повними, але секрети
// Telegram/Google і локальний lock у файл більше НЕ потрапляють.
if(typeof exportJsonBackup === 'function'){
  exportJsonBackup = async function(){
    const {photoData, missingPhotos} = await collectLocalPhotoData(tickets);
    const payload = {
      app: 'master-tracker',
      backupVersion: 2,
      secretsExcluded: true,
      exportedAt: new Date().toISOString(),
      tickets,
      shifts,
      settings: securitySanitizeSettingsForBackup(settings),
      photoData
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `master-tracker-backup-${localDateKey(new Date())}.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    showToast(missingPhotos
      ? `🔒 Бекап без секретів завантажено, але ${missingPhotos} фото локально не знайдено`
      : '🔒 Повний бекап завантажено без Telegram/Google секретів');
  };
}

// Щоденний локальний знімок також більше не зберігає токен/секрет/lock hash.
if(typeof maybeRunDailyBackup === 'function'){
  maybeRunDailyBackup = async function(){
    if(!backupDb) return;
    try{
      const todayKey = localDateKey(new Date());
      const index = loadDailyBackupIndex();
      if(index[0] && index[0].date === todayKey) return;
      const safeSettings = securitySanitizeSettingsForBackup(settings);
      const ok = await backupDbPut(todayKey, {tickets, shifts, settings:safeSettings, exportedAt:new Date().toISOString(), secretsExcluded:true});
      if(!ok) return;
      index.unshift({date:todayKey, ts:Date.now(), ticketsCount:tickets.length, shiftsCount:shifts.length});
      const overflow = index.splice(DAILY_BACKUP_MAX);
      for(const old of overflow) await backupDbDelete(old.date);
      saveDailyBackupIndex(index);
      if(tickets.length || shifts.length) await downloadDailyBackup(todayKey, {silent:true});
    }catch(err){ console.error('Security daily backup error:', err); }
  };
}

// Навіть старий локальний daily-backup, створений ДО v65, при завантаженні
// на диск очищається від секретів на льоту.
if(typeof downloadDailyBackup === 'function'){
  downloadDailyBackup = async function(dateKey, opts={}){
    const payload = await backupDbGet(dateKey);
    if(!payload){ if(!opts.silent) showToast('Не вдалося знайти цей бекап'); return; }
    const cleanPayload = {
      app:'master-tracker',
      backupVersion:2,
      secretsExcluded:true,
      exportedAt:payload.exportedAt,
      tickets:payload.tickets || [],
      shifts:payload.shifts || [],
      settings:securitySanitizeSettingsForBackup(payload.settings || {})
    };
    const blob = new Blob([JSON.stringify(cleanPayload, null, 2)], {type:'application/json;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `master-tracker-backup-${dateKey}.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    showToast(opts.silent ? `📅 Щоденний бекап (${dateKey}) збережено без секретів` : '🔒 Файл бекапу завантажено без секретів');
  };
}

// Відновлення daily-backup: локальні Telegram/Google секрети і lock
// залишаються поточними навіть якщо старий backup містив їх у відкритому вигляді.
if(typeof restoreDailyBackup === 'function'){
  restoreDailyBackup = async function(dateKey){
    const payload = await backupDbGet(dateKey);
    if(!payload){ showToast('Не вдалося знайти цей бекап'); return; }
    if(!confirm(`Відновити дані станом на ${dateKey}?\nПоточні локальні заявки, зміни й налаштування буде замінено.\nСекрети Telegram/Google та захист входу залишаться поточними.`)) return;
    backupLocalData();
    if(payload.photoData && typeof payload.photoData === 'object'){
      for(const [key, dataUrl] of Object.entries(payload.photoData)){
        if(!String(key).startsWith('idb:') || typeof dataUrl!=='string' || !dataUrl.startsWith('data:')) continue;
        if(!await photoDbPut(key, dataUrl)){ showToast('Не вдалося відновити фото з бекапу'); return; }
      }
    }
    tickets = Array.isArray(payload.tickets) ? payload.tickets : [];
    shifts = Array.isArray(payload.shifts) ? payload.shifts : [];
    if(payload.settings) settings = securityMergeImportedSettings(payload.settings, settings);
    saveTickets(); saveShifts(); saveSettings();
    renderTicketsScreen(); renderShiftsScreen(); renderSettingsScreen();
    showToast('🔒 Дані відновлено, локальні секрети не змінено');
  };
}

// Імпорт JSON: обмеження розміру + базова схема + whitelist settings.
// Старі бекапи сумісні, але їхні tgBotToken/syncSecret/appLock* ігноруються.
if(typeof handleJsonImportFile === 'function'){
  handleJsonImportFile = async function(file){
    if(!file) return;
    if(file.size > SECURITY_BACKUP_MAX_BYTES){
      showToast('🔒 Файл бекапу завеликий для безпечного імпорту на телефоні');
      return;
    }
    try{
      const text = await file.text();
      const data = JSON.parse(text);
      if(!securityValidateBackupEnvelope(data)){
        showToast('🔒 Файл не пройшов перевірку структури бекапу');
        return;
      }
      const hasTickets = Array.isArray(data.tickets);
      const hasShifts = Array.isArray(data.shifts);
      const hasSettings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings);
      if(!hasTickets && !hasShifts && !hasSettings){ showToast('Файл не схожий на бекап цього застосунку'); return; }

      const parts = [];
      if(hasTickets) parts.push(`заявки (${data.tickets.length})`);
      if(hasShifts) parts.push(`зміни (${data.shifts.length})`);
      if(hasSettings) parts.push('налаштування');
      if(!confirm(`Імпортувати ${parts.join(', ')}? Це ЗАМІНИТЬ поточні локальні дані відповідного типу.\n\n🔒 Telegram/Google секрети та захист входу з файла імпортовані НЕ будуть.`)) return;
      backupLocalData();

      if(hasTickets){
        const importedTickets = data.tickets.map(t=>Object.assign(blankTicketObject(), (t && typeof t==='object' && !Array.isArray(t)) ? t : {}));
        if(data.photoData && typeof data.photoData === 'object'){
          let photoCount = 0;
          for(const [key, dataUrl] of Object.entries(data.photoData)){
            if(++photoCount > 10000) throw new Error('Забагато фото в бекапі');
            if(!String(key).startsWith('idb:') || typeof dataUrl!=='string' || !dataUrl.startsWith('data:image/')) continue;
            if(dataUrl.length > 12 * 1024 * 1024) throw new Error('Фото в бекапі перевищує безпечний розмір');
            if(!await photoDbPut(key, dataUrl)) throw new Error('Не вдалося записати фото з бекапу');
          }
        }
        tickets = importedTickets;
        saveTickets();
        await migrateLegacyPhotosToIdb();
      }
      if(hasShifts){ shifts = data.shifts; saveShifts(); }
      if(hasSettings){
        settings = securityMergeImportedSettings(data.settings, settings);
        saveSettings();
        renderSettingsScreen();
      }
      renderTicketsScreen();
      renderShiftsScreen();
      showToast('🔒 Дані імпортовано, локальні секрети збережено');
    }catch(err){
      console.error('Security JSON import error:', err);
      showToast('Не вдалося безпечно імпортувати файл — перевірте JSON-бекап');
    }
  };
}

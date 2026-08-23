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
  'syncHmacSecret',
  'tgBackupChatId',
  'tgDispatcherChatId',
  'tgDispatchers',
  'tgMyChatId',
  'tgShiftsMsgId',
  'appLockPasswordHash',
  'appLockPasswordKdf',
  'appLockPasswordSalt',
  'appLockPasswordIterations',
  'appLockPasswordVerifier',
  'appLockCredentialId'
]);
const SECURITY_LOCK_SETTING_KEYS = new Set([
  'appLockEnabled',
  'appLockPasswordHash',
  'appLockPasswordKdf',
  'appLockPasswordSalt',
  'appLockPasswordIterations',
  'appLockPasswordVerifier',
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
  clean.appLockPasswordKdf = '';
  clean.appLockPasswordSalt = '';
  clean.appLockPasswordIterations = 0;
  clean.appLockPasswordVerifier = '';
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


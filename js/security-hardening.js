/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — security hardening layer (v65)
   Підключається після app.js, але ДО DOMContentLoaded.
   Тут лише сумісні захисні обгортки: без зміни формату заявок/синхронізації.
   ===================================================================== */

const SECURITY_BACKUP_MAX_BYTES = 120 * 1024 * 1024;
const SECURITY_SENSITIVE_SETTING_KEYS = new Set([
  'offlineMapAccessToken',
  'tgBotToken',
  'syncSecret',
  'syncHmacSecret',
  'dispatcherHmacSecret',
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
function securityStripSystemSecrets(value,depth=0){
  if(depth>24)return null;
  if(Array.isArray(value))return value.map(item=>securityStripSystemSecrets(item,depth+1));
  if(!value||typeof value!=='object')return value;
  const clean={};
  const secretName=/^(?:offlineMapAccessToken|syncHmacSecret|syncSecret|dispatcherHmacSecret|tgBotToken|tgBackupChatId|tgDispatcherChatId|tgDispatchers|tgMyChatId|tgShiftsMsgId|mapTiler(?:Api)?Key|authorization(?:Header)?|accessToken|refreshToken|apiToken|callbackUrl)$/i;
  Object.keys(value).forEach(key=>{if(!secretName.test(key))clean[key]=securityStripSystemSecrets(value[key],depth+1);});
  return clean;
}
function securitySanitizeSettingsForBackup(source){
  const clean = securityStripSystemSecrets(JSON.parse(JSON.stringify(source || {})));
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
  if(typeof MTAddressBook!=='undefined')Object.assign(base,MTAddressBook.importSettings(imported,current));
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
  // Narrow authenticated dispatcher RPC exception. Never expose a generic
  // native opener: require the saved endpoint and exactly the bridge nonce.
  const dispatcherReportOpen=function(value){
    const u=new URL(String(value)),saved=new URL(String(settings.dispatcherReportEndpoint||''));
    if(saved.protocol!=='https:'||saved.hostname!=='script.google.com'||saved.username||saved.password||saved.port||!/^\/macros\/s\/[\w-]+\/exec$/.test(saved.pathname)||saved.search||saved.hash||
       u.origin!==saved.origin||u.pathname!==saved.pathname||u.username||u.password||u.port||u.hash||
       u.searchParams.get('origin')!==location.origin||! /^[a-f0-9]{32}$/.test(u.searchParams.get('channel')||'')||
       [...u.searchParams.keys()].length!==2)throw new Error('INVALID_REPORT_WINDOW');
    // One stable window name: repeat connects REUSE/RELOAD this single bridge
    // window instead of stacking popups (Android tab discard recovery).
    return securityNativeOpen(u.href,'mtDispatcherReportBridge');
  };
  // Re-attach probe for auto-resume: targets ONLY this session's named bridge
  // window, never creates a visible popup outside a user gesture (blocked
  // probes return null). A blank window some webviews spawn is closed at once.
  dispatcherReportOpen.reacquire=function(){
    let w=null;try{w=securityNativeOpen('','mtDispatcherReportBridge');}catch(_e){return null;}
    if(!w)return null;
    try{if(w.location&&w.location.href==='about:blank'){w.close();return null;}}catch(_e){/* cross-origin = real bridge window */}
    return w;
  };
  Object.defineProperty(window, 'MTDispatcherReportOpen', {value:dispatcherReportOpen,writable:false,configurable:false});
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

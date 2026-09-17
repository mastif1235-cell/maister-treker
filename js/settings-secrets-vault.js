/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — vault системних секретів (пункт 16, аудит v91.27)

   tgBotToken і syncHmacSecret більше НЕ зберігаються plaintext у
   localStorage 'settings'. Постійне сховище — той самий vault-механізм,
   що й для пароля бекапів (js/backup-system.js): непереборний
   (non-extractable) AES-GCM-256 ключ і зашифрований запис в IndexedDB
   (backupDb, js/backup-storage.js). Ключ і запис — власні
   (__settingsSecretsKeyV1 / __settingsSecretsV1), щоб «забути пароль
   бекапів» не знищувало секрети синхронізації/Telegram, і навпаки.

   В пам'яті (об'єкт settings) значення лишаються синхронно доступними —
   усі наявні споживачі (Telegram-архів, HMAC-синхронізація, діагностика
   конфігурації) продовжують працювати без змін. Відновлення з vault і
   автоматична міграція legacy plaintext відбуваються в init() (app.js)
   ДО створення sync engine і першого рендеру налаштувань.

   Безпечна деградація: якщо IndexedDB/WebCrypto недоступні (приватний
   режим без IDB, дуже старий WebView), модуль НЕ витирає plaintext —
   збереження йде старим шляхом, щоб існуючий токен не втратився.
   Міграція повторюється при кожному наступному старті.
   ===================================================================== */

const MT_SETTINGS_SECRET_KEYS = ['tgBotToken', 'syncHmacSecret', 'aiBearerToken'];
const MT_SETTINGS_SECRETS_KEY_RECORD = '__settingsSecretsKeyV1';
const MT_SETTINGS_SECRETS_RECORD = '__settingsSecretsV1';
const MT_SETTINGS_SECRETS_DEBOUNCE_MS = 300;

let mtSettingsSecretsVaultSynced = false;
let mtSettingsSecretsPending = null;
let mtSettingsSecretsDebounceTimer = null;
let mtSettingsSecretsWriting = null;

function mtSettingsSecretsVaultAvailable(){
  return typeof backupDb !== 'undefined' && !!backupDb &&
    typeof backupDbGet === 'function' && typeof backupDbPut === 'function' &&
    typeof crypto !== 'undefined' && !!(crypto && crypto.subtle) &&
    typeof TextEncoder === 'function' && typeof TextDecoder === 'function';
}
function mtSettingsSecretsExtract(source){
  const out = {};
  MT_SETTINGS_SECRET_KEYS.forEach(key => { out[key] = String((source && source[key]) || ''); });
  return out;
}
function mtSettingsSecretsSanitize(source){
  const clean = Object.assign({}, source || {});
  MT_SETTINGS_SECRET_KEYS.forEach(key => { if(key in clean) clean[key] = ''; });
  return clean;
}
async function mtSettingsSecretsVaultKey(){
  const existing = await backupDbGet(MT_SETTINGS_SECRETS_KEY_RECORD);
  if(existing && existing.type === 'secret' && existing.algorithm && existing.algorithm.name === 'AES-GCM') return existing;
  try{
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return (await backupDbPut(MT_SETTINGS_SECRETS_KEY_RECORD, key)) ? key : null;
  }catch(_e){ return null; }
}
async function mtSettingsSecretsVaultWrite(values){
  if(!mtSettingsSecretsVaultAvailable()) return false;
  try{
    const key = await mtSettingsSecretsVaultKey();
    if(!key) return false;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(mtSettingsSecretsExtract(values)))
    ));
    return await backupDbPut(MT_SETTINGS_SECRETS_RECORD, { version: 1, iv, ciphertext });
  }catch(_e){ return false; }
}
async function mtSettingsSecretsVaultRead(){
  if(!mtSettingsSecretsVaultAvailable()) return null;
  try{
    const key = await backupDbGet(MT_SETTINGS_SECRETS_KEY_RECORD);
    const record = await backupDbGet(MT_SETTINGS_SECRETS_RECORD);
    if(!key || !record || Number(record.version) !== 1) return null;
    if(!(key.type === 'secret' && key.algorithm && key.algorithm.name === 'AES-GCM')) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(record.iv) }, key, new Uint8Array(record.ciphertext));
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    return parsed && typeof parsed === 'object' ? mtSettingsSecretsExtract(parsed) : null;
  }catch(_e){ return null; }
}

/* Асинхронний запис у vault із дебаунсом: поле токена в налаштуваннях
   викликає saveSettings() на кожен символ, і нам не потрібна IDB-транзакція
   на кожне натискання клавіші. Завжди перемагає найсвіжіше значення. */
function mtSettingsSecretsScheduleVaultWrite(secrets){
  mtSettingsSecretsPending = secrets;
  if(typeof setTimeout !== 'function') { void mtSettingsSecretsFlushPending(); return; }
  if(mtSettingsSecretsDebounceTimer) clearTimeout(mtSettingsSecretsDebounceTimer);
  mtSettingsSecretsDebounceTimer = setTimeout(() => {
    mtSettingsSecretsDebounceTimer = null;
    void mtSettingsSecretsFlushPending();
  }, MT_SETTINGS_SECRETS_DEBOUNCE_MS);
}
async function mtSettingsSecretsFlushPending(){
  if(!mtSettingsSecretsPending) return true;
  if(mtSettingsSecretsWriting) { try{ await mtSettingsSecretsWriting; }catch(_e){} }
  const values = mtSettingsSecretsPending;
  const writing = (async () => {
    const ok = await mtSettingsSecretsVaultWrite(values);
    // Знімаємо pending лише якщо значення не оновились поки тривав запис.
    if(ok && mtSettingsSecretsPending === values) mtSettingsSecretsPending = null;
    return ok;
  })();
  mtSettingsSecretsWriting = writing;
  try{ return await writing; }finally{ if(mtSettingsSecretsWriting === writing) mtSettingsSecretsWriting = null; }
}

/* Синхронний хук для saveSettings(): повертає копію settings для
   localStorage і планує запис справжніх значень у vault. Поки vault не
   синхронізований або недоступний — повертає джерело без змін (стара
   поведінка): plaintext витирається лише після успішної міграції, тому
   існуючий токен не може загубитись при оновленні застосунку. */
function mtSettingsSecretsPreparePersist(source){
  if(mtSettingsSecretsVaultSynced && mtSettingsSecretsVaultAvailable()){
    mtSettingsSecretsScheduleVaultWrite(mtSettingsSecretsExtract(source));
    return mtSettingsSecretsSanitize(source);
  }
  return source;
}

/* Автоматична міграція + відновлення в пам'ять. Викликається один раз в
   init() (app.js) після відкриття backupDb і ДО створення sync engine.
   Пріоритет: непорожнє legacy-значення з localStorage > значення vault.
   Так токен не втрачається при першому старті оновленого застосунку, а
   введений у UI новий токен (vault) не перезаписується старим. */
async function mtSettingsSecretsRestoreIntoSettings(){
  if(typeof settings === 'undefined' || !settings) return false;
  const legacy = mtSettingsSecretsExtract(settings);
  const hadLegacyPlaintext = MT_SETTINGS_SECRET_KEYS.some(key => legacy[key]);
  const vault = await mtSettingsSecretsVaultRead();
  MT_SETTINGS_SECRET_KEYS.forEach(key => {
    settings[key] = legacy[key] || (vault && vault[key]) || '';
  });
  const current = mtSettingsSecretsExtract(settings);
  const vaultMatches = !!vault && MT_SETTINGS_SECRET_KEYS.every(key => vault[key] === current[key]);
  if(vaultMatches && !hadLegacyPlaintext){
    mtSettingsSecretsVaultSynced = true;
    mtSettingsSecretsPending = null;
    return true;
  }
  const ok = await mtSettingsSecretsVaultWrite(current);
  if(!ok){
    // Vault недоступний/зламався — лишаємось у legacy-режимі: saveSettings()
    // продовжує писати plaintext, токен не втрачається, міграція повториться
    // на наступному старті.
    mtSettingsSecretsVaultSynced = false;
    return false;
  }
  mtSettingsSecretsVaultSynced = true;
  mtSettingsSecretsPending = null;
  // Plaintext з localStorage стирається ЛИШЕ після успішного запису в vault.
  try{
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('settings') : null;
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && typeof parsed === 'object' && !Array.isArray(parsed)){
        localStorage.setItem('settings', JSON.stringify(mtSettingsSecretsSanitize(parsed)));
      }
    }
  }catch(_e){ /* пошкоджений raw — не критично, його перезапише saveSettings() */ }
  return true;
}

/* Останній шанс записати свіжій секрет у vault, коли користувач ховає
   вкладку/закриває застосунок одразу після введення токена (дебаунс
   міг ще не спрацювати). */
if(typeof window !== 'undefined' && window.addEventListener){
  const mtSettingsSecretsFlushOnHide = () => {
    if(mtSettingsSecretsPending && mtSettingsSecretsVaultSynced) void mtSettingsSecretsFlushPending();
  };
  window.addEventListener('pagehide', mtSettingsSecretsFlushOnHide);
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') mtSettingsSecretsFlushOnHide();
  });
}

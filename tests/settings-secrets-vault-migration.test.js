'use strict';
// Пункт 16 (аудит v91.27): tgBotToken і syncHmacSecret більше не живуть
// plaintext у localStorage 'settings' — вони мігрують у шифрований vault
// (AES-GCM ключ + запис в IndexedDB, та сама архітектура, що й пароль
// бекапів). Тести:
//  1) автоматична міграція legacy plaintext → vault без втрати токена;
//  2) після міграції localStorage не містить plaintext секретів;
//  3) читання/використання секретів після міграції (в т.ч. після «перезапуску»);
//  4) saveSettings() після синхронізації vault пише копію без секретів;
//  5) деградований режим (немає IndexedDB): plaintext НЕ витирається — токен не втрачається;
//  6) init() у app.js відновлює секрети до створення sync engine.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const vaultSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'settings-secrets-vault.js'), 'utf8');
const settingsCoreSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'settings-core.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

const TOKEN = '123456789:AAF-TEST-TELEGRAM-TOKEN';
const HMAC = 'h'.repeat(40);

function makeHarness({ idbAvailable = true, legacySettings } = {}){
  const store = new Map();
  const ls = new Map();
  if(legacySettings !== undefined) ls.set('settings', JSON.stringify(legacySettings));
  const context = {
    console, URL, TextEncoder, TextDecoder,
    crypto: webcrypto,
    setTimeout, clearTimeout,
    window: null,
    document: { addEventListener(){}, visibilityState: 'visible' },
    localStorage: {
      getItem: key => (ls.has(key) ? ls.get(key) : null),
      setItem: (key, value) => { ls.set(key, String(value)); },
      removeItem: key => { ls.delete(key); }
    },
    backupDb: idbAvailable ? { name: 'mock' } : null,
    backupDbGet: async key => (idbAvailable && store.has(key) ? store.get(key) : null),
    backupDbPut: async (key, value) => { if(!idbAvailable) return false; store.set(key, value); return true; },
    backupDbDelete: async key => { if(!idbAvailable) return false; store.delete(key); return true; },
    loadJSON: (key, fallback) => fallback,
    store, ls
  };
  context.window = context;
  context.window.addEventListener = () => {};
  vm.createContext(context);
  vm.runInContext(vaultSource, context, { filename: 'js/settings-secrets-vault.js' });
  vm.runInContext(settingsCoreSource, context, { filename: 'js/settings-core.js' });
  return context;
}

function loadSettingsFromStorage(ctx){
  const raw = ctx.localStorage.getItem('settings');
  ctx.settings = raw ? JSON.parse(raw) : { tgBotToken: '', syncHmacSecret: '' };
}

function storedSettings(ctx){
  return JSON.parse(ctx.localStorage.getItem('settings') || '{}');
}

(async () => {
  /* 1. Міграція legacy plaintext → secure vault */
  const legacy = { theme: 'dark', tgBotToken: TOKEN, syncHmacSecret: HMAC, tgBackupChatId: '-100123' };
  const ctx = makeHarness({ legacySettings: legacy });
  loadSettingsFromStorage(ctx);

  const migrated = await ctx.mtSettingsSecretsRestoreIntoSettings();
  assert.equal(migrated, true, 'міграція успішна');
  assert.equal(ctx.settings.tgBotToken, TOKEN, 'Telegram-токен НЕ втрачено після міграції');
  assert.equal(ctx.settings.syncHmacSecret, HMAC, 'HMAC-секрет НЕ втрачено після міграції');
  assert.equal(ctx.settings.tgBackupChatId, '-100123', 'несекретні налаштування не чіпаються');

  // У vault тепер є зашифрований запис, і він не містить plaintext.
  const record = ctx.store.get('__settingsSecretsV1');
  assert.ok(record, 'vault-запис створено');
  assert.equal(Number(record.version), 1);
  const cipherBytes = Buffer.from(record.ciphertext).toString('latin1');
  assert.equal(cipherBytes.includes('AAF-TEST'), false, 'ciphertext не містить plaintext токена');
  const keyRec = ctx.store.get('__settingsSecretsKeyV1');
  assert.ok(keyRec && keyRec.type === 'secret' && keyRec.extractable === false, 'vault-ключ non-extractable AES-GCM');

  /* 2. Після міграції plaintext стертий з localStorage */
  const afterMigration = storedSettings(ctx);
  assert.equal(afterMigration.tgBotToken, '', 'localStorage більше не містить plaintext tgBotToken');
  assert.equal(afterMigration.syncHmacSecret, '', 'localStorage більше не містить plaintext syncHmacSecret');
  assert.equal(ctx.localStorage.getItem('settings').includes('AAF-TEST'), false, 'у всьому raw settings немає токена');
  assert.equal(afterMigration.theme, 'dark', 'решта налаштувань у localStorage збережена');

  /* 3+4. Використання після міграції: зміна токена → saveSettings → vault → «рестарт» */
  ctx.settings.tgBotToken = '987654321:NEW-TOKEN-AFTER-MIGRATION';
  ctx.saveSettings();
  const persisted = storedSettings(ctx);
  assert.equal(persisted.tgBotToken, '', 'saveSettings не пише новий токен plaintext у localStorage');
  assert.equal(ctx.localStorage.getItem('settings').includes('NEW-TOKEN'), false, 'новий токен теж не потрапив у localStorage');
  await ctx.mtSettingsSecretsFlushPending();
  const vaultNow = await ctx.mtSettingsSecretsVaultRead();
  assert.equal(vaultNow.tgBotToken, '987654321:NEW-TOKEN-AFTER-MIGRATION', 'оновлений токен зашифровано у vault');
  assert.equal(vaultNow.syncHmacSecret, HMAC, 'HMAC-секрет збережено у vault');

  // Імітація перезавантаження: settings читаються з (вже санітованого) localStorage,
  // секрети повертаються з vault — Telegram/sync отримують робочі значення.
  loadSettingsFromStorage(ctx);
  assert.equal(ctx.settings.tgBotToken, '', 'до відновлення з vault токена в settings немає');
  const restored = await ctx.mtSettingsSecretsRestoreIntoSettings();
  assert.equal(restored, true, 'повторне відновлення з vault успішне');
  assert.equal(ctx.settings.tgBotToken, '987654321:NEW-TOKEN-AFTER-MIGRATION', 'після «рестарту» Telegram-токен читається з vault і придатний до використання');
  assert.equal(ctx.settings.syncHmacSecret, HMAC, 'після «рестарту» HMAC-секрет придатний до використання (довжина >= 32)');
  assert.ok(String(ctx.settings.syncHmacSecret).length >= 32, 'sync online-gate бачить валідний секрет');

  /* 5. Деградований режим: IndexedDB недоступний — plaintext НЕ витирається */
  const degraded = makeHarness({ idbAvailable: false, legacySettings: legacy });
  loadSettingsFromStorage(degraded);
  const degradedResult = await degraded.mtSettingsSecretsRestoreIntoSettings();
  assert.equal(degradedResult, false, 'без IDB міграція чесно повертає false');
  assert.equal(degraded.settings.tgBotToken, TOKEN, 'токен лишається доступним у пам’яті');
  degraded.saveSettings();
  assert.equal(storedSettings(degraded).tgBotToken, TOKEN, 'без vault saveSettings НЕ витирає plaintext — токен не втрачається');
  assert.equal(degraded.mtSettingsSecretsPreparePersist({ tgBotToken: TOKEN, syncHmacSecret: HMAC }).tgBotToken, TOKEN, 'preparePersist у legacy-режимі повертає джерело без змін');

  /* Користувач без секретів: vault все одно синхронізується, plaintext-ключі порожні */
  const fresh = makeHarness({ legacySettings: { theme: 'light', tgBotToken: '', syncHmacSecret: '' } });
  loadSettingsFromStorage(fresh);
  assert.equal(await fresh.mtSettingsSecretsRestoreIntoSettings(), true, 'чистий старт синхронізовано з vault');
  fresh.settings.tgBotToken = TOKEN;
  fresh.saveSettings();
  assert.equal(storedSettings(fresh).tgBotToken, '', 'на чистому старті токен одразу йде лише в vault');
  await fresh.mtSettingsSecretsFlushPending();
  assert.equal((await fresh.mtSettingsSecretsVaultRead()).tgBotToken, TOKEN, 'vault отримав токен з чистого старту');

  /* 6. Інтеграція: app.js відновлює секрети ДО sync engine; index.html/sw.js підключають модуль */
  const restoreIdx = appSource.indexOf('mtSettingsSecretsRestoreIntoSettings');
  const transportIdx = appSource.indexOf('MTSyncTransport.create');
  assert.ok(restoreIdx > -1, 'app.js викликає відновлення секретів у init()');
  assert.ok(transportIdx > -1 && restoreIdx < transportIdx, 'секрети відновлюються до створення sync engine');
  assert.ok(appSource.indexOf('backupDb = await openBackupDb()') > -1, 'init() відкриває backupDb для vault');
  assert.ok(htmlSource.indexOf('js/settings-secrets-vault.js') > -1, 'index.html підключає vault-модуль');
  assert.ok(htmlSource.indexOf('js/settings-secrets-vault.js') < htmlSource.indexOf('<script src="app.js"'), 'vault-модуль завантажується до app.js');
  assert.ok(swSource.includes("'./js/settings-secrets-vault.js'"), 'sw.js precache містить vault-модуль');

  console.log('PASS settings secrets vault: legacy plaintext migration, encrypted storage, post-migration usage, degraded fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });

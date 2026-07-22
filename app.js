/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — основний скрипт
   Розділи: 0) константи й стан, 1) допоміжні функції, 2) синхронізація,
   3) навігація/модалки, 4) екран «Заявки», 5) екран «Калькулятор»,
   6) екран «Зміни», 7) екран «Налаштування», 8) ініціалізація
   ===================================================================== */

/* ---------- 0. Константи та стан ---------- */
const DEFAULT_SCRIPT_URL = ''; // якщо settings.scriptUrl порожній — синхронізація вимкнена
const DEFAULT_TAGS = ['ремонт','монтаж','діагностика','підключення','перенесення','аварія'];
const DEFAULT_COWORKERS = ['Сам'];
const DEFAULT_MASTERS = [
  {name:'Женя', letter:'G'},
  {name:'Артем', letter:'V'},
  {name:'Петя', letter:'V'},
  {name:'Паша', letter:'K'}
];
const DEFAULT_MATERIALS = [
  {id:'onu',       label:'ONU',        price:800},
  {id:'router',    label:'Роутер',     price:600},
  {id:'ups',       label:'ДБЖ',        price:900},
  {id:'androidtv', label:'Android TV', price:1500},
];
const DEFAULT_WORK_TYPES = [
  {id:'router_setup',  label:'Налаштування роутера',        price:50},
  {id:'smarttv_setup', label:'Налаштування Smart TV',       price:50},
  {id:'megogo',         label:'Підключення MEGOGO',          price:50},
  {id:'optic_splice',   label:'Пайка оптичного кабелю',      price:100},
  {id:'rj45_redo',      label:'Переобжати конектор RJ-45',   price:50},
  {id:'urgent_call',    label:'Терміновий виклик',           price:400},
  {id:'camera_install', label:'Встановлення камери нагляду', price:1000},
  {id:'power_supply',   label:'Блок живлення оптичного термінала', price:250},
];
// EQUIPMENT_CONFIG тепер береться з settings.materials (редагується в Налаштуваннях)
function getEquipmentConfig(){ return (settings && settings.materials) ? settings.materials : DEFAULT_MATERIALS; }
function getWorkTypesConfig(){ return (settings && settings.workTypes) ? settings.workTypes : DEFAULT_WORK_TYPES; }

const DEFAULT_CABLE_TYPES = [
  {id:'utp',   label:'UTP',    pricePerMeter:7},
  {id:'optic', label:'Оптика', pricePerMeter:9},
];
// CABLE_TYPES_CONFIG тепер береться з settings.cableTypes (редагується в Налаштуваннях) —
// можна додати свій тип кабелю (наприклад, вуличний), а не лише UTP/Оптику
function getCableTypesConfig(){ return (settings && settings.cableTypes && settings.cableTypes.length) ? settings.cableTypes : DEFAULT_CABLE_TYPES; }

function loadJSON(key, fallback){
  try{ const v = JSON.parse(localStorage.getItem(key)); return (v===null||v===undefined) ? fallback : v; }
  catch(e){ return fallback; }
}
function loadSettings(){
  const s = loadJSON('settings', null);
  const base = {hourlyRate:150, tags:[...DEFAULT_TAGS], coworkers:[...DEFAULT_COWORKERS], cities:[], streets:{}, theme:'dark', scriptUrl:DEFAULT_SCRIPT_URL, shiftsScriptUrl:'', materials: DEFAULT_MATERIALS.map(m=>({...m})), workTypes: DEFAULT_WORK_TYPES.map(m=>({...m})), cableTypes: DEFAULT_CABLE_TYPES.map(c=>({...c})), defaultConnectFee:500, defaultRepairCallFee:300, defaultTariff:250, syncSecret:'', vizitkaUrl:'https://on-b6a966.netlify.app', dogovorUrl:'', masters: DEFAULT_MASTERS.map(m=>({...m})), tgBotToken:'', tgBackupChatId:'', tgDispatcherChatId:'', tgDispatchers:[{name:'',chatId:''},{name:'',chatId:''}], tgMyChatId:''};
  const merged = s ? Object.assign(base, s) : base;
  // NEW: міграція зі старих окремих налаштувань utpPriceDefault/opticPriceDefault —
  // якщо вони колись були збережені, а нового списку cableTypes ще нема, переносимо ціни
  if(s && !s.cableTypes && (s.utpPriceDefault!==undefined || s.opticPriceDefault!==undefined)){
    merged.cableTypes = [
      {id:'utp',   label:'UTP',    pricePerMeter: Number(s.utpPriceDefault)||7},
      {id:'optic', label:'Оптика', pricePerMeter: Number(s.opticPriceDefault)||9},
    ];
  }
  // NEW: міграція зі старого одного поля tgDispatcherChatId (через кому) —
  // якщо нового іменованого списку tgDispatchers ще нема, розкладаємо в перші слоти
  if(s && !s.tgDispatchers && s.tgDispatcherChatId){
    const ids = s.tgDispatcherChatId.split(',').map(x=>x.trim()).filter(Boolean);
    merged.tgDispatchers = [
      {name:'Диспетчер 1', chatId: ids[0]||''},
      {name:'Диспетчер 2', chatId: ids[1]||''},
    ];
  }
  return merged;
}

let settings = loadSettings();
let tickets  = loadJSON('tickets', []);
let shifts   = loadJSON('shifts', []);
let deletedTickets = loadJSON('deletedTickets', []); // "кошик" — останні видалені заявки, можна відновити
const DELETED_TICKETS_MAX = 10;

let currentTicketDate = formatDate(new Date()); // 'DD.MM.YYYY'
let currentShiftDate  = formatDate(new Date());
let statsViewDate = new Date(); // місяць, що переглядається в огляді статистики/графіку (не пов'язаний з днем додавання зміни)
let calendarViewDate  = new Date(); // місяць, що показується в календарі заявок
let shiftCalendarViewDate = new Date(); // місяць, що показується в календарі змін
let searchQuery = '';
// Ліміт рендеру списку заявок: без нього innerHTML на тисячах заявок
// підвисає телефон при кожному натисканні клавіші в пошуку.
// Скидається на 100 автоматично, щойно змінюється пошук/фільтр/день (signature).
let ticketListRenderLimit = 100;
let ticketListRenderSignature = '';
const TICKET_LIST_PAGE_SIZE = 100;
let activeFilterTags = new Set();

let calcState = blankCalcState();
let editingTicketId = null;
let feeIsAutoDefault = true; // NEW: поки true — ціну виклику/підключення можна автоматично підставити при зміні типу заявки; false — майстер вже ввів своє значення вручну, чіпати не можна
let tariffIsAutoDefault = true; // те саме, але для поля "Тариф" — щоб автопідставлене за замовчуванням значення не вважалось "незбереженою зміною"

let coworkerSelection = new Set(['Сам']);

/* ---------- 1. Допоміжні функції ---------- */
function saveTickets(){ localStorage.setItem('tickets', JSON.stringify(tickets)); }
function saveShifts(){ localStorage.setItem('shifts', JSON.stringify(shifts)); }
function saveSettings(){ localStorage.setItem('settings', JSON.stringify(settings)); }

/* ---- Фото зберігаються окремо в IndexedDB, а не в localStorage ----
   Причина: localStorage має жорсткий ліміт (~5-10МБ на весь сайт), і при
   великій кількості заявок із фото (base64-рядки по 30-100КБ кожен) це
   швидко призводить до переповнення та втрати даних або «зависання»
   інтерфейсу через величезний JSON.stringify(tickets) при кожному збереженні.
   IndexedDB не має такого практичного лімııту і не блокує основний потік.
   У об'єкті заявки (t.photo) тепер зберігається не сам base64, а ключ
   виду 'idb:<id>'; сирі дані лежать в IndexedDB під цим ключем.
   photoCache — пам'ятковий кеш уже завантажених фото для синхронного рендеру. */
const PHOTO_DB_NAME = 'masterTrackerPhotos';
const PHOTO_STORE = 'photos';
let photoDb = null;
const photoCache = new Map();

function openPhotoDb(){
  return new Promise((resolve)=>{
    if(!window.indexedDB){ resolve(null); return; }
    const req = indexedDB.open(PHOTO_DB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(PHOTO_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=>{ console.error('IndexedDB помилка відкриття', req.error); resolve(null); };
  });
}
function photoDbPut(key, dataUrl){
  return new Promise((resolve)=>{
    if(!photoDb){ resolve(false); return; }
    try{
      const tx = photoDb.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).put(dataUrl, key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=>{ console.error('IndexedDB помилка запису', tx.error); resolve(false); };
    }catch(e){ console.error(e); resolve(false); }
  });
}
function photoDbDelete(key){
  return new Promise((resolve)=>{
    if(!photoDb){ resolve(false); return; }
    try{
      const tx = photoDb.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).delete(key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> resolve(false);
    }catch(e){ resolve(false); }
  });
}
/* NEW: якщо локальної копії фото немає (видалили, очистили дані сайту, новий
   телефон через 2 роки і т.д.), а в заявці збережено tgPhotoFileId — пробуємо
   дотягнутись до резервної копії в Telegram-групі за цим file_id. Успішний
   результат одразу "лікуємо" назад у локальний IndexedDB під тим самим ключем,
   щоб наступного разу вже не ходити в мережу. */
async function fetchPhotoFromTelegram(fileId){
  const token = (settings.tgBotToken||'').trim();
  if(!fileId || !token) return null;
  try{
    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const info = await infoRes.json();
    if(!info.ok) return null;
    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`);
    const blob = await fileRes.blob();
    return await new Promise(resolve=>{
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = ()=> resolve(null);
      reader.readAsDataURL(blob);
    });
  }catch(e){ console.error('Telegram: не вдалося підтягнути фото-бекап', e); return null; }
}
function photoDbGet(key){
  return new Promise((resolve)=>{
    if(!photoDb){ resolve(null); return; }
    try{
      const tx = photoDb.transaction(PHOTO_STORE, 'readonly');
      const req = tx.objectStore(PHOTO_STORE).get(key);
      req.onsuccess = ()=> resolve(req.result || null);
      req.onerror = ()=> resolve(null);
    }catch(e){ resolve(null); }
  });
}
/* Повертає base64 фото за ключем заявки/калькулятора (синхронно, з кешу,
   або асинхронно довантажує з IndexedDB та перемальовує callback-ом).
   tgFallbackFileId — необов'язковий: якщо локально нічого не знайшлось,
   пробуємо дотягнути з Telegram-бекапу (див. fetchPhotoFromTelegram вище). */
function getPhotoCached(photoKey, onLoaded, tgFallbackFileId){
  if(!photoKey) return null;
  if(!String(photoKey).startsWith('idb:')) return photoKey; // старі дані (base64 напряму) — сумісність
  if(photoCache.has(photoKey)) return photoCache.get(photoKey);
  photoDbGet(photoKey).then(async val=>{
    if(!val && tgFallbackFileId){
      val = await fetchPhotoFromTelegram(tgFallbackFileId);
      if(val) await photoDbPut(photoKey, val); // лікуємо локальне сховище під тим самим ключем
    }
    if(val){ photoCache.set(photoKey, val); if(onLoaded) onLoaded(val); }
  });
  return null;
}
/* Зберігає нове фото (data URL) в IndexedDB, повертає ключ для запису в заявку */
/* Те саме, що getPhotoCached, але як Promise — для місць, де потрібно дочекатись результату (поділитися, тощо) */
async function resolvePhotoAsync(photoKey, tgFallbackFileId){
  if(!photoKey) return null;
  if(!String(photoKey).startsWith('idb:')) return photoKey; // старі дані — сумісність
  if(photoCache.has(photoKey)) return photoCache.get(photoKey);
  let val = await photoDbGet(photoKey);
  if(!val && tgFallbackFileId){
    val = await fetchPhotoFromTelegram(tgFallbackFileId);
    if(val) await photoDbPut(photoKey, val); // лікуємо локальне сховище під тим самим ключем
  }
  if(val) photoCache.set(photoKey, val);
  return val;
}
async function storePhoto(dataUrl){
  const key = 'idb:' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  photoCache.set(key, dataUrl);
  await photoDbPut(key, dataUrl);
  return key;
}
async function deletePhotoKey(key){
  if(!key || !String(key).startsWith('idb:')) return;
  photoCache.delete(key);
  await photoDbDelete(key);
}
function clearAllPhotos(){
  photoCache.clear();
  if(!photoDb) return;
  try{
    const tx = photoDb.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).clear();
  }catch(e){ console.error(e); }
}
/* ---- Щоденні автобекапи — самі знімки (важкі, tickets+shifts) лежать в
   IndexedDB (окрема база, як і фото), а легкий список по датах — у
   localStorage (dailyBackupIndex), щоб швидко малювати список у Налаштуваннях
   без походу в IndexedDB. ---- */
const BACKUP_DB_NAME = 'masterTrackerBackups';
const BACKUP_STORE = 'daily';
const DAILY_BACKUP_MAX = 10;
let backupDb = null;
function openBackupDb(){
  return new Promise((resolve)=>{
    if(!window.indexedDB){ resolve(null); return; }
    const req = indexedDB.open(BACKUP_DB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(BACKUP_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=>{ console.error('IndexedDB бекапів: помилка відкриття', req.error); resolve(null); };
  });
}
function backupDbPut(key, value){
  return new Promise((resolve)=>{
    if(!backupDb){ resolve(false); return; }
    try{
      const tx = backupDb.transaction(BACKUP_STORE, 'readwrite');
      tx.objectStore(BACKUP_STORE).put(value, key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> resolve(false);
    }catch(e){ resolve(false); }
  });
}
function backupDbGet(key){
  return new Promise((resolve)=>{
    if(!backupDb){ resolve(null); return; }
    try{
      const tx = backupDb.transaction(BACKUP_STORE, 'readonly');
      const req = tx.objectStore(BACKUP_STORE).get(key);
      req.onsuccess = ()=> resolve(req.result || null);
      req.onerror = ()=> resolve(null);
    }catch(e){ resolve(null); }
  });
}
function backupDbDelete(key){
  return new Promise((resolve)=>{
    if(!backupDb){ resolve(false); return; }
    try{
      const tx = backupDb.transaction(BACKUP_STORE, 'readwrite');
      tx.objectStore(BACKUP_STORE).delete(key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> resolve(false);
    }catch(e){ resolve(false); }
  });
}
function loadDailyBackupIndex(){
  try{ return JSON.parse(localStorage.getItem('dailyBackupIndex')) || []; }catch(e){ return []; }
}
function saveDailyBackupIndex(index){
  try{ localStorage.setItem('dailyBackupIndex', JSON.stringify(index)); }catch(e){ /* сховище повне — не критично */ }
}
// NEW: викликається раз при старті застосунку — якщо сьогодні ще не було
// автобекапу, робить знімок і кладе його в IndexedDB, старший за 10-й видаляє
async function maybeRunDailyBackup(){
  if(!backupDb) return;
  const todayKey = new Date().toISOString().slice(0,10); // YYYY-MM-DD, стабільний ключ для порівняння днів
  const index = loadDailyBackupIndex();
  if(index[0] && index[0].date === todayKey) return; // сьогодні вже було
  const ok = await backupDbPut(todayKey, {tickets, shifts, exportedAt: new Date().toISOString()});
  if(!ok) return;
  index.unshift({date: todayKey, ts: Date.now(), ticketsCount: tickets.length, shiftsCount: shifts.length});
  const overflow = index.splice(DAILY_BACKUP_MAX); // все, що вилетіло за межі 10 останніх
  for(const old of overflow) backupDbDelete(old.date);
  saveDailyBackupIndex(index);
  // NEW: одразу ж скачуємо цей знімок як справжній файл у "Завантаження" —
  // саме він переживе очищення кешу/даних сайту, на відміну від копії в IndexedDB.
  // Браузер може першого разу запитати дозвіл на автозавантаження — його треба дозволити.
  if(tickets.length || shifts.length) await downloadDailyBackup(todayKey, {silent:true});
}
function renderDailyBackupList(){
  const wrap = document.getElementById('dailyBackupList');
  if(!wrap) return;
  const index = loadDailyBackupIndex();
  wrap.innerHTML = index.length ? index.map(entry=>{
    const d = new Date(entry.ts);
    return `<div class="settings-row" style="align-items:center;">
      <div><div class="sr-title">${formatDate(d)}</div><div style="font-size:12px; color:var(--text-dim);">Заявок: ${entry.ticketsCount}, змін: ${entry.shiftsCount}</div></div>
      <div class="row" style="gap:6px;">
        <button type="button" class="btn btn-sm daily-backup-download-btn" data-date="${entry.date}" title="Зберегти як файл">💾</button>
        <button type="button" class="btn btn-sm btn-ghost daily-backup-restore-btn" data-date="${entry.date}" title="Відновити з цього дня">♻️</button>
      </div>
    </div>`;
  }).join('') : '<span style="color:var(--text-faint); font-size:13px;">Бекапів ще немає — перший з\'явиться після сьогоднішнього відкриття застосунку</span>';
}
async function downloadDailyBackup(dateKey, opts={}){
  const payload = await backupDbGet(dateKey);
  if(!payload){ if(!opts.silent) showToast('Не вдалося знайти цей бекап'); return; }
  const blob = new Blob([JSON.stringify({app:'master-tracker', exportedAt: payload.exportedAt, tickets: payload.tickets, shifts: payload.shifts}, null, 2)], {type:'application/json;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `master-tracker-backup-${dateKey}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(opts.silent ? `📅 Щоденний бекап (${dateKey}) збережено у Завантаження` : 'Файл бекапу завантажено');
}
async function restoreDailyBackup(dateKey){
  const payload = await backupDbGet(dateKey);
  if(!payload){ showToast('Не вдалося знайти цей бекап'); return; }
  if(!confirm(`Відновити дані станом на ${dateKey}?\nПоточні локальні заявки й зміни буде замінено.`)) return;
  tickets = payload.tickets || [];
  shifts = payload.shifts || [];
  saveTickets(); saveShifts();
  renderTicketsScreen(); renderShiftsScreen();
  showToast('Дані відновлено з щоденного бекапу');
}
/* ---- Щомісячне нагадування почистити старі файли бекапів у "Завантаженнях" ----
   Застосунок не може сам видаляти файли з "Завантажень" (браузер це навмисно
   забороняє), тож 1-го числа кожного місяця показуємо на весь екран нагадування
   зробити це вручну. Показується один раз за місяць, поки не натиснуть кнопку. */
function maybeShowMonthlyCleanupReminder(){
  const now = new Date();
  if(now.getDate() !== 1) return; // тільки 1-го числа
  const monthKey = now.toISOString().slice(0,7); // YYYY-MM
  if(localStorage.getItem('cleanupReminderMonth') === monthKey) return; // цього місяця вже показували
  showCleanupReminderOverlay(monthKey);
}
function showCleanupReminderOverlay(monthKey){
  const root = document.getElementById('cleanupReminderRoot');
  if(!root) return;
  root.innerHTML = `
    <div id="cleanupReminderOverlay" style="position:fixed; inset:0; z-index:210; background:var(--bg); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:30px 24px; gap:14px;">
      <div style="font-size:56px;">🧹</div>
      <div style="font-size:20px; font-weight:800;">Перше число — час почистити бекапи!</div>
      <div style="font-size:14.5px; color:var(--text-dim); max-width:380px; line-height:1.5;">
        Кожен день сюди в «Завантаження» на телефоні складається новий файл
        <span style="font-family:var(--mono); font-size:12.5px;">master-tracker-backup-...json</span>.
        Відкрий Файли / Завантаження і видали зайві старі — досить лишити останні кілька.
      </div>
      <button type="button" class="btn btn-accent btn-block" id="cleanupReminderDoneBtn" style="max-width:320px; margin-top:10px;">✅ Гаразд, я почистив(-ла)</button>
      <button type="button" class="btn btn-ghost btn-sm" id="cleanupReminderLaterBtn">Нагадати пізніше сьогодні</button>
    </div>`;
  document.getElementById('cleanupReminderDoneBtn').addEventListener('click', ()=>{
    localStorage.setItem('cleanupReminderMonth', monthKey); // цього місяця більше не показувати
    root.innerHTML = '';
  });
  document.getElementById('cleanupReminderLaterBtn').addEventListener('click', ()=>{
    root.innerHTML = ''; // ховаємо лише на зараз — знову зʼявиться при наступному відкритті сьогодні
  });
}
/* Одноразова міграція: старі заявки, де photo — це сам base64-рядок,
   переносяться в IndexedDB, а в заявці залишається лише короткий ключ.
   Це звільняє localStorage і прибирає причину «зависань» на великих базах. */
async function migrateLegacyPhotosToIdb(){
  if(!photoDb) return;
  let changed = false;
  for(const t of tickets){
    if(t.photo && typeof t.photo==='string' && t.photo.startsWith('data:')){
      const key = await storePhoto(t.photo);
      t.photo = key;
      changed = true;
    }
  }
  if(changed) saveTickets();
}

function pad2(n){ return String(n).padStart(2,'0'); }
function normalizeMac(raw){
  if(!raw) return '';
  // Прибираємо все, окрім літер і цифр (тире, двокрапки, крапки, пробіли —
  // штрих-коди на різних наліпках дають різні розділювачі), і приводимо
  // до верхнього регістру для однаковості.
  return String(raw).replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
}

/* Маска телефону у форматі (050)555-55-55, поки користувач вводить цифри */
function formatPhoneInput(e){
  const digits = e.target.value.replace(/\D/g,'').slice(0,10);
  let out = '';
  if(digits.length>0) out = '(' + digits.substring(0,3);
  if(digits.length>=3) out += ')';
  if(digits.length>3) out += digits.substring(3,6);
  if(digits.length>6) out += '-' + digits.substring(6,8);
  if(digits.length>8) out += '-' + digits.substring(8,10);
  e.target.value = out;
}
function formatDate(d){ return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.${d.getFullYear()}`; }
function formatTime(d){ return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function parseDate(str){
  if(!str) return new Date();
  const [dd,mm,yyyy] = str.split('.').map(Number);
  return new Date(yyyy, (mm||1)-1, dd||1);
}
function shiftDate(str, days){
  const d = parseDate(str);
  d.setDate(d.getDate()+days);
  return formatDate(d);
}
/* Конвертація для нативного календаря (<input type="date"> працює лише з ISO РРРР-ММ-ДД,
   а весь застосунок і Google-таблиця зберігають дату як ДД.ММ.РРРР — тому синхронізуємо обидва поля разом). */
function ddmmyyyyToIso(s){
  const m = String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function isoToDdmmyyyy(iso){
  const m = String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}
function setDateFieldValue(ddmmyyyy){
  document.getElementById('f_date').value = ddmmyyyy || '';
  document.getElementById('f_dateNative').value = ddmmyyyyToIso(ddmmyyyy);
}
function isSameMonth(dateStr, refDate){
  const d = parseDate(dateStr);
  return d.getMonth()===refDate.getMonth() && d.getFullYear()===refDate.getFullYear();
}
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtMoney(n){ return `${Math.round(n||0)} грн`; }

function showToast(msg, ms=2200){
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=>{ el.remove(); }, ms);
}

function openModal(title, bodyHtml, opts={}){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal">
        <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="modal-close" id="modalCloseBtn">✕</button></div>
        <div id="modalBody">${bodyHtml}</div>
      </div>
    </div>`;
  document.getElementById('modalCloseBtn').onclick = closeModal;
  document.getElementById('modalOverlay').addEventListener('click', e=>{ if(e.target.id==='modalOverlay') closeModal(); });
  if(opts.onOpen) opts.onOpen(document.getElementById('modalBody'));
}
/* ---------- Історія абонента (пошук збігів по телефону/адресі/MAC) ---------- */
function normalizePhoneKey(raw){
  if(!raw) return '';
  const digits = String(raw).replace(/\D/g,'');
  if(!digits) return '';
  // Порівнюємо останні 9 цифр — так номери з +380, з 0 на початку чи
  // без коду країни однаково зводяться до одного ключа.
  return digits.slice(-9);
}
function normalizeAddressKey(t){
  const raw = [t.city, t.address, t.street, t.house, t.apartment].filter(Boolean).join(' ');
  if(!raw) return '';
  // \b у JS не працює з кирилицею (вона не входить у \w), тому прибираємо
  // службові слова токен за токеном, а не через word-boundary regex.
  const stop = new Set(['м','місто','вул','вулиця','буд','будинок','кв','квартира','б','просп','проспект']);
  return raw.toLowerCase()
    .replace(/[.,№]/g,' ')
    .split(/\s+/)
    .filter(tok => tok && !stop.has(tok))
    .join('');
}
function findAbonentMatches(t){
  const phoneKey = normalizePhoneKey(t.phone);
  const addrKey = normalizeAddressKey(t);
  const macKey = normalizeMac(t.macAddress);
  if(!phoneKey && !addrKey && !macKey) return [];
  const matches = [];
  tickets.forEach(other=>{
    if(String(other.id) === String(t.id)) return;
    const reasons = [];
    if(phoneKey && normalizePhoneKey(other.phone) === phoneKey) reasons.push('телефон');
    if(addrKey && normalizeAddressKey(other) === addrKey) reasons.push('адреса');
    if(macKey && normalizeMac(other.macAddress) === macKey) reasons.push('MAC ONU');
    if(reasons.length) matches.push({ticket:other, reasons});
  });
  matches.sort((a,b)=> `${b.ticket.date} ${b.ticket.time}`.localeCompare(`${a.ticket.date} ${a.ticket.time}`));
  return matches;
}
function showAbonentHistory(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  const matches = findAbonentMatches(t);
  if(!matches.length){
    showToast('Збігів не знайдено — це перша заявка для цього абонента');
    return;
  }
  const itemsHtml = matches.map(m=>{
    const o = m.ticket;
    const address = [o.city, o.address].filter(Boolean).join(', ') || '—';
    const badges = m.reasons.map(r=>`<span class="chip" style="pointer-events:none;">${escapeHtml(r)}</span>`).join(' ');
    return `
      <div class="card" style="margin-bottom:10px; padding:12px 14px;">
        <div class="row between" style="margin-bottom:4px;">
          <strong>${escapeHtml(o.date||'')} ${escapeHtml(o.time||'')}</strong>
          <span style="font-size:12.5px; color:var(--text-dim);">${escapeHtml(o.type||'')}</span>
        </div>
        <div style="font-size:13.5px; margin-bottom:2px;">📍 ${escapeHtml(address)}</div>
        ${o.macAddress ? `<div style="font-size:12.5px; color:var(--text-dim); margin-bottom:2px;">MAC: ${escapeHtml(o.macAddress)}</div>` : ''}
        ${o.sum ? `<div style="font-size:12.5px; color:var(--text-dim); margin-bottom:6px;">Сума: ${escapeHtml(String(o.sum))} грн</div>` : ''}
        <div class="row wrap" style="gap:4px; margin-bottom:6px;">${badges}</div>
        <button type="button" class="btn btn-sm btn-block open-history-ticket-btn" data-id="${o.id}">Відкрити заявку</button>
      </div>`;
  }).join('');
  openModal(`Історія абонента (${matches.length})`, `<div>${itemsHtml}</div>`, {onOpen: (rootEl)=>{
    rootEl.querySelectorAll('.open-history-ticket-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        closeModal();
        editTicket(btn.dataset.id);
      });
    });
  }});
}

function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }

/* ---------- Навігатор адрес: Місто → Вулиця → Будинок → Заявки ---------- */
// NEW: чотирирівневий пошук по факту заявок (а не по довіднику settings.cities/streets,
// щоб туди потрапляло геть усе, включно з тим, що було записано до автопрописки).
// Заявки, відновлені з хмари (cloudImported), потрапляють сюди лише якщо для них
// вручну дозаповнили місто й вулицю (поля city/street/house видно й редагуються
// навіть у "сирому" режимі) — критерій саме заповненість полів, а не сам прапорець.
let addrNavState = {level:'city', city:null, street:null, house:null};

function naturalSortStrings(arr){
  // NEW: природне сортування рядків з числами всередині — "2, 9, 12, 12а, 20",
  // а не "12, 12а, 2, 20", як дав би звичайний .sort()
  return arr.slice().sort((a,b)=>a.localeCompare(b, 'uk', {numeric:true, sensitivity:'base'}));
}

function buildAddressTree(){
  const tree = new Map(); // city -> Map(street -> Set(house))
  tickets.forEach(t=>{
    const city = (t.city||'').trim();
    const street = (t.street||'').trim();
    if(!city || !street) return;
    if(!tree.has(city)) tree.set(city, new Map());
    const streetsMap = tree.get(city);
    if(!streetsMap.has(street)) streetsMap.set(street, new Set());
    streetsMap.get(street).add((t.house||'').trim() || '(без номера)');
  });
  return tree;
}

function openAddressNavigator(){
  addrNavState = {level:'city', city:null, street:null, house:null};
  renderAddressNav();
}

function addrNavBreadcrumbHtml(){
  const crumbs = [`<span class="chip addr-nav-crumb" data-crumb="city" style="cursor:pointer;">🧭 Усі міста</span>`];
  if(addrNavState.city) crumbs.push(`<span class="chip addr-nav-crumb" data-crumb="street" style="cursor:pointer;">${escapeHtml(addrNavState.city)}</span>`);
  if(addrNavState.street) crumbs.push(`<span class="chip addr-nav-crumb" data-crumb="house" style="cursor:pointer;">${escapeHtml(addrNavState.street)}</span>`);
  return `<div class="row wrap" style="gap:6px; margin-bottom:12px;">${crumbs.join('')}</div>`;
}

function renderAddressNav(){
  const tree = buildAddressTree();
  let title = 'Навігатор адрес';
  let bodyHtml = addrNavBreadcrumbHtml();

  if(addrNavState.level==='city'){
    const cities = naturalSortStrings([...tree.keys()]);
    title = `Місто (${cities.length})`;
    bodyHtml += cities.length ? cities.map(city=>`
      <button type="button" class="btn btn-block addr-nav-city-btn" data-city="${escapeHtml(city)}" style="justify-content:space-between; margin-bottom:6px;">
        <span>${escapeHtml(city)}</span><span style="opacity:.6; font-weight:400;">${tree.get(city).size} вул. ›</span>
      </button>`).join('') : `<div class="empty-state" style="padding:24px 10px;"><div class="es-icon">🗺️</div>Ще немає заявок зі структурованою адресою</div>`;
  } else if(addrNavState.level==='street'){
    const streetsMap = tree.get(addrNavState.city) || new Map();
    const streets = naturalSortStrings([...streetsMap.keys()]);
    title = addrNavState.city;
    bodyHtml += streets.length ? streets.map(street=>`
      <button type="button" class="btn btn-block addr-nav-street-btn" data-street="${escapeHtml(street)}" style="justify-content:space-between; margin-bottom:6px;">
        <span>${escapeHtml(street)}</span><span style="opacity:.6; font-weight:400;">${streetsMap.get(street).size} буд. ›</span>
      </button>`).join('') : `<div class="empty-state" style="padding:24px 10px;">Вулиць не знайдено</div>`;
  } else if(addrNavState.level==='house'){
    const streetsMap = tree.get(addrNavState.city) || new Map();
    const houses = naturalSortStrings([...(streetsMap.get(addrNavState.street) || new Set())]);
    title = `${addrNavState.city}, ${addrNavState.street}`;
    bodyHtml += houses.length ? houses.map(house=>`
      <button type="button" class="btn btn-block addr-nav-house-btn" data-house="${escapeHtml(house)}" style="justify-content:space-between; margin-bottom:6px;">
        <span>буд. ${escapeHtml(house)}</span><span style="opacity:.6;">›</span>
      </button>`).join('') : `<div class="empty-state" style="padding:24px 10px;">Будинків не знайдено</div>`;
  } else if(addrNavState.level==='tickets'){
    const list = tickets.filter(t=>
      (t.city||'').trim()===addrNavState.city &&
      (t.street||'').trim()===addrNavState.street &&
      ((t.house||'').trim() || '(без номера)')===addrNavState.house
    ).sort((a,b)=> `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    title = `буд. ${addrNavState.house}`;
    bodyHtml += list.length
      ? `<div class="ticket-list">${list.map(renderTicketCard).join('')}</div>`
      : `<div class="empty-state" style="padding:24px 10px;">Заявок не знайдено</div>`;
  }

  if(addrNavState.level==='city'){
    bodyHtml += `<div style="margin-top:14px; padding-top:10px; border-top:1px dashed var(--border); font-size:11.5px; color:var(--text-faint); text-align:center;">
      Заявки з таблиць з'являться тут, тільки якщо вручну заповнити для них місто й вулицю — інакше шукайте їх через звичайний пошук
    </div>`;
  }

  openModal(title, bodyHtml, {onOpen: attachAddressNavHandlers});
}

function attachAddressNavHandlers(rootEl){
  rootEl.addEventListener('click', e=>{
    const crumb = e.target.closest('.addr-nav-crumb');
    if(crumb){
      const to = crumb.dataset.crumb;
      if(to==='city') addrNavState = {level:'city', city:null, street:null, house:null};
      else if(to==='street'){ addrNavState.level='street'; addrNavState.street=null; addrNavState.house=null; }
      else if(to==='house'){ addrNavState.level='house'; addrNavState.house=null; }
      renderAddressNav(); return;
    }
    const cityBtn = e.target.closest('.addr-nav-city-btn');
    if(cityBtn){ addrNavState = {level:'street', city:cityBtn.dataset.city, street:null, house:null}; renderAddressNav(); return; }
    const streetBtn = e.target.closest('.addr-nav-street-btn');
    if(streetBtn){ addrNavState.level='house'; addrNavState.street=streetBtn.dataset.street; addrNavState.house=null; renderAddressNav(); return; }
    const houseBtn = e.target.closest('.addr-nav-house-btn');
    if(houseBtn){ addrNavState.level='tickets'; addrNavState.house=houseBtn.dataset.house; renderAddressNav(); return; }
    // NEW: далі — ті самі дії, що й на звичайних картках заявок у списку
    const editBtn = e.target.closest('.edit-ticket-btn');
    if(editBtn){ closeModal(); editTicket(editBtn.dataset.id); return; }
    const shareBtn = e.target.closest('.share-ticket-btn');
    if(shareBtn){ shareTicket(shareBtn.dataset.id); return; }
    const tgBtn = e.target.closest('.tg-dispatcher-btn');
    if(tgBtn){ sendTicketToDispatcher(tgBtn.dataset.id); return; }
    const tgOpenBtn = e.target.closest('.tg-open-btn');
    if(tgOpenBtn){ openTicketInTelegram(tgOpenBtn.dataset.id); return; }
    const copyBtn = e.target.closest('.copy-ticket-btn');
    if(copyBtn){ copyTicketCardText(copyBtn.dataset.id); return; }
    const dgBtn = e.target.closest('.contract-ticket-btn');
    if(dgBtn){ showDogovor(dgBtn.dataset.id); return; }
    const histBtn = e.target.closest('.history-ticket-btn');
    if(histBtn){ closeModal(); showAbonentHistory(histBtn.dataset.id); return; }
    const delBtn = e.target.closest('.delete-ticket-btn');
    if(delBtn){ deleteTicket(delBtn.dataset.id); renderAddressNav(); return; }
    const expBtn = e.target.closest('.tc-expand-btn');
    if(expBtn){
      const id = expBtn.dataset.id;
      const contentEl = document.getElementById('tcc-'+id);
      if(!contentEl) return;
      const collapsed = contentEl.classList.toggle('tc-collapsed');
      expBtn.textContent = collapsed ? '▼ Розгорнути' : '▲ Згорнути';
    }
  });
}

/* ---------- Візитка (QR на контакти диспетчера) ---------- */
function showVizitka(){
  const url = (settings.vizitkaUrl || '').trim();
  if(!url){ showToast('Спершу вкажіть URL візитки в Налаштуваннях'); return; }
  let dataUrl = '';
  try{
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    dataUrl = qr.createDataURL(6); // margin не задаємо — тоді бере безпечний за замовчуванням (4 модулі)
  }catch(e){ showToast('Не вдалося згенерувати QR-код'); return; }
  openModal('Візитка LNET', `
    <div class="qr-wrap">
      <img src="${dataUrl}" alt="QR візитка">
      <div class="qr-hint">Дайте абоненту відсканувати камерою — відкриється сторінка з контактами диспетчера: натискання на телефон відкриє дзвінок, на Viber — Viber, на пошту — лист.</div>
      <button type="button" class="btn btn-block" id="openVizitkaLinkBtn">🔗 Відкрити посилання</button>
    </div>
  `, {onOpen: ()=>{
    document.getElementById('openVizitkaLinkBtn').onclick = ()=> window.open(url, '_blank');
  }});
}

/* ---------- Договір (картка абонента) ---------- */
const LNET_CONTACTS = {
  phone: '+380 (67) 568-20-22',
  viber: '+380 (73) 568-20-22 (Viber)',
  site: 'lnet.com.ua',
  schedule: 'Пн — Пт: 09:00 — 18:00\nСб: 09:00 — 16:00\nНд: Вихідний'
};
const UA_MONTHS = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
function formatUaDate(d){ return `${d.getDate()} ${UA_MONTHS[d.getMonth()]} ${d.getFullYear()} р.`; }

function showDogovor(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  if(!t.login && !t.password){
    if(!confirm('У цій заявці ще не вказано логін і пароль (додайте їх у калькуляторі при редагуванні заявки). Сформувати договір без них?')) return;
  }
  const rawAddress = [t.city, t.address].filter(Boolean).join(', ');
  const address = rawAddress || '—';
  const login = t.login || '—';
  const password = t.password || '—';
  const contractNumber = t.contractNumber || '';
  const text = buildDogovorText(address, login, password, contractNumber);
  let qrDataUrl = '';
  try{
    const qr = qrcode(0, 'M');
    const dogovorUrl = (settings.dogovorUrl || '').trim();
    if(dogovorUrl){
      // Кодуємо QR ПОСИЛАННЯМ на власну сторінку (dogovor-view.html), а не
      // сирим текстом — тоді будь-який сканер (Google Lens, камера, Viber)
      // одразу пропонує "відкрити посилання", замість незрозумілого
      // "шукати по штрихкоду". Так само влаштована й візитка.
      const params = new URLSearchParams();
      if(rawAddress) params.set('a', rawAddress);
      if(t.login) params.set('l', t.login);
      if(t.password) params.set('p', t.password);
      if(contractNumber) params.set('n', contractNumber);
      if(t.date) params.set('d', t.date);
      const sep = dogovorUrl.includes('?') ? '&' : '?';
      qr.addData(dogovorUrl + sep + params.toString());
    } else {
      // URL сторінки договору ще не налаштований у Налаштуваннях — кодуємо
      // стислим текстом напряму (без графіка й контактів, щоб QR лишався
      // невеликим). Працює, але деякі сканери можуть показати його не так
      // зручно, як посилання.
      qr.addData(buildDogovorQrText(address, login, password, contractNumber));
    }
    qr.make();
    qrDataUrl = qr.createDataURL(8); // margin не задаємо — тоді бере безпечний за замовчуванням (4 модулі)
  }catch(e){ /* якщо раптом все одно завелико — картку показуємо і без коду */ }
  const body = `
    <div class="dogovor-card">
      <div class="dg-title">LNET — інтернет-провайдер</div>
      <div class="dg-date">${escapeHtml(formatUaDate(new Date()))}</div>
      ${contractNumber ? `<div class="dg-site">№ ${escapeHtml(contractNumber)}</div>` : ''}
      <div class="dg-site">${escapeHtml(LNET_CONTACTS.site)}</div>
      <hr class="dg-sep">
      <div class="dg-label">Адреса підключення:</div>
      <div class="dg-value">${escapeHtml(address)}</div>
      <div class="dg-cabinet">
        <div class="dg-label">Логін:</div>
        <div class="dg-value" style="margin-bottom:0;">${escapeHtml(login)}</div>
        <div class="dg-label">Пароль:</div>
        <div class="dg-value" style="margin-bottom:0;">${escapeHtml(password)}</div>
      </div>
      <div class="dg-label" style="text-align:center;">Особистий рахунок:</div>
      <div class="dg-account">${escapeHtml(login)}</div>
      <div class="dg-label">Сайт:</div>
      <div class="dg-value">${escapeHtml(LNET_CONTACTS.site)}</div>
      <hr class="dg-sep">
      <div class="dg-contacts">
        <strong>Контакти:</strong><br>
        ${escapeHtml(LNET_CONTACTS.phone)}<br>
        ${escapeHtml(LNET_CONTACTS.viber)}
      </div>
      <div class="dg-schedule">
        <strong>Графік роботи:</strong><br>
        ${escapeHtml(LNET_CONTACTS.schedule).replace(/\n/g,'<br>')}
      </div>
      ${qrDataUrl ? `
      <div class="qr-wrap" style="margin-top:14px;">
        <img src="${qrDataUrl}" alt="QR договору" style="width:220px; height:220px;">
        <div class="qr-hint">${(settings.dogovorUrl||'').trim()
          ? 'QR веде на сторінку з даними абонента — сканер одразу запропонує її відкрити'
          : 'QR-код з логіном, паролем і адресою — залишається на картці, навіть якщо її зберегти як фото чи роздрукувати. Порада: додайте URL сторінки договору в Налаштуваннях — тоді QR працюватиме як посилання і розпізнаватиметься надійніше.'}</div>
      </div>` : ''}
    </div>
    <div class="row wrap" style="margin-top:14px;">
      <button type="button" class="btn" style="flex:1;" id="copyDogovorBtn">📄 Копіювати текст</button>
      <button type="button" class="btn" style="flex:1;" id="shareDogovorBtn">📤 Поділитися</button>
    </div>
    <button type="button" class="btn btn-block" id="printDogovorPdfBtn" style="margin-top:8px;">🖨️ Сформувати PDF-лист</button>
  `;
  openModal('Договір', body, {onOpen: ()=>{
    document.getElementById('copyDogovorBtn').onclick = async ()=>{
      try{ await navigator.clipboard.writeText(text); showToast('Скопійовано'); }
      catch(e){ showToast('Не вдалося скопіювати'); }
    };
    document.getElementById('shareDogovorBtn').onclick = async ()=>{
      if(navigator.share){ try{ await navigator.share({title:'Договір LNET', text}); }catch(e){} }
      else showToast('Поділитися не підтримується цим браузером');
    };
    document.getElementById('printDogovorPdfBtn').onclick = ()=>{
      printDogovorAsPdf({address, login, password, contractNumber});
    };
  }});
}

/* ---- PDF-лист договору — через діалог друку браузера ----
   Без зовнішніх бібліотек: створюємо прихований iframe зі своєю HTML-версткою
   листа, викликаємо iframe.contentWindow.print() — у діалозі друку на телефоні
   є варіант "Зберегти як PDF", саме так і виходить готовий PDF-файл. Обов'язково
   додаємо посилання на повний текст договору (публічну оферту) на сайті —
   про всяк випадок, якщо потрібна юридично повна версія, а не лише картка. */
function printDogovorAsPdf({address, login, password, contractNumber}){
  const scheduleHtml = escapeHtml(LNET_CONTACTS.schedule).replace(/\n/g,'<br>');
  const printHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Договір LNET</title>
  <style>
    body{ font-family: Arial, Helvetica, sans-serif; color:#111; padding:28px; }
    h1{ font-size:19px; margin:0 0 4px; }
    .date{ font-size:12px; color:#555; margin-bottom:18px; }
    .row{ margin-bottom:12px; }
    .label{ font-weight:700; font-size:11.5px; color:#555; text-transform:uppercase; letter-spacing:.3px; }
    .value{ font-size:15px; margin-top:2px; }
    hr{ border:none; border-top:1px solid #ccc; margin:16px 0; }
    .footer{ margin-top:26px; padding-top:14px; border-top:2px solid #111; font-size:12.5px; color:#333; }
    .footer a{ color:#0a5; word-break:break-all; }
    .footer .big{ font-weight:700; font-size:14px; }
  </style></head><body>
    <h1>LNET — Договір на підключення</h1>
    <div class="date">${escapeHtml(formatUaDate(new Date()))}${contractNumber ? ' · № ' + escapeHtml(contractNumber) : ''}</div>
    <div class="row"><div class="label">Адреса підключення</div><div class="value">${escapeHtml(address)}</div></div>
    <div class="row"><div class="label">Логін</div><div class="value">${escapeHtml(login)}</div></div>
    <div class="row"><div class="label">Пароль</div><div class="value">${escapeHtml(password)}</div></div>
    <div class="row"><div class="label">Особистий рахунок</div><div class="value">${escapeHtml(login)}</div></div>
    <hr>
    <div class="row"><div class="label">Контакти</div><div class="value">${escapeHtml(LNET_CONTACTS.phone)}, ${escapeHtml(LNET_CONTACTS.viber)}</div></div>
    <div class="row"><div class="label">Графік роботи</div><div class="value">${scheduleHtml}</div></div>
    <div class="footer">
      <div class="big">Повний текст договору (публічна оферта)</div>
      Офіційна юридична копія договору та всі документи — на сайті LNET, на всякий випадок, якщо знадобиться повний текст:<br>
      <a href="https://lnet.com.ua/dokumenti/">https://lnet.com.ua/dokumenti/</a>
    </div>
  </body></html>`;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(printHtml); doc.close();
  iframe.onload = ()=>{
    try{
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }catch(e){ showToast('Не вдалося відкрити друк — спробуйте ще раз'); }
    setTimeout(()=>{ iframe.remove(); }, 1500);
  };
}

function buildDogovorText(address, login, password, contractNumber){
  return [
    'LNET — інтернет-провайдер',
    formatUaDate(new Date()),
    contractNumber ? `№ договору: ${contractNumber}` : '',
    LNET_CONTACTS.site,
    '',
    `Адреса підключення: ${address}`,
    '',
    'Особистий кабінет:',
    `Логін: ${login}`,
    `Пароль: ${password}`,
    '',
    `Особистий рахунок: ${login}`,
    `Сайт: ${LNET_CONTACTS.site}`,
    '',
    'Контакти:',
    LNET_CONTACTS.phone,
    LNET_CONTACTS.viber,
    '',
    'Графік роботи:',
    LNET_CONTACTS.schedule
  ].filter(Boolean).join('\n');
}
/* Стисла версія лише для QR — чим менше символів (особливо кирилиці),
   тим менша щільність коду і тим легше його розпізнати камерою. */
function buildDogovorQrText(address, login, password, contractNumber){
  return [
    'LNET',
    contractNumber ? `№ ${contractNumber}` : '',
    `Адреса: ${address}`,
    `Логін: ${login}`,
    `Пароль: ${password}`,
    LNET_CONTACTS.site
  ].filter(Boolean).join('\n');
}

/* ---------- 2. Синхронізація з Google Sheets ----------
   Заявки завжди йдуть на settings.scriptUrl.
   Зміни йдуть на settings.shiftsScriptUrl, якщо він заданий (окрема таблиця/Excel-файл),
   інакше — туди ж, куди й заявки (одна спільна таблиця, як було раніше). */
function getScriptUrl(){ return (settings.scriptUrl || DEFAULT_SCRIPT_URL || '').trim(); }
function getShiftsScriptUrl(){ return (settings.shiftsScriptUrl || getScriptUrl()).trim(); }

function setSyncState(state){
  // state: 'idle' | 'syncing' | 'ok' | 'err'
  const dot = document.getElementById('syncDot');
  dot.className = 'sync-dot' + (state==='idle' ? '' : ' '+state);
  if(state==='ok' || state==='err'){
    setTimeout(()=>{ dot.className='sync-dot'; }, 1800);
  }
}

async function postToUrl(url, action, payload){
  if(!url) return false; // синхронізація не налаштована для цього типу даних — працюємо лише локально
  setSyncState('syncing');
  const body = JSON.stringify(Object.assign({action, secret: settings.syncSecret || ''}, payload));
  // ВІДКАТ: пробували спочатку звичайний (без no-cors) запит, щоб читати
  // справжню відповідь сервера — але на практиці Apps Script блокує CORS для
  // POST (через свій редірект), тож перша спроба щоразу падала і йшла друга
  // (no-cors) — тобто кожне збереження виконувалось на сервері ДВІЧІ
  // (включно з повторним пересортуванням всього листа), звідси й затримка.
  // Повертаємось до одного надійного no-cors запиту.
  try{
    await fetch(url, {
      method:'POST',
      mode:'no-cors', // Apps Script + no-cors: запит «глухий», відповідь прочитати не можна
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body
    });
    setSyncState('ok');
    return true;
  }catch(err){
    console.error('Помилка синхронізації:', err);
    setSyncState('err');
    return false;
  }
}
function syncTicketPost(action, payload){ return postToUrl(getScriptUrl(), action, payload); }
function syncShiftPost(action, payload){ return postToUrl(getShiftsScriptUrl(), action, payload); }
const syncPost = syncTicketPost; // зворотна сумісність з рештою коду заявок

/* ---- Адаптер для готового doGet-скрипта змін (формат GET-параметрів,
   а не POST з JSON) ----
   Скрипт користувача очікує:
   - додавання:  ?date=ДД.MM.РРРР&hours=8.5&coworker=Сам&id=12345
   - видалення:  ?action=delete&id=12345
   - повний список: ?action=list
   Дата передається саме в тому форматі, що вже використовується в
   існуючому аркуші користувача (ДД.MM.РРРР), без конвертації. */
async function syncShiftPostGet(action, payload){
  const url = getShiftsScriptUrl();
  if(!url){ showToast('⚠️ Синхронізація змін не налаштована — вкажіть URL у налаштуваннях'); return false; }
  setSyncState('syncing');
  try{
    const params = new URLSearchParams();
    params.set('secret', settings.syncSecret || '');
    if(action==='delete'){
      params.set('action','delete');
      params.set('id', payload.id);
    } else {
      params.set('date', payload.date);
      params.set('hours', payload.hours);
      params.set('coworker', payload.coworker || 'Сам');
      params.set('id', payload.id);
    }
    await fetch(`${url}?${params.toString()}`, {method:'GET', mode:'no-cors'});
    setSyncState('ok');
    return true;
  }catch(err){
    console.error('Помилка синхронізації змін:', err);
    setSyncState('err');
    return false;
  }
}

function ticketToSyncPayload(t){
  // Захист від «зіпсованих» заявок, що могли залишитись у локальному
  // сховищі з давніх тестів: якщо id/date/time не є нормальним рядком
  // (наприклад, лишився об'єкт Date або порожнє значення), підставляємо
  // безпечні значення замість того, щоб відправити сміття в таблицю.
  const safeId = (typeof t.id === 'number' || typeof t.id === 'string') ? String(t.id) : String(Date.now());
  const safeDate = (typeof t.date === 'string' && /^\d{2}\.\d{2}\.\d{4}$/.test(t.date)) ? t.date : formatDate(new Date());
  const safeTime = (typeof t.time === 'string' && /^\d{2}:\d{2}$/.test(t.time)) ? t.time : formatTime(new Date());
  // Геолокація та приватна примітка майстра НЕ входять у t.content (щоб не
  // потрапляти диспетчеру при копіюванні/шерингу), але для повного бекапу в
  // таблиці зберігаємо їх окремо — у службовому стовпці, який більше ніде в
  // застосунку не використовується і не завантажується назад автоматично.
  const backupExtra = [];
  if(t.geoLink) backupExtra.push(`Геолокація: ${t.geoLink}`);
  if(t.masterNote) backupExtra.push(`Приватна примітка майстра: ${t.masterNote}`);
  if(t.login) backupExtra.push(`Логін: ${t.login}`);
  if(t.password) backupExtra.push(`Пароль: ${t.password}`);
  return {id:safeId, date:safeDate, time:safeTime, content:t.content, sum:t.sum, tags:t.tags||[], backupNote: backupExtra.join('\n')};
}
function shiftToSyncPayload(s){
  return {id:s.id, date:s.date, hours:s.hours, coworker:s.coworker};
}

async function loadFromCloud(){
  const ticketsUrl = getScriptUrl();
  const shiftsUrl = getShiftsScriptUrl();
  if(!ticketsUrl && !shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script у налаштуваннях'); return; }
  if(!confirm('Завантажити дані з хмари? Це замінить локальні заявки та/або зміни.')) return;
  setSyncState('syncing');
  let ok = true;
  if(ticketsUrl){
    try{
      const res = await fetch(`${ticketsUrl}${ticketsUrl.includes('?')?'&':'?'}secret=${encodeURIComponent(settings.syncSecret||'')}`, {method:'GET'});
      const data = await res.json();
      tickets = (data.tickets||[]).map(t=>{
        const blank = blankTicketObject();
        const extra = parseBackupNote(t.backupNote); // NEW: дістаємо геолокацію/примітку майстра
        return Object.assign(blank, {
          id: t.id, date: t.date, time: t.time, content: t.content,
          sum: Number(t.sum)||0,
          tags: Array.isArray(t.tags) ? t.tags : String(t.tags||'').split(',').map(s=>s.trim()).filter(Boolean),
          photo: null,
          geoLink: extra.geoLink,       // NEW
          masterNote: extra.masterNote, // NEW
          login: extra.login,           // NEW
          password: extra.password,     // NEW
          synced: true,       // NEW: дані щойно прийшли з хмари — вже синхронізовані, повторно надсилати не треба
          cloudImported: true // NEW: увімкне режим сирого редагування тексту при відкритті заявки
        });
      });
      saveTickets();
    }catch(err){ console.error(err); ok = false; }
  }
  if(shiftsUrl){
    try{
      const res = await fetch(`${shiftsUrl}?action=list&secret=${encodeURIComponent(settings.syncSecret||'')}`, {method:'GET'});
      const data = await res.json();
      shifts = (data.shifts||[]).map(s=>({id:s.id, date:isoToDdmmyyyy(s.date), hours:Number(s.hours)||0, coworker:s.coworker||'Сам'}));
      saveShifts();
    }catch(err){ console.error(err); ok = false; }
  }
  renderTicketsScreen(); renderShiftsScreen();
  setSyncState(ok ? 'ok' : 'err');
  showToast(ok ? `Завантажено: ${tickets.length} заявок, ${shifts.length} змін` : 'Частину даних завантажити не вдалося');
}

const AUTOBACKUP_MAX_SLOTS = 3;
function backupLocalData(){
  try{
    let slots;
    try{ slots = JSON.parse(localStorage.getItem('autoBackupSlots')) || []; }catch(e){ slots = []; }
    slots.unshift({ts: Date.now(), tickets, shifts});
    slots = slots.slice(0, AUTOBACKUP_MAX_SLOTS); // тримаємо лише 3 останніх, щоб не займати зайве місце
    localStorage.setItem('autoBackupSlots', JSON.stringify(slots));
  }catch(e){ /* сховище повне чи недоступне — бекап просто пропускаємо, не заважаємо основній дії */ }
}

function restoreFromBackup(){
  let slots;
  try{ slots = JSON.parse(localStorage.getItem('autoBackupSlots')) || []; }catch(e){ slots = []; }
  if(slots.length===0){ showToast('Бекапів ще немає'); return; }
  const rows = slots.map((s,i)=>{
    const d = new Date(s.ts);
    return `<div class="settings-row">
      <div><div class="sr-title">${formatDate(d)} ${formatTime(d)}</div><div style="font-size:12px; color:var(--text-dim);">Заявок: ${(s.tickets||[]).length}, змін: ${(s.shifts||[]).length}</div></div>
      <button type="button" class="btn btn-sm restore-slot-btn" data-slotidx="${i}">Відновити</button>
    </div>`;
  }).join('');
  openModal('Відновлення з автобекапу', `
    <div style="font-size:12px; color:var(--text-dim); margin-bottom:10px;">Останні ${slots.length} автозбереження (робляться перед масовими діями). Поточні локальні дані буде замінено обраним.</div>
    ${rows}
  `, {onOpen:()=>{
    document.querySelectorAll('.restore-slot-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const s = slots[Number(btn.dataset.slotidx)];
        const d = new Date(s.ts);
        if(!confirm(`Відновити дані з автобекапу від ${formatDate(d)} ${formatTime(d)}?\nПоточні локальні дані буде замінено.`)) return;
        tickets = s.tickets || [];
        shifts = s.shifts || [];
        saveTickets();
        saveShifts();
        renderTicketsScreen();
        renderShiftsScreen();
        closeModal();
        showToast('Дані відновлено з бекапу');
      });
    });
  }});
}

async function sendAllToCloud(){
  backupLocalData();
  const ticketsUrl = getScriptUrl();
  const shiftsUrl = getShiftsScriptUrl();
  if(!ticketsUrl && !shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script у налаштуваннях'); return; }
  if(ticketsUrl) await syncTicketPost('syncAllTickets', {tickets: tickets.map(ticketToSyncPayload)});
  if(shiftsUrl){
    // Скрипт змін користувача приймає лише по одній зміні через GET (без
    // масової синхронізації) — емулюємо "відправити все" послідовними
    // запитами додавання; дублікати за ID скрипт сам відфільтрує.
    for(const s of shifts){ await syncShiftPostGet('add', shiftToSyncPayload(s)); }
  }
  showToast('Дані надіслано до хмари');
}

/* Окремі функції — працюють ТІЛЬКИ зі змінами, не торкаючись заявок.
   На відміну від loadFromCloud()/sendAllToCloud(), тут URL заявок ігнорується
   навіть якщо "URL Apps Script для змін" не заповнений — це явні кнопки
   саме для блоку "Синхронізація — Зміни", щоб не плутати користувача. */
async function loadShiftsFromCloud(){
  const shiftsUrl = settings.shiftsScriptUrl ? settings.shiftsScriptUrl.trim() : '';
  if(!shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script для змін'); return; }
  setSyncState('syncing');
  try{
    const res = await fetch(`${shiftsUrl}?action=list&secret=${encodeURIComponent(settings.syncSecret||'')}`, {method:'GET'});
    const data = await res.json();
    shifts = (data.shifts||[]).map(s=>({id:s.id, date:isoToDdmmyyyy(s.date), hours:Number(s.hours)||0, coworker:s.coworker||'Сам'}));
    saveShifts();
    renderShiftsScreen();
    setSyncState('ok');
    showToast(`Завантажено: ${shifts.length} змін`);
  }catch(err){
    console.error(err); setSyncState('err');
    showToast('Не вдалося завантажити зміни з хмари — перевірте, що скрипт підтримує ?action=list');
  }
}
/* Дата з таблиці може прийти як ДД.ММ.РРРР (рядок зі скрипта) — вона вже
   в потрібному форматі, але про всяк випадок підтримуємо й конвертацію,
   якщо колись формат зміниться на РРРР-ММ-ДД. */
function isoToDdmmyyyy(dateStr){
  const s = String(dateStr);
  if(s.includes('.')) return s; // вже ДД.ММ.РРРР
  const parts = s.split('-');
  if(parts.length<3) return s;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}
async function sendShiftsToCloud(){
  const shiftsUrl = settings.shiftsScriptUrl ? settings.shiftsScriptUrl.trim() : '';
  if(!shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script для змін'); return; }
  showToast(`Надсилання ${shifts.length} змін...`);
  for(const s of shifts){ await syncShiftPostGet('add', shiftToSyncPayload(s)); }
  showToast('Зміни надіслано до хмари (дублікати за ID пропущені автоматично)');
}

/* ---------- 3. Навігація між вкладками ---------- */
const SCREEN_TITLES = {tickets:'Заявки', calculator:'Калькулятор', shifts:'Зміни', settings:'Налаштування'};
function switchTab(tab){
  // NEW: якщо вкладка вже й так активна — не скидаємо скрол. Це прибирає
  // ефект "улетів на початок форми", який траплявся, якщо щось під час
  // заповнення заявки повторно викликало перемикання на ту саму вкладку.
  const alreadyActive = document.getElementById('screen-'+tab).classList.contains('active');
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+tab).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.getElementById('screenTitle').textContent = SCREEN_TITLES[tab];
  // "Дані" в Налаштуваннях рендеряться один раз при старті застосунку — але
  // кошик змінюється протягом сесії (заявки видаляються з інших екранів),
  // тож оновлюємо саме його щоразу при відкритті вкладки.
  if(tab==='settings') renderDeletedTicketsList();
  if(!alreadyActive) document.querySelector('main.screens').scrollTop = 0;
}

/* ---------- 4. Екран «Заявки» ---------- */
function blankTicketObject(){
  return {
    id:null, date:'', time:'', content:'', sum:0, tags:[], photo:null,
    type:'Підключення', city:'', address:'', clientName:'', phone:'',
    callFee:0, tariff:0,
    equipment: getEquipmentConfig().map(e=>({id:e.id, label:e.label, price:e.price, checked:false})),
    cables: getCableTypesConfig().map(c=>({id:c.id, label:c.label, meters:0, pricePerMeter:c.pricePerMeter})), // NEW: динамічний список кабелів замість фіксованих UTP/Оптика
    presetWorks: getWorkTypesConfig().map(w=>({id:w.id, label:w.label, price:w.price, qty:1, checked:false})),
    additionalWork: [{desc:'', sum:0}], // поле для вводу видно одразу, без кліку на "+"
    payment:'', note:'', geoLink:'', masterNote:'', otherNote:'', macAddress:'', street:'', house:'', apartment:'', login:'', password:'', connectMasters:[], contractNumber:'', contractNumberDate:'', contractNumberMastersKey:'', synced:false,
    tgBackedUp:false, tgPhotoFileId:null, tgSepMsgId:null, tgTextMsgId:null, tgPhotoMsgId:null, tgJsonMsgId:null, // NEW: чи відправлено та які message_id в Telegram-групі (для видалення/пересилання при редагуванні)
    cloudImported:false // NEW: позначка «завантажено з хмари» — вмикає режим сирого редагування тексту
  };
}

/* NEW: розбирає службовий стовпець "нотатки_майстра" (backupNote), який
   повертає таблиця для кожної заявки, і дістає з нього геолокацію та
   приватну примітку майстра — щоб відновити їх при завантаженні з хмари. */
function parseBackupNote(note){
  const result = {geoLink:'', masterNote:'', login:'', password:''};
  if(!note) return result;
  String(note).split('\n').forEach(line=>{
    const geoMatch = line.match(/^Геолокація:\s*(.+)$/);
    const noteMatch = line.match(/^Приватна примітка майстра:\s*(.+)$/);
    const loginMatch = line.match(/^Логін:\s*(.+)$/);
    const passMatch = line.match(/^Пароль:\s*(.+)$/);
    if(geoMatch) result.geoLink = geoMatch[1].trim();
    else if(noteMatch) result.masterNote = noteMatch[1].trim();
    else if(loginMatch) result.login = loginMatch[1].trim();
    else if(passMatch) result.password = passMatch[1].trim();
  });
  return result;
}

function ticketsForDate(dateStr){
  return tickets.filter(t=>t.date===dateStr).sort((a,b)=> (a.time||'').localeCompare(b.time||''));
}
/* Ключ для сортування заявок за датою+часом (а не за порядком створення) —
   потрібен у пошуку й фільтрі за тегами, де на екрані одразу заявки з
   різних дат: заявка, створена заднім чи майбутнім числом, має ставати на
   своє місце серед дат, а не вилазити нагору лише тому, що її щойно
   створили. */
function ticketSortKey(t){
  const d = parseDate(t.date);
  const m = String(t.time||'').match(/^(\d{1,2}):(\d{2})/);
  const minutes = m ? (Number(m[1])*60 + Number(m[2])) : 0;
  return d.getTime() + minutes*60000;
}

function renderTicketsScreen(){
  document.getElementById('currentDateDisplay').textContent = currentTicketDate;
  renderDateNavVisibility();
  renderDaySummary();
  renderMainTicketList();
  renderSyncQueueBanner();
}

function renderSyncQueueBanner(){
  const banner = document.getElementById('syncQueueBanner');
  if(!getScriptUrl()){ banner.classList.add('hidden'); return; }
  const pending = tickets.filter(t=>!t.synced);
  if(pending.length === 0){ banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  const text = document.getElementById('syncQueueBannerText');
  text.textContent = navigator.onLine
    ? `⏳ Не синхронізовано: ${pending.length} — спробувати ще раз?`
    : `📴 Немає інтернету — ${pending.length} заявок надішлю, коли з'явиться зв'язок`;
}

let syncQueueBusy = false; // NEW: захист від повторного запуску, поки черга вже синхронізується
async function retrySyncQueue(){
  if(syncQueueBusy) return; // NEW
  const pending = tickets.filter(t=>!t.synced);
  if(pending.length === 0) return;
  if(!getScriptUrl()) return;
  syncQueueBusy = true;
  const bannerText = document.getElementById('syncQueueBannerText');
  const retryBtn = document.getElementById('syncQueueRetryBtn');
  retryBtn.disabled = true; // NEW
  const total = pending.length;
  let done = 0;
  for(const t of pending){
    // NEW: живий прогрес замість одного статичного тосту — видно, що процес не завис
    bannerText.innerHTML = `<span class="mini-spinner"></span>Синхронізую ${done+1} із ${total}...`;
    const ok = await syncPost('addTicket', ticketToSyncPayload(t));
    t.synced = ok;
    done++;
    saveTickets(); // зберігаємо прогрес одразу, щоб нічого не загубилось, якщо процес перерветься
  }
  retryBtn.disabled = false;
  syncQueueBusy = false;
  renderTicketsScreen();
  const stillPending = tickets.filter(t=>!t.synced).length;
  showToast(stillPending ? `Залишилось не синхронізовано: ${stillPending}` : 'Усе синхронізовано ✅');
}

function renderDateNavVisibility(){
  const inSpecialMode = searchQuery.trim().length>0 || activeFilterTags.size>0;
  document.getElementById('dateNavBlock').classList.toggle('hidden', inSpecialMode);
  document.getElementById('modeSummaryBlock').classList.toggle('hidden', !inSpecialMode);
}

function renderDaySummary(){
  const dayTickets = ticketsForDate(currentTicketDate);
  const sum = dayTickets.reduce((s,t)=>s+(Number(t.sum)||0),0);
  document.getElementById('daySummary').textContent = dayTickets.length
    ? `${dayTickets.length} заявок · ${fmtMoney(sum)}`
    : 'заявок немає';
}

function renderMainTicketList(){
  const listEl = document.getElementById('ticketList');
  let list;
  const q = searchQuery.trim().toLowerCase();

  if(q){
    list = tickets.filter(t =>
      (t.content||'').toLowerCase().includes(q) ||
      (t.date||'').includes(q) ||
      (t.tags||[]).some(tag=>tag.toLowerCase().includes(q)) ||
      (t.city||'').toLowerCase().includes(q) ||
      (t.address||'').toLowerCase().includes(q) ||
      (t.clientName||'').toLowerCase().includes(q)
    ).sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
    document.getElementById('modeSummaryText').textContent = `Знайдено: ${list.length} заявок`;
  } else if(activeFilterTags.size>0){
    list = tickets.filter(t => (t.tags||[]).some(tag=>activeFilterTags.has(tag)))
      .sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
    document.getElementById('modeSummaryText').textContent = `За тегами (${[...activeFilterTags].join(', ')}): ${list.length}`;
  } else {
    list = ticketsForDate(currentTicketDate);
  }

  if(list.length===0){
    listEl.innerHTML = `<div class="empty-state"><div class="es-icon">🗂️</div>Заявок не знайдено</div>`;
    return;
  }

  // Якщо змінився пошук/фільтр/день — це новий список, скидаємо ліміт показу на 100.
  const signature = q + '|' + [...activeFilterTags].sort().join(',') + '|' + currentTicketDate;
  if(signature !== ticketListRenderSignature){
    ticketListRenderSignature = signature;
    ticketListRenderLimit = TICKET_LIST_PAGE_SIZE;
  }

  const visible = list.slice(0, ticketListRenderLimit);
  let html = visible.map(renderTicketCard).join('');
  if(list.length > visible.length){
    const remaining = list.length - visible.length;
    html += `<button type="button" class="btn btn-block show-more-tickets-btn" style="margin:10px 0;">
      Показати ще ${Math.min(remaining, TICKET_LIST_PAGE_SIZE)} (залишилось ${remaining})
    </button>`;
  }
  listEl.innerHTML = html;
}

function renderTicketCard(t){
  const tagsHtml = (t.tags||[]).map(tag=>`<span class="chip">${escapeHtml(tag)}</span>`).join('');
  const sub = [t.clientName, t.phone, [t.city, t.address].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const geoBtn = t.geoLink ? `<a href="${escapeHtml(t.geoLink)}" target="_blank" rel="noopener" class="btn btn-sm" style="text-decoration:none;">📍 Перейти</a>` : '';
  const hasContent = !!(t.content);
  const isOther = t.type === 'Інше';
  // Індикатор синхронізації показується лише якщо синхронізація взагалі налаштована.
  // ✅ означає «запит надіслано без помилок мережі», а не 100%-підтверджений запис
  // у Google Sheets — Apps Script працює в режимі «глухої відповіді» (no-cors),
  // тож повної гарантії доставки в межах браузера отримати неможливо.
  let syncBadge = '';
  if(getScriptUrl()){
    syncBadge = t.synced
      ? `<span class="tc-sync-badge tc-sync-ok" title="Запит надіслано без помилок мережі">✅ Завантажено</span>`
      : `<span class="tc-sync-badge tc-sync-pending retry-sync-btn" data-id="${t.id}" title="Натисніть, щоб повторити спробу">⏳ Очікує</span>`;
  }
  return `
  <div class="ticket-card" data-id="${t.id}">
    <div class="tc-head">
      <div style="flex:1; min-width:0;">
        <div class="tc-type">${escapeHtml(t.type||'Заявка')}</div>
        ${sub ? `<div class="tc-sub">${escapeHtml(sub)}</div>` : ''}
        ${t.contractNumber ? `<div class="tc-sub" style="color:var(--accent);">📄 № ${escapeHtml(t.contractNumber)}</div>` : ''}
      </div>
      <div style="text-align:right; flex-shrink:0;">
        <div class="tc-time">${escapeHtml(t.date)} ${escapeHtml(t.time||'')}</div>
        ${isOther ? '' : `<div class="tc-sum tabular">${fmtMoney(t.sum)}</div>`}
      </div>
    </div>
    ${hasContent ? `
    <div class="tc-content tc-collapsed" id="tcc-${t.id}">${escapeHtml(t.content)}</div>
    <button type="button" class="tc-expand-btn" data-id="${t.id}">▼ Розгорнути</button>` : ''}
    ${t.masterNote ? `<div class="tc-master-note" style="margin-top:8px; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px dashed var(--text-dim); font-size:13px; color:var(--text-dim);">🔒 <strong>Тільки для вас:</strong> ${escapeHtml(t.masterNote)}</div>` : ''}
    <div class="tc-tags" style="margin-top:8px;">${tagsHtml}${t.photo ? '<span class="tc-photo-badge">📷</span>' : ''}${t.tgBackedUp ? `<button type="button" class="tc-photo-badge tg-open-btn" data-id="${t.id}" title="Відкрити цю заявку в Telegram" style="border:none; background:none; padding:0; font:inherit; cursor:pointer; text-decoration:underline; text-underline-offset:2px;">☁️✅</button>` : ''}${syncBadge}</div>
    <div class="tc-actions">
      <button type="button" class="btn btn-sm edit-ticket-btn" data-id="${t.id}">✏️</button>
      ${geoBtn}
      <button type="button" class="btn btn-sm share-ticket-btn" data-id="${t.id}">📤 Переслати</button>
      <button type="button" class="btn btn-sm tg-dispatcher-btn" data-id="${t.id}" title="Надіслати диспетчеру через Telegram-бота">✈️ Диспетчеру</button>
      <button type="button" class="btn btn-sm copy-ticket-btn" data-id="${t.id}">📄 Копіювати</button>
      ${t.type==='Підключення' ? `<button type="button" class="btn btn-sm contract-ticket-btn" data-id="${t.id}" title="Договір">📜 Договір</button>` : ''}
      <button type="button" class="btn btn-sm history-ticket-btn" data-id="${t.id}" title="Історія абонента">🕘 Історія</button>
      <button type="button" class="btn btn-sm btn-danger delete-ticket-btn" data-id="${t.id}">🗑️</button>
    </div>
  </div>`;
}

function deleteTicket(id){
  if(!confirm('Видалити цю заявку?')) return;
  const idx = tickets.findIndex(x=>String(x.id)===String(id)); // NEW: id заявок з хмари приходить рядком, а не числом
  if(idx===-1) return;
  const t = tickets[idx];
  tickets.splice(idx,1);
  saveTickets();
  syncPost('deleteTicket', {id});
  // NEW: Telegram-бекап НЕ видаляється разом із заявкою навмисно — навіть якщо
  // заявку видалили в застосунку (помилково чи ні), її копія назавжди лишається
  // в групі-архіві. Це і є сенс резервної копії: вона не залежить від дій в
  // основному застосунку. Синхронізується з групою лише редагування (див.
  // backupTicketToTelegram), а видалення — ні.
  // Не видаляємо фото одразу — заявка йде в кошик, фото ще може знадобитись при відновленні.
  moveTicketToTrash(t);
  renderTicketsScreen();
  showToast('Заявку видалено — відновити можна в Налаштуваннях → Кошик');
}

/* ---- Кошик видалених заявок: зберігає останні DELETED_TICKETS_MAX записів,
   старіші за цю межу видаляються остаточно (разом із фото в IndexedDB). ---- */
function moveTicketToTrash(t){
  const copy = JSON.parse(JSON.stringify(t));
  copy.deletedAt = Date.now();
  deletedTickets.unshift(copy);
  while(deletedTickets.length > DELETED_TICKETS_MAX){
    const dropped = deletedTickets.pop();
    if(dropped.photo) deletePhotoKey(dropped.photo);
  }
  saveDeletedTickets();
}

function saveDeletedTickets(){
  try{ localStorage.setItem('deletedTickets', JSON.stringify(deletedTickets)); }catch(e){ /* сховище повне — не критично, це лише кошик */ }
}

function restoreDeletedTicket(deletedAt){
  const idx = deletedTickets.findIndex(t=>String(t.deletedAt)===String(deletedAt));
  if(idx===-1) return;
  const t = deletedTickets[idx];
  deletedTickets.splice(idx,1);
  saveDeletedTickets();
  const restored = JSON.parse(JSON.stringify(t));
  delete restored.deletedAt;
  // якщо заявка з таким id вже якимось чином існує (малоймовірно) — даємо новий id, щоб не затерти
  if(tickets.some(x=>String(x.id)===String(restored.id))) restored.id = Date.now();
  restored.synced = false;
  tickets.push(restored);
  saveTickets();
  currentTicketDate = restored.date || currentTicketDate;
  renderTicketsScreen();
  renderDeletedTicketsList();
  showToast('Заявку відновлено');
  if(getScriptUrl()){
    syncPost('addTicket', ticketToSyncPayload(restored)).then(ok=>{
      const found = tickets.find(x=>x.id===restored.id);
      if(found){ found.synced = ok; saveTickets(); renderTicketsScreen(); }
    });
  }
}

function purgeDeletedTicket(deletedAt){
  const idx = deletedTickets.findIndex(t=>String(t.deletedAt)===String(deletedAt));
  if(idx===-1) return;
  if(!confirm('Видалити заявку з кошика остаточно? Відновити після цього буде неможливо.')) return;
  const t = deletedTickets[idx];
  if(t.photo) deletePhotoKey(t.photo);
  deletedTickets.splice(idx,1);
  saveDeletedTickets();
  renderDeletedTicketsList();
}

function renderDeletedTicketsList(){
  const wrap = document.getElementById('deletedTicketsList');
  if(!wrap) return;
  if(deletedTickets.length===0){
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:13px;">Кошик порожній</div>`;
    return;
  }
  wrap.innerHTML = deletedTickets.map(t=>{
    const d = new Date(t.deletedAt);
    const sub = [t.clientName, [t.city, t.address].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    return `<div class="settings-row" style="align-items:flex-start; gap:8px;">
      <div style="min-width:0; flex:1;">
        <div class="sr-title">${escapeHtml(t.date||'')} ${escapeHtml(t.time||'')} — ${escapeHtml(t.type||'')}</div>
        <div style="font-size:12px; color:var(--text-dim); overflow-wrap:anywhere;">${escapeHtml(sub)}${t.sum?(' · '+fmtMoney(t.sum)):''}</div>
        <div style="font-size:11px; color:var(--text-faint);">Видалено: ${formatDate(d)} ${formatTime(d)}</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
        <button type="button" class="btn btn-sm restore-trash-btn" data-deleted-at="${t.deletedAt}">↩️ Відновити</button>
        <button type="button" class="btn btn-icon btn-sm btn-ghost purge-trash-btn" data-deleted-at="${t.deletedAt}">✕</button>
      </div>
    </div>`;
  }).join('');
}

function editTicket(id){
  const t = tickets.find(x=>String(x.id)===String(id)); // NEW
  if(!t) return;
  loadTicketIntoForm(t);
  switchTab('calculator');
}

async function retrySyncTicket(id){
  const t = tickets.find(x=>String(x.id)===String(id)); // NEW
  if(!t) return;
  if(!getScriptUrl()){ showToast('Синхронізація не налаштована'); return; }
  showToast('Повторна спроба надсилання...');
  const ok = await syncPost('addTicket', ticketToSyncPayload(t));
  t.synced = ok;
  saveTickets();
  renderTicketsScreen();
  showToast(ok ? 'Надіслано' : 'Не вдалося — перевірте інтернет-з’єднання');
}

async function copyTicketCardText(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return; // NEW
  try{ await navigator.clipboard.writeText(t.content); showToast('Текст заявки скопійовано'); }
  catch(e){
    const ta = document.createElement('textarea');
    ta.value = t.content; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); showToast('Текст заявки скопійовано'); }
    catch(e2){ showToast('Не вдалося скопіювати текст'); }
    ta.remove();
  }
}

/* ---- "Знайти в Telegram" — відкриває саме повідомлення цієї заявки в групі ----
   Працює за прямим посиланням виду https://t.me/c/<internal_id>/<message_id>,
   де internal_id — це chat_id групи без префіксу "-100" (Telegram так формує
   посилання на приватні супергрупи/канали). Спрацьовує лише для тих, хто вже
   є учасником групи — саме тому доступно тільки вам, а не будь-кому з посиланням. */
function telegramMessageLink(msgId){
  const chatId = (settings.tgBackupChatId||'').trim();
  if(!chatId || !msgId) return null;
  const internalId = chatId.replace(/^-100/, '').replace(/^-/, '');
  return `https://t.me/c/${internalId}/${msgId}`;
}
function openTicketInTelegram(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return;
  // беремо перше з наявних — розділювач (початок "картки" заявки) як пріоритет,
  // інакше текст, інакше фото чи json — щоб хоч якесь повідомлення знайшлось
  const msgId = t.tgSepMsgId || t.tgTextMsgId || t.tgPhotoMsgId || t.tgJsonMsgId;
  const link = telegramMessageLink(msgId);
  if(!link){ showToast('Цю заявку ще не надіслано в Telegram-групу'); return; }
  window.open(link, '_blank');
}

/* ---- Надіслати заявку диспетчеру через бота (за вимогою, з кнопки) ----
   На відміну від резервного копіювання нижче — це не тихий фон, а явна дія
   майстра: показуємо тост про успіх/помилку. Використовує той самий бот
   (tgBotToken), але окремий chat_id — особистий чат диспетчера. */
async function sendToTelegramChat(chatId, text, photoKey, tgFileId){
  const token = (settings.tgBotToken||'').trim();
  if(!token || !chatId) return {ok:false, reason:'не налаштовано токен/chat_id'};
  try{
    const msgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: chatId, text: (text||'').slice(0,4000)})
    });
    const msgData = await msgRes.json();
    if(!msgData.ok) return {ok:false, reason: msgData.description || 'sendMessage failed'};
    if(photoKey){
      const photoData = await resolvePhotoAsync(photoKey, tgFileId);
      if(photoData){
        const blob = await (await fetch(photoData)).blob();
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('photo', blob, 'foto.jpg');
        await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {method:'POST', body: form});
      }
    }
    return {ok:true};
  }catch(e){ return {ok:false, reason:String(e)}; }
}
// NEW: список налаштованих диспетчерів — {name, chatId}, тільки ті, де chatId заповнено
function getConfiguredDispatchers(){
  return (settings.tgDispatchers||[]).filter(d=>d.chatId && d.chatId.trim());
}
// Якщо диспетчер один — шле одразу йому. Якщо два — питає, кому саме
// (конкретному або обом), через маленьку модалку з кнопками-іменами.
function chooseDispatcherAndSend(sendFn){
  const list = getConfiguredDispatchers();
  if(!settings.tgBotToken || !list.length){ showToast('Спочатку вкажіть токен бота і Chat ID хоча б одного диспетчера в Налаштуваннях'); return; }
  if(list.length===1){ sendFn([list[0].chatId]); return; }
  openModal('Кому надіслати?', `
    <div class="row wrap" style="gap:8px; flex-direction:column;">
      ${list.map((d,i)=>`<button type="button" class="btn btn-block dispatcher-choice-btn" data-idx="${i}">✈️ ${escapeHtml(d.name || ('Диспетчер '+(i+1)))}</button>`).join('')}
      <button type="button" class="btn btn-accent btn-block" id="dispatcherChoiceAllBtn">✈️ Обом одразу</button>
    </div>
  `, {onOpen: (root)=>{
    root.querySelectorAll('.dispatcher-choice-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ closeModal(); sendFn([list[Number(btn.dataset.idx)].chatId]); });
    });
    document.getElementById('dispatcherChoiceAllBtn').addEventListener('click', ()=>{ closeModal(); sendFn(list.map(d=>d.chatId)); });
  }});
}
async function sendTicketToDispatcher(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return;
  chooseDispatcherAndSend(async (chatIds)=>{
    showToast('Надсилаю диспетчеру…');
    // NEW: диспетчеру шлемо лише текст, без фото — воно й так є в бекап-групі
    const results = await Promise.all(chatIds.map(id2 => sendToTelegramChat(id2, t.content, null, null)));
    const okCount = results.filter(r=>r.ok).length;
    showToast(okCount===chatIds.length ? '✅ Надіслано диспетчеру!' : `Надіслано ${okCount} з ${chatIds.length}: ${results.find(r=>!r.ok)?.reason||''}`);
  });
}
async function sendCurrentTicketToDispatcher(){
  // працює навіть якщо заявку ще не збережено — рахуємо текст прямо з форми
  syncFormToState();
  const text = getCurrentTicketText();
  if(!text){ showToast('Немає що надсилати — заповніть заявку'); return; }
  chooseDispatcherAndSend(async (chatIds)=>{
    showToast('Надсилаю диспетчеру…');
    const results = await Promise.all(chatIds.map(id2 => sendToTelegramChat(id2, text, null, null)));
    const okCount = results.filter(r=>r.ok).length;
    showToast(okCount===chatIds.length ? '✅ Надіслано диспетчеру!' : `Надіслано ${okCount} з ${chatIds.length}: ${results.find(r=>!r.ok)?.reason||''}`);
  });
}

/* ---- Резервне копіювання заявок у закриту Telegram-групу ----
   Не замінює локальне зберігання (фото й далі лежать в IndexedDB як завжди),
   а лише додатково дублює ПОВНІ дані заявки в групу. На кожне збереження
   (і нової заявки, і редагування вже наявної) — спочатку видаляє попередні
   повідомлення цієї заявки в групі (якщо вони були), потім надсилає свіжі:
   текст, фото (якщо є) і повний JSON-знімок усіх полів заявки окремим
   файлом — так група завжди показує АКТУАЛЬНИЙ стан, а не застарілу версію
   після редагування, і жодне поле не губиться (навіть те, чого нема в тексті:
   логін/пароль, вулиця/будинок/квартира, теги, geo-посилання тощо).
   Спрацьовує лише якщо в Налаштуваннях заповнені tgBotToken і tgBackupChatId,
   інакше нічого не робить. Не блокує збереження заявки — викликається без await. */
async function deleteTicketTelegramMessages(t, token, chatId){
  const ids = [t.tgSepMsgId, t.tgTextMsgId, t.tgPhotoMsgId, t.tgJsonMsgId].filter(Boolean);
  for(const msgId of ids){
    try{
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, message_id: msgId})
      });
    }catch(e){ /* повідомлення могло вже бути видалене вручну — не критично */ }
  }
  t.tgSepMsgId = null; t.tgTextMsgId = null; t.tgPhotoMsgId = null; t.tgJsonMsgId = null;
}
/* NEW: для бекапу в групу текст має бути ПОВНИМ — на відміну від t.content
   (який навмисно без приватної примітки/геолокації/логіна-пароля, бо саме
   t.content летить диспетчеру при "Поділитися"/"Диспетчеру"). Тут же це ваш
   особистий архів, тож дописуємо все, чого не вистачає в звичайному тексті. */
function buildTelegramBackupText(t){
  const extra = [];
  if(t.masterNote) extra.push(`🔒 Тільки для вас: ${t.masterNote}`);
  if(t.geoLink) extra.push(`📍 Геолокація: ${t.geoLink}`);
  if(t.login) extra.push(`👤 Логін: ${t.login}`);
  if(t.password) extra.push(`🔑 Пароль: ${t.password}`);
  if(!extra.length) return t.content || '';
  return `${t.content||''}\n------------------\n${extra.join('\n')}`;
}
async function backupTicketToTelegram(t){
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgBackupChatId||'').trim();
  if(!token || !chatId || !t) return;
  try{
    // спочатку прибираємо попередню версію цієї заявки в групі (якщо була) —
    // щоб після редагування там не лишалось двох копій (старої й нової)
    await deleteTicketTelegramMessages(t, token, chatId);
    t.tgPhotoFileId = null;
    t.tgBackedUp = false;

    // 0) розділювач-заголовок — щоб у стрічці групи було одразу видно, де
    // закінчується одна заявка (2-3 повідомлення) і починається наступна
    if(t.content){
      const addr = [t.city, t.street, t.house].filter(Boolean).join(', ');
      const sepText = `➖➖➖➖➖➖➖➖➖➖\n🧾 ${(t.type||'ЗАЯВКА').toUpperCase()}${t.date? ' · '+t.date:''}${t.time? ' '+t.time:''}${addr? ' · '+addr:''}`;
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, text: sepText})
      });
      const data = await res.json();
      if(data.ok) t.tgSepMsgId = data.result.message_id;
    }
    // 1) текст — повна версія, включно з приватною міткою/геолокацією/логіном-паролем
    if(t.content){
      const text = buildTelegramBackupText(t).slice(0, 4000); // ліміт Telegram на текст повідомлення
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, text})
      });
      const data = await res.json();
      if(data.ok){ t.tgBackedUp = true; t.tgTextMsgId = data.result.message_id; }
    }
    // 2) фото
    if(t.photo){
      const photoData = await resolvePhotoAsync(t.photo);
      if(photoData){
        const blob = await (await fetch(photoData)).blob();
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('caption', `${t.date||''} ${t.time||''} ${t.city||''} ${t.street||''} ${t.house||''}`.trim().slice(0,1020));
        form.append('photo', blob, 'foto.jpg');
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {method:'POST', body: form});
        const data = await res.json();
        if(data.ok){
          const sizes = data.result.photo || [];
          t.tgPhotoFileId = sizes.length ? sizes[sizes.length-1].file_id : null; // найбільший варіант — для повноцінного відновлення
          t.tgPhotoMsgId = data.result.message_id;
        }
      }
    }
    // 3) повний JSON-знімок УСІХ полів заявки — окремим файлом, це і є
    // "повний бекап" (а не лише те, що влізло в короткий текст вище)
    try{
      const jsonBlob = new Blob([JSON.stringify(t, null, 2)], {type:'application/json'});
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('document', jsonBlob, `ticket-${t.id}.json`);
      const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {method:'POST', body: form});
      const data = await res.json();
      if(data.ok) t.tgJsonMsgId = data.result.message_id;
    }catch(e){ console.error('Telegram: не вдалося надіслати json-бекап', e); }

    saveTickets();
  }catch(e){ console.error('Telegram бекап: помилка відправки', e); } // тихо — це лише резервна копія, не критична дія
}
// NEW: тестове повідомлення в Налаштуваннях — перевірити, що токен і chat_id правильні.
// Приймає chatId ззовні, щоб однією функцією перевіряти всі три призначення.
async function sendTelegramTestMessage(chatId, label){
  const token = (settings.tgBotToken||'').trim();
  chatId = (chatId||'').trim();
  if(!token || !chatId){ showToast('Спочатку заповніть токен і відповідний Chat ID'); return; }
  try{
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: chatId, text: `✅ Майстер-Трекер: зв'язок налаштовано (${label}).`})
    });
    const data = await res.json();
    showToast(data.ok ? 'Тестове повідомлення надіслано!' : `Помилка Telegram: ${data.description||'невідома'}`);
  }catch(e){ showToast('Не вдалося з\'єднатись із Telegram'); }
}

/* ---- Місячний звіт собі особисто (1-го числа, автоматично) ----
   Рахує зміни/години, кількість і суму заявок, та зведення встановленого
   обладнання/кабелю/робіт — усе за щойно завершений місяць. */
function buildMonthlyEquipmentLines(list){
  const eqCounts = {}, cableMeters = {}, workCounts = {};
  list.forEach(t=>{
    (t.equipment||[]).forEach(e=>{ if(e.checked) eqCounts[e.label] = (eqCounts[e.label]||0) + 1; });
    (t.cables||[]).forEach(c=>{ const m = Number(c.meters)||0; if(m>0) cableMeters[c.label] = (cableMeters[c.label]||0) + m; });
    (t.presetWorks||[]).forEach(w=>{ if(w.checked) workCounts[w.label] = (workCounts[w.label]||0) + (Number(w.qty)||1); });
  });
  const lines = [];
  Object.entries(eqCounts).sort((a,b)=>b[1]-a[1]).forEach(([label,c])=> lines.push(`${label} — ${c} шт.`));
  Object.entries(cableMeters).sort((a,b)=>b[1]-a[1]).forEach(([label,m])=> lines.push(`${label} — ${m} м`));
  Object.entries(workCounts).sort((a,b)=>b[1]-a[1]).forEach(([label,q])=> lines.push(`${label} — ${q} шт.`));
  return lines;
}
function buildMonthlyTelegramReport(refDate){
  const monthTickets = tickets.filter(t=>isSameMonth(t.date, refDate));
  const monthShifts = shifts.filter(s=>isSameMonth(s.date, refDate));
  const totalHours = monthShifts.reduce((s,x)=>s+(Number(x.hours)||0),0);
  const totalSum = monthTickets.reduce((s,t)=>s+(Number(t.sum)||0),0);
  const byType = {};
  monthTickets.forEach(t=>{ const ty=t.type||'Інше'; byType[ty] = (byType[ty]||0) + 1; });
  const lines = [];
  lines.push(`📊 ЗВІТ ЗА ${MONTH_NAMES[refDate.getMonth()].toUpperCase()} ${refDate.getFullYear()}`);
  lines.push('──────────');
  lines.push(`🕒 Змін: ${monthShifts.length}, годин: ${totalHours.toFixed(1)}`);
  lines.push(`🧾 Заявок: ${monthTickets.length}, сума: ${fmtMoney(totalSum)}`);
  Object.entries(byType).forEach(([ty,count])=> lines.push(`   • ${ty}: ${count}`));
  lines.push('──────────');
  lines.push('📦 Встановлено обладнання:');
  const eqLines = buildMonthlyEquipmentLines(monthTickets);
  if(eqLines.length) eqLines.forEach(l=> lines.push('   • '+l));
  else lines.push('   — немає даних');
  return lines.join('\n');
}
async function sendMonthlyTelegramReportNow(){
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgMyChatId||'').trim();
  if(!token || !chatId){ showToast('Спочатку заповніть токен і ваш особистий Chat ID'); return; }
  const now = new Date();
  const lastMonthRef = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const text = buildMonthlyTelegramReport(lastMonthRef);
  showToast('Надсилаю звіт…');
  const res = await sendToTelegramChat(chatId, text, null, null);
  showToast(res.ok ? '✅ Звіт надіслано!' : `Не вдалося надіслати: ${res.reason}`);
}
// NEW: викликається раз при старті застосунку — 1-го числа місяця сам надсилає
// звіт за щойно завершений місяць, якщо ще не надсилав цього місяця
async function maybeSendMonthlyTelegramReport(){
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgMyChatId||'').trim();
  if(!token || !chatId) return;
  const now = new Date();
  if(now.getDate() !== 1) return;
  const monthKey = now.toISOString().slice(0,7);
  if(localStorage.getItem('tgMonthlyReportMonth') === monthKey) return;
  const lastMonthRef = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const text = buildMonthlyTelegramReport(lastMonthRef);
  const res = await sendToTelegramChat(chatId, text, null, null);
  if(res.ok) localStorage.setItem('tgMonthlyReportMonth', monthKey);
}

/* ---- Спільний "двигун" для масової відправки в Telegram-групу ----
   Показує модалку з прогресом, шле по одній заявці з паузою (щоб не
   впертися в ліміти Telegram), дає кнопку "Зупинити". Використовується і для
   довантаження нових заявок, і для повного перезапису вже надісланих. */
let bulkExportRunning = false;
let bulkExportCancelled = false;
async function runBulkTelegramJob(list, title){
  bulkExportRunning = true;
  bulkExportCancelled = false;
  openModal(title, `
    <div style="text-align:center; padding:16px 10px;">
      <div style="font-size:14.5px; color:var(--text-dim); margin-bottom:10px;">Надсилаю заявки в групу…</div>
      <div class="tabular" id="bulkExportCounter" style="font-size:26px; font-weight:800;">0 / ${list.length}</div>
    </div>
    <button type="button" class="btn btn-danger btn-block" id="bulkExportCancelBtn">Зупинити</button>
  `, {onOpen: ()=>{
    document.getElementById('bulkExportCancelBtn').addEventListener('click', ()=>{ bulkExportCancelled = true; });
  }});

  let done = 0;
  for(const t of list){
    if(bulkExportCancelled) break;
    await backupTicketToTelegram(t);
    done++;
    const counterEl = document.getElementById('bulkExportCounter');
    if(counterEl) counterEl.textContent = `${done} / ${list.length}`;
    await new Promise(r=>setTimeout(r, 1400));
  }
  bulkExportRunning = false;
  closeModal();
  showToast(bulkExportCancelled ? `Зупинено: оброблено ${done} з ${list.length}` : `Готово: оброблено ${done} заявок(и)`);
}

/* ---- Одноразове вивантаження вже наявних заявок у групу-архів ----
   Для заявок, створених до налаштування бота. Надсилає лише ті, яких у
   групі ще НІКОЛИ не було — редаговані вже синхронізуються самі при
   збереженні, а вже надіслані пропускаються (щоб не плодити дублі). */
async function bulkExportTicketsToTelegram(){
  if(bulkExportRunning){ showToast('Вивантаження вже триває'); return; }
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgBackupChatId||'').trim();
  if(!token || !chatId){ showToast('Спочатку налаштуйте токен і Chat ID групи вище'); return; }
  const todo = tickets.filter(t => !t.tgBackedUp && t.content);
  if(!todo.length){ showToast('Усі заявки вже вивантажено в групу'); return; }
  const etaMin = Math.ceil(todo.length * 1.4 / 60);
  if(!confirm(`Буде надіслано ${todo.length} заявок(и) у групу. Орієнтовно ~${etaMin} хв (навмисна пауза між заявками, щоб не впертися в ліміти Telegram). Не закривайте застосунок, поки триває. Продовжити?`)) return;
  await runBulkTelegramJob(todo, 'Вивантаження в Telegram');
}

/* ---- Повний перезапис УЖЕ надісланих заявок ----
   На відміну від функції вище — бере геть усі заявки з текстом, незалежно
   від того, чи вони вже позначені tgBackedUp. Кожну спочатку видаляє з групи
   (старі повідомлення), потім шле заново — текст + фото + повний JSON-файл.
   Потрібно, наприклад, якщо бот/функцію бекапу додали пізніше, і старі заявки
   в групі є лише текстом без JSON-файлу — цим можна "дотягнути" їх до повного
   формату заднім числом. */
async function resyncAllTicketsToTelegram(){
  if(bulkExportRunning){ showToast('Вивантаження вже триває'); return; }
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgBackupChatId||'').trim();
  if(!token || !chatId){ showToast('Спочатку налаштуйте токен і Chat ID групи вище'); return; }
  const all = tickets.filter(t => t.content);
  if(!all.length){ showToast('Немає заявок для вивантаження'); return; }
  const etaMin = Math.ceil(all.length * 1.4 / 60);
  if(!confirm(`Це ПЕРЕЗАПИШЕ геть усі ${all.length} заявок(и) у групі: старі повідомлення кожної заявки буде видалено, замість них надіслано свіжі (текст + фото + повний JSON-файл). Орієнтовно ~${etaMin} хв. Не закривайте застосунок, поки триває. Продовжити?`)) return;
  await runBulkTelegramJob(all, 'Перезапис усіх заявок у Telegram');
}

/* Поділитися заявкою (текст + фото, якщо є) — відкриває системне меню «Поділитися»,
   де серед застосунків буде Viber, якщо він встановлений на телефоні. */
async function shareTicket(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return; // NEW
  const text = t.content || '';
  try{
    const photoData = t.photo ? await resolvePhotoAsync(t.photo, t.tgPhotoFileId) : null;
    if(photoData){
      const res = await fetch(photoData);
      const blob = await res.blob();
      const file = new File([blob], 'foto.jpg', {type:'image/jpeg'});
      if(navigator.canShare && navigator.canShare({files:[file], text})){
        await navigator.share({title:'Заявка', text, files:[file]});
        return;
      }
    }
    if(navigator.share){
      await navigator.share({title:'Заявка', text});
      return;
    }
    throw new Error('share-unsupported');
  }catch(e){
    if(e.name==='AbortError') return; // користувач сам закрив меню «Поділитися»
    try{
      await navigator.clipboard.writeText(text);
      showToast(t.photo ? 'Поділитися фото з текстом тут недоступне — текст скопійовано, фото додайте в Viber вручну' : 'Поділитися недоступне — текст скопійовано');
    }catch(e2){ showToast('Не вдалося поділитися заявкою'); }
  }
}

/* ---- Фільтр за тегами ---- */
function renderTagFilterChips(){
  const counts = {};
  tickets.forEach(t=>(t.tags||[]).forEach(tag=>{ counts[tag]=(counts[tag]||0)+1; }));
  // NEW: показуємо лише офіційні теги з Налаштувань — а не будь-які, що
  // колись потрапили в t.tags (наприклад, лишились від видаленого тега).
  const allTags = settings.tags;
  const wrap = document.getElementById('tagFilterChips');
  wrap.innerHTML = allTags.map(tag=>{
    const active = activeFilterTags.has(tag);
    return `<span class="chip ${active?'active':''}" style="display:inline-flex; align-items:center; gap:6px; padding-right:6px;">
      <button type="button" data-tag="${escapeHtml(tag)}" style="background:none; border:none; color:inherit; font:inherit; padding:0;">${escapeHtml(tag)} ${counts[tag]?`· ${counts[tag]}`:''}</button>
      <button type="button" data-deltag="${escapeHtml(tag)}" title="Видалити цей тег зі всіх заявок" style="background:none; border:none; color:var(--text-dim); font-size:14px; padding:0 2px; line-height:1;">✕</button>
    </span>`;
  }).join('') || '<span style="color:var(--text-faint); font-size:13px;">Тегів ще немає</span>';
}

/* ---- Календар ---- */
const MONTH_NAMES = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const DOW_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
function renderCalendar(){
  document.getElementById('calMonthLabel').textContent = `${MONTH_NAMES[calendarViewDate.getMonth()]} ${calendarViewDate.getFullYear()}`;
  const grid = document.getElementById('calGrid');
  const year = calendarViewDate.getFullYear(), month = calendarViewDate.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // понеділок=0
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayStr = formatDate(new Date());

  const counts = {};
  tickets.forEach(t=>{ counts[t.date] = (counts[t.date]||0)+1; });

  let html = DOW_NAMES.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<firstDow;i++) html += `<div class="cal-day empty"></div>`;
  for(let day=1; day<=daysInMonth; day++){
    const dateStr = formatDate(new Date(year, month, day));
    const isToday = dateStr===todayStr;
    const isSelected = dateStr===currentTicketDate;
    const hasTickets = counts[dateStr] > 0;
    html += `<div class="cal-day ${isToday?'today':''} ${isSelected?'selected':''}" data-date="${dateStr}">${day}${hasTickets?'<span class="dot"></span>':''}</div>`;
  }
  grid.innerHTML = html;
}

/* Календар для екрана «Зміни» — той же принцип, що й у «Заявках»:
   крапка під днем означає, що в цей день була зміна, клік переносить
   на цей день у щоденній навігації, а заголовок показує загальні
   години за цей день (якщо змін кілька — суму). */
function renderShiftCalendar(){
  document.getElementById('shiftCalMonthLabel').textContent = `${MONTH_NAMES[shiftCalendarViewDate.getMonth()]} ${shiftCalendarViewDate.getFullYear()}`;
  const grid = document.getElementById('shiftCalGrid');
  const year = shiftCalendarViewDate.getFullYear(), month = shiftCalendarViewDate.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // понеділок=0
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayStr = formatDate(new Date());

  const hoursByDate = {};
  shifts.forEach(s=>{ hoursByDate[s.date] = (hoursByDate[s.date]||0) + (Number(s.hours)||0); });

  let html = DOW_NAMES.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<firstDow;i++) html += `<div class="cal-day empty"></div>`;
  for(let day=1; day<=daysInMonth; day++){
    const dateStr = formatDate(new Date(year, month, day));
    const isToday = dateStr===todayStr;
    const isSelected = dateStr===currentShiftDate;
    const hasShift = hoursByDate[dateStr] > 0;
    html += `<div class="cal-day ${isToday?'today':''} ${isSelected?'selected':''}" data-date="${dateStr}">${day}${hasShift?'<span class="dot"></span>':''}</div>`;
  }
  grid.innerHTML = html;
}

/* ---------- 5. Екран «Калькулятор» ---------- */
function blankCalcState(){
  const t = blankTicketObject();
  const now = new Date();
  t.date = formatDate(now);
  t.time = formatTime(now);
  // NEW: підставляємо ціну виклику за замовчуванням залежно від типу заявки
  // (тип за замовчуванням — "Підключення"); змінюється в Налаштуваннях.
  t.callFee = Number(settings.defaultConnectFee) || 0;
  t.tariff = (t.type === 'Підключення') ? (Number(settings.defaultTariff) || 0) : 0; // тариф лише для підключення
  return t;
}

/* Перевіряє, чи в калькуляторі є введені дані, які ще не збережені як заявка.
   Використовується, щоб попередити про втрату даних при перемиканні вкладки
   або закритті застосунку — щоб незбережена заявка не «загубилась» випадково. */
function hasUnsavedChanges(){
  const s = calcState;
  if(s.otherNote) return true;
  if(s.city || s.address || s.street || s.house || s.clientName || s.phone) return true;
  if(s.note || s.masterNote) return true;
  if(s.photo) return true;
  if(s.macAddress) return true;
  if(s.login || s.password) return true;
  if(s.geoLink) return true;
  if((s.callFee>0 && !feeIsAutoDefault) || (s.tariff>0 && !tariffIsAutoDefault)) return true; // NEW: авто-підставлена ціна за замовчуванням — не «зміна»
  if((s.cables||[]).some(c=> Number(c.meters)>0)) return true; // NEW: динамічний список кабелів
  if((s.equipment||[]).some(e=>e.checked)) return true;
  if((s.presetWorks||[]).some(w=>w.checked)) return true;
  if((s.additionalWork||[]).some(w=>w.desc || w.sum)) return true; // порожній рядок за замовчуванням не рахується
  // NEW: тег типу роботи (підключення/ремонт) вмикається автоматично для щойно
  // створеної заявки — сам по собі він не «зміна», інакше кожна порожня нова
  // заявка вважалась би чернеткою і при кожному відкритті застосунку зайве
  // спливало б «Відновити чернетку?». Рахуємо зміною лише БУДЬ-ЯКИЙ ІНШИЙ тег.
  const autoTag = TYPE_TAG_MAP[s.type];
  if((s.tags||[]).some(tag => tag !== autoTag)) return true;
  return false;
}

/* ---- Автозбереження чернетки ---- */
const DRAFT_KEY = 'ticketDraft';

function saveDraftToLocalStorage(){
  if(!hasUnsavedChanges()) return; // немає що зберігати — не смітимо сховище
  try{
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      ts: Date.now(),
      editingTicketId,
      state: calcState
    }));
  }catch(e){ /* сховище повне чи недоступне — пропускаємо, це не критично */ }
}

function clearDraft(){
  localStorage.removeItem(DRAFT_KEY);
}

function restoreDraftIfAny(){
  const raw = localStorage.getItem(DRAFT_KEY);
  if(!raw) return;
  let draft;
  try{ draft = JSON.parse(raw); } catch(e){ clearDraft(); return; }
  if(!draft || !draft.state) { clearDraft(); return; }
  const d = new Date(draft.ts);
  const ok = confirm(`Знайдено незбережену чернетку заявки від ${formatDate(d)} ${formatTime(d)}.\nВідновити її?`);
  if(!ok){ clearDraft(); return; }
  editingTicketId = draft.editingTicketId || null;
  loadTicketIntoForm(draft.state);
  if(editingTicketId){
    document.getElementById('saveTicketBtn').textContent = 'Оновити заявку';
    document.getElementById('cancelEditBtn').classList.remove('hidden');
  }
  switchTab('calculator');
  showToast('Чернетку відновлено');
}

function resetCalcForm(presetDate){
  calcState = blankCalcState();
  if(presetDate) calcState.date = presetDate;
  editingTicketId = null;
  feeIsAutoDefault = true; // NEW: нова заявка — ціну можна підставляти автоматично за типом
  tariffIsAutoDefault = true;
  // NEW: нова заявка стартує з типом "Підключення" — одразу вмикаємо тег "підключення"
  const defTag = TYPE_TAG_MAP[calcState.type];
  if(defTag){
    if(!settings.tags.includes(defTag)){ settings.tags.push(defTag); saveSettings(); }
    if(!calcState.tags.includes(defTag)) calcState.tags.push(defTag);
  }
  document.getElementById('saveTicketBtn').textContent = 'Зберегти заявку';
  document.getElementById('cancelEditBtn').classList.add('hidden');
  fillFormFromState();
}

function loadTicketIntoForm(t){
  calcState = JSON.parse(JSON.stringify(t)); // глибока копія, щоб не мутувати реєстр до збереження
  // сумісність зі старими записами, де могло не бути структурних полів
  if(!calcState.equipment || !calcState.equipment.length){
    calcState.equipment = getEquipmentConfig().map(e=>({id:e.id, label:e.label, price:e.price, checked:false}));
  }
  if(!calcState.presetWorks || !calcState.presetWorks.length){
    calcState.presetWorks = getWorkTypesConfig().map(w=>({id:w.id, label:w.label, price:w.price, qty:1, checked:false}));
  }
  if(!calcState.cables || !calcState.cables.length){
    // NEW: сумісність зі старими заявками — переносимо старі окремі поля
    // UTP/Оптика (якщо були) у новий динамічний список кабелів
    calcState.cables = getCableTypesConfig().map(c=>({id:c.id, label:c.label, meters:0, pricePerMeter:c.pricePerMeter}));
    const utp = calcState.cables.find(c=>c.id==='utp');
    if(utp && calcState.utpMeters) { utp.meters = Number(calcState.utpMeters)||0; utp.pricePerMeter = Number(calcState.utpPrice)||utp.pricePerMeter; }
    const optic = calcState.cables.find(c=>c.id==='optic');
    if(optic && calcState.opticMeters) { optic.meters = Number(calcState.opticMeters)||0; optic.pricePerMeter = Number(calcState.opticPrice)||optic.pricePerMeter; }
  }
  // якщо в збереженій заявці немає додаткових робіт — все одно показуємо
  // одне порожнє поле для вводу, а не порожній список з кнопкою "+"
  calcState.additionalWork = (calcState.additionalWork && calcState.additionalWork.length)
    ? calcState.additionalWork
    : [{desc:'', sum:0}];
  calcState.tags = calcState.tags || [];
  // сумісність зі старими заявками, де майстер зберігався як одне ім'я/літера,
  // а не масив (до того, як зробили множинний вибір майстрів)
  if(!calcState.connectMasters){
    calcState.connectMasters = (calcState.masterName || calcState.masterLetter)
      ? [{name: calcState.masterName || '', letter: calcState.masterLetter || ''}]
      : [];
  }
  editingTicketId = t.id;
  feeIsAutoDefault = false; // NEW: редагуємо існуючу заявку — ціну вже введено, автопідстановку вимикаємо
  tariffIsAutoDefault = false;
  document.getElementById('saveTicketBtn').textContent = 'Оновити заявку';
  document.getElementById('cancelEditBtn').classList.remove('hidden');
  fillFormFromState();
}

/* Розбирає текст, вставлений з Viber/Telegram від диспетчера, на логін і пароль.
   Формат зазвичай — два рядки: перший логін, другий пароль. Якщо рядок один —
   пробуємо розбити по пробілу/табу; якщо нічого не вдалось — все йде в логін. */
function parseCredentials(raw){
  const lines = String(raw||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(lines.length >= 2) return {login: lines[0], password: lines[1]};
  if(lines.length === 1){
    const parts = lines[0].split(/\s+/).filter(Boolean);
    if(parts.length >= 2) return {login: parts[0], password: parts[1]};
    return {login: parts[0]||'', password: ''};
  }
  return {login:'', password:''};
}
function updateCredParsedHint(){
  const hintEl = document.getElementById('credParsedHint');
  if(!hintEl) return;
  const cred = parseCredentials(document.getElementById('f_credRaw').value);
  hintEl.textContent = (cred.login || cred.password)
    ? `✅ Логін: ${cred.login || '—'} · Пароль: ${cred.password || '—'}`
    : '';
}

function fillFormFromState(){
  document.getElementById('f_type').value = calcState.type || 'Підключення';
  document.getElementById('f_otherNote').value = calcState.otherNote || '';
  renderMasterChips();
  toggleTypeOtherField();
  updateCallFeeLabel();
  document.getElementById('f_city').value = calcState.city || '';
  renderStreetDatalist(calcState.city || ''); // NEW: підказки вулиць саме для міста цієї заявки
  if(calcState.street || calcState.house || calcState.apartment){
    document.getElementById('f_street').value = calcState.street || '';
    document.getElementById('f_house').value = calcState.house || '';
    document.getElementById('f_apartment').value = calcState.apartment || '';
  } else {
    // Стара заявка без розбитих полів — кладемо весь текст адреси у "Вулиця",
    // будинок/квартиру можна донести вручну при редагуванні.
    document.getElementById('f_street').value = calcState.address || '';
    document.getElementById('f_house').value = '';
    document.getElementById('f_apartment').value = '';
  }
  document.getElementById('f_client').value = calcState.clientName || '';
  document.getElementById('f_phone').value = calcState.phone || '';
  document.getElementById('f_mac').value = calcState.macAddress || '';
  { const hint = document.getElementById('macHint'); if(hint) hint.style.display = (calcState.macAddress && !/^[0-9A-F]{12}$/.test(calcState.macAddress)) ? '' : 'none'; }
  document.getElementById('f_credRaw').value = [calcState.login, calcState.password].filter(Boolean).join('\n');
  updateCredParsedHint();
  setDateFieldValue(calcState.date || '');
  document.getElementById('f_time').value = calcState.time || '';
  document.getElementById('f_callFee').value = calcState.callFee || 0;
  document.getElementById('f_tariff').value = calcState.tariff || 0;
  document.getElementById('f_payment').value = calcState.payment || '';
  document.getElementById('f_note').value = calcState.note || '';
  document.getElementById('f_masterNote').value = calcState.masterNote || '';
  document.getElementById('f_rawContent').value = calcState.content || ''; // NEW
  document.getElementById('f_rawSum').value = calcState.sum || 0; // NEW
  updateCallFeeLabel();
  renderEquipmentList();
  renderCablesList(); // NEW: динамічний список кабелів замість фіксованих UTP/Оптика
  renderPresetWorksList();
  renderAdditionalWorkList();
  renderCalcTagChips();
  renderPhotoPreview();
  renderGeoBadge();
  computeTotal();
}

function renderEquipmentList(){
  const wrap = document.getElementById('equipmentList');
  wrap.innerHTML = calcState.equipment.map((eq,i)=>`
    <div class="eq-row">
      <label><input type="checkbox" data-eqidx="${i}" class="eq-check" ${eq.checked?'checked':''}> ${escapeHtml(eq.label)}</label>
      <input type="number" min="0" data-eqidx="${i}" class="eq-price" value="${eq.price}">
    </div>`).join('');
  updateEquipmentSummary();
}

// NEW: оновлює лише текст підсумку обладнання, не перебудовуючи інпути —
// щоб не збивати фокус/курсор під час введення ціни
function updateEquipmentSummary(){
  const checkedCount = calcState.equipment.filter(e=>e.checked).length;
  const sum = calcState.equipment.reduce((s,e)=> s + (e.checked ? (Number(e.price)||0) : 0), 0);
  document.getElementById('equipmentSummary').textContent = checkedCount ? `— обрано: ${checkedCount}, ${fmtMoney(sum)}` : '';
}

// NEW: динамічний список кабелів (типи редагуються в Налаштуваннях) —
// замінює колишні жорстко закодовані поля UTP/Оптика
function renderCablesList(){
  const wrap = document.getElementById('cablesList');
  if(!calcState.cables || calcState.cables.length===0){
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:13px;">Типи кабелів не налаштовані — додайте у Налаштуваннях</div>`;
  } else {
    wrap.innerHTML = calcState.cables.map((c,i)=>`
      <div class="cab-row" data-cabidx="${i}">
        <span class="cab-label">${escapeHtml(c.label)}</span>
        <input type="number" data-cabidx="${i}" class="cab-meters" placeholder="метри" min="0" value="${c.meters||0}">
        <span class="cab-x">м ×</span>
        <input type="number" data-cabidx="${i}" class="cab-price" placeholder="грн/м" min="0" value="${c.pricePerMeter||0}">
      </div>`).join('');
  }
  updateCablesSummary();
}

// NEW: оновлює лише текст підсумку кабелів, не перебудовуючи інпути —
// щоб не збивати фокус/курсор під час введення метрів чи ціни
function updateCablesSummary(){
  const sum = (calcState.cables||[]).reduce((s,c)=> s + (Number(c.meters)||0)*(Number(c.pricePerMeter)||0), 0);
  document.getElementById('cablesSummary').textContent = sum ? `— ${fmtMoney(sum)}` : '';
}

function renderPresetWorksList(){
  const wrap = document.getElementById('presetWorksList');
  if(!calcState.presetWorks || calcState.presetWorks.length===0){
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:13px;">Список робіт порожній — додайте у Налаштуваннях</div>`;
  } else {
    wrap.innerHTML = calcState.presetWorks.map((w,i)=>`
      <div class="eq-row" data-pwidx="${i}" style="align-items:center; gap:8px;">
        <label style="flex:1;"><input type="checkbox" data-pwidx="${i}" class="pw-check" ${w.checked?'checked':''}> ${escapeHtml(w.label)}</label>
        <input type="number" min="1" data-pwidx="${i}" class="pw-qty" value="${w.qty||1}" style="width:52px;" title="Кількість">
        <span style="color:var(--text-dim); font-size:12px;">×</span>
        <input type="number" min="0" data-pwidx="${i}" class="pw-price" value="${w.price}" style="width:70px;" title="Ціна">
      </div>`).join('');
  }
  const checkedCount = (calcState.presetWorks||[]).filter(w=>w.checked).length;
  const sum = (calcState.presetWorks||[]).reduce((s,w)=> s + (w.checked ? (Number(w.price)||0)*(Number(w.qty)||1) : 0), 0);
  document.getElementById('presetWorksSummary').textContent = checkedCount ? `— обрано: ${checkedCount}, разом: ${fmtMoney(sum)}` : '';
}

function renderAdditionalWorkList(){
  const wrap = document.getElementById('additionalWorkList');
  if(calcState.additionalWork.length===0){
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:13px; margin-bottom:8px;">Додаткових робіт немає</div>`;
    document.getElementById('additionalWorkSummary').textContent = '';
    return;
  }
  wrap.innerHTML = calcState.additionalWork.map((w,i)=>`
    <div class="aw-row" data-awidx="${i}">
      <input type="text" class="aw-desc" placeholder="Опис роботи" value="${escapeHtml(w.desc)}">
      <input type="number" class="aw-sum" placeholder="Сума" min="0" value="${w.sum}">
      <button type="button" class="btn btn-icon btn-sm aw-remove">✕</button>
    </div>`).join('');
  const sum = calcState.additionalWork.reduce((s,w)=> s + (Number(w.sum)||0), 0);
  document.getElementById('additionalWorkSummary').textContent = `— ${calcState.additionalWork.length}, ${fmtMoney(sum)}`;
}

function renderMasterChips(){
  const wrap = document.getElementById('calcMasterChips');
  if(!settings.masters || settings.masters.length===0){
    wrap.innerHTML = `<span style="color:var(--text-faint); font-size:13px;">Додайте майстрів у Налаштуваннях</span>`;
    return;
  }
  // Кілька майстрів можуть робити одне підключення разом — вибір
  // множинний. Звіряємо по імені, а не по літері: у різних майстрів
  // літера може збігатися (наприклад, двоє з однаковою першою літерою
  // прізвища), і звірка по літері підсвічувала б їх обох одразу.
  wrap.innerHTML = settings.masters.map(m=>{
    const active = (calcState.connectMasters||[]).some(x=>x.name===m.name);
    return `<button type="button" class="chip ${active?'active':''}" data-master-letter="${escapeHtml(m.letter)}" data-master-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}</button>`;
  }).join('');
}

function renderCalcTagChips(){
  const wrap = document.getElementById('calcTagChips');
  if(settings.tags.length===0){
    wrap.innerHTML = `<span style="color:var(--text-faint); font-size:13px;">Додайте теги в Налаштуваннях</span>`;
  } else {
    wrap.innerHTML = settings.tags.map(tag=>{
      const active = calcState.tags.includes(tag);
      return `<button type="button" class="chip ${active?'active':''}" data-calctag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
    }).join('');
  }
  document.getElementById('tagsSummary').textContent = calcState.tags.length ? `— обрано: ${calcState.tags.length}` : '';
}

function renderPhotoPreview(){
  const wrap = document.getElementById('photoPreviewWrap');
  const btn = document.getElementById('photoBtn');
  if(calcState.photo){
    wrap.classList.remove('hidden');
    const img = document.getElementById('photoPreview');
    const resolved = getPhotoCached(calcState.photo, (val)=>{ img.src = val; }, calcState.tgPhotoFileId);
    img.src = resolved || ''; // поки фото з IndexedDB вантажиться, плейсхолдер порожній; підʼявиться через мить
    btn.textContent = '📷 Замінити фото';
  } else {
    wrap.classList.add('hidden');
    btn.textContent = '📷 Зробити фото';
  }
}

function computeTotal(){
  if(calcState.cloudImported){ // NEW: для відновленої з хмари заявки сума вводиться вручну
    const total = Number(document.getElementById('f_rawSum').value)||0;
    document.getElementById('calcTotal').textContent = fmtMoney(total);
    return total;
  }
  const callFee = Number(document.getElementById('f_callFee').value)||0;
  const tariff  = Number(document.getElementById('f_tariff').value)||0;
  const equipSum = calcState.equipment.reduce((s,e)=> s + (e.checked ? (Number(e.price)||0) : 0), 0);
  const cablesSum = (calcState.cables||[]).reduce((s,c)=> s + (Number(c.meters)||0)*(Number(c.pricePerMeter)||0), 0); // NEW
  const workSum  = calcState.additionalWork.reduce((s,w)=> s + (Number(w.sum)||0), 0);
  const presetWorkSum = (calcState.presetWorks||[]).reduce((s,w)=> s + (w.checked ? (Number(w.price)||0)*(Number(w.qty)||1) : 0), 0);
  const total = callFee + tariff + equipSum + cablesSum + workSum + presetWorkSum;
  document.getElementById('calcTotal').textContent = fmtMoney(total);
  return total;
}

/* NEW: текст поточної заявки для копіювання/надсилання. Для заявок,
   відновлених з хмари, беремо текст напряму з textarea (щоб не перезаписати
   оригінальний опис порожніми даними калькулятора) — для решти рахуємо як
   раніше, через калькулятор. */
/* Номер договору формується лише для підключень. Якщо після першого
   збереження дату або склад майстрів більше НЕ чіпали — номер лишається
   тим самим (щоб не "плив" сам по собі при кожному редагуванні). Але якщо
   виявили помилку і поправили дату чи майстра — номер перераховується під
   нові дані, саме цього просив користувач.
   Формат: ДДММРРРРN<літери майстрів>, де N — порядковий номер підключення
   за цей день, літери — в порядку списку майстрів у Налаштуваннях. */
function assignContractNumberIfNeeded(){
  if(calcState.type !== 'Підключення'){
    calcState.contractNumber = '';
    calcState.contractNumberDate = '';
    calcState.contractNumberMastersKey = '';
    return;
  }
  const currentMastersKey = (calcState.connectMasters||[]).map(m=>m.name).join('|');

  if(calcState.contractNumber){
    // Для заявок зі старих версій застосунку (де ще не зберігали "знімок"
    // дати/майстрів на момент призначення номера) знімка немає — довіряємо
    // наявному номеру й просто донаповнюємо знімок, без перерахунку.
    const hasSnapshot = !!calcState.contractNumberDate;
    const dateChanged = hasSnapshot && calcState.contractNumberDate !== calcState.date;
    const mastersChanged = hasSnapshot && calcState.contractNumberMastersKey !== currentMastersKey;
    if(!hasSnapshot || (!dateChanged && !mastersChanged)){
      calcState.contractNumberDate = calcState.date;
      calcState.contractNumberMastersKey = currentMastersKey;
      return;
    }
    // дата чи майстри дійсно змінились відносно того, з чим формували номер
    // раніше — перераховуємо нижче.
  }

  const dateDigits = String(calcState.date||'').replace(/\./g,'');
  if(!dateDigits) return;
  const seq = tickets.filter(t=>
    t.type === 'Підключення' &&
    t.date === calcState.date &&
    String(t.id) !== String(editingTicketId||'')
  ).length + 1;
  const selectedNames = new Set((calcState.connectMasters||[]).map(m=>m.name));
  const letters = (settings.masters||[])
    .filter(m=>selectedNames.has(m.name))
    .map(m=>m.letter)
    .join('');
  calcState.contractNumber = `${dateDigits}-${seq}${letters}`;
  calcState.contractNumberDate = calcState.date;
  calcState.contractNumberMastersKey = currentMastersKey;
}

function getCurrentTicketText(){
  if(calcState.cloudImported){
    return document.getElementById('f_rawContent').value.trim();
  }
  const isOther = calcState.type === 'Інше';
  assignContractNumberIfNeeded();
  const total = isOther ? 0 : computeTotal();
  return buildTicketContent(calcState, total);
}

function callFeeLabelFor(type){
  return type === 'Ремонт' ? 'Виклик' : (type || 'Виклик');
}

function buildTicketContent(s, total){
  if(s.type === 'Інше'){
    const lines = [`📋 НОТАТКА`];
    if(s.date) lines.push(`📅 ${s.date}${s.time ? ' '+s.time : ''}`); // NEW: дата — видно, навіть якщо надсилаєте не в той день
    if(s.otherNote) lines.push(s.otherNote);
    return lines.join('\n');
  }
  const lines = [];
  lines.push(`📋 ЗАЯВКА: ${(s.type||'').toUpperCase()}`);
  if(s.date) lines.push(`📅 ${s.date}${s.time ? ' '+s.time : ''}`); // NEW: дата — видно, навіть якщо надсилаєте не в той день
  if(s.type === 'Підключення' && s.contractNumber) lines.push(`📄 № дог.: ${s.contractNumber}`); // коротка мітка — щоб рядок влазив в один рядок у Viber
  if(s.city) lines.push(`🏙️ Місто: ${s.city}`);
  if(s.address) lines.push(`📍 Адреса: ${s.address}`);
  if(s.clientName) lines.push(`👤 Клієнт: ${s.clientName}`);
  if(s.phone) lines.push(`📞 Тел: ${s.phone}`);
  if(s.macAddress) lines.push(`🔧 MAC ONU: ${s.macAddress}`);
  lines.push('------------------');
  if(s.callFee>0) lines.push(`💎 ${callFeeLabelFor(s.type)}: ${fmtMoney(s.callFee)}`);
  if(s.tariff>0) lines.push(`💎 Тариф: ${fmtMoney(s.tariff)}`);
  s.equipment.filter(e=>e.checked).forEach(e=>{
    lines.push(`🛠️ ${e.label}: 1 шт. х ${Math.round(e.price)} грн`);
  });
  (s.cables||[]).forEach(c=>{
    const meters = Number(c.meters)||0;
    if(meters>0) lines.push(`🔌 ${c.label}: ${meters}м х ${c.pricePerMeter}грн = ${Math.round(meters*(Number(c.pricePerMeter)||0))}грн`);
  });
  (s.presetWorks||[]).filter(w=>w.checked).forEach(w=>{
    lines.push(`🔧 ${w.label}: ${w.qty||1} шт. х ${Math.round(w.price)} грн = ${Math.round((w.price||0)*(w.qty||1))}грн`);
  });
  s.additionalWork.forEach(w=>{ if(w.desc || w.sum) lines.push(`✏️ ${w.desc||'Робота'}: ${fmtMoney(w.sum)}`); });
  lines.push('------------------');
  if(s.payment) lines.push(`💳 Оплата: ${s.payment}`);
  lines.push(`💵 ІТОГО: ${fmtMoney(total)}`);
  if(s.note) lines.push(`📝 ${s.note}`);
  return lines.join('\n');
}

function getEffectiveType(){
  return document.getElementById('f_type').value;
}
function isOtherType(){
  return document.getElementById('f_type').value === 'Інше';
}
function toggleTypeOtherField(){
  const other = isOtherType();
  const isConnect = getEffectiveType() === 'Підключення';
  const isRepair = getEffectiveType() === 'Ремонт';
  const raw = !!calcState.cloudImported; // NEW: заявка відновлена з хмари — свій режим редагування
  document.getElementById('otherNoteWrap').classList.toggle('hidden', !other);
  // NEW: вибір напарників тепер показуємо і для "Ремонт", не лише для
  // "Підключення" — але номер договору формується, як і раніше, лише для
  // підключень (див. assignContractNumberIfNeeded).
  document.getElementById('connectMasterWrap').classList.toggle('hidden', !(isConnect || isRepair) || raw);
  document.getElementById('connectMasterWrapLabel').innerHTML = isConnect
    ? 'Хто підключав <span style="font-size:11px; color:var(--text-faint); font-weight:400;">(для номера договору)</span>'
    : 'Напарники';
  document.getElementById('importedRawWrap').classList.toggle('hidden', !raw); // NEW
  document.getElementById('fullFormFields').classList.toggle('hidden', other);
  document.getElementById('fullFormBlocks').classList.toggle('hidden', other);
  // NEW: обладнання/вартість/MAC для сирої заявки не мають сенсу — сума редагується вручну
  document.getElementById('calcMacCard').classList.toggle('hidden', other || raw);
  document.getElementById('calcPricingBlocks').classList.toggle('hidden', other || raw);
  document.getElementById('f_payment').required = !other;
}
function updateCallFeeLabel(){
  document.getElementById('callFeeLabel').textContent = callFeeLabelFor(getEffectiveType()) + ', грн';
}

// NEW: підставляє ціну виклику/підключення за замовчуванням при зміні типу
// заявки — але тільки якщо майстер ще не ввів своє значення вручну.
// NEW: коли обрано тип роботи "Підключення"/"Ремонт" — одразу вмикає відповідний
// тег (щоб потім було зручно шукати заявки за тегом). Порівнюємо з calcState.type,
// який на момент події 'change' ще містить ПОПЕРЕДНЄ значення (синхронізується
// з форми лише при збереженні) — тож знімаємо старий тег типу й ставимо новий.
const TYPE_TAG_MAP = {'Підключення':'підключення', 'Ремонт':'ремонт'};
function applyDefaultTypeTag(){
  const newType = document.getElementById('f_type').value;
  const prevType = calcState.type;
  const newTag = TYPE_TAG_MAP[newType];
  const prevTag = TYPE_TAG_MAP[prevType];
  if(prevTag && prevTag!==newTag){
    const i = calcState.tags.indexOf(prevTag);
    if(i>-1) calcState.tags.splice(i,1);
  }
  if(newTag){
    if(!settings.tags.includes(newTag)){ settings.tags.push(newTag); saveSettings(); }
    if(!calcState.tags.includes(newTag)) calcState.tags.push(newTag);
  }
  calcState.type = newType;
  renderCalcTagChips();
}
function applyDefaultCallFee(){
  if(!feeIsAutoDefault || calcState.cloudImported) return;
  const type = getEffectiveType();
  let def = null;
  if(type === 'Підключення') def = Number(settings.defaultConnectFee) || 0;
  else if(type === 'Ремонт') def = Number(settings.defaultRepairCallFee) || 0;
  if(def === null) return;
  document.getElementById('f_callFee').value = def;
  computeTotal();
}

// NEW: тариф за замовчуванням підставляється лише для типу "Підключення" —
// для ремонту та інших типів заявок тарифу бути не повинно.
function applyDefaultTariff(){
  if(!tariffIsAutoDefault || calcState.cloudImported) return;
  const type = getEffectiveType();
  document.getElementById('f_tariff').value = (type === 'Підключення') ? (Number(settings.defaultTariff) || 0) : 0;
  computeTotal();
}

function syncFormToState(){
  calcState.type = getEffectiveType();
  calcState.otherNote = document.getElementById('f_otherNote').value.trim();
  if(calcState.type !== 'Підключення'){
    calcState.connectMasters = [];
  }
  calcState.city = document.getElementById('f_city').value.trim();
  calcState.street = document.getElementById('f_street').value.trim();
  calcState.house = document.getElementById('f_house').value.trim();
  calcState.apartment = document.getElementById('f_apartment').value.trim();
  calcState.address = [
    [calcState.street, calcState.house].filter(Boolean).join(' '),
    calcState.apartment ? `кв. ${calcState.apartment}` : ''
  ].filter(Boolean).join(', ');
  calcState.clientName = document.getElementById('f_client').value.trim();
  calcState.phone = document.getElementById('f_phone').value.trim();
  calcState.macAddress = normalizeMac(document.getElementById('f_mac').value);
  const cred = parseCredentials(document.getElementById('f_credRaw').value);
  calcState.login = cred.login;
  calcState.password = cred.password;
  calcState.date = document.getElementById('f_date').value.trim() || formatDate(new Date());
  calcState.time = document.getElementById('f_time').value.trim() || formatTime(new Date());
  calcState.callFee = Number(document.getElementById('f_callFee').value)||0;
  calcState.tariff = Number(document.getElementById('f_tariff').value)||0;
  calcState.payment = document.getElementById('f_payment').value;
  calcState.note = document.getElementById('f_note').value.trim();
  calcState.masterNote = document.getElementById('f_masterNote').value.trim();
  // geoLink вже синхронізується через setGeoLink
}

/* ---- Фото: зчитування + стиснення до ширини 800px ---- */
function handlePhotoFile(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e)=>{
    const img = new Image();
    img.onload = ()=>{
      const maxW = 800;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width*scale);
      canvas.height = Math.round(img.height*scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      calcState.photo = canvas.toDataURL('image/jpeg', 0.72); // сире фото; в IndexedDB переноситься при збереженні заявки
      renderPhotoPreview();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ---- Геолокація ---- */

/* Показує/ховає зелений бейдж з координатами під полем адреси */
function renderGeoBadge(){
  const badge = document.getElementById('geoBadge');
  const linkEl = document.getElementById('geoLink');
  const btn = document.getElementById('geoBtn');
  if(calcState.geoLink){
    // витягуємо координати з посилання для красивого відображення
    const m = calcState.geoLink.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const label = m ? `📍 ${Number(m[1]).toFixed(5)}, ${Number(m[2]).toFixed(5)}` : `📍 ${calcState.geoLink.slice(0,40)}…`;
    linkEl.innerHTML = `<a href="${escapeHtml(calcState.geoLink)}" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:none;">${label}</a>`;
    badge.classList.remove('hidden');
    btn.style.background = 'var(--success)';
    btn.style.color = '#fff';
  } else {
    badge.classList.add('hidden');
    btn.style.background = '';
    btn.style.color = '';
  }
}

function setGeoLink(link){
  calcState.geoLink = link;
  // Геолокація тепер НЕ потрапляє в текст примітки/заявки — вона лише
  // для власного використання майстра (кнопка 📍 і бейдж з посиланням).
  renderGeoBadge();
}

/* Розпізнає координати з посилання Google Maps (формати @lat,lng / q=lat,lng / ll=lat,lng)
   або з простого тексту "lat,lng", введеного вручну */
function parseMapsLink(text){
  if(!text) return null;
  const patterns = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/, /^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/];
  for(const re of patterns){
    const m = text.match(re);
    if(m) return {lat:m[1], lng:m[2]};
  }
  return null;
}

/* Одна розумна кнопка 📍:
   - якщо HTTPS і GPS доступні — визначає координати автоматично
   - якщо GPS заблокований або файл відкрито локально — одразу показує модалку «вставити посилання» */
function handleGeoBtn(){
  // GPS на телефоні часто дає неточну точку, тож більше не використовуємо
  // автоматичне визначення — одразу відкриваємо Google Maps, де можна
  // вручну поставити мітку та скопіювати посилання.
  if(calcState.geoLink){
    if(confirm('Геолокація вже додана. Оновити?')){
      calcState.geoLink='';
      openGeoPasteModal();
    }
    return;
  }
  openGeoPasteModal();
}

function tryGps(){
  if(!navigator.geolocation || window.isSecureContext === false){
    // GPS точно не спрацює — одразу відкриваємо ручне введення
    openGeoPasteModal();
    return;
  }
  const btn = document.getElementById('geoBtn');
  btn.textContent = '⏳';
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    pos=>{
      btn.textContent = '📍';
      btn.disabled = false;
      const link = `https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;
      setGeoLink(link);
      showToast('✅ Геолокацію збережено');
    },
    err=>{
      btn.textContent = '📍';
      btn.disabled = false;
      // GPS не спрацював — відкриваємо ручне введення з поясненням
      let hint = '';
      if(err.code===1) hint = 'GPS заблоковано. ';
      else if(err.code===2) hint = 'GPS недоступний. ';
      else if(err.code===3) hint = 'Час очікування вийшов. ';
      openGeoPasteModal(hint + 'Встав посилання з Google Maps вручну:');
    },
    {enableHighAccuracy:true, timeout:8000}
  );
}

/* Модалка ручного введення — відкривається автоматично при відмові GPS */
function openGeoPasteModal(headerMsg){
  openModal('📍 Додати геолокацію', `
    <div style="font-size:13px; color:var(--text-dim); margin-bottom:10px;">
      ${escapeHtml(headerMsg||'Відкрий Google Maps → постав мітку → Поділитися → Копіювати посилання → встав нижче.')}
    </div>
    <button type="button" class="btn btn-block" id="openMapsAppBtn" style="margin-bottom:10px;">🗺️ Відкрити Google Maps</button>
    <div class="field"><label>Посилання або координати (50.4501, 30.5234)</label>
      <textarea id="geoPasteInput" placeholder="https://maps.app.goo.gl/... або 50.4501, 30.5234" style="min-height:60px;"></textarea>
    </div>
    <button type="button" class="btn btn-accent btn-block" id="geoPasteAddBtn">✅ Додати в заявку</button>
  `, {onOpen:()=>{
    document.getElementById('openMapsAppBtn').onclick = ()=> window.open('https://www.google.com/maps', '_blank');
    document.getElementById('geoPasteAddBtn').onclick = ()=>{
      const raw = document.getElementById('geoPasteInput').value.trim();
      if(!raw){ showToast('Встав посилання або координати'); return; }
      const coords = parseMapsLink(raw);
      const link = coords ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}` : raw;
      setGeoLink(link);
      closeModal();
      showToast('✅ Геолокацію збережено');
    };
  }});
}

/* ---- Копіювати текст / Поділитись фото ---- */
async function copyTicketText(){
  syncFormToState();
  const text = getCurrentTicketText(); // NEW: враховує raw-режим
  try{
    await navigator.clipboard.writeText(text);
    showToast('Текст заявки скопійовано');
  }catch(e){
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); showToast('Текст заявки скопійовано'); }
    catch(e2){ showToast('Не вдалося скопіювати текст'); }
    ta.remove();
  }
}

async function sharePhoto(){
  if(!calcState.photo){ showToast('Спочатку додайте фото'); return; }
  if(!navigator.share){ showToast('Web Share API не підтримується цим браузером'); return; }
  try{
    const photoData = await resolvePhotoAsync(calcState.photo, calcState.tgPhotoFileId);
    const res = await fetch(photoData);
    const blob = await res.blob();
    const file = new File([blob], 'foto.jpg', {type:'image/jpeg'});
    if(navigator.canShare && !navigator.canShare({files:[file]})){
      showToast('Цей браузер не підтримує надсилання фото'); return;
    }
    await navigator.share({files:[file], title:'Фото заявки'});
  }catch(e){
    if(e.name !== 'AbortError') showToast('Не вдалося надіслати фото');
  }
}

/* ---- Збереження / оновлення заявки ---- */
async function saveTicketFromForm(e){
  e.preventDefault();
  syncFormToState();
  // прибираємо порожні рядки додаткових робіт (незаповнений рядок за
  // замовчуванням не повинен потрапляти у збережену заявку)
  calcState.additionalWork = (calcState.additionalWork||[]).filter(w => w.desc || w.sum);
  // NEW: автопрописка міста та вулиці — якщо введеного немає в довідниках,
  // додаємо автоматично (без походу в Налаштування), за зразком автопрописки
  // імен напарників у теги вище (calcMasterChips click-хендлер)
  if(calcState.city){
    if(!settings.cities) settings.cities = [];
    if(!settings.cities.includes(calcState.city)){
      settings.cities.push(calcState.city);
      saveSettings();
      renderCityDatalist();
    }
    if(calcState.street){
      if(!settings.streets) settings.streets = {};
      if(!settings.streets[calcState.city]) settings.streets[calcState.city] = [];
      if(!settings.streets[calcState.city].includes(calcState.street)){
        settings.streets[calcState.city].push(calcState.street);
        saveSettings();
      }
    }
  }
  if(!calcState.type){ showToast('Оберіть тип роботи'); return; }
  const isOther = calcState.type === 'Інше';
  const isRaw = !!calcState.cloudImported; // NEW

  if(isRaw){
    // NEW: заявка відновлена з хмари — структурних полів калькулятора в ній
    // немає, тож перезбирати текст не можна (втратимо оригінальний опис).
    // Берем текст і суму напряму з полів редагування.
    if(!calcState.payment){ showToast('Оберіть спосіб оплати'); return; }
    calcState.content = document.getElementById('f_rawContent').value.trim();
    calcState.sum = Number(document.getElementById('f_rawSum').value)||0;
  } else {
    if(isOther && !calcState.otherNote){ showToast('Введіть текст нотатки'); return; }
    if(!isOther && !calcState.payment){ showToast('Оберіть спосіб оплати'); return; }
    assignContractNumberIfNeeded();
    const total = isOther ? 0 : computeTotal();
    calcState.sum = total;
    calcState.content = buildTicketContent(calcState, total);
  }

  // Якщо фото нове (сирий base64, а не вже збережений ключ idb:...) — переносимо в IndexedDB,
  // а попереднє фото заявки (якщо було інше) видаляємо, щоб не накопичувати «сирітські» записи.
  if(calcState.photo && !String(calcState.photo).startsWith('idb:')){
    const rawPhoto = calcState.photo;
    if(editingTicketId){
      const prev = tickets.find(t=>t.id===editingTicketId);
      if(prev && prev.photo && prev.photo!==rawPhoto) await deletePhotoKey(prev.photo);
    }
    calcState.photo = await storePhoto(rawPhoto);
  } else if(!calcState.photo && editingTicketId){
    const prev = tickets.find(t=>t.id===editingTicketId);
    if(prev && prev.photo) await deletePhotoKey(prev.photo);
  }

  const syncConfigured = !!getScriptUrl();

  // Захист від дублів: якщо за останні 3 години вже є заявка з такою ж
  // адресою (і вона не та, що зараз редагується) — попереджаємо.
  if(!editingTicketId && calcState.address){
    const threeHoursMs = 3*60*60*1000;
    const nowMs = Date.now();
    const similar = tickets.find(t=>
      t.address && t.address.trim().toLowerCase() === calcState.address.trim().toLowerCase() &&
      t.city === calcState.city &&
      (nowMs - Number(t.id||0)) < threeHoursMs
    );
    if(similar && !confirm(`Схожа заявка вже є (${similar.date} ${similar.time}, ${similar.city||''} ${similar.address}).\nЗберегти ще одну?`)){
      return;
    }
  }

  let savedTicketRef = null; // NEW: посилання на щойно збережений об'єкт у tickets — для бекапу в Telegram нижче
  if(editingTicketId){
    calcState.id = editingTicketId;
    const idx = tickets.findIndex(t=>t.id===editingTicketId);
    if(idx>-1) tickets[idx] = JSON.parse(JSON.stringify(calcState));
    saveTickets();
    showToast('Заявку оновлено');
    if(syncConfigured){
      // у схемі синку немає updateTicket — імітуємо оновлення видаленням і повторним додаванням
      await syncPost('deleteTicket', {id: editingTicketId});
      const ok = await syncPost('addTicket', ticketToSyncPayload(calcState));
      if(idx>-1){ tickets[idx].synced = ok; saveTickets(); renderTicketsScreen(); }
    }
    if(idx>-1) savedTicketRef = tickets[idx];
  } else {
    calcState.id = Date.now();
    const newTicket = JSON.parse(JSON.stringify(calcState));
    tickets.push(newTicket);
    saveTickets();
    showToast('Заявку збережено');
    if(syncConfigured){
      const ok = await syncPost('addTicket', ticketToSyncPayload(calcState));
      const t = tickets.find(t=>t.id===newTicket.id);
      if(t){ t.synced = ok; saveTickets(); renderTicketsScreen(); }
    }
    savedTicketRef = tickets.find(t=>t.id===newTicket.id);
  }
  if(savedTicketRef) backupTicketToTelegram(savedTicketRef); // NEW: фонова резервна копія тексту/фото в Telegram (не блокує збереження)

  currentTicketDate = calcState.date;
  clearDraft();
  resetCalcForm();
  switchTab('tickets');
  renderTicketsScreen();
}

/* ---------- 6. Екран «Зміни» ---------- */
function renderShiftsScreen(){
  document.getElementById('currentShiftDateDisplay').textContent = currentShiftDate;
  renderCoworkerGrid();
  renderStatsMonthLabel();
  renderYearChart();
  renderShiftStats();
  renderShiftHistory();
}

function renderCoworkerGrid(){
  const wrap = document.getElementById('coworkerGrid');
  wrap.innerHTML = settings.coworkers.map(cw=>{
    const active = coworkerSelection.has(cw);
    return `<button type="button" class="chip ${active?'active':''}" data-cw="${escapeHtml(cw)}">${escapeHtml(cw)}</button>`;
  }).join('');
}

function renderStatsMonthLabel(){
  document.getElementById('statsMonthLabel').textContent = `${MONTH_NAMES[statsViewDate.getMonth()]} ${statsViewDate.getFullYear()}`;
}

/* Графік годин по місяцях обраного року — щоб одразу бачити, в якому місяці скільки відпрацьовано */
function renderYearChart(){
  const year = statsViewDate.getFullYear();
  const hoursByMonth = Array(12).fill(0);
  shifts.forEach(s=>{
    const d = parseDate(s.date);
    if(d.getFullYear()===year) hoursByMonth[d.getMonth()] += Number(s.hours)||0;
  });
  const max = Math.max(1, ...hoursByMonth);
  document.getElementById('yearChart').innerHTML = hoursByMonth.map((h,i)=>{
    const pct = Math.max(2, Math.round((h/max)*100));
    const active = i===statsViewDate.getMonth();
    return `<button type="button" class="ychart-bar-wrap" data-month="${i}" title="${MONTH_NAMES[i]}: ${h.toFixed(1)} год">
      <span class="ychart-val">${h>0 ? h.toFixed(0) : ''}</span>
      <span class="ychart-bar ${active?'active':''}" style="height:${pct}%"></span>
      <span class="ychart-lbl">${MONTH_NAMES[i].slice(0,3)}</span>
    </button>`;
  }).join('');
}

function renderShiftStats(){
  const monthShifts = shifts.filter(s=>isSameMonth(s.date, statsViewDate));
  const totalHours = monthShifts.reduce((s,x)=>s+(Number(x.hours)||0),0);
  const count = monthShifts.length;
  const avg = count ? (totalHours/count) : 0;
  const salary = totalHours * (Number(settings.hourlyRate)||0);
  document.getElementById('shiftStatGrid').innerHTML = `
    <div class="stat-box"><div class="s-val tabular">${count}</div><div class="s-lbl">Змін</div></div>
    <div class="stat-box"><div class="s-val tabular">${totalHours.toFixed(1)}</div><div class="s-lbl">Годин</div></div>
    <div class="stat-box"><div class="s-val tabular">${avg.toFixed(1)}</div><div class="s-lbl">Середнє/зміну</div></div>
    <div class="stat-box"><div class="s-val tabular">${fmtMoney(salary)}</div><div class="s-lbl">Зарплата</div></div>`;
}

function renderShiftHistory(){
  const monthShifts = shifts.filter(s=>isSameMonth(s.date, statsViewDate))
    .sort((a,b)=> parseDate(b.date) - parseDate(a.date) || b.id - a.id);
  const card = document.getElementById('shiftHistoryCard');
  if(monthShifts.length===0){
    card.innerHTML = `<div class="empty-state"><div class="es-icon">🕒</div>Змін у цьому місяці ще немає</div>`;
    return;
  }
  card.innerHTML = monthShifts.map(s=>`
    <div class="shift-row" data-id="${s.id}">
      <div>
        <div class="sr-main">${escapeHtml(s.date)} · ${s.hours} год</div>
        <div class="sr-sub">${escapeHtml(s.coworker)}</div>
      </div>
      <button type="button" class="delete-shift-btn" data-id="${s.id}">✕</button>
    </div>`).join('');
}

function addShift(){
  const hours = Number(document.getElementById('shiftHours').value);
  if(!hours || hours<=0){ showToast('Вкажіть кількість годин'); return; }
  const coworker = coworkerSelection.size ? [...coworkerSelection].join(', ') : 'Сам';
  const shift = {id: Date.now(), date: currentShiftDate, hours, coworker};
  shifts.push(shift);
  saveShifts();
  syncShiftPostGet('add', shiftToSyncPayload(shift));
  document.getElementById('shiftHours').value = '';
  coworkerSelection = new Set(['Сам']);
  statsViewDate = parseDate(currentShiftDate);
  renderShiftsScreen();
  showToast('Зміну додано');
}

function deleteShift(id){
  if(!confirm('Видалити цю зміну?')) return;
  shifts = shifts.filter(s=>String(s.id)!==String(id)); // NEW: id зміни — рядок (UUID), Number() ламав порівняння
  saveShifts();
  syncShiftPostGet('delete', {id});
  renderShiftsScreen();
  showToast('Зміну видалено');
}

/* Текстовий звіт за обраний місяць — для копіювання/відправки у Viber, Telegram тощо */
function buildShiftMonthReport(){
  const monthShifts = shifts.filter(s=>isSameMonth(s.date, statsViewDate))
    .sort((a,b)=> parseDate(a.date)-parseDate(b.date));
  const totalHours = monthShifts.reduce((s,x)=>s+(Number(x.hours)||0),0);
  const lines = [];
  lines.push(`🕒 ЗМІНИ — ${MONTH_NAMES[statsViewDate.getMonth()].toUpperCase()} ${statsViewDate.getFullYear()}`);
  lines.push('------------------');
  if(monthShifts.length===0){
    lines.push('Змін немає');
  } else {
    monthShifts.forEach(s=> lines.push(`${s.date} — ${s.hours} год — ${s.coworker}`));
  }
  lines.push('------------------');
  lines.push(`📅 Змін: ${monthShifts.length}`);
  lines.push(`⏱️ Годин: ${totalHours.toFixed(1)}`);
  return lines.join('\n');
}

async function shareMonthShifts(){
  const text = buildShiftMonthReport();
  try{
    if(navigator.share){ await navigator.share({title:'Зміни за місяць', text}); return; }
    throw new Error('share-unsupported');
  }catch(e){
    if(e.name==='AbortError') return;
    try{ await navigator.clipboard.writeText(text); showToast('Звіт за місяць скопійовано в буфер обміну'); }
    catch(e2){ showToast('Не вдалося скопіювати звіт'); }
  }
}
// NEW: надіслати звіт по змінах у Telegram собі особисто — за будь-який місяць,
// який зараз обрано на екрані "Зміни" (гортаєте стрілками ‹ › і тиснете, коли треба)
async function sendShiftsReportToTelegram(){
  const chatId = (settings.tgMyChatId||'').trim();
  if(!settings.tgBotToken || !chatId){ showToast('Спочатку заповніть токен і ваш особистий Chat ID в Налаштуваннях'); return; }
  const text = buildShiftMonthReport();
  showToast('Надсилаю звіт по змінах…');
  const res = await sendToTelegramChat(chatId, text, null, null);
  showToast(res.ok ? '✅ Звіт надіслано!' : `Не вдалося надіслати: ${res.reason}`);
}

/* ---------- 7. Екран «Налаштування» ---------- */
function renderSettingsScreen(){
  document.getElementById('hourlyRateInput').value = settings.hourlyRate;
  document.getElementById('defaultConnectFeeInput').value = settings.defaultConnectFee;
  document.getElementById('defaultTariffInput').value = settings.defaultTariff;
  renderDeletedTicketsList();
  document.getElementById('defaultRepairCallFeeInput').value = settings.defaultRepairCallFee;
  document.getElementById('themeSwitch').checked = settings.theme==='dark';
  document.getElementById('scriptUrlInput').value = settings.scriptUrl || '';
  document.getElementById('tgBotTokenInput').value = settings.tgBotToken || '';
  document.getElementById('tgBackupChatIdInput').value = settings.tgBackupChatId || '';
  document.getElementById('tgDisp1NameInput').value = (settings.tgDispatchers && settings.tgDispatchers[0] && settings.tgDispatchers[0].name) || '';
  document.getElementById('tgDisp1ChatIdInput').value = (settings.tgDispatchers && settings.tgDispatchers[0] && settings.tgDispatchers[0].chatId) || '';
  document.getElementById('tgDisp2NameInput').value = (settings.tgDispatchers && settings.tgDispatchers[1] && settings.tgDispatchers[1].name) || '';
  document.getElementById('tgDisp2ChatIdInput').value = (settings.tgDispatchers && settings.tgDispatchers[1] && settings.tgDispatchers[1].chatId) || '';
  document.getElementById('tgMyChatIdInput').value = settings.tgMyChatId || '';
  document.getElementById('syncSecretInput').value = settings.syncSecret || '';
  document.getElementById('shiftsScriptUrlInput').value = settings.shiftsScriptUrl || '';
  document.getElementById('vizitkaUrlInput').value = settings.vizitkaUrl || '';
  document.getElementById('dogovorUrlInput').value = settings.dogovorUrl || '';
  renderTagMgmtList();
  renderCityMgmtList();
  renderCwMgmtList();
  renderMatMgmtList();
  renderWorkMgmtList();
  renderCableMgmtList();
  renderMasterMgmtList();
  renderDailyBackupList();
}

function renderTagMgmtList(){
  document.getElementById('tagMgmtList').innerHTML = settings.tags.map(tag=>
    `<span class="chip">${escapeHtml(tag)} <span class="chip-x remove-tag-btn" data-tag="${escapeHtml(tag)}">✕</span></span>`
  ).join('') || '<span style="color:var(--text-faint); font-size:13px;">Тегів немає</span>';
}
function renderCityMgmtList(){
  document.getElementById('cityMgmtList').innerHTML = (settings.cities||[]).map(city=>
    `<span class="chip">${escapeHtml(city)} <span class="chip-x remove-city-btn" data-city="${escapeHtml(city)}">✕</span></span>`
  ).join('') || '<span style="color:var(--text-faint); font-size:13px;">Міст ще немає</span>';
  renderCityDatalist();
  renderStreetMgmtCitySelect(); // NEW: список міст для керування вулицями завжди в курсі актуальних міст
  renderStreetMgmtList();
}
/* Підказки міст у полі "Місто" калькулятора (через <datalist> — рідна підтримка
   браузера: і підказки за першими буквами, і вільний ввід одночасно) */
function renderCityDatalist(){
  const dl = document.getElementById('cityDatalist');
  if(!dl) return;
  dl.innerHTML = (settings.cities||[]).map(c=>`<option value="${escapeHtml(c)}"></option>`).join('');
}
// NEW: підказки вулиць у полі "Вулиця" — окремий список для кожного міста
// (щоб «Шевченка» в Дніпрі не підмішувалась до «Шевченка» в Кам'янському),
// оновлюється щоразу при зміні поля "Місто"
function renderStreetDatalist(city){
  const dl = document.getElementById('streetDatalist');
  if(!dl) return;
  const list = (settings.streets && settings.streets[city]) || [];
  dl.innerHTML = list.map(s=>`<option value="${escapeHtml(s)}"></option>`).join('');
}
/* NEW: керування вулицями в Налаштуваннях — окремий список для кожного міста,
   можна дописати вручну або видалити помилково внесене */
let streetMgmtSelectedCity = '';
function renderStreetMgmtCitySelect(){
  const sel = document.getElementById('streetMgmtCitySelect');
  if(!sel) return;
  const cities = (settings.cities||[]).slice().sort((a,b)=>a.localeCompare(b,'uk'));
  if(!cities.includes(streetMgmtSelectedCity)) streetMgmtSelectedCity = cities[0] || '';
  sel.innerHTML = cities.length
    ? cities.map(c=>`<option value="${escapeHtml(c)}" ${c===streetMgmtSelectedCity?'selected':''}>${escapeHtml(c)}</option>`).join('')
    : `<option value="">— спершу додайте місто —</option>`;
}
function renderStreetMgmtList(){
  const wrap = document.getElementById('streetMgmtList');
  if(!wrap) return;
  const city = streetMgmtSelectedCity;
  const streets = (city && settings.streets && settings.streets[city]) || [];
  wrap.innerHTML = streets.length
    ? streets.map(s=>`<span class="chip">${escapeHtml(s)} <span class="chip-x remove-street-btn" data-street="${escapeHtml(s)}">✕</span></span>`).join('')
    : `<span style="color:var(--text-faint); font-size:13px;">${city ? 'Вулиць ще немає' : 'Спершу додайте місто вище'}</span>`;
}
// NEW: одноразово підтягує місто/вулицю з уже наявних заявок (з будь-яких, де ці поля
// фактично заповнені — включно з заявками з таблиць, якщо для них дозаповнили адресу вручну)
function backfillAddressDictionariesFromTickets(){
  if(!settings.cities) settings.cities = [];
  if(!settings.streets) settings.streets = {};
  let addedCities = 0, addedStreets = 0;
  tickets.forEach(t=>{
    const city = (t.city||'').trim();
    const street = (t.street||'').trim();
    if(!city) return;
    if(!settings.cities.includes(city)){ settings.cities.push(city); addedCities++; }
    if(street){
      if(!settings.streets[city]) settings.streets[city] = [];
      if(!settings.streets[city].includes(street)){ settings.streets[city].push(street); addedStreets++; }
    }
  });
  saveSettings();
  renderCityMgmtList();
  showToast(addedCities || addedStreets ? `Додано міст: ${addedCities}, вулиць: ${addedStreets}` : 'Нічого нового не знайдено — довідники вже актуальні');
}
function renderCwMgmtList(){
  document.getElementById('cwMgmtList').innerHTML = settings.coworkers.map(cw=>
    `<span class="chip">${escapeHtml(cw)} <span class="chip-x remove-cw-btn" data-cw="${escapeHtml(cw)}">✕</span></span>`
  ).join('') || '<span style="color:var(--text-faint); font-size:13px;">Список порожній</span>';
}
function renderMasterMgmtList(){
  const wrap = document.getElementById('masterMgmtList');
  if(!settings.masters || settings.masters.length===0){
    wrap.innerHTML = '<span style="color:var(--text-faint); font-size:13px;">Майстрів немає</span>'; return;
  }
  wrap.innerHTML = settings.masters.map((m,i)=>`
    <div class="row" style="gap:8px; align-items:center;">
      <input type="text" class="master-name-inp" data-idx="${i}" value="${escapeHtml(m.name)}" placeholder="Ім'я" style="flex:2;">
      <input type="text" class="master-letter-inp" data-idx="${i}" value="${escapeHtml(m.letter)}" placeholder="Літера" maxlength="3" style="flex:1; text-transform:uppercase;">
      <button type="button" class="btn btn-icon btn-sm remove-master-btn" data-idx="${i}">✕</button>
    </div>`).join('');
}
function renderMatMgmtList(){
  const wrap = document.getElementById('matMgmtList');
  if(!settings.materials || settings.materials.length===0){
    wrap.innerHTML = '<span style="color:var(--text-faint); font-size:13px;">Матеріалів немає</span>'; return;
  }
  wrap.innerHTML = settings.materials.map((m,i)=>`
    <div class="row" style="gap:8px; align-items:center;">
      <input type="text" class="mat-label-inp" data-idx="${i}" value="${escapeHtml(m.label)}" style="flex:2;">
      <input type="number" class="mat-price-inp" data-idx="${i}" value="${m.price}" min="0" style="flex:1;">
      <button type="button" class="btn btn-icon btn-sm remove-mat-btn" data-idx="${i}">✕</button>
    </div>`).join('');
}
function renderWorkMgmtList(){
  const wrap = document.getElementById('workMgmtList');
  if(!settings.workTypes || settings.workTypes.length===0){
    wrap.innerHTML = '<span style="color:var(--text-faint); font-size:13px;">Робіт немає</span>'; return;
  }
  wrap.innerHTML = settings.workTypes.map((w,i)=>`
    <div class="row" style="gap:8px; align-items:center;">
      <input type="text" class="work-label-inp" data-idx="${i}" value="${escapeHtml(w.label)}" style="flex:2;">
      <input type="number" class="work-price-inp" data-idx="${i}" value="${w.price}" min="0" style="flex:1;">
      <button type="button" class="btn btn-icon btn-sm remove-work-btn" data-idx="${i}">✕</button>
    </div>`).join('');
}
// NEW: керування списком типів кабелів (аналогічно матеріалам/роботам)
function renderCableMgmtList(){
  const wrap = document.getElementById('cableMgmtList');
  if(!settings.cableTypes || settings.cableTypes.length===0){
    wrap.innerHTML = '<span style="color:var(--text-faint); font-size:13px;">Типів кабелю немає</span>'; return;
  }
  wrap.innerHTML = settings.cableTypes.map((c,i)=>`
    <div class="row" style="gap:8px; align-items:center;">
      <input type="text" class="cable-label-inp" data-idx="${i}" value="${escapeHtml(c.label)}" style="flex:2;">
      <input type="number" class="cable-price-inp" data-idx="${i}" value="${c.pricePerMeter}" min="0" style="flex:1;">
      <button type="button" class="btn btn-icon btn-sm remove-cable-btn" data-idx="${i}">✕</button>
    </div>`).join('');
}

function applyTheme(){
  document.documentElement.setAttribute('data-theme', settings.theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', settings.theme==='dark' ? '#14181C' : '#EEF1F3');
}

/* ---- Повний бекап у JSON (для перенесення на інший телефон або власне
   збереження на випадок втрати кешу/даних) ---- */
function exportJsonBackup(){
  const payload = {
    app: 'master-tracker',
    exportedAt: new Date().toISOString(),
    tickets,
    shifts
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `master-tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Файл бекапу завантажено');
}

async function handleJsonImportFile(file){
  if(!file) return;
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    const hasTickets = Array.isArray(data.tickets);
    const hasShifts = Array.isArray(data.shifts);
    if(!hasTickets && !hasShifts){ showToast('Файл не схожий на бекап цього застосунку'); return; }

    const parts = [];
    if(hasTickets) parts.push(`заявки (${data.tickets.length})`);
    if(hasShifts) parts.push(`зміни (${data.shifts.length})`);
    if(!confirm(`Імпортувати ${parts.join(' і ')}? Це ЗАМІНИТЬ поточні локальні дані відповідного типу на цьому телефоні.`)) return;

    if(hasTickets){
      // NEW: доповнюємо кожну заявку значеннями за замовчуванням — якщо бекап
      // зроблено старішою версією застосунку і в ньому бракує якихось полів
      tickets = data.tickets.map(t=>Object.assign(blankTicketObject(), t));
      saveTickets();
    }
    if(hasShifts){
      shifts = data.shifts;
      saveShifts();
    }
    renderTicketsScreen();
    renderShiftsScreen();
    showToast('Дані з бекапу імпортовано');
  }catch(err){
    console.error('Помилка імпорту JSON:', err);
    showToast('Не вдалося прочитати файл — перевірте, що це коректний JSON-бекап');
  }
}

/* ---- Експорт для NotebookLM ---- */
function openExportModal(){
  openModal('Експорт для NotebookLM', `
    <div class="field">
      <label>Формат файлу</label>
      <select id="exportFormat"><option value="txt">TXT</option><option value="md">Markdown (.md)</option></select>
    </div>
    <div class="settings-row"><span class="sr-title">Включити статистику</span>
      <input type="checkbox" id="exportStats" checked style="width:20px;height:20px;"></div>
    <div class="settings-row"><span class="sr-title">Приховати телефони</span>
      <input type="checkbox" id="exportHidePhones" style="width:20px;height:20px;"></div>
    <button class="btn btn-accent btn-block" id="exportDownloadBtn" style="margin-top:14px;">Завантажити файл</button>
  `, {onOpen:(body)=>{
    document.getElementById('exportDownloadBtn').onclick = ()=>{
      const format = document.getElementById('exportFormat').value;
      const includeStats = document.getElementById('exportStats').checked;
      const hidePhones = document.getElementById('exportHidePhones').checked;
      downloadExport(format, includeStats, hidePhones);
      closeModal();
    };
  }});
}

function downloadExport(format, includeStats, hidePhones){
  const md = format==='md';
  let out = md ? `# Реєстр заявок — Майстер-Трекер\n\n` : `РЕЄСТР ЗАЯВОК — МАЙСТЕР-ТРЕКЕР\n\n`;
  const sorted = [...tickets].sort((a,b)=> parseDate(a.date)-parseDate(b.date) || (a.time||'').localeCompare(b.time||''));
  sorted.forEach(t=>{
    let content = t.content || '';
    if(hidePhones) content = content.replace(/(\+?\d[\d\s\-\(\)]{6,}\d)/g, '[прихований номер]');
    out += md ? `## ${t.date} ${t.time} — ${t.type}\n\n${content}\n\n` : `=== ${t.date} ${t.time} — ${t.type} ===\n${content}\n\n`;
  });
  if(includeStats){
    const totalSum = tickets.reduce((s,t)=>s+(Number(t.sum)||0),0);
    const statsText = `Усього заявок: ${tickets.length}\nЗагальна сума: ${fmtMoney(totalSum)}\nУсього змін: ${shifts.length}\n`;
    out += md ? `## Статистика\n\n${statsText}` : `=== СТАТИСТИКА ===\n${statsText}`;
  }
  const blob = new Blob([out], {type:'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `master-tracker-export.${md?'md':'txt'}`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Файл експорту завантажено');
}

/* ---- Масовий імпорт ---- */
function openImportModal(){
  openModal('Масовий імпорт заявок', `
    <div class="field">
      <label>Вставте текст заявок (кожна заявка починається з рядка дати ДД.ММ.РРРР)</label>
      <textarea id="importTextarea" style="min-height:160px;"></textarea>
    </div>
    <button class="btn btn-accent btn-block" id="importRunBtn">Імпортувати</button>
  `, {onOpen:()=>{
    document.getElementById('importRunBtn').onclick = ()=>{
      const text = document.getElementById('importTextarea').value;
      const count = runBulkImport(text);
      closeModal();
      showToast(`Імпортовано заявок: ${count}`);
      renderTicketsScreen();
    };
  }});
}


async function dedupTickets(){
  if(!confirm('Знайти заявки з однаковою датою, часом і текстом та залишити тільки одну копію кожної?')) return;
  backupLocalData();
  const seen = new Map();
  const toRemove = new Set();
  tickets.forEach(t=>{
    const key = `${t.date}|${t.time}|${t.content}`;
    if(seen.has(key)){
      // залишаємо запис з меншим id (він, як правило, старіший/оригінальний),
      // а новіший дублікат прибираємо
      const existing = seen.get(key);
      const existingIdNum = Number(existing.id) || 0;
      const currentIdNum = Number(t.id) || 0;
      if(currentIdNum < existingIdNum){
        toRemove.add(existing.id);
        seen.set(key, t);
      } else {
        toRemove.add(t.id);
      }
    } else {
      seen.set(key, t);
    }
  });
  if(toRemove.size === 0){ showToast('Дублікатів не знайдено'); return; }
  tickets = tickets.filter(t=>!toRemove.has(t.id));
  saveTickets();
  renderTicketsScreen();
  showToast(`Видалено дублікатів: ${toRemove.size}. Синхронізація з хмарою...`);
  if(getScriptUrl()){
    const ok = await syncTicketPost('syncAllTickets', {tickets: tickets.map(ticketToSyncPayload)});
    tickets.forEach(t=>{ t.synced = ok; });
    saveTickets();
    renderTicketsScreen();
    showToast(ok ? 'Синхронізацію завершено' : 'Синхронізація не вдалась — перевірте інтернет');
  }
}

async function shareCurrentTicket(){
  // Працює навіть якщо заявку ще не збережено — рахуємо суму й текст
  // прямо з поточної форми, як для копіювання, а не з уже збереженого списку.
  syncFormToState();
  const text = getCurrentTicketText(); // NEW: враховує raw-режим
  if(!text){ showToast('Немає що надсилати — заповніть заявку'); return; }
  try{
    const photoData = calcState.photo ? await resolvePhotoAsync(calcState.photo, calcState.tgPhotoFileId) : null;
    if(photoData){
      const res = await fetch(photoData);
      const blob = await res.blob();
      const file = new File([blob], 'foto.jpg', {type:'image/jpeg'});
      if(navigator.canShare && navigator.canShare({files:[file], text})){
        await navigator.share({title:'Заявка', text, files:[file]});
        return;
      }
    }
    if(navigator.share){
      await navigator.share({title:'Заявка', text});
      return;
    }
    throw new Error('share-unsupported');
  }catch(e){
    if(e.name==='AbortError') return; // користувач сам закрив меню «Поділитися»
    try{
      await navigator.clipboard.writeText(text);
      showToast('Поділитися недоступне — текст скопійовано');
    }catch(_){
      showToast('Не вдалося поділитися заявкою');
    }
  }
}

async function repairCorruptedTickets(){
  if(!confirm('Знайти та полагодити заявки з битими id/датою (залишились від старих тестів синхронізації)? Текст заявок не зміниться.')) return;
  backupLocalData();
  // Розпізнаємо зіпсовані записи: id виглядає як рядок з toString() дати
  // JS (напр. "Fri Jul 10 2026 00:00:00 GMT+0300 (...)"). Такий рядок
  // МОЖНА розпарсити назад через new Date(...) — і саме так ми
  // відновлюємо справжню дату заявки. Якщо в полі date лежить схожий
  // «зіпсований» рядок з роком 1899 — це залишок часу (HH:MM), який
  // теж можна витягнути.
  const looksLikeDateToString = (v) => typeof v === 'string' && /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4}/.test(v);
  let repaired = 0, unfixable = 0;
  let counter = 0;
  tickets.forEach(t=>{
    const idBroken = looksLikeDateToString(t.id);
    const dateBroken = looksLikeDateToString(t.date) || !/^\d{2}\.\d{2}\.\d{4}$/.test(t.date||'');
    const timeBroken = !/^\d{2}:\d{2}$/.test(t.time||'');
    if(!idBroken && !dateBroken && !timeBroken) return; // запис в нормі

    let newDate = null, newTime = null;
    if(idBroken){
      const d = new Date(t.id);
      if(!isNaN(d.getTime())) newDate = formatDate(d);
    }
    if(looksLikeDateToString(t.date)){
      const d = new Date(t.date);
      if(!isNaN(d.getTime())) newTime = formatTime(d);
    }
    if(newDate || newTime || idBroken){
      counter++;
      t.id = Date.now() + counter; // новий унікальний числовий id
      if(newDate) t.date = newDate;
      else if(dateBroken) t.date = formatDate(new Date()); // не змогли відновити — ставимо сьогодні
      if(newTime) t.time = newTime;
      else if(timeBroken) t.time = formatTime(new Date());
      repaired++;
    } else {
      unfixable++;
    }
  });
  saveTickets();
  renderTicketsScreen();
  showToast(`Полагоджено: ${repaired}${unfixable ? `, не вдалось: ${unfixable}` : ''}. Синхронізація з хмарою...`);
  if(getScriptUrl()){
    const ok = await syncTicketPost('syncAllTickets', {tickets: tickets.map(ticketToSyncPayload)});
    tickets.forEach(t=>{ t.synced = ok; });
    saveTickets();
    renderTicketsScreen();
    showToast(ok ? 'Синхронізацію завершено' : 'Синхронізація не вдалась — перевірте інтернет');
  }
}

function runBulkImport(text){
  if(!text.trim()) return 0;
  const dateRe = /^(\d{2}\.\d{2}\.\d{4})/;
  const lines = text.split('\n');
  const blocks = [];
  let current = null;
  lines.forEach(line=>{
    if(dateRe.test(line.trim())){
      if(current) blocks.push(current);
      current = {date: line.trim().match(dateRe)[1], lines:[line.trim()]};
    } else if(current){
      current.lines.push(line);
    }
  });
  if(current) blocks.push(current);
  let imported = 0;
  blocks.forEach(b=>{
    const content = b.lines.join('\n').trim();
    if(!content) return;
    const sumMatch = content.match(/ВСЬОГО:\s*([\d\s]+)/i) || content.match(/Сума:\s*([\d\s]+)/i);
    const sum = sumMatch ? Number(sumMatch[1].replace(/\s/g,'')) : 0;
    const timeMatch = content.match(/(\d{2}:\d{2})/);
    const t = blankTicketObject();
    t.id = Date.now() + imported;
    t.date = b.date;
    t.time = timeMatch ? timeMatch[1] : '';
    t.content = content;
    t.sum = sum;
    t.type = 'Імпорт';
    tickets.push(t);
    syncPost('addTicket', ticketToSyncPayload(t));
    imported++;
  });
  saveTickets();
  return imported;
}

/* ---- Звіти ---- */
function openReportModal(){
  openModal('Звіти', `
    <div class="row wrap" style="margin-bottom:12px;">
      <button class="btn btn-sm" data-rep="day">За день</button>
      <button class="btn btn-sm" data-rep="week">За тиждень</button>
      <button class="btn btn-sm" data-rep="month">За місяць</button>
      <button class="btn btn-sm" data-rep="all">Всі</button>
    </div>
    <label class="row" style="align-items:center; gap:8px; margin-bottom:10px; font-size:13px; color:var(--text-dim);">
      <input type="checkbox" id="reportFullToggle"> Повний текст кожної заявки (а не короткий рядок)
    </label>
    <div id="reportOutput"></div>
  `, {onOpen:(body)=>{
    let currentRange = 'day';
    body.querySelectorAll('[data-rep]').forEach(btn=>{
      btn.onclick = ()=>{ currentRange = btn.dataset.rep; renderReport(currentRange); };
    });
    document.getElementById('reportFullToggle').addEventListener('change', ()=> renderReport(currentRange));
    renderReport('day');
  }});
}

/* Текст всіх заявок поточного дня (того, що зараз обраний у навігації по
   датах) - для кнопок "Копіювати за день"/"Надіслати за день" одразу під
   списком заявок. */
function buildDayReportText(){
  const list = ticketsForDate(currentTicketDate)
    .slice()
    .sort((a,b)=> (a.time||'').localeCompare(b.time||''));
  const total = list.reduce((s,t)=>s+(Number(t.sum)||0),0);
  let text = `ЗАЯВКИ ЗА ${currentTicketDate}\nВсього: ${list.length}, сума: ${fmtMoney(total)}\n\n`;
  list.forEach(t=>{
    text += `${t.time || ''} — ${t.type || 'Заявка'}\n${t.content || ''}\n\n`;
  });
  return text.trim();
}

function renderReport(range){
  const ref = parseDate(currentTicketDate);
  let list;
  let title;
  if(range==='day'){
    list = ticketsForDate(currentTicketDate); title = `за ${currentTicketDate}`;
  } else if(range==='week'){
    const start = new Date(ref); start.setDate(start.getDate() - 6);
    list = tickets.filter(t=>{ const d=parseDate(t.date); return d>=start && d<=ref; }); title = 'за останні 7 днів';
  } else if(range==='month'){
    list = tickets.filter(t=>isSameMonth(t.date, ref)); title = 'за поточний місяць';
  } else {
    list = [...tickets]; title = 'за весь час';
  }
  list = list.sort((a,b)=> parseDate(a.date)-parseDate(b.date) || (a.time||'').localeCompare(b.time||''));
  const total = list.reduce((s,t)=>s+(Number(t.sum)||0),0);
  const full = document.getElementById('reportFullToggle')?.checked;
  let text = `ЗВІТ ${title.toUpperCase()}\nЗаявок: ${list.length}  Сума: ${fmtMoney(total)}\n\n`;
  if(full){
    list.forEach(t=> text += `${t.date} ${t.time}\n${t.content || (t.type+' — '+fmtMoney(t.sum))}\n\n`);
  } else {
    list.forEach(t=> text += `${t.date} ${t.time} — ${t.type} — ${fmtMoney(t.sum)}\n`);
  }
  const out = document.getElementById('reportOutput');
  out.innerHTML = `<div class="report-text">${escapeHtml(text)}</div>
    <div class="row wrap" style="margin-top:10px;">
      <button class="btn btn-accent" id="copyReportBtn" style="flex:1 1 45%;">📄 Копіювати</button>
      <button class="btn" id="shareReportBtn" style="flex:1 1 45%;">📤 Надіслати</button>
    </div>`;
  document.getElementById('copyReportBtn').onclick = async ()=>{
    try{ await navigator.clipboard.writeText(text); showToast('Звіт скопійовано'); }
    catch(e){ showToast('Не вдалося скопіювати'); }
  };
  document.getElementById('shareReportBtn').onclick = async ()=>{
    try{
      if(navigator.share){ await navigator.share({title:'Звіт', text}); }
      else { await navigator.clipboard.writeText(text); showToast('Поділитися недоступне — текст скопійовано'); }
    }catch(e){ if(e.name!=='AbortError') showToast('Не вдалося надіслати'); }
  };
}

/* ---- Код Apps Script (для довідки користувачу) ---- */
const APPS_SCRIPT_CODE = `var TICKET_HEADERS = ['id','date','time','content','sum','tags','нотатки_майстра'];
var SHIFT_HEADERS = ['id','date','hours','coworker'];

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var action = data.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = {status: 'ok'};

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status:'error', message:'Busy, try again'}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    if (action === 'addTicket') {
      addTicketRow(ss, data);
    } else if (action === 'deleteTicket') {
      deleteRowById(getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS), data.id);
    } else if (action === 'addShift') {
      addShiftRow(ss, data);
    } else if (action === 'deleteShift') {
      deleteRowById(getOrCreateSheet(ss, 'Зміни', SHIFT_HEADERS), data.id);
    } else if (action === 'syncAll') {
      syncAllData(ss, data.tickets, data.shifts);
    } else if (action === 'syncAllTickets') {
      writeAllTickets(getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS), data.tickets || []);
    } else if (action === 'syncAllShifts') {
      writeAllShifts(getOrCreateSheet(ss, 'Зміни', SHIFT_HEADERS), data.shifts || []);
    } else if (action === 'clearAll') {
      syncAllData(ss, [], []);
    }
  } catch (err) {
    result = {status: 'error', message: String(err)};
  } finally {
    lock.releaseLock();
  }

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1000, 3).setNumberFormat('@');
    if (name === 'Заявки') {
      sheet.getRange(1, 6, 1000, 2).setNumberFormat('@'); // tags + нотатки_майстра
    }
  }
  if (name === 'Заявки') {
    // перенос тексту в колонці "content" (D) — довгий опис буде повністю
    // видно в клітинці, а не обрізатись. Виконується щоразу (не лише при
    // створенні листа), щоб застосуватись і до вже існуючої таблиці.
    sheet.getRange(1, 4, Math.max(sheet.getMaxRows(), 1000), 1).setWrap(true);
  }
  return sheet;
}

function writeTicketRow(sheet, rowIndex, t) {
  var row = [t.id, t.date, t.time, t.content, t.sum, (t.tags || []).join(', '), t.backupNote || ''];
  var range = sheet.getRange(rowIndex, 1, 1, row.length);
  sheet.getRange(rowIndex, 1, 1, 1).setNumberFormat('@'); // id
  sheet.getRange(rowIndex, 2, 1, 1).setNumberFormat('@'); // date
  sheet.getRange(rowIndex, 3, 1, 1).setNumberFormat('@'); // time
  sheet.getRange(rowIndex, 6, 1, 1).setNumberFormat('@'); // tags
  sheet.getRange(rowIndex, 7, 1, 1).setNumberFormat('@'); // нотатки_майстра
  sheet.getRange(rowIndex, 5, 1, 1).setNumberFormat('0.##'); // sum
  range.setValues([row]);
  // перенос тексту + автопідбір висоти рядка під довгий опис
  sheet.getRange(rowIndex, 4, 1, 1).setWrap(true);
  sheet.setRowHeightsAuto(rowIndex, 1);
}

function addTicketRow(ss, t) {
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);

  var last = sheet.getLastRow();
  var existingRows = [];
  if (last > 1) {
    existingRows = sheet.getRange(2, 1, last - 1, TICKET_HEADERS.length).getValues();
    var alreadyExists = existingRows.some(function(r){ return String(r[0]) === String(t.id); });
    if (alreadyExists) return;
  }

  var newRow = [t.id, t.date, t.time, t.content, t.sum, (t.tags || []).join(', '), t.backupNote || ''];
  existingRows.push(newRow);

  // Сортуємо в пам'яті й переписуємо весь блок даних одним разом — це
  // те саме, що вже надійно робить ручний запуск sortExistingTicketsNow.
  // Раніше тут було "вставити рядок і одразу пересортувати на місці"
  // (insertRowBefore + сортування), і це раз у раз "губило" щойно
  // вставлений рядок — сортування ніби виконувалось по старому стану
  // листа. Такий спосіб (прочитати все → додати → відсортувати →
  // переписати) цієї проблеми не має.
  existingRows.sort(function(a, b) {
    return rowDateKey(b) - rowDateKey(a);
  });

  if (last > 1) {
    sheet.getRange(2, 1, last - 1, TICKET_HEADERS.length).clearContent();
  }
  var range = sheet.getRange(2, 1, existingRows.length, TICKET_HEADERS.length);
  range.setNumberFormat('@');
  range.setValues(existingRows);
  sheet.getRange(2, 5, existingRows.length, 1).setNumberFormat('0.##'); // sum
  sheet.getRange(2, 4, existingRows.length, 1).setWrap(true); // content — перенос тексту
  sheet.setRowHeightsAuto(2, existingRows.length);
}

// пересортовує всі рядки листа "Заявки" за датою і часом — від
// найновішої зверху до найстарішої знизу, незалежно від того, у якому
// порядку вони туди потрапили раніше.
function sortTicketsSheet(sheet) {
  var last = sheet.getLastRow();
  if (last <= 2) return; // 0 або 1 заявка — сортувати нічого

  var range = sheet.getRange(2, 1, last - 1, TICKET_HEADERS.length);
  var rows = range.getValues();

  rows.sort(function(a, b) {
    return rowDateKey(b) - rowDateKey(a);
  });

  range.setValues(rows);
}

function rowDateKey(row) {
  var d = parseDdMmYyyy(row[1]); // колонка B — дата
  if (!d) return 0;
  return d.getTime() + timeToMs(row[2]); // колонка C — час
}

// одноразова ручна функція — запустіть її один раз з редактора Apps
// Script (кнопка ▶ Запустити, обравши "sortExistingTicketsNow" у списку
// функцій зверху), щоб одразу впорядкувати вже наявні заявки за датою.
// Далі порядок буде підтримуватись автоматично при кожному новому додаванні.
function sortExistingTicketsNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  sortTicketsSheet(sheet);
}


// переводить "ГГ:ХХ" у мілісекунди для порівняння в межах однієї доби
function timeToMs(t) {
  if (t instanceof Date) {
    return (t.getHours() * 60 + t.getMinutes()) * 60000;
  }
  var m = String(t || '').match(/^(\\d{1,2}):(\\d{2})/);
  if (!m) return 0;
  return (Number(m[1]) * 60 + Number(m[2])) * 60000;
}

function parseDdMmYyyy(s) {
  // Деякі клітинки Google Таблиця могла зберегти як справжню дату (тип
  // Date), а не текст — навіть якщо колонці задано текстовий формат: формат
  // не перетворює заднім числом уже наявне значення. Якщо це не врахувати,
  // такий рядок не парситься, отримує "нульовий" ключ сортування і
  // провалюється в самий низ (чи випадково опиняється не на своєму місці).
  if (s instanceof Date) {
    return isNaN(s.getTime()) ? null : new Date(s.getFullYear(), s.getMonth(), s.getDate());
  }
  var parts = String(s || '').split('.');
  if (parts.length !== 3) return null;
  var d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  return isNaN(d.getTime()) ? null : d;
}

function addShiftRow(ss, s) {
  var sheet = getOrCreateSheet(ss, 'Зміни', SHIFT_HEADERS);
  var newDate = parseDdMmYyyy(s.date);
  var last = sheet.getLastRow();
  var insertRow = last + 1; // за замовчуванням — в кінець, якщо дату не розпізнали
  if (newDate && last > 1) {
    var dates = sheet.getRange(2, 2, last - 1, 1).getValues();
    insertRow = last + 1;
    for (var i = 0; i < dates.length; i++) {
      var existing = parseDdMmYyyy(dates[i][0]);
      if (existing && existing > newDate) { insertRow = i + 2; break; }
    }
  }
  if (insertRow <= last) sheet.insertRowBefore(insertRow);
  writeShiftRow(sheet, insertRow, s);
}

function writeShiftRow(sheet, rowIndex, s) {
  var row = [s.id, s.date, s.hours, s.coworker];
  var range = sheet.getRange(rowIndex, 1, 1, row.length);
  sheet.getRange(rowIndex, 1, 1, 1).setNumberFormat('@'); // id
  sheet.getRange(rowIndex, 2, 1, 1).setNumberFormat('@'); // date
  sheet.getRange(rowIndex, 3, 1, 1).setNumberFormat('0.##'); // hours
  sheet.getRange(rowIndex, 4, 1, 1).setNumberFormat('@'); // coworker
  range.setValues([row]);
}

function writeAllTickets(sheet, tickets) {
  var sorted = sortTicketsByDateDesc(tickets); // щоб і повний синк тримав порядок за датою
  sheet.clear();
  sheet.appendRow(TICKET_HEADERS);
  sheet.getRange(1, 1, Math.max(sorted.length + 1, 1000), 3).setNumberFormat('@');
  sheet.getRange(1, 6, Math.max(sorted.length + 1, 1000), 2).setNumberFormat('@');
  sorted.forEach(function (t, i) {
    writeTicketRow(sheet, i + 2, t);
  });
}

// сортує заявки від найновішої (за датою і часом) до найстарішої
function sortTicketsByDateDesc(list) {
  return (list || []).slice().sort(function(a, b) {
    return ticketDateKey(b) - ticketDateKey(a);
  });
}

function ticketDateKey(t) {
  var d = parseDdMmYyyy(t.date);
  if (!d) return 0;
  return d.getTime() + timeToMs(t.time);
}

function writeAllShifts(sheet, shifts) {
  sheet.clear();
  sheet.appendRow(SHIFT_HEADERS);
  sheet.getRange(1, 1, Math.max(shifts.length + 1, 1000), 2).setNumberFormat('@');
  shifts.forEach(function (s, i) {
    writeShiftRow(sheet, i + 2, s);
  });
}

function deleteRowById(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues().flat();
  var idx = ids.findIndex(function (v) { return String(v) === String(id); });
  if (idx > -1) sheet.deleteRow(idx + 2);
}

function syncAllData(ss, tickets, shifts) {
  writeAllTickets(getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS), tickets || []);
  writeAllShifts(getOrCreateSheet(ss, 'Зміни', SHIFT_HEADERS), shifts || []);
}

function cellToDateString(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'dd.MM.yyyy');
  return v === null || v === undefined ? '' : String(v).trim();
}
function cellToTimeString(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'HH:mm');
  return v === null || v === undefined ? '' : String(v).trim();
}
function safeString(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}
function safeNumber(v) {
  if (v instanceof Date) return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function doGet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var tSheet = ss.getSheetByName('Заявки');
  var sSheet = ss.getSheetByName('Зміни');
  var tickets = [];
  var shifts = [];
  if (tSheet && tSheet.getLastRow() > 1) {
    tSheet.getRange(2, 1, tSheet.getLastRow() - 1, 7).getValues().forEach(function (r) {
      if (!r[0] && !r[1]) return;
      tickets.push({
        id: safeString(r[0]),
        date: cellToDateString(r[1], tz),
        time: cellToTimeString(r[2], tz),
        content: r[3] === null || r[3] === undefined ? '' : String(r[3]),
        sum: safeNumber(r[4]),
        tags: r[5] ? String(r[5]).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
        backupNote: safeString(r[6]),
        photo: null
      });
    });
  }
  if (sSheet && sSheet.getLastRow() > 1) {
    sSheet.getRange(2, 1, sSheet.getLastRow() - 1, 4).getValues().forEach(function (r) {
      if (!r[0] && !r[1]) return;
      shifts.push({
        id: safeString(r[0]),
        date: cellToDateString(r[1], tz),
        hours: safeNumber(r[2]),
        coworker: safeString(r[3])
      });
    });
  }
  return ContentService.createTextOutput(JSON.stringify({tickets: tickets, shifts: shifts})).setMimeType(ContentService.MimeType.JSON);
}`;

function showAppsScriptModal(){
  openModal('Код Apps Script', `
    <div class="report-text">${escapeHtml(APPS_SCRIPT_CODE)}</div>
    <button class="btn btn-accent btn-block" id="copyScriptBtn" style="margin-top:10px;">Копіювати код</button>
  `, {onOpen:()=>{
    document.getElementById('copyScriptBtn').onclick = async ()=>{
      try{ await navigator.clipboard.writeText(APPS_SCRIPT_CODE); showToast('Код скопійовано'); }
      catch(e){ showToast('Не вдалося скопіювати'); }
    };
  }});
}

/* ---------- 8. Прив'язка подій та ініціалізація ---------- */
function bindTabBar(){
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const tab = btn.dataset.tab;
      const currentlyOnCalculator = document.getElementById('screen-calculator').classList.contains('active');
      if(currentlyOnCalculator && tab!=='calculator' && editingTicketId===null){
        syncFormToState();
        if(hasUnsavedChanges()){
          const leave = confirm('У калькуляторі є незбережені дані. Перейти без збереження?');
          if(!leave) return;
        }
      }
      if(tab==='calculator' && editingTicketId===null && !calcState.address && !calcState.clientName){
        // якщо форма порожня — підставляємо поточну дату реєстру
        calcState.date = currentTicketDate;
        setDateFieldValue(calcState.date);
      }
      switchTab(tab);
    });
  });
}

function bindTicketsScreen(){
  document.getElementById('copyDayBtn').addEventListener('click', async ()=>{
    const text = buildDayReportText();
    try{ await navigator.clipboard.writeText(text); showToast('Заявки за день скопійовано'); }
    catch(e){ showToast('Не вдалося скопіювати'); }
  });
  document.getElementById('shareDayBtn').addEventListener('click', async ()=>{
    const text = buildDayReportText();
    try{
      if(navigator.share){ await navigator.share({title:'Заявки за день', text}); }
      else { await navigator.clipboard.writeText(text); showToast('Поділитися недоступне — текст скопійовано'); }
    }catch(e){ if(e.name!=='AbortError') showToast('Не вдалося надіслати'); }
  });

  let searchDebounceTimer = null;
  document.getElementById('searchInput').addEventListener('input', e=>{
    const value = e.target.value;
    clearTimeout(searchDebounceTimer);
    // Дебаунс 220мс: при великій базі (1000+ заявок) фільтрація на кожне
    // натискання клавіші відчутно гальмує введення тексту на слабких телефонах.
    searchDebounceTimer = setTimeout(()=>{
      searchQuery = value;
      activeFilterTags.clear();
      document.getElementById('tagFilterPanel').classList.add('hidden');
      renderTicketsScreen();
    }, 220);
  });
  document.getElementById('filterToggleBtn').addEventListener('click', ()=>{
    document.getElementById('calendarPanel').classList.add('hidden');
    const panel = document.getElementById('tagFilterPanel');
    panel.classList.toggle('hidden');
    if(!panel.classList.contains('hidden')) renderTagFilterChips();
  });
  document.getElementById('calendarToggleBtn').addEventListener('click', ()=>{
    document.getElementById('tagFilterPanel').classList.add('hidden');
    const panel = document.getElementById('calendarPanel');
    panel.classList.toggle('hidden');
    if(!panel.classList.contains('hidden')){ calendarViewDate = parseDate(currentTicketDate); renderCalendar(); }
  });
  document.getElementById('reportToggleBtn').addEventListener('click', openReportModal);
  document.getElementById('addrNavToggleBtn').addEventListener('click', openAddressNavigator); // NEW
  document.getElementById('clearTagFilterBtn').addEventListener('click', ()=>{
    activeFilterTags.clear(); renderTagFilterChips(); renderTicketsScreen();
  });
  document.getElementById('tagFilterChips').addEventListener('click', e=>{
    const delBtn = e.target.closest('[data-deltag]');
    if(delBtn){
      const tag = delBtn.dataset.deltag;
      const count = tickets.filter(t=>(t.tags||[]).includes(tag)).length;
      if(!confirm(`Видалити тег "${tag}"? Він зникне з ${count} заявок і зі списку тегів.`)) return;
      backupLocalData();
      tickets.forEach(t=>{ if(t.tags) t.tags = t.tags.filter(x=>x!==tag); });
      settings.tags = (settings.tags||[]).filter(x=>x!==tag);
      activeFilterTags.delete(tag);
      saveTickets(); saveSettings();
      renderTagFilterChips(); renderTicketsScreen();
      showToast('Тег видалено. Синхронізація з хмарою...');
      if(getScriptUrl()){
        syncTicketPost('syncAllTickets', {tickets: tickets.map(ticketToSyncPayload)}).then(ok=>{
          tickets.forEach(t=>{ t.synced = ok; });
          saveTickets(); renderTicketsScreen();
          showToast(ok ? 'Синхронізовано' : 'Синхронізація не вдалась — перевірте інтернет');
        });
      }
      return;
    }
    const btn = e.target.closest('[data-tag]'); if(!btn) return;
    const tag = btn.dataset.tag;
    if(activeFilterTags.has(tag)) activeFilterTags.delete(tag); else activeFilterTags.add(tag);
    document.getElementById('searchInput').value=''; searchQuery='';
    renderTagFilterChips(); renderTicketsScreen();
  });
  document.getElementById('calPrevMonth').addEventListener('click', ()=>{
    calendarViewDate.setMonth(calendarViewDate.getMonth()-1); renderCalendar();
  });
  document.getElementById('calNextMonth').addEventListener('click', ()=>{
    calendarViewDate.setMonth(calendarViewDate.getMonth()+1); renderCalendar();
  });
  document.getElementById('calGrid').addEventListener('click', e=>{
    const day = e.target.closest('[data-date]'); if(!day) return;
    currentTicketDate = day.dataset.date;
    searchQuery=''; document.getElementById('searchInput').value='';
    activeFilterTags.clear();
    document.getElementById('calendarPanel').classList.add('hidden');
    renderTicketsScreen();
  });
  document.getElementById('prevDayBtn').addEventListener('click', ()=>{ currentTicketDate = shiftDate(currentTicketDate,-1); renderTicketsScreen(); });
  document.getElementById('nextDayBtn').addEventListener('click', ()=>{ currentTicketDate = shiftDate(currentTicketDate,1); renderTicketsScreen(); });
  document.getElementById('modeResetBtn').addEventListener('click', ()=>{
    searchQuery=''; document.getElementById('searchInput').value=''; activeFilterTags.clear();
    renderTicketsScreen();
  });
  document.getElementById('ticketList').addEventListener('click', e=>{
    const editBtn  = e.target.closest('.edit-ticket-btn');
    const delBtn   = e.target.closest('.delete-ticket-btn');
    const shareBtn = e.target.closest('.share-ticket-btn');
    const tgBtn    = e.target.closest('.tg-dispatcher-btn');
    const tgOpenBtn= e.target.closest('.tg-open-btn');
    const copyBtn  = e.target.closest('.copy-ticket-btn');
    const dgBtn    = e.target.closest('.contract-ticket-btn');
    const histBtn  = e.target.closest('.history-ticket-btn');
    const expBtn   = e.target.closest('.tc-expand-btn');
    const retryBtn = e.target.closest('.retry-sync-btn');
    const moreBtn  = e.target.closest('.show-more-tickets-btn');
    if(moreBtn){
      ticketListRenderLimit += TICKET_LIST_PAGE_SIZE;
      renderMainTicketList();
      return;
    }
    if(editBtn)  editTicket(editBtn.dataset.id);
    if(delBtn)   deleteTicket(delBtn.dataset.id);
    if(shareBtn) shareTicket(shareBtn.dataset.id);
    if(tgBtn)    sendTicketToDispatcher(tgBtn.dataset.id);
    if(tgOpenBtn) openTicketInTelegram(tgOpenBtn.dataset.id);
    if(copyBtn)  copyTicketCardText(copyBtn.dataset.id);
    if(dgBtn)    showDogovor(dgBtn.dataset.id);
    if(histBtn)  showAbonentHistory(histBtn.dataset.id);
    if(retryBtn) retrySyncTicket(retryBtn.dataset.id);
    if(expBtn){
      const id = expBtn.dataset.id;
      const contentEl = document.getElementById('tcc-'+id);
      if(!contentEl) return;
      const collapsed = contentEl.classList.toggle('tc-collapsed');
      expBtn.textContent = collapsed ? '▼ Розгорнути' : '▲ Згорнути';
    }
  });
  document.getElementById('showVizitkaBtn').addEventListener('click', showVizitka);
  document.getElementById('addTicketFab').addEventListener('click', ()=>{
    resetCalcForm(currentTicketDate);
    switchTab('calculator');
  });

  // Свайп вліво/вправо для зміни дня
  let touchStartX = null;
  const listEl = document.getElementById('ticketList');
  listEl.addEventListener('touchstart', e=>{ touchStartX = e.touches[0].clientX; }, {passive:true});
  listEl.addEventListener('touchend', e=>{
    if(touchStartX===null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if(Math.abs(dx) > 70 && searchQuery==='' && activeFilterTags.size===0){
      currentTicketDate = shiftDate(currentTicketDate, dx<0 ? 1 : -1);
      renderTicketsScreen();
    }
    touchStartX = null;
  }, {passive:true});
}

function bindCalculatorScreen(){
  // Автоматично виділяємо весь вміст числового поля при фокусі —
  // щоб не доводилось вручну видаляти «0» перед введенням ціни
  document.querySelectorAll('#calcForm input[type="number"]').forEach(el=>{
    el.addEventListener('focus', ()=> el.select());
  });
  ['f_callFee','f_tariff'].forEach(id=>{
    document.getElementById(id).addEventListener('input', computeTotal);
  });
  document.getElementById('f_phone').addEventListener('input', formatPhoneInput);
  document.getElementById('f_type').addEventListener('change', ()=>{ applyDefaultTypeTag(); toggleTypeOtherField(); updateCallFeeLabel(); applyDefaultCallFee(); applyDefaultTariff(); });
  // NEW: при зміні міста — одразу підвантажуємо підказки вулиць саме для цього міста
  // NEW: підказка клієнта за адресою — якщо на цю ж адресу вже була заявка,
// пропонуємо підставити ім'я/телефон, щоб не вбивати вручну вдруге.
// Спрацьовує тільки для НОВОЇ заявки (не при редагуванні) і тільки якщо
// клієнта/телефон ще не вписані — нічого не нав'язуємо, якщо вже заповнено.
function findPreviousTicketAtAddress(city, street, house){
  const norm = s => (s||'').trim().toLowerCase();
  if(!norm(city) || !norm(street) || !norm(house)) return null;
  const matches = tickets.filter(t=>
    !t.cloudImported &&
    norm(t.city)===norm(city) && norm(t.street)===norm(street) && norm(t.house)===norm(house) &&
    (t.clientName || t.phone)
  );
  if(!matches.length) return null;
  matches.sort((a,b)=> `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return matches[0];
}
function maybeSuggestClientFromAddress(){
  if(editingTicketId) return; // при редагуванні вже існуючої заявки нічого не пропонуємо
  if(calcState.clientName || calcState.phone) return; // щось уже вписано — не заважаємо
  const city = document.getElementById('f_city').value.trim();
  const street = document.getElementById('f_street').value.trim();
  const house = document.getElementById('f_house').value.trim();
  const prev = findPreviousTicketAtAddress(city, street, house);
  if(!prev) return;
  const addr = [city, street, house].filter(Boolean).join(', ');
  openModal('Клієнт на цій адресі', `
    <div style="font-size:14px; margin-bottom:14px; color:var(--text-dim);">
      На адресі <strong style="color:var(--text);">${escapeHtml(addr)}</strong> вже була заявка:<br>
      ${prev.clientName ? escapeHtml(prev.clientName)+'<br>' : ''}${prev.phone ? escapeHtml(prev.phone) : ''}
    </div>
    <button type="button" class="btn btn-accent btn-block" id="useAddrClientBtn">Підставити ці дані</button>
    <button type="button" class="btn btn-block" id="skipAddrClientBtn" style="margin-top:8px;">Ні, дякую</button>
  `, {onOpen: ()=>{
    document.getElementById('useAddrClientBtn').addEventListener('click', ()=>{
      document.getElementById('f_client').value = prev.clientName || '';
      document.getElementById('f_phone').value = prev.phone || '';
      calcState.clientName = prev.clientName || '';
      calcState.phone = prev.phone || '';
      closeModal();
      showToast('Дані клієнта підставлено');
    });
    document.getElementById('skipAddrClientBtn').addEventListener('click', closeModal);
  }});
}
document.getElementById('f_house').addEventListener('blur', maybeSuggestClientFromAddress);

document.getElementById('f_city').addEventListener('input', e=>{ renderStreetDatalist(e.target.value.trim()); });
  // NEW: як тільки майстер сам щось ввів у поле ціни виклику — більше не чіпаємо його автоматично
  document.getElementById('f_callFee').addEventListener('input', ()=>{ feeIsAutoDefault = false; }, {capture:true});
  document.getElementById('f_tariff').addEventListener('input', ()=>{ tariffIsAutoDefault = false; }, {capture:true});
  /* Сканер MAC через штрих-код на наліпці пристрою (Code128 і т.п.).
   Використовує нативний BarcodeDetector — без зовнішніх бібліотек, тому
   працює і офлайн. Якщо браузер API не підтримує — просто ховаємо кнопку
   сканування, залишаючи ручне поле введення як основний спосіб. */
let macScanStream = null;
let macScanRAF = null;
let macScanSeen = new Map(); // rawValue -> кнопка, щоб не дублювати список щокадру

async function startMacScan(){
  const modal = document.getElementById('macScanModal');
  const video = document.getElementById('macScanVideo');
  const results = document.getElementById('macScanResults');
  results.innerHTML = '';
  macScanSeen = new Map();
  if(!('BarcodeDetector' in window)){
    showToast('Камера-сканер не підтримується цим браузером — введіть MAC вручну');
    return;
  }
  try{
    macScanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
  }catch(e){
    showToast('Не вдалося відкрити камеру');
    return;
  }
  video.srcObject = macScanStream;
  modal.classList.remove('hidden');
  let detector;
  try{
    detector = new BarcodeDetector({formats:['code_128','code_39','code_93','codabar','itf','ean_13','ean_8','upc_a','upc_e','qr_code','data_matrix','pdf417']});
  }catch(e){
    detector = new BarcodeDetector();
  }
  const addResultButton = (raw)=>{
    if(macScanSeen.has(raw)) return;
    const mac = normalizeMac(raw);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-block';
    btn.style.textAlign = 'left';
    btn.innerHTML = `<div style="font-weight:700;">${mac}</div><div style="font-size:11.5px; color:var(--text-dim);">як відскановано: ${raw}</div>`;
    btn.addEventListener('click', ()=>{
      document.getElementById('f_mac').value = mac;
      showToast(`Обрано: ${mac}`);
      stopMacScan();
    });
    macScanSeen.set(raw, btn);
    results.appendChild(btn);
  };
  const scanFrame = async ()=>{
    if(!macScanStream) return; // сканер вже закрито
    try{
      const codes = await detector.detect(video);
      (codes||[]).forEach(c=>{ if(c.rawValue) addResultButton(c.rawValue); });
    }catch(e){ /* кадр не розпізнався — просто пробуємо наступний */ }
    macScanRAF = requestAnimationFrame(scanFrame);
  };
  macScanRAF = requestAnimationFrame(scanFrame);
}

function stopMacScan(){
  if(macScanRAF) cancelAnimationFrame(macScanRAF);
  macScanRAF = null;
  if(macScanStream){ macScanStream.getTracks().forEach(t=>t.stop()); macScanStream = null; }
  document.getElementById('macScanModal').classList.add('hidden');
}

document.getElementById('photoBtn').addEventListener('click', ()=> document.getElementById('f_photoInput').click());
  document.getElementById('f_photoInput').addEventListener('change', e=>{
    if(e.target.files && e.target.files[0]) handlePhotoFile(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('photoRemoveBtn').addEventListener('click', ()=>{ calcState.photo=null; renderPhotoPreview(); });
  document.getElementById('macScanBtn').addEventListener('click', startMacScan);
  document.getElementById('macScanCloseBtn').addEventListener('click', stopMacScan);
  document.getElementById('f_mac').addEventListener('input', e=>{
    const pos = e.target.selectionStart;
    const before = e.target.value;
    e.target.value = normalizeMac(before).slice(0,12);
    // якщо не редагували середину рядка (звичайне друкування в кінці) — курсор лишаємо в кінці
    if(pos === before.length) e.target.selectionStart = e.target.selectionEnd = e.target.value.length;
    // NEW: м'яка підказка (не блокує збереження) — повний MAC це рівно 12 символів 0-9/A-F
    const hint = document.getElementById('macHint');
    if(hint) hint.style.display = (e.target.value && !/^[0-9A-F]{12}$/.test(e.target.value)) ? '' : 'none';
  });
  if(!('BarcodeDetector' in window)) document.getElementById('macScanBtn').classList.add('hidden');
  document.getElementById('f_credRaw').addEventListener('input', updateCredParsedHint);
  document.getElementById('f_dateNative').addEventListener('change', e=>{
    const ddmmyyyy = isoToDdmmyyyy(e.target.value);
    if(ddmmyyyy) document.getElementById('f_date').value = ddmmyyyy;
  });
  document.getElementById('geoBtn').addEventListener('click', handleGeoBtn);
  document.getElementById('geoClearBtn').addEventListener('click', ()=>{ setGeoLink(''); showToast('Геолокацію видалено'); });

  document.getElementById('equipmentList').addEventListener('change', e=>{
    const chk = e.target.closest('.eq-check');
    if(chk){ calcState.equipment[Number(chk.dataset.eqidx)].checked = chk.checked; computeTotal(); renderEquipmentList(); }
  });
  document.getElementById('equipmentList').addEventListener('input', e=>{
    const price = e.target.closest('.eq-price');
    if(price){ calcState.equipment[Number(price.dataset.eqidx)].price = Number(price.value)||0; computeTotal(); updateEquipmentSummary(); }
  });

  // NEW: обробники для динамічного списку кабелів
  document.getElementById('cablesList').addEventListener('input', e=>{
    const metersEl = e.target.closest('.cab-meters');
    const priceEl = e.target.closest('.cab-price');
    if(metersEl){ calcState.cables[Number(metersEl.dataset.cabidx)].meters = Number(metersEl.value)||0; computeTotal(); updateCablesSummary(); }
    if(priceEl){ calcState.cables[Number(priceEl.dataset.cabidx)].pricePerMeter = Number(priceEl.value)||0; computeTotal(); updateCablesSummary(); }
  });

  document.getElementById('presetWorksList').addEventListener('change', e=>{
    const chk = e.target.closest('.pw-check');
    if(chk){ calcState.presetWorks[Number(chk.dataset.pwidx)].checked = chk.checked; computeTotal(); renderPresetWorksList(); }
  });
  document.getElementById('presetWorksList').addEventListener('input', e=>{
    const qty = e.target.closest('.pw-qty');
    const price = e.target.closest('.pw-price');
    if(qty){ calcState.presetWorks[Number(qty.dataset.pwidx)].qty = Number(qty.value)||1; computeTotal(); }
    if(price){ calcState.presetWorks[Number(price.dataset.pwidx)].price = Number(price.value)||0; computeTotal(); }
  });

  document.getElementById('addWorkBtn').addEventListener('click', ()=>{
    calcState.additionalWork.push({desc:'', sum:0});
    renderAdditionalWorkList(); computeTotal();
  });
  document.getElementById('additionalWorkList').addEventListener('input', e=>{
    const row = e.target.closest('[data-awidx]'); if(!row) return;
    const idx = Number(row.dataset.awidx);
    if(e.target.classList.contains('aw-desc')) calcState.additionalWork[idx].desc = e.target.value;
    if(e.target.classList.contains('aw-sum')) {
      calcState.additionalWork[idx].sum = Number(e.target.value)||0;
      computeTotal();
      const sum = calcState.additionalWork.reduce((s,w)=> s + (Number(w.sum)||0), 0);
      document.getElementById('additionalWorkSummary').textContent = `— ${calcState.additionalWork.length}, ${fmtMoney(sum)}`;
    }
  });
  document.getElementById('additionalWorkList').addEventListener('click', e=>{
    const removeBtn = e.target.closest('.aw-remove'); if(!removeBtn) return;
    const idx = Number(removeBtn.closest('[data-awidx]').dataset.awidx);
    calcState.additionalWork.splice(idx,1);
    // не лишаємо список зовсім порожнім — завжди має бути хоч одне поле для вводу
    if(calcState.additionalWork.length===0) calcState.additionalWork.push({desc:'', sum:0});
    renderAdditionalWorkList(); computeTotal();
  });

  document.getElementById('calcTagChips').addEventListener('click', e=>{
    const chip = e.target.closest('[data-calctag]'); if(!chip) return;
    const tag = chip.dataset.calctag;
    const i = calcState.tags.indexOf(tag);
    if(i>-1) calcState.tags.splice(i,1); else calcState.tags.push(tag);
    // NEW: раніше тут викликався renderCalcTagChips(), який перебудовував весь
    // innerHTML — це знищувало саме ту кнопку, по якій щойно тапнули, і браузер
    // "губив" фокус та підкидав скрол сторінки вгору. Тепер міняємо лише клас.
    chip.classList.toggle('active');
    document.getElementById('tagsSummary').textContent = calcState.tags.length ? `— обрано: ${calcState.tags.length}` : '';
  });
  document.getElementById('calcMasterChips').addEventListener('click', e=>{
    const chip = e.target.closest('[data-master-letter]'); if(!chip) return;
    const letter = chip.dataset.masterLetter;
    const name = chip.dataset.masterName;
    if(!calcState.connectMasters) calcState.connectMasters = [];
    const idx = calcState.connectMasters.findIndex(m=>m.name===name);
    let newTagRegistered = false; // NEW: чи з'явився зовсім новий тег у списку (тоді таки треба перемалювати)
    if(idx>-1){
      // повторний тап на вже вибраного майстра знімає вибір
      calcState.connectMasters.splice(idx,1);
      // прибираємо його ім'я з тегів цієї заявки (сам тег у Налаштуваннях лишається)
      const ti = calcState.tags.indexOf(name);
      if(ti>-1) calcState.tags.splice(ti,1);
    } else {
      // додаємо в кінець — порядок натискань визначає порядок літер у номері договору
      calcState.connectMasters.push({name, letter});
      // напарник одразу стає тегом заявки — не треба вписувати ім'я двічі
      if(!calcState.tags.includes(name)) calcState.tags.push(name);
      // якщо такого тега ще нема серед офіційних у Налаштуваннях — реєструємо його там же
      if(!settings.tags.includes(name)){ settings.tags.push(name); saveSettings(); newTagRegistered = true; }
    }
    // NEW: раніше тут завжди викликались renderMasterChips()/renderCalcTagChips(), які
    // перебудовували весь innerHTML і губили скрол/фокус (та сама причина, що й з тегами
    // вище). Тепер повне перемальовування тегів робимо лише тоді, коли справді з'явився
    // новий елемент списку — інакше просто оновлюємо класи "active" на місці.
    chip.classList.toggle('active');
    if(newTagRegistered){
      renderCalcTagChips();
    } else {
      document.getElementById('tagsSummary').textContent = calcState.tags.length ? `— обрано: ${calcState.tags.length}` : '';
      document.querySelectorAll('#calcTagChips [data-calctag]').forEach(btn=>{
        btn.classList.toggle('active', calcState.tags.includes(btn.dataset.calctag));
      });
    }
  });

  document.getElementById('sendTicketBtn').addEventListener('click', shareCurrentTicket);
  document.getElementById('sendToDispatcherBtn').addEventListener('click', sendCurrentTicketToDispatcher);
  document.getElementById('copyTextBtn').addEventListener('click', copyTicketText);
  document.getElementById('sharePhotoBtn').addEventListener('click', sharePhoto);
  document.getElementById('saveTicketBtn').addEventListener('click', saveTicketFromForm);
  document.getElementById('cancelEditBtn').addEventListener('click', ()=>{
    syncFormToState(); // щоб hasUnsavedChanges бачила саме те, що зараз у полях, а не стан на момент відкриття
    if(hasUnsavedChanges() && !confirm('Скасувати редагування? Незбережені зміни буде втрачено.')) return;
    clearDraft(); resetCalcForm(currentTicketDate); switchTab('tickets');
  });
}

function bindShiftsScreen(){
  document.getElementById('prevShiftDayBtn').addEventListener('click', ()=>{ currentShiftDate = shiftDate(currentShiftDate,-1); renderShiftsScreen(); });
  document.getElementById('nextShiftDayBtn').addEventListener('click', ()=>{ currentShiftDate = shiftDate(currentShiftDate,1); renderShiftsScreen(); });

  document.getElementById('shiftCalendarToggleBtn').addEventListener('click', ()=>{
    const panel = document.getElementById('shiftCalendarPanel');
    panel.classList.toggle('hidden');
    if(!panel.classList.contains('hidden')){ shiftCalendarViewDate = parseDate(currentShiftDate); renderShiftCalendar(); }
  });
  document.getElementById('shiftCalPrevMonth').addEventListener('click', ()=>{
    shiftCalendarViewDate.setMonth(shiftCalendarViewDate.getMonth()-1); renderShiftCalendar();
  });
  document.getElementById('shiftCalNextMonth').addEventListener('click', ()=>{
    shiftCalendarViewDate.setMonth(shiftCalendarViewDate.getMonth()+1); renderShiftCalendar();
  });
  document.getElementById('shiftCalGrid').addEventListener('click', e=>{
    const day = e.target.closest('[data-date]'); if(!day) return;
    currentShiftDate = day.dataset.date;
    document.getElementById('shiftCalendarPanel').classList.add('hidden');
    renderShiftsScreen();
  });

  // Навігація по місяцях у блоці статистики/графіку — незалежна від дня додавання зміни
  document.getElementById('statsPrevMonth').addEventListener('click', ()=>{
    statsViewDate.setMonth(statsViewDate.getMonth()-1);
    renderStatsMonthLabel(); renderYearChart(); renderShiftStats(); renderShiftHistory();
  });
  document.getElementById('statsNextMonth').addEventListener('click', ()=>{
    statsViewDate.setMonth(statsViewDate.getMonth()+1);
    renderStatsMonthLabel(); renderYearChart(); renderShiftStats(); renderShiftHistory();
  });

  // Клік по стовпцю графіку — переключає обраний місяць
  document.getElementById('yearChart').addEventListener('click', e=>{
    const bar = e.target.closest('[data-month]'); if(!bar) return;
    statsViewDate.setMonth(Number(bar.dataset.month));
    renderYearChart(); renderShiftStats(); renderShiftHistory();
  });

  document.getElementById('shareMonthBtn').addEventListener('click', shareMonthShifts);
  document.getElementById('tgShiftsReportBtn').addEventListener('click', sendShiftsReportToTelegram);

  document.querySelectorAll('.hq-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{ document.getElementById('shiftHours').value = btn.dataset.h; });
  });
  document.getElementById('coworkerGrid').addEventListener('click', e=>{
    const chip = e.target.closest('[data-cw]'); if(!chip) return;
    const cw = chip.dataset.cw;
    if(coworkerSelection.has(cw)) coworkerSelection.delete(cw); else coworkerSelection.add(cw);
    renderCoworkerGrid();
  });
  document.getElementById('addShiftBtn').addEventListener('click', addShift);
  document.getElementById('shiftHistoryCard').addEventListener('click', e=>{
    const btn = e.target.closest('.delete-shift-btn'); if(!btn) return;
    deleteShift(btn.dataset.id);
  });
}

function bindSettingsScreen(){
  document.getElementById('tagMgmtList').addEventListener('click', e=>{
    const btn = e.target.closest('.remove-tag-btn'); if(!btn) return;
    settings.tags = settings.tags.filter(t=>t!==btn.dataset.tag);
    saveSettings(); renderTagMgmtList();
  });
  document.getElementById('addTagBtn').addEventListener('click', ()=>{
    const input = document.getElementById('newTagInput');
    const val = input.value.trim();
    if(val && !settings.tags.includes(val)){ settings.tags.push(val); saveSettings(); renderTagMgmtList(); }
    input.value = '';
  });
  document.getElementById('newTagInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addTagBtn').click(); }
  });
  document.getElementById('resetTagsBtn').addEventListener('click', ()=>{
    if(!confirm('Скинути список тегів до стандартного?')) return;
    settings.tags = [...DEFAULT_TAGS]; saveSettings(); renderTagMgmtList();
  });

  document.getElementById('cityMgmtList').addEventListener('click', e=>{
    const btn = e.target.closest('.remove-city-btn'); if(!btn) return;
    settings.cities = (settings.cities||[]).filter(c=>c!==btn.dataset.city);
    if(settings.streets) delete settings.streets[btn.dataset.city]; // NEW: прибираємо й вулиці видаленого міста
    saveSettings(); renderCityMgmtList();
  });
  document.getElementById('addCityBtn').addEventListener('click', ()=>{
    const input = document.getElementById('newCityInput');
    const val = input.value.trim();
    if(!settings.cities) settings.cities = [];
    if(val && !settings.cities.includes(val)){ settings.cities.push(val); saveSettings(); renderCityMgmtList(); }
    input.value = '';
  });
  document.getElementById('newCityInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addCityBtn').click(); }
  });

  // NEW: керування вулицями по містах у Налаштуваннях
  document.getElementById('streetMgmtCitySelect').addEventListener('change', e=>{
    streetMgmtSelectedCity = e.target.value;
    renderStreetMgmtList();
  });
  document.getElementById('streetMgmtList').addEventListener('click', e=>{
    const btn = e.target.closest('.remove-street-btn'); if(!btn) return;
    const city = streetMgmtSelectedCity;
    if(!city || !settings.streets || !settings.streets[city]) return;
    settings.streets[city] = settings.streets[city].filter(s=>s!==btn.dataset.street);
    saveSettings(); renderStreetMgmtList();
  });
  document.getElementById('addStreetBtn').addEventListener('click', ()=>{
    const city = streetMgmtSelectedCity;
    const input = document.getElementById('newStreetInput');
    const val = input.value.trim();
    if(!city){ showToast('Спершу додайте місто'); return; }
    if(!settings.streets) settings.streets = {};
    if(!settings.streets[city]) settings.streets[city] = [];
    if(val && !settings.streets[city].includes(val)){ settings.streets[city].push(val); saveSettings(); renderStreetMgmtList(); }
    input.value = '';
  });
  document.getElementById('newStreetInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addStreetBtn').click(); }
  });
  document.getElementById('backfillAddrBtn').addEventListener('click', backfillAddressDictionariesFromTickets);

  document.getElementById('cwMgmtList').addEventListener('click', e=>{
    const btn = e.target.closest('.remove-cw-btn'); if(!btn) return;
    settings.coworkers = settings.coworkers.filter(c=>c!==btn.dataset.cw);
    saveSettings(); renderCwMgmtList();
  });
  document.getElementById('addCwBtn').addEventListener('click', ()=>{
    const input = document.getElementById('newCwInput');
    const val = input.value.trim();
    if(val && !settings.coworkers.includes(val)){ settings.coworkers.push(val); saveSettings(); renderCwMgmtList(); }
    input.value = '';
  });
  document.getElementById('newCwInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addCwBtn').click(); }
  });

  document.getElementById('hourlyRateInput').addEventListener('input', e=>{
    settings.hourlyRate = Number(e.target.value)||0; saveSettings(); renderShiftStats();
  });
  document.getElementById('defaultConnectFeeInput').addEventListener('input', e=>{
    settings.defaultConnectFee = Number(e.target.value)||0; saveSettings();
  });
  document.getElementById('defaultTariffInput').addEventListener('input', e=>{
    settings.defaultTariff = Number(e.target.value)||0; saveSettings();
  });
  document.getElementById('defaultRepairCallFeeInput').addEventListener('input', e=>{
    settings.defaultRepairCallFee = Number(e.target.value)||0; saveSettings();
  });
  document.getElementById('themeSwitch').addEventListener('change', e=>{
    settings.theme = e.target.checked ? 'dark' : 'light';
    saveSettings(); applyTheme();
  });
  document.getElementById('scriptUrlInput').addEventListener('input', e=>{
    settings.scriptUrl = e.target.value.trim(); saveSettings();
  });
  document.getElementById('syncSecretInput').addEventListener('input', e=>{
    settings.syncSecret = e.target.value.trim(); saveSettings();
  });
  // NEW: налаштування Telegram-бота
  document.getElementById('tgBotTokenInput').addEventListener('input', e=>{
    settings.tgBotToken = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgBackupChatIdInput').addEventListener('input', e=>{
    settings.tgBackupChatId = e.target.value.trim(); saveSettings();
  });
  // NEW: два іменованих диспетчери — окремі поля імені й chat_id для кожного
  document.getElementById('tgDisp1NameInput').addEventListener('input', e=>{
    if(!settings.tgDispatchers) settings.tgDispatchers = [{name:'',chatId:''},{name:'',chatId:''}];
    settings.tgDispatchers[0].name = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgDisp1ChatIdInput').addEventListener('input', e=>{
    if(!settings.tgDispatchers) settings.tgDispatchers = [{name:'',chatId:''},{name:'',chatId:''}];
    settings.tgDispatchers[0].chatId = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgDisp2NameInput').addEventListener('input', e=>{
    if(!settings.tgDispatchers) settings.tgDispatchers = [{name:'',chatId:''},{name:'',chatId:''}];
    settings.tgDispatchers[1].name = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgDisp2ChatIdInput').addEventListener('input', e=>{
    if(!settings.tgDispatchers) settings.tgDispatchers = [{name:'',chatId:''},{name:'',chatId:''}];
    settings.tgDispatchers[1].chatId = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgMyChatIdInput').addEventListener('input', e=>{
    settings.tgMyChatId = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgTestBtn').addEventListener('click', ()=> sendTelegramTestMessage(settings.tgBackupChatId, 'група-архів'));
  document.getElementById('tgTestDisp1Btn').addEventListener('click', ()=>{
    const d = settings.tgDispatchers && settings.tgDispatchers[0];
    if(!d || !d.chatId){ showToast('Спочатку заповніть Chat ID диспетчера 1'); return; }
    sendTelegramTestMessage(d.chatId, d.name || 'диспетчер 1');
  });
  document.getElementById('tgTestDisp2Btn').addEventListener('click', ()=>{
    const d = settings.tgDispatchers && settings.tgDispatchers[1];
    if(!d || !d.chatId){ showToast('Спочатку заповніть Chat ID диспетчера 2'); return; }
    sendTelegramTestMessage(d.chatId, d.name || 'диспетчер 2');
  });
  document.getElementById('tgTestMonthlyBtn').addEventListener('click', sendMonthlyTelegramReportNow);
  document.getElementById('tgBulkExportBtn').addEventListener('click', bulkExportTicketsToTelegram);
  document.getElementById('tgResyncAllBtn').addEventListener('click', resyncAllTicketsToTelegram);
  document.getElementById('shiftsScriptUrlInput').addEventListener('input', e=>{
    settings.shiftsScriptUrl = e.target.value.trim(); saveSettings();
  });
  document.getElementById('vizitkaUrlInput').addEventListener('input', e=>{
    settings.vizitkaUrl = e.target.value.trim(); saveSettings();
  });
  document.getElementById('dogovorUrlInput').addEventListener('input', e=>{
    settings.dogovorUrl = e.target.value.trim(); saveSettings();
  });

  document.getElementById('loadCloudBtn').addEventListener('click', loadFromCloud);
  document.getElementById('restoreCloudBtn').addEventListener('click', ()=>{
    if(!confirm('Відновити дані з хмари? Поточні локальні дані будуть замінені.')) return;
    loadFromCloud();
  });
  document.getElementById('sendAllBtn').addEventListener('click', sendAllToCloud);
  document.getElementById('loadShiftsCloudBtn').addEventListener('click', loadShiftsFromCloud);
  document.getElementById('restoreShiftsCloudBtn').addEventListener('click', ()=>{
    if(!confirm('Відновити зміни з хмари? Поточні локальні зміни будуть замінені.')) return;
    loadShiftsFromCloud();
  });
  document.getElementById('sendShiftsAllBtn').addEventListener('click', sendShiftsToCloud);
  document.getElementById('showScriptBtn').addEventListener('click', showAppsScriptModal);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJsonBackup);
  document.getElementById('importJsonBtn').addEventListener('click', ()=> document.getElementById('jsonImportInput').click());
  document.getElementById('jsonImportInput').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    handleJsonImportFile(file);
    e.target.value = ''; // щоб можна було обрати той самий файл повторно
  });
  document.getElementById('exportBtn').addEventListener('click', openExportModal);
  document.getElementById('importBtn').addEventListener('click', openImportModal);
  document.getElementById('repairTicketsBtn').addEventListener('click', repairCorruptedTickets);
  document.getElementById('dedupTicketsBtn').addEventListener('click', dedupTickets);
  document.getElementById('restoreBackupBtn').addEventListener('click', restoreFromBackup);
  // NEW: щоденні бекапи — завантажити як файл або відновити прямо з обраного дня
  document.getElementById('dailyBackupList').addEventListener('click', e=>{
    const dlBtn = e.target.closest('.daily-backup-download-btn');
    const restBtn = e.target.closest('.daily-backup-restore-btn');
    if(dlBtn) downloadDailyBackup(dlBtn.dataset.date);
    if(restBtn) restoreDailyBackup(restBtn.dataset.date);
  });
  document.getElementById('deletedTicketsList').addEventListener('click', e=>{
    const restoreBtn = e.target.closest('.restore-trash-btn');
    const purgeBtn = e.target.closest('.purge-trash-btn');
    if(restoreBtn) restoreDeletedTicket(restoreBtn.dataset.deletedAt);
    if(purgeBtn) purgeDeletedTicket(purgeBtn.dataset.deletedAt);
  });
  document.getElementById('clearAllBtn').addEventListener('click', ()=>{
    if(!confirm('Очистити ВСЮ базу даних (заявки і зміни)? Цю дію не можна скасувати.')) return;
    if(!confirm('Ви впевнені? Дані будуть видалені остаточно.')) return;
    backupLocalData();
    tickets = []; shifts = [];
    saveTickets(); saveShifts();
    clearAllPhotos();
    syncPost('clearAll', {});
    renderTicketsScreen(); renderShiftsScreen();
    showToast('Базу очищено');
  });

  // Матеріали: редагування назви/ціни та видалення
  document.getElementById('matMgmtList').addEventListener('input', e=>{
    const li = e.target.closest('.mat-label-inp');
    const pi = e.target.closest('.mat-price-inp');
    if(li){ settings.materials[Number(li.dataset.idx)].label = li.value; saveSettings(); }
    if(pi){ settings.materials[Number(pi.dataset.idx)].price = Number(pi.value)||0; saveSettings(); }
  });
  document.getElementById('matMgmtList').addEventListener('click', e=>{
    const rm = e.target.closest('.remove-mat-btn'); if(!rm) return;
    settings.materials.splice(Number(rm.dataset.idx), 1);
    saveSettings(); renderMatMgmtList();
    showToast('Матеріал видалено');
  });
  document.getElementById('addMatBtn').addEventListener('click', ()=>{
    const nameEl = document.getElementById('newMatName');
    const priceEl = document.getElementById('newMatPrice');
    const label = nameEl.value.trim();
    if(!label){ showToast('Введіть назву матеріалу'); return; }
    const price = Number(priceEl.value)||0;
    const id = 'mat_'+Date.now();
    settings.materials.push({id, label, price});
    saveSettings(); renderMatMgmtList();
    nameEl.value = ''; priceEl.value = '';
    showToast(`Матеріал «${label}» додано`);
  });
  document.getElementById('newMatName').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addMatBtn').click(); }
  });

  // Майстри: редагування імені/літери та видалення (літера йде в номер договору)
  document.getElementById('masterMgmtList').addEventListener('input', e=>{
    const ni = e.target.closest('.master-name-inp');
    const li = e.target.closest('.master-letter-inp');
    if(ni){ settings.masters[Number(ni.dataset.idx)].name = ni.value; saveSettings(); }
    if(li){ settings.masters[Number(li.dataset.idx)].letter = li.value.toUpperCase(); saveSettings(); }
  });
  document.getElementById('masterMgmtList').addEventListener('click', e=>{
    const rm = e.target.closest('.remove-master-btn'); if(!rm) return;
    settings.masters.splice(Number(rm.dataset.idx), 1);
    saveSettings(); renderMasterMgmtList();
    showToast('Майстра видалено');
  });
  document.getElementById('addMasterBtn').addEventListener('click', ()=>{
    const nameEl = document.getElementById('newMasterName');
    const letterEl = document.getElementById('newMasterLetter');
    const name = nameEl.value.trim();
    const letter = letterEl.value.trim().toUpperCase();
    if(!name){ showToast('Введіть ім\'я майстра'); return; }
    if(!letter){ showToast('Введіть літеру'); return; }
    settings.masters.push({name, letter});
    saveSettings(); renderMasterMgmtList();
    nameEl.value = ''; letterEl.value = '';
    showToast(`Майстра «${name}» додано`);
  });
  document.getElementById('newMasterName').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('newMasterLetter').focus(); }
  });
  document.getElementById('newMasterLetter').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addMasterBtn').click(); }
  });

  // NEW: Типи кабелів — редагування назви/ціни, видалення, додавання
  document.getElementById('cableMgmtList').addEventListener('input', e=>{
    const li = e.target.closest('.cable-label-inp');
    const pi = e.target.closest('.cable-price-inp');
    if(li){ settings.cableTypes[Number(li.dataset.idx)].label = li.value; saveSettings(); }
    if(pi){ settings.cableTypes[Number(pi.dataset.idx)].pricePerMeter = Number(pi.value)||0; saveSettings(); }
  });
  document.getElementById('cableMgmtList').addEventListener('click', e=>{
    const rm = e.target.closest('.remove-cable-btn'); if(!rm) return;
    settings.cableTypes.splice(Number(rm.dataset.idx), 1);
    saveSettings(); renderCableMgmtList();
    showToast('Тип кабелю видалено');
  });
  document.getElementById('addCableBtn').addEventListener('click', ()=>{
    const nameEl = document.getElementById('newCableName');
    const priceEl = document.getElementById('newCablePrice');
    const label = nameEl.value.trim();
    if(!label){ showToast('Введіть назву кабелю'); return; }
    const pricePerMeter = Number(priceEl.value)||0;
    const id = 'cable_'+Date.now();
    settings.cableTypes.push({id, label, pricePerMeter});
    saveSettings(); renderCableMgmtList();
    nameEl.value = ''; priceEl.value = '';
    showToast(`Кабель «${label}» додано`);
  });
  document.getElementById('newCableName').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addCableBtn').click(); }
  });

  // Роботи з переліку: редагування назви/ціни та видалення
  document.getElementById('workMgmtList').addEventListener('input', e=>{
    const li = e.target.closest('.work-label-inp');
    const pi = e.target.closest('.work-price-inp');
    if(li){ settings.workTypes[Number(li.dataset.idx)].label = li.value; saveSettings(); }
    if(pi){ settings.workTypes[Number(pi.dataset.idx)].price = Number(pi.value)||0; saveSettings(); }
  });
  document.getElementById('workMgmtList').addEventListener('click', e=>{
    const rm = e.target.closest('.remove-work-btn'); if(!rm) return;
    settings.workTypes.splice(Number(rm.dataset.idx), 1);
    saveSettings(); renderWorkMgmtList();
    showToast('Роботу видалено зі списку');
  });
  document.getElementById('addWorkTypeBtn').addEventListener('click', ()=>{
    const nameEl = document.getElementById('newWorkName');
    const priceEl = document.getElementById('newWorkPrice');
    const label = nameEl.value.trim();
    if(!label){ showToast('Введіть назву роботи'); return; }
    const price = Number(priceEl.value)||0;
    const id = 'work_'+Date.now();
    settings.workTypes.push({id, label, price});
    saveSettings(); renderWorkMgmtList();
    nameEl.value = ''; priceEl.value = '';
    showToast(`Робота «${label}» додана`);
  });
  document.getElementById('newWorkName').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addWorkTypeBtn').click(); }
  });
}

async function init(){
  applyTheme();
  bindTabBar();
  bindTicketsScreen();
  bindCalculatorScreen();
  bindShiftsScreen();
  bindSettingsScreen();

  photoDb = await openPhotoDb();
  await migrateLegacyPhotosToIdb(); // переносить старі base64-фото з localStorage в IndexedDB (одноразово)

  backupDb = await openBackupDb();
  await maybeRunDailyBackup(); // NEW: раз на день — автоматичний знімок заявок/змін у IndexedDB (10 останніх днів по колу)

  renderTicketsScreen();
  resetCalcForm(currentTicketDate);
  renderShiftsScreen();
  renderSettingsScreen();

  restoreDraftIfAny();
  setInterval(saveDraftToLocalStorage, 30000);

  maybeShowMonthlyCleanupReminder(); // NEW: 1-го числа кожного місяця — нагадування почистити файли бекапів
  maybeSendMonthlyTelegramReport(); // NEW: 1-го числа кожного місяця — авто-звіт у Telegram собі особисто

  document.getElementById('syncQueueRetryBtn').addEventListener('click', retrySyncQueue);
  window.addEventListener('online', ()=>{
    showToast('Інтернет з\'явився — синхронізую...');
    retrySyncQueue();
  });
  window.addEventListener('offline', renderSyncQueueBanner);
}

document.addEventListener('DOMContentLoaded', init);

/* Реєстрація Service Worker — кешує застосунок у браузері, щоб він
   відкривався і без інтернету. Синхронізація зі скриптом Google
   при цьому все одно вимагає мережі — це стосується лише завантаження
   самого інтерфейсу. */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(err=>console.error('SW registration failed', err));
  });
}

/* Попередження при закритті вкладки/застосунку, якщо в калькуляторі є
   незбережені дані. Працює лише в звичайному браузері (Chrome тощо) —
   у PWA-режимі або деяких мобільних webview це попередження може не
   показуватись через обмеження платформи, але шкоди від нього немає. */
window.addEventListener('beforeunload', (e)=>{
  if(editingTicketId===null){
    syncFormToState();
    if(hasUnsavedChanges()){
      e.preventDefault();
      e.returnValue = '';
    }
  }
});

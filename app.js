/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — основний скрипт
   Розділи: 0) константи й стан, 1) допоміжні функції, 2) синхронізація,
   3) навігація/модалки, 4) екран «Заявки», 5) екран «Калькулятор»,
   6) екран «Зміни», 7) екран «Налаштування», 8) ініціалізація
   ===================================================================== */

/* ---------- 0. Константи та стан ---------- */
// NEW: показується в Налаштуваннях — щоб одразу бачити, чи підвантажилась
// свіжа версія після деплою, чи браузер ще показує старий кеш. Піднімати
// разом із CACHE_NAME у sw.js при кожному суттєвому оновленні.
const APP_VERSION = 'v90 · 2026-09-05';
let settings = loadSettings();
if(ensureCatalogTags()) saveSettings(); // NEW: додає теги для всіх матеріалів/робіт з переліку, якщо їх ще нема
// NEW: раніше тут одразу синхронно читалось з localStorage — тепер справжні
// дані підвантажуються асинхронно з IndexedDB у init() (loadTicketsFromIdb),
// до першого рендеру екрану заявок ще встигає бути порожній масив.
let tickets  = [];
let shifts   = loadJSON('shifts', []);
// Ревізії відрізняють «стан на початку cloud load» від локальних змін,
// зроблених користувачем, поки мережевий запит ще очікує відповідь.
let ticketsRevision = 0;
let shiftsRevision = 0;
let deletedTickets = loadJSON('deletedTickets', []); // "кошик" — останні видалені заявки, можна відновити
let syncEngine = null;
let syncTicketsSnapshot = [];
let syncShiftsSnapshot = JSON.parse(JSON.stringify(shifts));
const DELETED_TICKETS_MAX = 30;
// NEW: черга "сирих" нарядів від диспетчера — вставив текст як є (з Viber
// тощо), поки не перетворив на заявку. Маленькі текстові записи, тож
// localStorage тут цілком доречний (не той випадок, що з tickets).
let naryadQueue = loadJSON('naryadQueue', []);

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
// Наряд в черзі позначаємо виконаним лише після фактичного збереження заявки,
// а не після самого відкриття її форми.
let naryadPendingCompletionId = null;
// NEW: знімок ключів фото на момент відкриття форми (нової чи існуючої
// заявки) — потрібен, щоб при скасуванні редагування прибрати з IndexedDB
// лише ФОТО, ЗНЯТІ В ЦЬОМУ СЕАНСІ (щойно сфотографовані, ще ніде не
// збережені), а не ті, що вже належать заявці й мають лишитись.
let calcOriginalPhotoKeys = [];
// NEW: лічильник "сеансу форми" — росте щоразу, коли відкривається нова
// порожня форма (resetCalcForm) чи форма редагування (loadTicketIntoForm).
// handlePhotoFile знімає поточне значення ДО того, як піде асинхронний
// storePhoto (запис в IndexedDB) — якщо до моменту, коли запис завершиться,
// користувач встиг скасувати заявку чи відкрити іншу (сеанс змінився), фото
// видаляється з IndexedDB замість того, щоб "прилипнути" до чужої заявки.
let formSessionId = 0;
let feeIsAutoDefault = true; // NEW: поки true — ціну виклику/підключення можна автоматично підставити при зміні типу заявки; false — майстер вже ввів своє значення вручну, чіпати не можна
let tariffIsAutoDefault = true; // те саме, але для поля "Тариф" — щоб автопідставлене за замовчуванням значення не вважалось "незбереженою зміною"
// NEW: чи торкався користувач полів форми руками. Потрібно окремо від
// hasUnsavedChanges(), бо швидке створення заявки з наряду/профілю саме
// собою вже підставляє телефон/зміст — і якщо просто глянути на таку форму
// й піти на іншу вкладку, вона раніше вважалась "чернеткою" й нав'язливо
// пропонувала відновитись при кожному відкритті застосунку, хоча користувач
// нічого сам не вводив.
let formTouchedByUser = false;

// NEW: раніше тут одразу лежало 'Сам' — і воно ніколи не прибиралось при
// виборі реального напарника (бо "Сам" не рендериться як власна фішка,
// яку можна зняти), тож зміна зберігалась як "Сам, Артем" замість просто
// "Артем". Тепер стартуємо з порожнього набору; якщо нічого не обрано —
// нижче (addShift) все одно підставляється рядок "Сам" за замовчуванням.
let coworkerSelection = new Set();

/* ---------- 1. Допоміжні функції ---------- */
/* ---- Заявки зберігаються в IndexedDB, а не в localStorage ----
   Причина (той самий діагноз, що й для фото вище): localStorage має
   жорсткий ліміт (~5-10МБ на весь сайт) і кожне збереження раніше робило
   синхронний JSON.stringify(tickets) прямо в головному потоці — при великій
   базі це і ризик впертись у ліміт, і відчутне "підвисання" при кожному
   збереженні. IndexedDB такого ліміту не має і працює асинхронно, не
   блокуючи інтерфейс. Зберігаємо весь масив одним записом під фіксованим
   ключем (як і фото — по одному значенню на ключ), а не по заявці на запис:
   це найпростіша зміна, що прибирає обидві проблеми, і НЕ вимагає переписувати
   сотні місць у коді, де tickets.find/filter/push використовуються як
   звичайний синхронний масив у пам'яті — вони лишаються без змін. */
/* ---- Фото зберігаються окремо в IndexedDB, а не в localStorage ----
   Причина: localStorage має жорсткий ліміт (~5-10МБ на весь сайт), і при
   великій кількості заявок із фото (base64-рядки по 30-100КБ кожен) це
   швидко призводить до переповнення та втрати даних або «зависання»
   інтерфейсу через величезний JSON.stringify(tickets) при кожному збереженні.
   IndexedDB не має такого практичного лімııту і не блокує основний потік.
   У об'єкті заявки (t.photo) тепер зберігається не сам base64, а ключ
   виду 'idb:<id>'; сирі дані лежать в IndexedDB під цим ключем.
   photoCache — пам'ятковий кеш уже завантажених фото для синхронного рендеру. */
// NEW: та сама Map, але зі стелею розміру (LRU — найдавніше використане
// прибирається першим). Дані все одно завжди лежать в IndexedDB — це лише
// кеш для швидкого синхронного доступу, тож витіснення нічого не губить.
/* NEW: якщо локальної копії фото немає (видалили, очистили дані сайту, новий
   телефон через 2 роки і т.д.), а в заявці збережено tgPhotoFileId — пробуємо
   дотягнутись до резервної копії в Telegram-групі за цим file_id. Успішний
   результат одразу "лікуємо" назад у локальний IndexedDB під тим самим ключем,
   щоб наступного разу вже не ходити в мережу. */
/* Одноразова міграція: старі заявки, де photo — це сам base64-рядок,
   переносяться в IndexedDB, а в заявці залишається лише короткий ключ.
   Це звільняє localStorage і прибирає причину «зависань» на великих базах. */
/* ---------- Історія абонента (пошук збігів по телефону/адресі/MAC) ---------- */
// NEW: розбір "сирого" тексту наряду від диспетчера (вільна форма, як у Telegram-групі) —
// щоб перевірити, чи вже була заявка по цьому абоненту/адресі, ще ДО того, як
// створювати нову. Телефон шукаємо жадібно (будь-які довгі числові послідовності
// з пробілами/дефісами) — це найнадійніший сигнал, бо номер зазвичай пишуть
// без помилок. Адресу шукаємо м'яко, простим збігом слів — тексти диспетчерів
// дуже різношерсті ("вул. Шевченка 21", "Майська 85" без міста тощо), тому
// адресний збіг — лише "можливий", ніколи не точний.

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

async function migrateLegacySyncState(){
  if(typeof MTSingleWriterLock!=='undefined'&&!MTSingleWriterLock.warn()) return false;
  const shiftsMigrationKey='mtSyncV3ShiftsMigrated';
  const legacyTickets=tickets.filter(t=>t.synced===false);
  const hadLegacyTicketFields=tickets.some(t=>Object.prototype.hasOwnProperty.call(t,'synced')||Object.prototype.hasOwnProperty.call(t,'syncAction'));
  const hadLegacyDeletes=deletedTickets.some(t=>Object.prototype.hasOwnProperty.call(t,'pendingCloudDelete'));
  const migrateLegacyShifts=localStorage.getItem(shiftsMigrationKey)!=='1';
  if(legacyTickets.length) await syncEngine.recordDiff('ticket',[],legacyTickets);
  for(const t of deletedTickets.filter(t=>t.pendingCloudDelete)){
    await syncEngine.persistTransition(state=>syncEngine.core.enqueue(state,{entity:'ticket',id:String(t.id),payload:{},delete:true},MTSyncEngineRuntime.uuid));
  }
  if(migrateLegacyShifts && shifts.length) await syncEngine.recordDiff('shift',[],shifts);
  if(migrateLegacyShifts) localStorage.setItem(shiftsMigrationKey,'1');
  tickets.forEach(t=>{delete t.syncAction;delete t.synced;});
  deletedTickets.forEach(t=>{delete t.pendingCloudDelete;});
  if(hadLegacyTicketFields) await ticketsDbPut(tickets);
  if(hadLegacyDeletes) saveDeletedTickets();
}
function isEntitySynced(entity,id){
  if(!syncEngine) return true;
  const record=syncEngine.state.records[MTSyncEngineCore.key(entity,id)];
  return !record || (!record.head && !record.tail);
}
function getEntityConflict(entity,id){
  return syncEngine && typeof syncEngine.conflictFor==='function' ? syncEngine.conflictFor(entity,id) : null;
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
  // NEW: "Завантажити дані з хмари" раніше замінювала заявки лише на
  // id/date/time/content/sum/tags — місто/вулиця/будинок/квартира/ПІБ/
  // телефон/MAC/обладнання/оплата губились назавжди, хоча текст (content)
  // виглядав повним. Кладемо ці поля в окреме поле payload'а (не в
  // backupNote — щоб не роздувати той самий текстовий стовпець) — на боці
  // Apps Script воно йде в окремий стовпець "повніДаніJSON" (див. оновлений
  // скрипт), а при завантаженні з хмари відновлюємо їх назад.
  const fullData = {
    type:t.type, city:t.city, street:t.street, house:t.house, apartment:t.apartment,
    address:t.address, clientName:t.clientName, phone:t.phone, macAddress:t.macAddress,
    payment:t.payment, cashAmount:t.cashAmount, cardAmount:t.cardAmount, itemPayments:t.itemPayments, baseCallFee:t.baseCallFee, callFee:t.callFee, tariff:t.tariff, contractNumber:t.contractNumber,
    equipment:t.equipment, cables:t.cables, presetWorks:t.presetWorks, additionalWork:t.additionalWork,
    note:t.note, otherNote:t.otherNote, abonentNote:t.abonentNote, extraPhones:t.extraPhones,
    signal:t.signal, geoLat:t.geoLat, geoLng:t.geoLng,
    networkPointIds:typeof MTToolsCore!=='undefined'?MTToolsCore.networkPointIds(t.networkPointIds):(Array.isArray(t.networkPointIds)?t.networkPointIds:[])
  };
  return {id:safeId, date:safeDate, time:safeTime, content:t.content, sum:t.sum, tags:t.tags||[], backupNote: backupExtra.join('\n'), fullDataJson: JSON.stringify(fullData)};
}
function shiftToSyncPayload(s){
  return {id:s.id, date:s.date, hours:s.hours, coworker:s.coworker};
}

async function loadFromCloud(){
  showToast('Повне відновлення з хмари вимкнено до окремого recovery protocol');
}


async function sendAllToCloud(){
  showToast('Повна синхронізація вимкнена до окремого recovery protocol'); return;
  backupLocalData();
  // "Відправити все" повністю замінює лист "Заявки" на сервері. Порожня
  // локальна база не є командою очистити Google Sheets: для навмисного
  // очищення існує окремий сценарій clearAll з двома підтвердженнями.
  if(tickets.length === 0){
    showToast('Локальних заявок немає. Масова відправка в Google скасована, щоб випадково не очистити хмарні дані. Для навмисного очищення використовуйте окрему функцію очищення.');
    return;
  }
  const ticketsUrl = getScriptUrl();
  const shiftsUrl = getShiftsScriptUrl();
  if(!ticketsUrl && !shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script у налаштуваннях'); return; }
  if(ticketsUrl){
    const ok = await syncEngine.flush();
    // NEW: раніше після масової відправки статус synced НІЯК не оновлювався —
    // локально всі заявки назавжди лишались "не синхронізовано", хоча дані вже
    // потрапили в таблицю. Це не створювало дублів (Apps Script сам відкидає
    // повтори за id), але зайво ганяло мережу при кожному retry і показувало
    // невірний банер "є несинхронізовані".
    if(ok) renderTicketsScreen();
  }
  if(shiftsUrl){
    // Скрипт змін користувача приймає лише по одній зміні через GET (без
    // масової синхронізації) — емулюємо "відправити все" послідовними
    // запитами додавання; дублікати за ID скрипт сам відфільтрує.
    await syncEngine.flush();
  }
  showToast('Дані надіслано до хмари');
}

/* Окремі функції — працюють ТІЛЬКИ зі змінами, не торкаючись заявок.
   На відміну від loadFromCloud()/sendAllToCloud(), тут URL заявок ігнорується
   навіть якщо "URL Apps Script для змін" не заповнений — це явні кнопки
   саме для блоку "Синхронізація — Зміни", щоб не плутати користувача. */
async function loadShiftsFromCloud(){
  showToast('Повне відновлення змін вимкнено до окремого recovery protocol');
}
/* Дата з таблиці може прийти як ДД.ММ.РРРР (рядок зі скрипта) — вона вже
   в потрібному форматі, але про всяк випадок підтримуємо й конвертацію,
   якщо колись формат зміниться на РРРР-ММ-ДД. */
async function sendShiftsToCloud(){
  showToast('Повна синхронізація змін вимкнена до окремого recovery protocol'); return;
  const shiftsUrl = settings.shiftsScriptUrl ? settings.shiftsScriptUrl.trim() : '';
  if(!shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script для змін'); return; }
  showToast(`Надсилання ${shifts.length} змін...`);
  await syncEngine.flush();
  showToast('Зміни надіслано до хмари (дублікати за ID пропущені автоматично)');
}

/* ---------- 3. Навігація між вкладками ---------- */

/* ---------- 4. Екран «Заявки» ---------- */
/* NEW: розбирає службовий стовпець "нотатки_майстра" (backupNote), який
   повертає таблиця для кожної заявки, і дістає з нього геолокацію та
   приватну примітку майстра — щоб відновити їх при завантаженні з хмари. */
/* ---------- 5. Екран «Калькулятор» ---------- */
/* Перевіряє, чи в калькуляторі є введені дані, які ще не збережені як заявка.
   Використовується, щоб попередити про втрату даних при перемиканні вкладки
   або закритті застосунку — щоб незбережена заявка не «загубилась» випадково. */
/* ---------- 6. Екран «Зміни» ---------- */
/* ---------- 7. Екран «Налаштування» ---------- */
/* ---- Експорт для NotebookLM ---- */
/* ---- Код Apps Script (для довідки користувачу) ---- */

/* ---------- 8. Прив'язка подій та ініціалізація ---------- */

async function sha256Hex(text){
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// NEW: чекає розблокування (якщо захист увімкнено) перш ніж застосунок
// продовжить ініціалізацію — жодні дані абонентів не підвантажуються і не
// малюються до успішного вводу пароля/відбитка.
async function registerBiometricCredential(){
  if(!window.PublicKeyCredential){ showToast('Цей браузер не підтримує вхід за відбитком'); return false; }
  try{
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: {name: 'Майстер-Трекер'},
        user: {id: crypto.getRandomValues(new Uint8Array(16)), name: 'maister', displayName: 'Майстер-Трекер'},
        pubKeyCredParams: [{alg:-7, type:'public-key'}, {alg:-257, type:'public-key'}],
        authenticatorSelection: {authenticatorAttachment:'platform', userVerification:'required'},
        timeout: 30000
      }
    });
    if(!cred) return false;
    settings.appLockCredentialId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    saveSettings();
    return true;
  }catch(err){
    console.error('WebAuthn registration failed:', err);
    showToast('Не вдалося налаштувати відбиток — спробуйте ще раз або лишіть лише пароль');
    return false;
  }
}


async function init(){
  // NEW: тема (data-theme) визначає ВСІ кольорові CSS-змінні (--bg, --text,
  // --accent тощо) — вони не мають запасного значення без цього атрибута.
  // Якщо застосувати тему ПІСЛЯ показу екрана блокування, сам цей екран
  // лишається без кольорів (прозорий фон, змішується зі статичною
  // розміткою під ним) — саме це й сталось на скріншоті. Тема суто
  // косметична і не показує жодних чутливих даних, тож застосовувати її
  // до розблокування абсолютно безпечно.
  applyTheme();
  await ensureAppUnlocked(); // якщо ввімкнено захист входу — чекаємо пароль/відбиток, перш ніж щось малювати чи підвантажувати
  await MTSingleWriterLock.acquire();
  bindTabBar();
  bindTicketsScreen();
  bindCalculatorScreen();
  bindShiftsScreen();
  bindToolsScreen();
  bindSettingsScreen();

  ticketsDb = await openTicketsDb();
  await loadTicketsFromIdb(); // NEW: підвантажує заявки з IndexedDB (з одноразовою міграцією зі старого localStorage, якщо потрібно) — має відбутись ДО міграції фото нижче, бо та проходиться по tickets
  syncTicketsSnapshot = JSON.parse(JSON.stringify(tickets));
  syncShiftsSnapshot = JSON.parse(JSON.stringify(shifts));
  const syncTransport = MTSyncTransport.create({
    fetch: window.fetch.bind(window),
    url: ()=>getScriptUrl(),
    secret: ()=>String(settings.syncHmacSecret||''),
    random: ()=>MTSyncEngineRuntime.uuid(),
    now: ()=>Date.now(),
    postTimeoutMs:8000,
    verifyTimeoutMs:4000,
    verifyDelays:[300,900]
  });
  syncEngine = await new MTSyncEngineRuntime.Engine({
    transport:syncTransport,
    online:()=>navigator.onLine && !!getScriptUrl() && String(settings.syncHmacSecret||'').length>=32,
    onChange:()=>{
      if(document.getElementById('syncQueueBanner')) renderSyncQueueBanner();
      if(document.getElementById('screen-tickets')?.classList.contains('active')) renderTicketsScreen();
      if(document.getElementById('screen-shifts')?.classList.contains('active')) renderShiftsScreen();
    }
  }).init();
  await migrateLegacySyncState();

  photoDb = await openPhotoDb();
  await migrateLegacyPhotosToIdb(); // переносить старі base64-фото з localStorage в IndexedDB (одноразово)

  backupDb = await openBackupDb();
  await maybeRunDailyBackup(); // NEW: раз на день — автоматичний знімок заявок/змін у IndexedDB (10 останніх днів по колу)
  maybeOfferExternalDailyBackup(); // зовнішній файл пропонується раз на день, але завантажується лише після кліку

  renderTicketsScreen();
  resetCalcForm(currentTicketDate);
  renderShiftsScreen();
  renderToolsScreen();
  renderSettingsScreen();

  restoreDraftIfAny();
  setInterval(saveDraftToLocalStorage, 30000);

  maybeShowMonthlyCleanupReminder(); // NEW: 1-го числа кожного місяця — нагадування почистити файли бекапів
  maybeSendMonthlyTelegramReport(); // NEW: 1-го числа кожного місяця — авто-звіт у Telegram собі особисто

  document.getElementById('syncQueueRetryBtn').addEventListener('click', retrySyncQueue);
  window.addEventListener('online', ()=>{
    showToast('Інтернет з\'явився — синхронізую...');
    syncEngine.flush();
    retryPendingTelegramBackups();
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
  // NEW: та сама причина, що й у bindTabBar вище — прибрано editingTicketId===null,
  // яке раніше вимикало це попередження для редагування вже існуючої заявки.
  syncFormToState();
  if(hasUnsavedChanges()){
    e.preventDefault();
    e.returnValue = '';
  }
});

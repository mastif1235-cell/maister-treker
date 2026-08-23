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
const APP_VERSION = 'v64.2 · 2026-08-18';
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
function saveNaryadQueue(){ localStorage.setItem('naryadQueue', JSON.stringify(naryadQueue)); }

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
function saveShifts(){
  shiftsRevision++;
  const before=syncShiftsSnapshot; const after=JSON.parse(JSON.stringify(shifts));
  const persist=syncEngine ? syncEngine.recordDiff('shift',before,after) : Promise.resolve();
  return persist.then(()=>{syncShiftsSnapshot=after;localStorage.setItem('shifts',JSON.stringify(shifts));});
}
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
  }catch(e){ console.error('Telegram photo backup request failed'); return null; }
}
async function collectLocalPhotoData(ticketList){
  const photoData = {};
  const photoKeys = new Set();
  (ticketList||[]).forEach(t=>{
    const keys = (t.photos && t.photos.length) ? t.photos : (t.photo ? [t.photo] : []);
    keys.forEach(key=>{ if(String(key||'').startsWith('idb:')) photoKeys.add(key); });
  });
  let missingPhotos = 0;
  for(const key of photoKeys){
    const dataUrl = await photoDbGet(key);
    if(dataUrl) photoData[key] = dataUrl;
    else missingPhotos++;
  }
  return {photoData, missingPhotos};
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
    if(val){ photoCacheSet(photoKey, val); if(onLoaded) onLoaded(val); }
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
  if(val) photoCacheSet(photoKey, val);
  return val;
}
async function storePhoto(dataUrl){
  const key = 'idb:' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  photoCacheSet(key, dataUrl);
  // Якщо IndexedDB відмовив (наприклад, закінчилось місце), ключ не можна
  // лишати в заявці: прев'ю з пам'яткового кешу зникло б після перезапуску.
  const ok = await photoDbPut(key, dataUrl);
  if(!ok){
    photoCache.delete(key);
    showToast('⚠️ Не вдалося зберегти фото на телефон — не закривайте застосунок, спробуйте ще раз');
    return null;
  }
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
const DAILY_BACKUP_MAX = 10;
// NEW: викликається раз при старті застосунку — якщо сьогодні ще не було
// автобекапу, робить знімок і кладе його в IndexedDB, старший за 10-й видаляє
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
/* ---- Щомісячне нагадування почистити старі файли бекапів у "Завантаженнях" ----
   Застосунок не може сам видаляти файли з "Завантажень" (браузер це навмисно
   забороняє), тож 1-го числа кожного місяця показуємо на весь екран нагадування
   зробити це вручну. Показується один раз за місяць, поки не натиснуть кнопку. */
function maybeShowMonthlyCleanupReminder(){
  const now = new Date();
  if(now.getDate() !== 1) return; // тільки 1-го числа
  const monthKey = localMonthKey(now); // YYYY-MM, локальний час
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
    const sourcePhotos = (t.photos && t.photos.length) ? t.photos : (t.photo ? [t.photo] : []);
    if(!sourcePhotos.length) continue;
    const migratedPhotos = [];
    for(const photo of sourcePhotos){
      if(typeof photo==='string' && photo.startsWith('data:')){
        const key = await storePhoto(photo);
        migratedPhotos.push(key || photo); // якщо IndexedDB недоступний, не губимо старе base64-фото
        if(key) changed = true;
      }else if(photo){
        migratedPhotos.push(photo);
      }
    }
    t.photos = migratedPhotos;
    t.photo = migratedPhotos[0] || null;
  }
  if(changed) saveTickets();
}

function formatPhoneInput(e){
  const el = e.target;
  const prevDigits = el.dataset.prevDigitsCount === undefined ? null : Number(el.dataset.prevDigitsCount);
  const valueShrank = el.value.length < Number(el.dataset.prevLength || 0);
  // NEW: раніше тут одразу обрізали до 10 цифр (.slice(0,10)) — якщо
  // вставити номер з кодом країни (+380671234567, 12 цифр), він обрізався
  // до "3806712345" ДО того, як phoneDigitsToMask встигала прибрати "380" —
  // нормалізація коду країни просто не встигала спрацювати. Тепер обрізку
  // й нормалізацію робить сама phoneDigitsToMask (їй передаємо повний
  // рядок цифр), а тут лише рахуємо їх кількість для розпізнавання
  // видалення символу маски (нижче).
  let digits = el.value.replace(/\D/g,'');
  if(valueShrank && prevDigits !== null && digits.length === prevDigits && digits.length > 0){
    digits = digits.slice(0, -1);
  }
  el.value = phoneDigitsToMask(digits);
  el.dataset.prevDigitsCount = el.value.replace(/\D/g,'').length; // NEW: рахуємо ПІСЛЯ нормалізації — інакше 12 "сирих" цифр не збігалися б із 10 у вже нормалізованому значенні
  el.dataset.prevLength = el.value.length;
}
// NEW: викликати після БУДЬ-ЯКОГО програмного встановлення f_phone.value
// (завантаження заявки, відновлення попереднього значення після зміни типу
// тощо) — щоб formatPhoneInput вище одразу знав правильну кількість цифр і
// коректно розпізнавав видалення символу маски з першого ж натискання.
function syncPhoneFieldMaskState(){
  const el = document.getElementById('f_phone');
  el.dataset.prevDigitsCount = el.value.replace(/\D/g,'').length;
  el.dataset.prevLength = el.value.length;
}
function setDateFieldValue(ddmmyyyy){
  document.getElementById('f_date').value = ddmmyyyy || '';
  document.getElementById('f_dateNative').value = ddmmyyyyToIso(ddmmyyyy);
}
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
  const doClose = opts.onClose || closeModal; // NEW: дозволяє викликачу повернутись до свого контексту (напр. профілю) замість повного закриття
  document.getElementById('modalCloseBtn').onclick = doClose;
  document.getElementById('modalOverlay').addEventListener('click', e=>{ if(e.target.id==='modalOverlay') doClose(); });
  if(opts.onOpen) opts.onOpen(document.getElementById('modalBody'));
}
/* ---------- Історія абонента (пошук збігів по телефону/адресі/MAC) ---------- */
// NEW: розбір "сирого" тексту наряду від диспетчера (вільна форма, як у Telegram-групі) —
// щоб перевірити, чи вже була заявка по цьому абоненту/адресі, ще ДО того, як
// створювати нову. Телефон шукаємо жадібно (будь-які довгі числові послідовності
// з пробілами/дефісами) — це найнадійніший сигнал, бо номер зазвичай пишуть
// без помилок. Адресу шукаємо м'яко, простим збігом слів — тексти диспетчерів
// дуже різношерсті ("вул. Шевченка 21", "Майська 85" без міста тощо), тому
// адресний збіг — лише "можливий", ніколи не точний.
function findNaryadMatches(rawText){
  const phoneKeys = extractPhoneCandidatesFromText(rawText);
  const naryadTokens = new Set(extractAddressTokens(rawText));
  // NEW: номер будинку типу "10 А" в тексті наряду розпадається на два
  // окремих слова ("10" і "а"), а в самій заявці зберігається як один
  // рядок — тому окремо будуємо "сирі" слова БЕЗ фільтра довжини (інакше
  // самотня літера "а" губиться) і додаємо ще й пари сусідніх слів, злиті
  // без пробілу, у порядку появи в тексті — щоб зловити обидва записи.
  const rawWords = String(rawText||'').toLowerCase().replace(/[.,№\/]/g,' ').split(/\s+/).filter(Boolean);
  const naryadHouseCandidates = new Set(rawWords);
  for(let i=0;i<rawWords.length-1;i++){ naryadHouseCandidates.add(rawWords[i]+rawWords[i+1]); }
  const results = [];
  tickets.forEach(t=>{
    const reasons = [];
    const tPhoneKey = normalizePhoneKey(t.phone);
    if(tPhoneKey && phoneKeys.includes(tPhoneKey)) reasons.push({label:'збіг за телефоном', strong:true});
    // NEW: збіг рахуємо лише за ВУЛИЦЕЮ + БУДИНКОМ, а не за містом/селом —
    // назва населеного пункту сама по собі нічого не каже (в одному селі можуть
    // бути десятки заявок на різних вулицях), тож раніше через неї спрацьовував
    // "можливий збіг" навіть для геть різних адрес в тому ж селі.
    const streetTokens = extractAddressTokens(t.street);
    const houseToken = t.house ? String(t.house).toLowerCase().replace(/\s+/g,'').trim() : '';
    // NEW: раніше вимагався збіг УСІХ слів вулиці — але диспетчери часто
    // скорочують багатослівні назви (напр. "Тараса Шевченка" пишуть просто
    // "Шевченка"). Тепер достатньо збігу останнього слова — в українських
    // назвах саме воно зазвичай прізвище, і саме так їх найчастіше скорочують.
    const streetMatch = streetTokens.length>0 && naryadTokens.has(streetTokens[streetTokens.length-1]);
    const houseMatch = houseToken && naryadHouseCandidates.has(houseToken);
    if(streetMatch && houseMatch) reasons.push({label:'можливий збіг за адресою', strong:false});
    if(reasons.length) results.push({ticket:t, reasons});
  });
  // спочатку надійні (телефон), потім лише "можливі"; в межах групи — новіші вище
  results.sort((a,b)=>{
    const aStrong = a.reasons.some(r=>r.strong) ? 1 : 0;
    const bStrong = b.reasons.some(r=>r.strong) ? 1 : 0;
    if(aStrong !== bStrong) return bStrong - aStrong;
    return ticketSortKey(b.ticket) - ticketSortKey(a.ticket); // NEW: числовий ключ замість текстового порівняння дати — див. коментар в addrNavSearchResultsHtml
  });
  return results;
}

function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }
// NEW: "🔍 Повна заявка" на картці профілю абонента (де показано лише
// стислий перелік робіт) — просто показує оригінальний повний текст заявки
// для читання, без переходу в режим редагування.
function showFullTicketText(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  openModal(`${t.type||'Заявка'} · ${t.date||''} ${t.time||''}`, `<div style="white-space:pre-wrap; font-size:14px; line-height:1.5;">${escapeHtml(t.content || '(немає тексту)')}</div>`, {onClose: renderAddressNav});
}

// NEW: "Перевірити наряд" — вставляєш сирий текст від диспетчера (як у Telegram),
// показує, чи вже була заявка по цьому телефону/адресі. Не блокує нічого і
// нічого не створює сама — це просто підказка перед тим, як заводити нову заявку.
// NEW: перехід на "профіль абонента" (адреса з картками), а не одразу в саму
// заявку — так і з результатів пошуку, і з перевірки наряду. Якщо в заявки
// взагалі нема структурованої адреси (місто+вулиця), навігатором туди не
// потрапити — тоді відкриваємо саму заявку як запасний варіант.
function openAddressForTicket(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  const city = (t.city||'').trim();
  const street = (t.street||'').trim();
  if(!city || !street){ closeModal(); editTicket(id); return; }
  const house = (t.house||'').trim() || '(без номера)';
  const apartment = ticketApartmentKey(t); // NEW: без цього фільтр на рівні 'tickets' не знаходив жодної заявки
  addrNavSearchQuery = '';
  addrNavState = {level:'tickets', city, street, house, apartment};
  renderAddressNav();
}
// NEW: черга "сирих" нарядів від диспетчера (окремо від "Перевірити наряд" —
// той інструмент для одноразової перевірки збігів, а це — список того, що
// диспетчер скинув, а ти ще не встиг доїхати й перетворити на заявку).
// Кожен наряд прив'язаний до конкретної дати виконання (не дати додавання!)
// — диспетчер каже "це на післязавтра", ти одразу ставиш післязавтра, і коли
// доходить той день — наряд сам там і чекає.
// Підпис кнопки під датою — кількість ще не виконаних нарядів САМЕ на дату,
// яка зараз переглядається в календарі заявок (оновлюється разом з нею).
function updateNaryadQueueBtn(){
  const btn = document.getElementById('naryadQueueBtn');
  if(!btn) return;
  const pending = naryadQueue.filter(n=>!n.done && naryadItemDate(n, formatDate)===currentTicketDate).length;
  btn.textContent = pending ? `📋 Наряди на цю дату (${pending})` : '📋 Наряди від диспетчера';
}

// Головний список — з навігацією по днях (як і на екрані "Заявки"), щоб
// можна було глянути наперед чи назад, не виходячи звідси.
function showNaryadQueue(date){
  let viewDate = date || currentTicketDate;
  const bodyHtml = `
    <div class="row" style="gap:6px; align-items:center; margin-bottom:12px;">
      <button type="button" class="btn btn-icon" id="naryadQueuePrevDayBtn">‹</button>
      <div style="flex:1; text-align:center; font-weight:700;" id="naryadQueueDateLabel">${escapeHtml(viewDate)}</div>
      <button type="button" class="btn btn-icon" id="naryadQueueNextDayBtn">›</button>
    </div>
    <button type="button" class="btn btn-block" id="naryadQueueAddBtn">➕ Додати наряд</button>
    <div id="naryadQueueListArea" style="margin-top:14px;">${naryadQueueListHtml(naryadQueue, viewDate, tickets, formatDate, escapeHtml)}</div>`;
  openModal('Наряди від диспетчера', bodyHtml, {onOpen: (rootEl)=>{
    const refresh = ()=>{
      document.getElementById('naryadQueueDateLabel').textContent = viewDate;
      document.getElementById('naryadQueueListArea').innerHTML = naryadQueueListHtml(naryadQueue, viewDate, tickets, formatDate, escapeHtml);
    };
    document.getElementById('naryadQueuePrevDayBtn').addEventListener('click', ()=>{ viewDate = shiftDate(viewDate,-1); refresh(); });
    document.getElementById('naryadQueueNextDayBtn').addEventListener('click', ()=>{ viewDate = shiftDate(viewDate,1); refresh(); });
    // NEW: поле вводу — окрема "на весь екран" модалка (див. showAddNaryadModal
    // нижче), а не тісний textarea поруч зі списком
    document.getElementById('naryadQueueAddBtn').addEventListener('click', ()=> showAddNaryadModal(viewDate));
    rootEl.addEventListener('click', e=>{
      const editTicketBtn = e.target.closest('.naryad-queue-edit-ticket-btn');
      if(editTicketBtn){
        // Наряд уже пов'язаний зі збереженою заявкою: відкриваємо саме її
        // стандартним шляхом editTicket, без створення другої форми чи нового ID.
        closeModal();
        editTicket(editTicketBtn.dataset.ticketId);
        return;
      }
      const editNaryadBtn = e.target.closest('.naryad-queue-edit-btn');
      if(editNaryadBtn){
        // Редагуємо саме вихідний наряд у черзі, не створюючи нового запису.
        showAddNaryadModal(viewDate, editNaryadBtn.dataset.id);
        return;
      }
      const doneBtn = e.target.closest('.naryad-queue-done-btn');
      if(doneBtn){
        const n = naryadQueue.find(x=>String(x.id)===doneBtn.dataset.id);
        if(n){ n.done = !n.done; saveNaryadQueue(); refresh(); updateNaryadQueueBtn(); }
        return;
      }
      const delBtn = e.target.closest('.naryad-queue-delete-btn');
      if(delBtn){
        if(!confirm('Прибрати цей наряд з черги?')) return;
        naryadQueue = naryadQueue.filter(x=>String(x.id)!==delBtn.dataset.id);
        saveNaryadQueue();
        refresh();
        updateNaryadQueueBtn();
        return;
      }
      const rescheduleBtn = e.target.closest('.naryad-queue-reschedule-btn');
      if(rescheduleBtn){ showRescheduleNaryadModal(rescheduleBtn.dataset.id); return; }
      const createBtn = e.target.closest('.naryad-queue-create-btn');
      if(createBtn){
        const n = naryadQueue.find(x=>String(x.id)===createBtn.dataset.id);
        if(!n) return;
        // Позначку "виконано" ставимо після збереження заявки, а не тут:
        // форму можна закрити без збереження, і тоді наряд має лишитися в черзі.
        const prefill = {masterNote: n.text};
        const phoneMatch = extractPhoneFromText(n.text);
        if(phoneMatch) prefill.phone = phoneDigitsToMask(phoneMatch);
        showTicketTypePicker(type=> startNewTicketFlow(type, prefill, null, n.id), ()=> showNaryadQueue(viewDate));
      }
    });
  }});
}
// NEW: окрема модалка лише для вставки тексту наряду — поле вводу займає
// майже весь екран (замість тісного блоку поряд зі списком), плюс швидкий
// вибір дати виконання (Сьогодні/Завтра/Післязавтра або довільна дата).
function showAddNaryadModal(defaultDate, editingNaryadId){
  const editingNaryad = editingNaryadId
    ? naryadQueue.find(n=>String(n.id)===String(editingNaryadId))
    : null;
  if(editingNaryadId && !editingNaryad) return;
  const today = formatDate(new Date());
  const initialDate = editingNaryad ? naryadItemDate(editingNaryad, formatDate) : (defaultDate || today);
  const isEditing = !!editingNaryad;
  const bodyHtml = `
    <textarea id="addNaryadInput" placeholder="Встав сюди текст наряду від диспетчера…" style="min-height:90px; width:calc(100% + 32px); margin-left:-16px; margin-right:-16px; border-radius:0;">${escapeHtml(editingNaryad ? editingNaryad.text : '')}</textarea>
    <div class="row" style="gap:6px; margin-top:10px;">
      <button type="button" class="btn btn-sm addNaryadDateBtn" data-date="${today}" style="flex:1;">Сьогодні</button>
      <button type="button" class="btn btn-sm addNaryadDateBtn" data-date="${shiftDate(today,1)}" style="flex:1;">Завтра</button>
      <button type="button" class="btn btn-sm addNaryadDateBtn" data-date="${shiftDate(today,2)}" style="flex:1;">Післязавтра</button>
    </div>
    <div class="field" style="margin-top:10px;">
      <label>Дата виконання</label>
      <input type="date" id="addNaryadDateInput" value="${ddmmyyyyToIso(initialDate)}">
    </div>
    <button type="button" class="btn btn-block btn-accent" id="addNaryadSaveBtn" style="margin-top:12px;">${isEditing ? '✅ Зберегти зміни' : '✅ Додати в чергу'}</button>`;
  openModal(isEditing ? 'Редагувати наряд' : 'Новий наряд', bodyHtml, {onClose: ()=> showNaryadQueue(initialDate), onOpen: ()=>{
    document.getElementById('addNaryadInput').focus();
    document.querySelectorAll('.addNaryadDateBtn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ document.getElementById('addNaryadDateInput').value = ddmmyyyyToIso(btn.dataset.date); });
    });
    document.getElementById('addNaryadSaveBtn').addEventListener('click', ()=>{
      const text = document.getElementById('addNaryadInput').value.trim();
      if(!text){ showToast('Встав текст наряду'); return; }
      const chosenDate = isoToDdmmyyyy(document.getElementById('addNaryadDateInput').value) || initialDate;
      if(editingNaryad){
        // Зберігаємо той самий об'єкт: ID, createdAt, done і ticketId не
        // змінюються. Оновлюються лише поля, доступні у формі створення.
        editingNaryad.text = text;
        editingNaryad.date = chosenDate;
        saveNaryadQueue();
        updateNaryadQueueBtn();
        showToast('Наряд оновлено');
        showNaryadQueue(chosenDate);
        return;
      }
      const now = new Date();
      naryadQueue.push({id: Date.now(), text, date: chosenDate, createdAt: `${formatDate(now)} ${formatTime(now)}`, done: false});
      saveNaryadQueue();
      updateNaryadQueueBtn();
      // NEW: одразу перевіряємо, чи це вже знайомий абонент (за телефоном
      // чи адресою з тексту наряду) — наряд у будь-якому разі вже додано,
      // це лише підказка з можливістю одразу перейти в профіль і глянути
      // попередні заявки, перш ніж їхати на об'єкт.
      const matches = findNaryadMatches(text);
      if(matches.length){ showNaryadMatchResultsModal(matches, chosenDate); }
      else{ showNaryadQueue(chosenDate); }
    });
  }});
}
// NEW: результат перевірки збігів одразу після додавання наряду — той самий
// вигляд карток, що й у "Перевірити наряд", з кнопкою переходу в профіль
// абонента для перегляду попередніх заявок.
function showNaryadMatchResultsModal(matches, continueDate){
  const bodyHtml = `
    <div style="font-size:12.5px; color:var(--text-faint); margin-bottom:10px;">Наряд уже додано в чергу. Знайдено схожі заявки — можливо, це той самий абонент:</div>
    <div>${naryadMatchesHtml(matches, escapeHtml)}</div>
    <button type="button" class="btn btn-block" id="naryadMatchContinueBtn" style="margin-top:10px;">➡️ До черги нарядів</button>`;
  openModal('⚠️ Знайдено збіг', bodyHtml, {onClose: ()=> showNaryadQueue(continueDate), onOpen: (rootEl)=>{
    document.getElementById('naryadMatchContinueBtn').addEventListener('click', ()=> showNaryadQueue(continueDate));
    rootEl.addEventListener('click', e=>{
      const btn = e.target.closest('.open-address-btn');
      if(btn) openAddressForTicket(btn.dataset.id);
    });
  }});
}
// NEW: "🔁 Перенести" на нарядi — абонент попросив на інший день, тож
// потрібно швидко перекласти цей самий наряд на нову дату, не видаляючи й
// не створюючи заново.
function showRescheduleNaryadModal(id){
  const n = naryadQueue.find(x=>String(x.id)===String(id));
  if(!n) return;
  const today = formatDate(new Date());
  const curDate = naryadItemDate(n, formatDate);
  const preview = n.text.length>200 ? n.text.slice(0,200)+'…' : n.text;
  const bodyHtml = `
    <div style="font-size:13px; color:var(--text-dim); margin-bottom:10px; white-space:pre-wrap;">${escapeHtml(preview)}</div>
    <div style="font-size:12.5px; color:var(--text-faint); margin-bottom:10px;">Зараз стоїть на: ${escapeHtml(curDate)}</div>
    <div class="row" style="gap:6px;">
      <button type="button" class="btn btn-sm rescheduleNaryadDateBtn" data-date="${today}" style="flex:1;">Сьогодні</button>
      <button type="button" class="btn btn-sm rescheduleNaryadDateBtn" data-date="${shiftDate(today,1)}" style="flex:1;">Завтра</button>
      <button type="button" class="btn btn-sm rescheduleNaryadDateBtn" data-date="${shiftDate(today,7)}" style="flex:1;">+ Тиждень</button>
    </div>
    <div class="field" style="margin-top:10px;">
      <label>Або оберіть дату</label>
      <input type="date" id="rescheduleNaryadDateInput" value="${ddmmyyyyToIso(curDate)}">
    </div>
    <button type="button" class="btn btn-block btn-accent" id="rescheduleNaryadSaveBtn" style="margin-top:12px;">✅ Перенести</button>`;
  openModal('Перенести наряд', bodyHtml, {onClose: ()=> showNaryadQueue(curDate), onOpen: ()=>{
    document.querySelectorAll('.rescheduleNaryadDateBtn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ document.getElementById('rescheduleNaryadDateInput').value = ddmmyyyyToIso(btn.dataset.date); });
    });
    document.getElementById('rescheduleNaryadSaveBtn').addEventListener('click', ()=>{
      const newDate = isoToDdmmyyyy(document.getElementById('rescheduleNaryadDateInput').value);
      if(!newDate){ showToast('Оберіть дату'); return; }
      n.date = newDate;
      saveNaryadQueue();
      updateNaryadQueueBtn();
      showToast('Наряд перенесено на ' + newDate);
      showNaryadQueue(newDate);
    });
  }});
}


function showNaryadChecker(){
  const bodyHtml = `
    <textarea id="naryadInput" placeholder="Встав сюди текст наряду від диспетчера…" style="min-height:90px;"></textarea>
    <button type="button" class="btn btn-block" id="naryadCheckBtn" style="margin-top:8px;">🔎 Перевірити</button>
    <div style="font-size:11.5px; color:var(--text-faint); margin-top:6px;">Збіг за телефоном — надійний. Збіг за адресою — лише підказка: за одним будинком можуть жити різні абоненти.</div>
    <div id="naryadResults" style="margin-top:14px;"></div>
    <div style="font-size:11.5px; color:var(--text-faint); margin:14px 0 6px;">Якщо збігів немає — це нова заявка:</div>
    <div class="row" style="gap:8px;">
      <button type="button" class="btn btn-block" id="naryadNewConnectBtn" style="flex:1;">🔌 Підключення</button>
      <button type="button" class="btn btn-block" id="naryadNewRepairBtn" style="flex:1;">🛠️ Ремонт</button>
    </div>
    <button type="button" class="btn btn-block" id="naryadBackBtn" style="margin-top:8px;">⬅ Назад до пошуку</button>`;
  openModal('Перевірити наряд', bodyHtml, {onClose: renderAddressNav, onOpen: (rootEl)=>{
    const runCheck = ()=>{
      const text = document.getElementById('naryadInput').value.trim();
      const resultsEl = document.getElementById('naryadResults');
      if(!text){ resultsEl.innerHTML = ''; return; }
      resultsEl.innerHTML = naryadMatchesHtml(findNaryadMatches(text), escapeHtml);
    };
    document.getElementById('naryadCheckBtn').addEventListener('click', runCheck);
    rootEl.addEventListener('click', e=>{
      const btn = e.target.closest('.open-address-btn');
      if(btn){ openAddressForTicket(btn.dataset.id); }
    });
    // NEW: створити заявку прямо звідси, не виходячи в загальний список —
    // вставлений текст наряду переносимо в зміст заявки, а якщо в тексті
    // знайшовся номер телефону — підставляємо і його. Тип обирається кнопкою,
    // окремий пікер тут не потрібен, бо диспетчер завжди каже, підключення це
    // чи ремонт.
    const startFromNaryad = type=>{
      const rawText = document.getElementById('naryadInput').value.trim();
      const prefill = {};
      // NEW: те саме виправлення, що й вище — текст наряду в masterNote
      // (приватна примітка "🔒 Тільки для вас", ніколи не летить диспетчеру),
      // а не в note (яке потрапляє в текст заявки для диспетчера) чи в
      // content (перезаписувався і губився).
      if(rawText) prefill.masterNote = rawText;
      const phoneMatch = extractPhoneFromText(rawText);
      if(phoneMatch) prefill.phone = phoneDigitsToMask(phoneMatch);
      startNewTicketFlow(type, prefill, {...addrNavState});
    };
    document.getElementById('naryadNewConnectBtn').addEventListener('click', ()=> startFromNaryad('Підключення'));
    document.getElementById('naryadNewRepairBtn').addEventListener('click', ()=> startFromNaryad('Ремонт'));
    document.getElementById('naryadBackBtn').addEventListener('click', renderAddressNav);
  }});
}

/* ---------- Навігатор адрес: Місто → Вулиця → Будинок → Заявки ---------- */
// NEW: чотирирівневий пошук по факту заявок (а не по довіднику settings.cities/streets,
// щоб туди потрапляло геть усе, включно з тим, що було записано до автопрописки).
// Заявки, відновлені з хмари (cloudImported), потрапляють сюди лише якщо для них
// вручну дозаповнили місто й вулицю (поля city/street/house видно й редагуються
// навіть у "сирому" режимі) — критерій саме заповненість полів, а не сам прапорець.
let addrNavState = {level:'city', city:null, street:null, house:null, apartment:null};
let addrNavSearchQuery = ''; // NEW: глобальний пошук за ім'ям/телефоном/адресою (працює одразу по всіх заявках, не лише в межах вибраного міста/вулиці)
// NEW: якщо заявку відкрили на редагування з профілю абонента (навігатор
// адрес) — запам'ятовуємо, куди повернутись після скасування/збереження,
// замість того, щоб завжди приземлятись на звичайний список "Заявки".
let editReturnAddrState = null;
function returnAfterTicketEdit(){
  switchTab('tickets');
  if(editReturnAddrState){
    addrNavState = editReturnAddrState;
    editReturnAddrState = null;
    renderAddressNav();
  }
}

// NEW: маленький пікер типу заявки — використовується і на головній кнопці
// "+ Заявка", і на кнопці створення заявки в профілі абонента, і на кнопці
// створення заявки прямо з екрана пошуку навігатора адрес.
function showTicketTypePicker(onPick, onCancel){
  openModal('Оберіть тип заявки', `
    <div style="display:flex; flex-direction:column; gap:10px;">
      <button type="button" class="btn btn-block ticket-type-pick-btn" data-type="Підключення">🔌 Підключення</button>
      <button type="button" class="btn btn-block ticket-type-pick-btn" data-type="Ремонт">🛠️ Ремонт</button>
      <button type="button" class="btn btn-block ticket-type-pick-btn" data-type="Інше">📋 Інше</button>
    </div>`, {onClose: onCancel || closeModal, onOpen: (rootEl)=>{
    rootEl.querySelectorAll('.ticket-type-pick-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ closeModal(); onPick(btn.dataset.type); });
    });
  }});
}

// NEW: відкриває порожню форму заявки з уже обраним типом і (за наявності)
// підставленими даними абонента з профілю. Якщо передано returnState —
// запам'ятовуємо, куди повернутись (як і при редагуванні з профілю), і
// показуємо кнопку "Назад" замість "Скасувати редагування", бо це нова
// заявка, а не редагування наявної.
function startNewTicketFlow(type, prefill, returnState, naryadIdToComplete){
  closeModal(); // на випадок, якщо запуск стався з модалки пошуку/профілю
  resetCalcForm(formatDate(new Date()), Object.assign({type}, prefill||{}));
  naryadPendingCompletionId = naryadIdToComplete || null;
  if(returnState){
    editReturnAddrState = {...returnState};
    const cancelBtn = document.getElementById('cancelEditBtn');
    cancelBtn.textContent = '⬅ Назад до пошуку';
    cancelBtn.classList.remove('hidden');
  }
  switchTab('calculator');
}

// NEW: один будинок може мати кілька квартир з РІЗНИМИ абонентами — тому
// "профіль" будується не просто на рівні будинку, а на рівні будинок+квартира.
// Якщо квартира не вказана, всі такі заявки потрапляють в один спільний
// "профіль" (приватний будинок без поділу на квартири).

function openAddressNavigator(){
  addrNavState = {level:'city', city:null, street:null, house:null, apartment:null};
  addrNavSearchQuery = ''; // NEW
  renderAddressNav();
}


// NEW: пошук одразу по всіх заявках за іменем, телефоном (частково, досить
// набрати кілька цифр) або будь-яким словом з адреси — щоб не обов'язково
// пам'ятати точну адресу, а можна було знайти абонента "як завгодно".


// NEW: компактна кнопка-профіль для списків (профілі в будинку, результати
// пошуку) — лише ім'я/телефон/адреса/кількість заявок, тап веде всередину
// до повного профілю з картками. Той самий вигляд в обох місцях.

// NEW: "профіль" абонента — шапка над списком заявок конкретного будинку:
// ім'я + телефон (з найсвіжішої заявки, де вони заповнені) + скільки разів
// тут були. Якщо в різних заявках траплялись РІЗНІ імена/телефони — показуємо
// це окремим попередженням, а не тихо обираємо один варіант, бо за однією
// адресою можуть бути різні люди (сусід, родич тощо).
// NEW: редагування ПІБ/телефону/адреси/логіна/пароля/договору просто з
// профілю абонента (навігатор адрес) — застосовується одразу до ВСІХ
// заявок за цією адресою: де було порожньо — додасть, де вже було —
// виправить. Синхронізацію в хмару/Telegram для кожної із заявок при
// цьому НЕ запускаємо (щоб не заспамити Telegram повідомленнями за кожну
// заявку одразу) — вони підхоплять зміну при наступному звичайному
// збереженні.
function showEditAbonentProfile(profileJson){
  let data;
  try{ data = JSON.parse(profileJson); }catch(e){ return; }
  const ids = data.ids || [];
  const bodyHtml = `
    <div class="row" style="gap:10px;">
      <div class="field" style="flex:1;"><label>Місто</label><input type="text" id="abonentEditCity" list="abonentEditCityDatalist" autocomplete="off" value="${escapeHtml(data.city||'')}"><datalist id="abonentEditCityDatalist"></datalist></div>
      <div class="field" style="flex:2;"><label>Вулиця</label><input type="text" id="abonentEditStreet" list="abonentEditStreetDatalist" autocomplete="off" value="${escapeHtml(data.street||'')}"><datalist id="abonentEditStreetDatalist"></datalist></div>
    </div>
    <div class="row" style="gap:10px; margin-top:10px;">
      <div class="field" style="flex:1;"><label>Будинок</label><input type="text" id="abonentEditHouse" value="${escapeHtml(data.house||'')}"></div>
      <div class="field" style="flex:1;"><label>Квартира</label><input type="text" id="abonentEditApartment" value="${escapeHtml(data.apartment||'')}"></div>
    </div>
    <div class="field" style="margin-top:10px;"><label>ПІБ</label><input type="text" id="abonentEditName" value="${escapeHtml(data.clientName||'')}"></div>
    <div class="field" style="margin-top:10px;"><label>Телефон</label><input type="text" id="abonentEditPhone" value="${escapeHtml(data.phone||'')}"></div>
    <div class="field" style="margin-top:10px;">
      <label>Додаткові телефони</label>
      <div id="abonentEditExtraPhonesList"></div>
      <button type="button" class="btn btn-sm" id="abonentEditAddPhoneBtn" style="margin-top:6px;">➕ Додати телефон</button>
    </div>
    <div class="field" style="margin-top:10px;"><label>Примітка (про абонента)</label><textarea id="abonentEditNote" style="min-height:60px;">${escapeHtml(data.note||'')}</textarea></div>
    <div class="field" style="margin-top:10px;"><label>Логін</label><input type="text" id="abonentEditLogin" value="${escapeHtml(data.login||'')}"></div>
    <div class="field" style="margin-top:10px;"><label>Пароль</label><input type="text" id="abonentEditPassword" value="${escapeHtml(data.password||'')}"></div>
    <div class="field" style="margin-top:10px;"><label>№ договору</label><input type="text" id="abonentEditContract" value="${escapeHtml(data.contractNumber||'')}"></div>
    <div style="font-size:11.5px; color:var(--text-faint); margin-top:8px;">Застосується до всіх заявок за цією адресою (${ids.length} шт.) — де вже було заповнено, зміниться; де не було — додасться.</div>
    <button type="button" class="btn btn-block" id="abonentEditSaveBtn" style="margin-top:12px;">Зберегти</button>`;
  openModal('Редагувати абонента', bodyHtml, {onClose: renderAddressNav, onOpen: ()=>{
    // NEW: та сама маска телефону (050)555-55-55, що й у калькуляторі, плюс
    // одразу приводимо вже наявне значення до маски (могло бути внесене
    // раніше у "сирому" вигляді, з таблиці тощо)
    const abonentEditPhoneEl = document.getElementById('abonentEditPhone');
    abonentEditPhoneEl.addEventListener('input', formatPhoneInput);
    formatPhoneInput({target: abonentEditPhoneEl});
    // NEW: додаткові телефони — рядки додаються/видаляються прямо в DOM
    // (без перерендеру всієї модалки, щоб не губити те, що вже надруковано
    // в інших полях); кожен новий рядок одразу отримує ту саму маску.
    const extraPhonesWrap = document.getElementById('abonentEditExtraPhonesList');
    function addAbonentExtraPhoneRow(value){
      const row = document.createElement('div');
      row.className = 'row abonent-extra-phone-row';
      row.style.cssText = 'gap:6px; margin-top:6px;';
      row.innerHTML = `<input type="text" class="abonent-extra-phone-input" value="${escapeHtml(value||'')}" style="flex:1;"><button type="button" class="btn btn-sm btn-danger abonent-extra-phone-remove">✕</button>`;
      extraPhonesWrap.appendChild(row);
      const inp = row.querySelector('.abonent-extra-phone-input');
      inp.addEventListener('input', formatPhoneInput);
      row.querySelector('.abonent-extra-phone-remove').addEventListener('click', ()=> row.remove());
    }
    (data.extraPhones||[]).forEach(p=> addAbonentExtraPhoneRow(p));
    document.getElementById('abonentEditAddPhoneBtn').addEventListener('click', ()=> addAbonentExtraPhoneRow(''));
    // NEW: ті самі підказки міст/вулиць (через <datalist>), що й у формі
    // створення заявки — вулиці підвантажуються окремо для кожного міста
    // і оновлюються при зміні поля "Місто"
    const abonentEditCityEl = document.getElementById('abonentEditCity');
    const abonentEditCityDl = document.getElementById('abonentEditCityDatalist');
    const abonentEditStreetDl = document.getElementById('abonentEditStreetDatalist');
    abonentEditCityDl.innerHTML = (settings.cities||[]).map(c=>`<option value="${escapeHtml(c)}"></option>`).join('');
    const updateAbonentEditStreetDl = city=>{
      const list = (settings.streets && settings.streets[city]) || [];
      abonentEditStreetDl.innerHTML = list.map(s=>`<option value="${escapeHtml(s)}"></option>`).join('');
    };
    updateAbonentEditStreetDl(data.city||'');
    abonentEditCityEl.addEventListener('input', e=> updateAbonentEditStreetDl(e.target.value.trim()));
    document.getElementById('abonentEditSaveBtn').addEventListener('click', ()=>{
      const vals = {
        city: document.getElementById('abonentEditCity').value.trim(),
        street: document.getElementById('abonentEditStreet').value.trim(),
        house: document.getElementById('abonentEditHouse').value.trim(),
        apartment: document.getElementById('abonentEditApartment').value.trim(),
        clientName: document.getElementById('abonentEditName').value.trim(),
        phone: document.getElementById('abonentEditPhone').value.trim(),
        extraPhones: Array.from(document.querySelectorAll('.abonent-extra-phone-input')).map(inp=>inp.value.trim()).filter(Boolean),
        note: document.getElementById('abonentEditNote').value.trim(),
        login: document.getElementById('abonentEditLogin').value.trim(),
        password: document.getElementById('abonentEditPassword').value.trim(),
        contractNumber: document.getElementById('abonentEditContract').value.trim()
      };
      // NEW: адреса застосовується одразу до ВСІХ заявок цього профілю —
      // якщо її справді змінили (а не просто ПІБ/телефон/тощо), попереджаємо,
      // скільки заявок "переїде" на нову адресу, щоб не зробити це випадково
      const addressChanged = vals.city!==(data.city||'') || vals.street!==(data.street||'') || vals.house!==(data.house||'') || vals.apartment!==(data.apartment||'');
      if(addressChanged){
        const sure = confirm(`Адресу змінено — вона застосується до ${ids.length} заявок(и) за старою адресою (вони «переїдуть» на нову). Якщо це насправді інший абонент — краще скасувати й створити нову заявку з новою адресою. Продовжити?`);
        if(!sure) return;
      }
      ids.forEach(id=>{
        const t = tickets.find(x=>String(x.id)===String(id));
        if(t){
          t.city = vals.city; t.street = vals.street; t.house = vals.house; t.apartment = vals.apartment;
          t.address = [[vals.street, vals.house].filter(Boolean).join(' '), vals.apartment ? `кв. ${vals.apartment}` : ''].filter(Boolean).join(', ');
          t.clientName = vals.clientName; t.phone = vals.phone; t.extraPhones = vals.extraPhones; t.abonentNote = vals.note;
          t.login = vals.login; t.password = vals.password; t.contractNumber = vals.contractNumber;
          // NEW: раніше після масової правки профілю текст заявки (t.content)
          // залишався СТАРИМ — диспетчеру при пересиланні/копіюванні летіло
          // старе ім'я/адреса/телефон, хоча в самій заявці все вже виправлено.
          // Для звичайних (не raw) заявок перебудовуємо текст з новими даними.
          if(!t.cloudImported) t.content = buildTicketContent(t, Number(t.sum)||0);
          // Профіль змінює вже наявну заявку, тому повтор має йти update,
          // а не add: сервер оновлює рядок по stable id без delete-вікна.
        }
      });
      saveTickets();
      showToast('Дані абонента оновлено');
      // NEW: якщо адресу виправили — навігатор слідує за заявками на їхню
      // нову адресу, а не лишається дивитись на порожнє місце
      addrNavState = {level:'tickets', city: vals.city, street: vals.street, house: vals.house || '(без номера)', apartment: vals.apartment || '(без кв.)'};
      renderAddressNav();
    });
  }});
}

function renderAddressNav(){
  const title = addrNavTitle();
  const topHtml = `
    <div class="row" style="gap:6px; margin-bottom:10px;">
      <input type="text" id="addrNavSearchInput" placeholder="Пошук за ім'ям, телефоном або адресою" value="${escapeHtml(addrNavSearchQuery)}" style="flex:1;" autocomplete="off">
      <button type="button" class="btn btn-icon" id="addrNavClearSearchBtn" title="Очистити пошук">✕</button>
    </div>
    <button type="button" class="btn btn-block" id="openNaryadCheckerBtn" style="margin-bottom:12px;">📋 Перевірити наряд</button>
    <div id="addrNavResultsArea">${addrNavResultsAreaHtml()}</div>`;
  openModal(title, topHtml, {onOpen: attachAddressNavHandlers});
}

function attachAddressNavHandlers(rootEl){
  // NEW: пошук — оновлюємо лише результати (не весь модал), щоб не губити фокус/курсор у полі вводу
  const searchInput = document.getElementById('addrNavSearchInput');
  const refreshAddrNavResults = ()=>{
    document.getElementById('addrNavResultsArea').innerHTML = addrNavResultsAreaHtml();
    const titleEl = document.querySelector('.modal-head h3');
    if(titleEl) titleEl.textContent = addrNavTitle();
  };
  if(searchInput){
    searchInput.addEventListener('input', ()=>{
      addrNavSearchQuery = searchInput.value;
      refreshAddrNavResults();
    });
  }
  const clearSearchBtn = document.getElementById('addrNavClearSearchBtn');
  if(clearSearchBtn){
    clearSearchBtn.addEventListener('click', ()=>{
      addrNavSearchQuery = '';
      if(searchInput) searchInput.value = '';
      refreshAddrNavResults();
    });
  }
  const naryadBtn = document.getElementById('openNaryadCheckerBtn');
  if(naryadBtn) naryadBtn.addEventListener('click', showNaryadChecker);

  rootEl.addEventListener('click', e=>{
    const crumb = e.target.closest('.addr-nav-crumb');
    if(crumb){
      const to = crumb.dataset.crumb;
      if(to==='city') addrNavState = {level:'city', city:null, street:null, house:null, apartment:null};
      else if(to==='street'){ addrNavState.level='street'; addrNavState.street=null; addrNavState.house=null; addrNavState.apartment=null; }
      else if(to==='house'){ addrNavState.level='house'; addrNavState.house=null; addrNavState.apartment=null; }
      else if(to==='profiles'){ addrNavState.level='profiles'; addrNavState.apartment=null; }
      renderAddressNav(); return;
    }
    const cityBtn = e.target.closest('.addr-nav-city-btn');
    if(cityBtn){ addrNavState = {level:'street', city:cityBtn.dataset.city, street:null, house:null, apartment:null}; renderAddressNav(); return; }
    const streetBtn = e.target.closest('.addr-nav-street-btn');
    if(streetBtn){ addrNavState.level='house'; addrNavState.street=streetBtn.dataset.street; addrNavState.house=null; addrNavState.apartment=null; renderAddressNav(); return; }
    const houseBtn = e.target.closest('.addr-nav-house-btn');
    if(houseBtn){
      addrNavState.house = houseBtn.dataset.house;
      // NEW: якщо в цьому будинку заявки лише по одній квартирі (чи квартира
      // взагалі не використовується) — одразу показуємо профіль, не змушуючи
      // тапати зайвий раз; якщо квартир кілька — спершу список профілів.
      const groups = getApartmentGroupsForHouse(addrNavState.city, addrNavState.street, addrNavState.house);
      if(groups.size <= 1){
        addrNavState.apartment = groups.size ? [...groups.keys()][0] : '(без кв.)';
        addrNavState.level = 'tickets';
      } else {
        addrNavState.level = 'profiles';
        addrNavState.apartment = null;
      }
      renderAddressNav(); return;
    }
    const profileBtn = e.target.closest('.addr-profile-btn');
    if(profileBtn){
      // NEW: результати пошуку несуть повну адресу в data-*, а кнопки
      // всередині одного будинку (рівень 'profiles') — лише квартиру
      if(profileBtn.dataset.city) addrNavState.city = profileBtn.dataset.city;
      if(profileBtn.dataset.street) addrNavState.street = profileBtn.dataset.street;
      if(profileBtn.dataset.house) addrNavState.house = profileBtn.dataset.house;
      addrNavState.apartment = profileBtn.dataset.apartment;
      addrNavState.level = 'tickets';
      addrNavSearchQuery = '';
      renderAddressNav(); return;
    }
    // NEW: фото абонента підвантажується лише за тапом на кнопку — не сама
    // собою при відкритті профілю, і не зберігається на телефоні окремо від
    // звичайного кешу фото заявок (той самий IndexedDB, що й завжди). Кнопку
    // тепер можна натиснути повторно, щоб знову приховати фото — раніше вона
    // ховалась назавжди після першого показу.
    const photoBtn = e.target.closest('.abonent-photo-btn');
    if(photoBtn){
      const wrap = document.getElementById(photoBtn.dataset.wrapId);
      if(!wrap) return;
      // NEW: галерея фото з УСІХ заявок за адресою (не одне фото) — той самий
      // підхід, що й у toggleTicketCardPhoto: підвантажуємо всі паралельно,
      // кожне у своїй мініатюрі, тап по мініатюрі відкриває на весь екран.
      if(!wrap.classList.contains('hidden')){
        wrap.classList.add('hidden');
        photoBtn.textContent = photoBtn.dataset.origLabel || photoBtn.textContent;
        return;
      }
      if(wrap.dataset.loaded === '1'){
        wrap.classList.remove('hidden');
        photoBtn.textContent = '🔼 Сховати фото';
        return;
      }
      let keys = [], fileIds = [];
      try{ keys = JSON.parse(photoBtn.dataset.photoKeys || '[]'); }catch(err){ keys = []; }
      try{ fileIds = JSON.parse(photoBtn.dataset.tgFileIds || '[]'); }catch(err){ fileIds = []; }
      keys = keys.filter(Boolean);
      if(!keys.length) return;
      photoBtn.dataset.origLabel = photoBtn.textContent;
      photoBtn.disabled = true; photoBtn.textContent = '⏳ Завантаження…';
      Promise.all(keys.map((key, i)=> resolvePhotoAsync(key, fileIds[i] || null))).then(values=>{
        photoBtn.disabled = false;
        const loadedAny = values.some(Boolean);
        if(!loadedAny){ photoBtn.textContent = '📷 Не вдалося завантажити, спробувати ще раз'; return; }
        wrap.innerHTML = values.map((val,i)=> val ? `<img src="${val}" class="tc-photo-thumb" data-full="${val}" alt="фото ${i+1}" style="width:96px; height:96px; object-fit:cover; border-radius:10px; cursor:pointer;">` : '').join('');
        wrap.dataset.loaded = '1';
        wrap.classList.remove('hidden');
        photoBtn.textContent = '🔼 Сховати фото';
      });
      return;
    }
    // NEW: редагування даних абонента (адреса/ПІБ/телефон/логін/пароль/договір)
    // прямо з профілю — застосується одразу до всіх заявок за цією адресою
    const editProfileBtn = e.target.closest('.abonent-edit-btn');
    if(editProfileBtn){
      showEditAbonentProfile(editProfileBtn.dataset.profile);
      return;
    }
    // NEW: "➕ Заявка" в профілі — та сама форма створення заявки, але з уже
    // підставленими даними абонента; повертаємось сюди ж після збереження
    const newTicketBtn = e.target.closest('.abonent-new-ticket-btn');
    if(newTicketBtn){
      let prefill = {};
      try{ prefill = JSON.parse(newTicketBtn.dataset.prefill || '{}'); }catch(err){ prefill = {}; }
      showTicketTypePicker(type=> startNewTicketFlow(type, prefill, {...addrNavState}), renderAddressNav);
      return;
    }
    // NEW: редагування геолокації прямо з профілю — не лише "Перейти"
    const geoEditBtn = e.target.closest('.abonent-geo-edit-btn');
    if(geoEditBtn){
      let ids = [];
      try{ ids = JSON.parse(geoEditBtn.dataset.ids || '[]'); }catch(err){ ids = []; }
      openAbonentGeoEditModal(ids, geoEditBtn.dataset.geoLink || '');
      return;
    }
    // NEW: редагування примітки про абонента прямо з профілю — без заходу
    // у повне "Редагувати абонента"
    const noteEditBtn = e.target.closest('.abonent-note-edit-btn');
    if(noteEditBtn){
      let ids = [];
      try{ ids = JSON.parse(noteEditBtn.dataset.ids || '[]'); }catch(err){ ids = []; }
      openAbonentNoteEditModal(ids, noteEditBtn.dataset.note || '');
      return;
    }
    // NEW: "🔍 Повна заявка" — лише перегляд оригінального тексту, без edit-режиму
    const viewFullBtn = e.target.closest('.view-full-ticket-btn');
    if(viewFullBtn){ showFullTicketText(viewFullBtn.dataset.id); return; }
    // NEW: "🗓️ На дату" — перейти в основний список заявок на день, коли
    // саме ця заявка була зроблена (замість гортати вручну по днях)
    const jumpDateBtn = e.target.closest('.jump-to-date-btn');
    if(jumpDateBtn){
      const t = tickets.find(x=>String(x.id)===String(jumpDateBtn.dataset.id));
      if(t){ currentTicketDate = t.date; closeModal(); switchTab('tickets'); renderTicketsScreen(); }
      return;
    }
    // NEW: далі — ті самі дії, що й на звичайних картках заявок у списку
    const editBtn = e.target.closest('.edit-ticket-btn');
    if(editBtn){
      editReturnAddrState = {...addrNavState}; // NEW: щоб після скасування/збереження повернутись саме сюди, а не на головний список
      closeModal(); editTicket(editBtn.dataset.id); return;
    }
    const shareBtn = e.target.closest('.share-ticket-btn');
    if(shareBtn){ shareTicket(shareBtn.dataset.id); return; }
    const tgBtn = e.target.closest('.tg-dispatcher-btn');
    if(tgBtn){ sendTicketToDispatcher(tgBtn.dataset.id); return; }
    const tgOpenBtn = e.target.closest('.tg-open-btn');
    if(tgOpenBtn){ openTicketInTelegram(tgOpenBtn.dataset.id); return; }
    const retryTgBtn = e.target.closest('.retry-tg-btn');
    if(retryTgBtn){ retryTelegramBackup(retryTgBtn.dataset.id); return; }
    const retrySyncBtn = e.target.closest('.retry-sync-btn');
    if(retrySyncBtn){ retrySyncTicket(retrySyncBtn.dataset.id); return; }
    const copyBtn = e.target.closest('.copy-ticket-btn');
    if(copyBtn){ copyTicketCardText(copyBtn.dataset.id); return; }
    const dgBtn = e.target.closest('.contract-ticket-btn');
    if(dgBtn){ showDogovor(dgBtn.dataset.id); return; }
    const gotoProfileBtn = e.target.closest('.goto-profile-btn'); // NEW: для "loose"-заявок без структурованої адреси, показаних тут же
    if(gotoProfileBtn){ goToTicketProfile(gotoProfileBtn.dataset.id); return; }
    const delBtn = e.target.closest('.delete-ticket-btn');
    if(delBtn){ deleteTicket(delBtn.dataset.id); renderAddressNav(); return; }
    const photoBadgeBtn = e.target.closest('.tc-photo-toggle-btn');
    if(photoBadgeBtn){ toggleTicketCardPhoto(photoBadgeBtn, rootEl); return; }
    const photoThumb = e.target.closest('.tc-photo-thumb');
    if(photoThumb){ openTicketPhotoFullscreen(photoThumb.dataset.full); return; }
    const expBtn = e.target.closest('.tc-expand-btn');
    if(expBtn){
      const id = expBtn.dataset.id;
      // NEW: та сама заявка може одночасно бути відрендерена і тут (у модалці),
      // і на екрані "Заявки" позаду — тоді на сторінці двоє елементів з
      // однаковим id. document.getElementById бере ПЕРШИЙ у документі, що міг
      // бути прихованою фоновою карткою — тому шукаємо лише всередині цієї
      // модалки (rootEl), щоб точно розгортати саме те, що бачить користувач.
      const contentEl = rootEl.querySelector('[id="tcc-'+id+'"]');
      if(!contentEl) return;
      const collapsed = contentEl.classList.toggle('tc-collapsed');
      expBtn.textContent = collapsed ? '▼ Розгорнути' : '▲ Згорнути';
    }
  });
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

async function migrateLegacySyncState(){
  const legacyTickets=tickets.filter(t=>t.synced===false);
  const hadLegacyTicketFields=tickets.some(t=>Object.prototype.hasOwnProperty.call(t,'synced')||Object.prototype.hasOwnProperty.call(t,'syncAction'));
  const hadLegacyDeletes=deletedTickets.some(t=>Object.prototype.hasOwnProperty.call(t,'pendingCloudDelete'));
  if(legacyTickets.length) await syncEngine.recordDiff('ticket',[],legacyTickets);
  for(const t of deletedTickets.filter(t=>t.pendingCloudDelete)){
    await syncEngine.persistTransition(state=>syncEngine.core.enqueue(state,{entity:'ticket',id:String(t.id),payload:{},delete:true},MTSyncEngineRuntime.uuid));
  }
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
    payment:t.payment, cashAmount:t.cashAmount, cardAmount:t.cardAmount, itemPayments:t.itemPayments, callFee:t.callFee, tariff:t.tariff, contractNumber:t.contractNumber,
    equipment:t.equipment, cables:t.cables, presetWorks:t.presetWorks, additionalWork:t.additionalWork,
    note:t.note, otherNote:t.otherNote, abonentNote:t.abonentNote, extraPhones:t.extraPhones // NEW: щоб примітка й додаткові телефони теж відновлювались при завантаженні з хмари
  };
  return {id:safeId, date:safeDate, time:safeTime, content:t.content, sum:t.sum, tags:t.tags||[], backupNote: backupExtra.join('\n'), fullDataJson: JSON.stringify(fullData)};
}
function shiftToSyncPayload(s){
  return {id:s.id, date:s.date, hours:s.hours, coworker:s.coworker};
}

async function loadFromCloud(){
  showToast('Повне відновлення з хмари вимкнено до окремого recovery protocol'); return;
  const ticketsUrl = getScriptUrl();
  const shiftsUrl = getShiftsScriptUrl();
  if(!ticketsUrl && !shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script у налаштуваннях'); return; }
  if(!confirm('Завантажити дані з хмари? Це замінить локальні заявки та/або зміни.')) return;
  const loadTicketsRevision = ticketsRevision;
  const loadShiftsRevision = shiftsRevision;
  setSyncState('syncing');
  let nextTickets = null;
  let nextShifts = null;
  const loadErrors = [];
  // NEW: у хмарі немає полів photo/tg* (там лише текст, суми, теги) — раніше
  // після "Завантажити з хмари" ці посилання просто стирались навіть якщо
  // фото фізично й досі лежить в IndexedDB, а повідомлення — в Telegram-групі.
  // Зберігаємо їх заздалегідь за id, щоб повернути в об'єднані заявки нижче.
  const localPhotoAndTgById = new Map();
  tickets.forEach(t=>{
    // NEW: раніше зберігали лише ОДНЕ фото (t.photo) і одинарні tg-поля —
    // для заявок із 2-3 фото (masiv photos/tgPhotoFileIds/tgPhotoMsgIds)
    // друге й третє фото після "Завантажити з хмари" тихо відв'язувались
    // від заявки (лишались в IndexedDB сиротами, але заявка про них більше
    // "не знала" — картка показувала тільки перше фото).
    if(t.photo || (t.photos && t.photos.length) || t.tgBackedUp || t.tgPhotoFileId || (t.tgPhotoFileIds && t.tgPhotoFileIds.length)){
      localPhotoAndTgById.set(String(t.id), {
        photo: t.photo,
        photos: t.photos ? t.photos.slice() : undefined,
        tgBackedUp: t.tgBackedUp,
        tgPhotoFileId: t.tgPhotoFileId,
        tgPhotoFileIds: t.tgPhotoFileIds ? t.tgPhotoFileIds.slice() : undefined,
        tgSepMsgId: t.tgSepMsgId, tgTextMsgId: t.tgTextMsgId,
        tgPhotoMsgId: t.tgPhotoMsgId,
        tgPhotoMsgIds: t.tgPhotoMsgIds ? t.tgPhotoMsgIds.slice() : undefined,
        tgJsonMsgId: t.tgJsonMsgId
      });
    }
  });
  if(ticketsUrl){
    try{
      throw new Error('ADMIN_RECOVERY_REQUIRED');
      const data = await res.json();
      // NEW: КРИТИЧНО — раніше тут не перевірялась відповідь сервера взагалі.
      // Якщо секретний ключ невірний (наприклад, друкарська помилка чи
      // застарілий), справжній Apps Script повертає {status:'error',
      // message:'forbidden'} — БЕЗ поля tickets. Код же читав
      // (data.tickets||[]) — за відсутності поля це ставало ПОРОЖНІМ
      // масивом, і рядком нижче (saveTickets()) ЛОКАЛЬНА БАЗА ЗАЯВОК
      // ЗАМІНЯЛАСЬ НА ПОРОЖНЮ. Тобто неправильний секрет міг стерти всі
      // заявки на телефоні одним натисканням "Завантажити з хмари".
      if(data.status === 'error' || !Array.isArray(data.tickets)){
        throw new Error(data.message || 'Сервер не повернув список заявок (перевірте секретний ключ)');
      }
      nextTickets = data.tickets.map(t=>{
        const blank = blankTicketObject();
        const extra = parseBackupNote(t.backupNote); // NEW: дістаємо геолокацію/примітку майстра (і, для старих рядків, повні дані, якщо вони туди ще потрапляли)
        // NEW: новий, чистіший шлях — окремий стовпець "повніДаніJSON" у
        // таблиці (не роздуває нотатки_майстра). Для рядків, які встигли
        // синхронізуватись ДО оновлення Apps Script, підстраховуємось старим
        // способом (parseBackupNote вище).
        let fullData = extra.fullData;
        if(t.fullDataJson){
          try{ fullData = JSON.parse(t.fullDataJson); }
          catch(e){ /* пошкоджений JSON у цьому стовпці — лишаємо те, що вже дістали з backupNote (може бути null) */ }
        }
        const merged = Object.assign(blank, {
          id: t.id, date: t.date, time: t.time, content: t.content,
          sum: Number(t.sum)||0,
          tags: Array.isArray(t.tags) ? t.tags : String(t.tags||'').split(',').map(s=>s.trim()).filter(Boolean),
          photo: null,
          geoLink: extra.geoLink,       // NEW
          masterNote: extra.masterNote, // NEW
          login: extra.login,           // NEW
          password: extra.password,     // NEW
          // NEW: якщо є повні структуровані дані (заявки, збережені після
          // цього оновлення) — відновлюємо адресу/MAC/обладнання/оплату один
          // в один, і сирий режим редагування більше не потрібен. Старі
          // заявки без цих даних відновлюються як і раніше — лише за текстом.
          cloudImported: !fullData
        });
        if(fullData) Object.assign(merged, fullData);
        // NEW: якщо для цього id є збережені локальні photo/tg* — повертаємо їх
        const local = localPhotoAndTgById.get(String(merged.id));
        if(local){
          Object.assign(merged, local);
          // NEW: Object.assign копіює й undefined-значення (якщо в local не
          // було масиву photos — властивість все одно перезаписується на
          // undefined) — тож після злиття завжди узгоджуємо одне з одним,
          // а не покладаємось, що обидва поля прийшли синхронізованими.
          if((!merged.photos || !merged.photos.length) && merged.photo) merged.photos = [merged.photo];
          if(merged.photos && merged.photos.length && !merged.photo) merged.photo = merged.photos[0];
          if(!merged.tgPhotoFileIds || !merged.tgPhotoFileIds.length){ merged.tgPhotoFileIds = merged.tgPhotoFileId ? [merged.tgPhotoFileId] : []; }
          if(!merged.tgPhotoMsgIds || !merged.tgPhotoMsgIds.length){ merged.tgPhotoMsgIds = merged.tgPhotoMsgId ? [merged.tgPhotoMsgId] : []; }
        }
        return merged;
      });
    }catch(err){ console.error(err); loadErrors.push(`заявки${err.message ? `: ${err.message}` : ''}`); }
  } else {
    loadErrors.push('заявки: не налаштовано URL');
  }
  if(shiftsUrl){
    try{
      throw new Error('ADMIN_RECOVERY_REQUIRED');
      const data = await res.json();
      // NEW: та сама критична перевірка, що й для заявок вище — без неї
      // невірний секрет так само стирав би локальні "Зміни".
      if(data.status === 'error' || !Array.isArray(data.shifts)){
        throw new Error(data.message || 'Сервер не повернув список змін (перевірте секретний ключ)');
      }
      nextShifts = data.shifts.map(s=>({id:s.id, date:isoToDdmmyyyy(s.date), hours:Number(s.hours)||0, coworker:s.coworker||'Сам'}));
    }catch(err){ console.error(err); loadErrors.push(`зміни${err.message ? `: ${err.message}` : ''}`); }
  } else {
    loadErrors.push('зміни: не налаштовано URL');
  }
  if(loadErrors.length === 0){
    // Атомарність tickets+shifts не захищає від нової локальної роботи під
    // час await fetch. Не зливаємо два незалежні стани автоматично: краще
    // лишити локальні дані й попросити користувача повторити завантаження.
    if(ticketsRevision !== loadTicketsRevision || shiftsRevision !== loadShiftsRevision){
      renderTicketsScreen(); renderShiftsScreen();
      setSyncState('err');
      showToast('Локальні дані змінилися під час завантаження. Дані з хмари не застосовано — повторіть завантаження.');
      return;
    }
    tickets = nextTickets;
    shifts = nextShifts;
    saveTickets();
    saveShifts();
    renderTicketsScreen(); renderShiftsScreen();
    setSyncState('ok');
    showToast(`Завантажено: ${tickets.length} заявок, ${shifts.length} змін`);
  } else {
    renderTicketsScreen(); renderShiftsScreen();
    setSyncState('err');
    showToast(`Не вдалося завантажити дані з хмари: ${loadErrors.join('; ')}. Локальні дані НЕ змінено.`);
  }
}

function backupLocalData(){
  if(typeof maybeRunDailyBackup === 'function') void maybeRunDailyBackup();
}

function restoreFromBackup(){
  showToast('Відновлення доступне у списку щоденних бекапів нижче');
  document.getElementById('dailyBackupList')?.scrollIntoView({behavior:'smooth',block:'center'});
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
  showToast('Повне відновлення змін вимкнено до окремого recovery protocol'); return;
  const shiftsUrl = settings.shiftsScriptUrl ? settings.shiftsScriptUrl.trim() : '';
  if(!shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script для змін'); return; }
  if(!confirm('Завантажити зміни з хмари? Поточні локальні зміни буде замінено.')) return;
  setSyncState('syncing');
  try{
    throw new Error('ADMIN_RECOVERY_REQUIRED');
    const data = await res.json();
    if(data.status === 'error' || !Array.isArray(data.shifts)) throw new Error(data.message || 'Сервер не повернув список змін (перевірте секретний ключ)');
    backupLocalData();
    shifts = data.shifts.map(s=>({id:s.id, date:isoToDdmmyyyy(s.date), hours:Number(s.hours)||0, coworker:s.coworker||'Сам'}));
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
async function sendShiftsToCloud(){
  showToast('Повна синхронізація змін вимкнена до окремого recovery protocol'); return;
  const shiftsUrl = settings.shiftsScriptUrl ? settings.shiftsScriptUrl.trim() : '';
  if(!shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script для змін'); return; }
  showToast(`Надсилання ${shifts.length} змін...`);
  await syncEngine.flush();
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
/* NEW: розбирає службовий стовпець "нотатки_майстра" (backupNote), який
   повертає таблиця для кожної заявки, і дістає з нього геолокацію та
   приватну примітку майстра — щоб відновити їх при завантаженні з хмари. */
function ticketsForDate(dateStr){
  return tickets.filter(t=>t.date===dateStr).sort((a,b)=> (a.time||'').localeCompare(b.time||''));
}
// NEW: порядковий номер заявки за день (1, 2, 3...) — рахуємо за хронологією
// (час створення в межах дня), незалежно від того, як зараз відсортований/
// відфільтрований список на екрані (пошук, теги тощо).
function getDailyTicketNumber(t){
  const sameDay = ticketsForDate(t.date); // вже відсортовано за часом зростаючо
  const idx = sameDay.findIndex(x=>String(x.id)===String(t.id));
  return idx>-1 ? idx+1 : null;
}
// NEW: точково перемальовує ОДНУ картку заявки (за id) там, де вона зараз є на
// екрані — без повного renderMainTicketList(), щоб не збивати позицію скролу
// й стан "розгорнуто/згорнуто" інших карток. Картка може одночасно бути в
// декількох місцях (список + модалка адресної навігації) — оновлюємо всі.
function refreshTicketCardDom(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  document.querySelectorAll(`.ticket-card[data-id="${id}"]`).forEach(el=>{
    const workOnly = el.dataset.workonly === '1'; // NEW: не втрачаємо режим "тільки робота" (профіль абонента) при фоновому оновленні
    el.outerHTML = renderTicketCard(t, {workOnly});
  });
}
/* Ключ для сортування заявок за датою+часом (а не за порядком створення) —
   потрібен у пошуку й фільтрі за тегами, де на екрані одразу заявки з
   різних дат: заявка, створена заднім чи майбутнім числом, має ставати на
   своє місце серед дат, а не вилазити нагору лише тому, що її щойно
   створили. */
function renderTicketsScreen(){
  document.getElementById('currentDateDisplay').textContent = currentTicketDate;
  updateNaryadQueueBtn(); // NEW: підпис кнопки залежить від поточної дати — оновлюємо разом з нею
  renderDateNavVisibility();
  renderDaySummary();
  renderMainTicketList();
  renderSyncQueueBanner();
  renderQuickDialButtons();
}

function renderSyncQueueBanner(){
  const banner = document.getElementById('syncQueueBanner');
  if(!getScriptUrl()){ banner.classList.add('hidden'); return; }
  const total = syncEngine ? syncEngine.pendingCount() : 0;
  if(total === 0){ banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  const text = document.getElementById('syncQueueBannerText');
  text.textContent = navigator.onLine
    ? `⏳ Не синхронізовано: ${total} — спробувати ще раз?`
    : `📴 Немає інтернету — ${total} заявок надішлю, коли з'явиться зв'язок`;
}

async function retrySyncQueue(){
  const retryBtn = document.getElementById('syncQueueRetryBtn');
  if(!syncEngine || !getScriptUrl()) return;
  retryBtn.disabled = true;
  let ok=false;
  try{
    ok=await syncEngine.flush();
  } finally {
    retryBtn.disabled = false;
  }
  renderTicketsScreen();
  showToast(ok ? 'Усе синхронізовано ✅' : `Залишилось не синхронізовано: ${syncEngine.pendingCount()}`);
}

function renderMainTicketList(){
  const listEl = document.getElementById('ticketList');
  let list;
  const q = searchQuery.trim().toLowerCase();

  if(q){
    const qDigits = q.replace(/\D/g,''); // NEW: пошук за цифрами телефону — окремо від тексту нижче
    list = tickets.filter(t =>
      (t.content||'').toLowerCase().includes(q) ||
      (t.date||'').includes(q) ||
      (t.tags||[]).some(tag=>tag.toLowerCase().includes(q)) ||
      (t.city||'').toLowerCase().includes(q) ||
      (t.address||'').toLowerCase().includes(q) ||
      (t.clientName||'').toLowerCase().includes(q) ||
      // NEW: раніше пошук телефону тут не спрацьовував — t.content містить
      // номер УЖЕ ЗІ СКОБКАМИ/ДЕФІСАМИ ("(067)123-45-67"), а простий пошук
      // цифр ("067123") не збігається як підрядок такого форматованого
      // тексту. Порівнюємо цифри з цифрами, як і в навігаторі адрес.
      (qDigits.length>=3 && String(t.phone||'').replace(/\D/g,'').includes(qDigits)) ||
      (qDigits.length>=3 && (t.extraPhones||[]).some(p=>String(p||'').replace(/\D/g,'').includes(qDigits)))
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
    renderEmptyTicketList(listEl);
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
    html += buildShowMoreTicketsButton(remaining);
  }
  listEl.innerHTML = html;
}

// NEW: 📷-бейдж на картці заявки тепер можна натиснути, щоб показати фото
// (підвантажується лише за тапом, як і фото абонента) та натиснути ще раз,
// щоб знову сховати. scopeEl — корінь пошуку елементів (щоб не сплутати з
// однаковим id тієї самої заявки, відрендереної одночасно і в модалці, і
// позаду на екрані).
// NEW: "👤 В профіль" на картці заявки — веде одразу до профілю абонента
// (навігатор адрес, той самий екран, де видно повну історію заявок за цією
// адресою) замість колишньої кнопки "На дату". В профілі кнопки самих
// заявок лишились із "На дату" — там вона й досі корисна.
function goToTicketProfile(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  const city = (t.city||'').trim(), street = (t.street||'').trim();
  if(!city || !street){ showToast('У цієї заявки немає структурованої адреси — профіль зібрати нема з чого'); return; }
  addrNavSearchQuery = '';
  addrNavState = {level:'tickets', city, street, house: (t.house||'').trim() || '(без номера)', apartment: ticketApartmentKey(t)};
  renderAddressNav();
}
function toggleTicketCardPhoto(btn, scopeEl){
  const root = scopeEl || document;
  const id = btn.dataset.id;
  const wrap = root.querySelector('[id="tcp-'+id+'"]');
  if(!wrap) return;
  if(!wrap.classList.contains('hidden')){
    wrap.classList.add('hidden');
    btn.textContent = btn.dataset.origLabel || '📷 Фото';
    return;
  }
  if(wrap.dataset.loaded === '1'){
    wrap.classList.remove('hidden');
    btn.textContent = '🔼 Сховати фото';
    return;
  }
  let keys = [];
  try{ keys = JSON.parse(btn.dataset.photoKeys || '[]'); }catch(err){ keys = []; }
  keys = keys.filter(Boolean);
  if(!keys.length) return;
  // NEW: раніше запасний Telegram file_id (на випадок відсутності локальної
  // копії фото) брався лише для ПЕРШОГО фото (data-tg-file-id, одиничне
  // поле) — для другого й третього завжди null, тож вони не могли
  // відновитись із Telegram. Тепер читаємо масив (data-tg-file-ids) — по
  // одному id на кожне фото, як і в профілі абонента.
  let fileIds = [];
  try{ fileIds = JSON.parse(btn.dataset.tgFileIds || '[]'); }catch(err){ fileIds = []; }
  btn.dataset.origLabel = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Завантаження…';
  // NEW: до 3 фото на заявку — вантажимо всі паралельно, кожне у своєму
  // мініатюрному блоці (тап по мініатюрі відкриває фото на весь екран)
  Promise.all(keys.map((key, i)=> resolvePhotoAsync(key, fileIds[i] || null))).then(values=>{
    btn.disabled = false;
    const loadedAny = values.some(Boolean);
    if(!loadedAny){ btn.textContent = '📷 Не вдалося завантажити'; return; }
    wrap.innerHTML = values.map((val,i)=> val ? `<img src="${val}" class="tc-photo-thumb" data-full="${val}" alt="фото ${i+1}" style="width:96px; height:96px; object-fit:cover; border-radius:10px; cursor:pointer;">` : '').join('');
    wrap.dataset.loaded = '1';
    wrap.classList.remove('hidden');
    btn.textContent = '🔼 Сховати фото';
  });
}
// NEW: тап по мініатюрі в розгорнутому списку фото заявки — показує це фото
// на весь екран (просте модальне вікно, без зайвих кнопок)
function openTicketPhotoFullscreen(src){
  openModal('Фото', `<img src="${src}" style="width:100%; border-radius:10px;">`, {});
}
function deleteTicket(id){
  if(!confirm('Видалити цю заявку?')) return;
  const idx = tickets.findIndex(x=>String(x.id)===String(id)); // NEW: id заявок з хмари приходить рядком, а не числом
  if(idx===-1) return;
  const t = tickets[idx];
  tickets.splice(idx,1);
  saveTickets();
  // NEW: раніше результат цього запиту ніде не перевірявся — якщо видалення
  // не дійшло до Google Таблиці (немає інтернету саме в цей момент), заявка
  // все одно йшла в кошик, зникала з tickets, і retrySyncQueue (яка шукає
  // лише tickets.filter(t=>!t.synced)) більше НІКОЛИ не намагалась
  // повторити видалення — старий рядок так і лишався в Таблиці назавжди.
  // Тепер, якщо видалення не вдалось одразу, позначаємо запис у кошику
  // прапорцем pendingCloudDelete — retrySyncQueue (і кнопка "Повторити", і
  // подія online) підхоплять його пізніше.
  // NEW: Telegram-бекап НЕ видаляється разом із заявкою навмисно — навіть якщо
  // заявку видалили в застосунку (помилково чи ні), її копія назавжди лишається
  // в групі-архіві. Це і є сенс резервної копії: вона не залежить від дій в
  // основному застосунку. Синхронізується з групою лише редагування (див.
  // backupTicketToTelegram), а видалення — ні.
  // Не видаляємо фото одразу — заявка йде в кошик, фото ще може знадобитись при відновленні.
  // Ставимо прапорець ДО мережі: якщо застосунок закриється під час await,
  // наступний запуск усе одно знатиме, що Google-видалення треба повторити.
  moveTicketToTrash(t);
  renderTicketsScreen();
  showToast('Заявку видалено — відновити можна в Налаштуваннях → Кошик');
}

/* ---- Кошик видалених заявок: зберігає останні DELETED_TICKETS_MAX записів,
   старіші за цю межу видаляються остаточно (разом із фото в IndexedDB). ---- */
// NEW: спільна функція для видалення ВСІХ фото заявки з IndexedDB (масив
// photos, якщо є, інакше старе одиничне поле photo) — використовується і в
// кошику (переповнення/остаточне видалення), і будь-де ще, де потрібно
// прибрати фото заявки цілком. Раніше кошик прибирав лише t.photo (перше
// фото), а друге й третє лишались "сиротами" в IndexedDB назавжди.
function deleteAllTicketPhotos(t){
  const keys = (t.photos && t.photos.length) ? t.photos : (t.photo ? [t.photo] : []);
  keys.forEach(k=> deletePhotoKey(k));
}

function moveTicketToTrash(t){
  const copy = JSON.parse(JSON.stringify(t));
  copy.deletedAt = Date.now();
  deletedTickets.unshift(copy);
  while(deletedTickets.length > DELETED_TICKETS_MAX){
    const dropped = deletedTickets.pop();
    deleteAllTicketPhotos(dropped);
  }
  saveDeletedTickets();
  return copy;
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
  // Tombstone старого ID необоротний: restore завжди є новим create.
  restored.id = MTSyncEngineRuntime.uuid();
  delete restored.synced;
  delete restored.syncAction;
  delete restored.pendingCloudDelete;
  tickets.push(restored);
  saveTickets();
  currentTicketDate = restored.date || currentTicketDate;
  renderTicketsScreen();
  renderDeletedTicketsList();
  showToast('Заявку відновлено');
}

function purgeDeletedTicket(deletedAt){
  const idx = deletedTickets.findIndex(t=>String(t.deletedAt)===String(deletedAt));
  if(idx===-1) return;
  if(!confirm('Видалити заявку з кошика остаточно? Відновити після цього буде неможливо.')) return;
  const t = deletedTickets[idx];
  deleteAllTicketPhotos(t); // NEW: усі фото (photos), не лише перше
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
  const ok = await syncEngine.flush();
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
// NEW: ручний повтор бекапу в Telegram прямо з картки заявки (кнопка ☁️⏳) —
// на випадок, коли автоматична відправка (при збереженні) не долетіла.
function retryTelegramBackup(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return;
  showToast('Повторно надсилаю в Telegram…');
  backupTicketToTelegram(t);
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
  // NEW: tgPhotoMsgIds — усі повідомлення з фото (до 3), tgPhotoMsgId лишається
  // як дублікат першого для сумісності зі старими заявками, тож не дублюємо його
  // в списку, якщо він вже є в масиві.
  const photoIds = (t.tgPhotoMsgIds && t.tgPhotoMsgIds.length) ? t.tgPhotoMsgIds : [t.tgPhotoMsgId].filter(Boolean);
  const ids = [t.tgSepMsgId, t.tgTextMsgId, ...photoIds, t.tgJsonMsgId].filter(Boolean);
  for(const msgId of ids){
    try{
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, message_id: msgId})
      });
    }catch(e){ /* повідомлення могло вже бути видалене вручну — не критично */ }
  }
  t.tgSepMsgId = null; t.tgTextMsgId = null; t.tgPhotoMsgId = null; t.tgJsonMsgId = null; t.tgPhotoMsgIds = []; t.tgPhotoFileIds = [];
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
// NEW: на мобільній мережі (перемикання 4G/3G, слабкий сигнал) fetch до Telegram
// інколи обривається саме в очікуванні відповіді — хоча повідомлення вже дійшло
// й показалось у групі. Одна швидка повторна спроба закриває більшість таких
// випадків, не роблячи бекап відчутно повільнішим.
async function fetchWithRetry(url, opts, retries=1){
  // NEW: без таймауту цей fetch міг висіти нескінченно довго на поганому
  // зв'язку — Telegram-бекап відбувається у фоні (не блокує збереження
  // заявки), але без ліміту такі "зависші" запити накопичувались би без
  // кінця. 15с — цього достатньо навіть для повільного 3G, але не дає
  // запиту висіти вічно на мертвому з'єднанні.
  const controller = new AbortController();
  const timeoutId = setTimeout(()=> controller.abort(), 15000);
  try{
    return await fetch(url, {...opts, signal: controller.signal});
  }catch(e){
    if(retries<=0) throw e;
    await new Promise(r=>setTimeout(r, 800));
    return fetchWithRetry(url, opts, retries-1);
  } finally { clearTimeout(timeoutId); }
}
// Серіалізуємо backup по stable id. Наступний запит завжди дістає заявку
// наново з tickets уже після попереднього завершення: save/edit може замінити
// tickets[idx] новим об'єктом, тож старе async-посилання не можна продовжувати.
const telegramBackupQueues = new Map();
function backupTicketToTelegram(ticket){
  const id = ticket && ticket.id;
  if(id === undefined || id === null) return Promise.resolve(false);
  const key = String(id);
  const previous = telegramBackupQueues.get(key) || Promise.resolve();
  const job = previous.catch(()=>{}).then(()=>{
    const current = tickets.find(x=>String(x.id)===key);
    return current ? backupTicketToTelegramNow(current) : false;
  });
  let tracked;
  tracked = job.finally(()=>{
    if(telegramBackupQueues.get(key) === tracked) telegramBackupQueues.delete(key);
  });
  telegramBackupQueues.set(key, tracked);
  return tracked;
}
async function backupTicketToTelegramNow(t){
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgBackupChatId||'').trim();
  if(!token || !chatId || !t) return;
  // NEW: раніше СПОЧАТКУ видаляли стару копію заявки в групі, а вже ПОТІМ
  // відправляли нову — якщо зв'язок обривався саме між цими двома кроками
  // (найімовірніше на поганому інтернеті — а це якраз умови, для яких
  // застосунок і робився), стара копія вже видалена, нова не встигла
  // відправитись — заявка лишалась ЗОВСІМ без бекапу в Telegram. Тепер
  // спочатку зберігаємо id старих повідомлень окремо (не чіпаючи їх),
  // відправляємо нову версію, і лише ПІСЛЯ підтвердженого успіху видаляємо
  // стару — якщо новий бекап не пройшов, стара копія лишається недоторканою
  // як резервний варіант.
  const oldMsgIds = {
    tgSepMsgId: t.tgSepMsgId, tgTextMsgId: t.tgTextMsgId,
    tgPhotoMsgId: t.tgPhotoMsgId, tgPhotoMsgIds: (t.tgPhotoMsgIds||[]).slice(),
    tgJsonMsgId: t.tgJsonMsgId
  };
  // Поки новий текст, усі фото й JSON не підтверджені, стара повна копія
  // лишається робочою. Тому запам'ятовуємо також file_id та статус: при
  // частковій помилці повторна спроба не повинна втратити шлях до старих фото.
  const previousBackupState = {
    tgBackedUp: t.tgBackedUp,
    tgPhotoFileId: t.tgPhotoFileId,
    tgPhotoFileIds: (t.tgPhotoFileIds||[]).slice(),
    tgSepMsgId: t.tgSepMsgId,
    tgTextMsgId: t.tgTextMsgId,
    tgPhotoMsgId: t.tgPhotoMsgId,
    tgPhotoMsgIds: (t.tgPhotoMsgIds||[]).slice(),
    tgJsonMsgId: t.tgJsonMsgId
  };
  let backupSucceeded = false;
  try{
    const previousPrimaryPhotoFileId = t.tgPhotoFileId;
    t.tgPhotoFileId = null;
    t.tgBackedUp = false;
    let textOk = false;

    // 0) розділювач-заголовок — щоб у стрічці групи було одразу видно, де
    // закінчується одна заявка (2-3 повідомлення) і починається наступна
    if(t.content){
      const addr = [t.city, t.street, t.house].filter(Boolean).join(', ');
      const sepText = `➖➖➖➖➖➖➖➖➖➖\n🧾 ${(t.type||'ЗАЯВКА').toUpperCase()}${t.date? ' · '+t.date:''}${t.time? ' '+t.time:''}${addr? ' · '+addr:''}`;
      const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, text: sepText})
      });
      const data = await res.json();
      if(data.ok) t.tgSepMsgId = data.result.message_id;
    }
    // 1) текст — повна версія, включно з приватною міткою/геолокацією/логіном-паролем
    if(t.content){
      const text = buildTelegramBackupText(t).slice(0, 4000); // ліміт Telegram на текст повідомлення
      const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, text})
      });
      const data = await res.json();
      if(data.ok){ textOk = true; t.tgTextMsgId = data.result.message_id; }
    }
    // 2) фото — NEW: усі фото заявки (до 3), а не лише перше. Шлемо по черзі
    // окремими повідомленнями (Telegram sendPhoto — одне фото за раз), кожне
    // з підписом і номером (1/3, 2/3...), щоб було видно, що це саме ця заявка.
    const photosToSend = (t.photos && t.photos.length) ? t.photos : (t.photo ? [t.photo] : []);
    // NEW: раніше запасний Telegram file_id (на випадок, якщо локальної копії
    // фото в IndexedDB вже немає) передавався ЛИШЕ для першого фото
    // (t.tgPhotoFileId — старе одиничне поле), а для другого й третього —
    // завжди null, хоча правильні id для КОЖНОГО фото вже лежать у масиві
    // t.tgPhotoFileIds (заповнюється нижче ж таки після кожної успішної
    // відправки). Через це повторний бекап/відновлення другого-третього фото
    // мовчки не спрацьовував би, якщо локальна копія загубилась.
    const prevTgPhotoFileIds = t.tgPhotoFileIds || [];
    t.tgPhotoFileIds = []; t.tgPhotoMsgIds = [];
    let photoSendAttempts = 0; // NEW: скільки фото реально намагались відправити (є локальна копія/fallback)
    for(let pi=0; pi<photosToSend.length; pi++){
      const fallbackId = prevTgPhotoFileIds[pi] || (pi===0 ? previousPrimaryPhotoFileId : null);
      const photoData = await resolvePhotoAsync(photosToSend[pi], fallbackId);
      if(!photoData) continue;
      photoSendAttempts++;
      const blob = await (await fetch(photoData)).blob();
      const form = new FormData();
      form.append('chat_id', chatId);
      const caption = `${t.date||''} ${t.time||''} ${t.city||''} ${t.street||''} ${t.house||''}`.trim();
      form.append('caption', (photosToSend.length>1 ? `${caption} (${pi+1}/${photosToSend.length})` : caption).slice(0,1020));
      form.append('photo', blob, 'foto.jpg');
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {method:'POST', body: form});
      const data = await res.json();
      if(data.ok){
        const sizes = data.result.photo || [];
        const fileId = sizes.length ? sizes[sizes.length-1].file_id : null; // найбільший варіант — для повноцінного відновлення
        t.tgPhotoFileIds.push(fileId);
        t.tgPhotoMsgIds.push(data.result.message_id);
      }
    }
    // NEW: раніше стару копію видаляли, щойно проходив ТЕКСТ (t.tgBackedUp),
    // навіть якщо ВСІ фото не відправились (наприклад, короткий збій саме
    // sendPhoto) — нова версія лишалась без фото, а стара (де фото ще були)
    // вже видалена. Тепер видаляємо стару копію лише якщо текст пройшов І
    // (фото в заявці не було, або всі спроби відправки фото, які реально
    // відбулись, — успішні).
    const photosOk = photoSendAttempts === photosToSend.length && t.tgPhotoMsgIds.length === photosToSend.length;
    // старі поля лишаються дублікатом першого фото — для сумісності зі старим кодом
    t.tgPhotoFileId = t.tgPhotoFileIds[0] || null;
    t.tgPhotoMsgId = t.tgPhotoMsgIds[0] || null;
    // 3) повний JSON-знімок УСІХ полів заявки — окремим файлом, це і є
    // "повний бекап" (а не лише те, що влізло в короткий текст вище)
    let jsonOk = false;
    try{
      const jsonBlob = new Blob([JSON.stringify(t, null, 2)], {type:'application/json'});
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('document', jsonBlob, `ticket-${t.id}.json`);
      const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {method:'POST', body: form});
      const data = await res.json();
      if(data.ok){ jsonOk = true; t.tgJsonMsgId = data.result.message_id; }
    }catch(e){ console.error('Telegram JSON backup request failed'); }
    // NEW: нова версія підтверджено відправлена (текст пройшов) — тепер
    // безпечно прибрати стару копію. Якщо старої не було (перший бекап
    // цієї заявки) — deleteTicketTelegramMessages просто нічого не робить.
    if(textOk && photosOk && jsonOk){
      t.tgBackedUp = true;
      await deleteTicketTelegramMessages(oldMsgIds, token, chatId);
      backupSucceeded = true;
    }
  }catch(e){ console.error('Telegram backup request failed'); } // тихо — це лише резервна копія, не критична дія
  finally{
    if(!backupSucceeded) Object.assign(t, previousBackupState);
    // NEW: раніше saveTickets() викликався лише в кінці "щасливого" шляху —
    // якщо зв'язок обривався десь на середині (а повідомлення в Telegram все
    // одно доходило), локально це не зберігалось і галочка "✅" губилась
    // назавжди, навіть після перезаходу в застосунок. Тепер зберігаємо й
    // перемальовуємо картку в будь-якому разі, незалежно від результату.
    saveTickets();
    refreshTicketCardDom(t.id);
  }
}
// NEW: тестове повідомлення в Налаштуваннях — перевірити, що токен і chat_id правильні.
// Приймає chatId ззовні, щоб однією функцією перевіряти всі три призначення.

/* ---- Відновлення ОДНІЄЇ заявки з Telegram-архіву -------------------------
   Кожна заявка при бекапі (backupTicketToTelegram) додатково зберігається в
   групі повним JSON-файлом (ticket-<id>.json) з УСІМА полями: логін/пароль,
   номер договору, geo, нотатка майстра, а також ідентифікатори оригінальних
   повідомлень у групі (tgSepMsgId/tgTextMsgId/tgPhotoMsgId/tgJsonMsgId) —
   тому після відновлення кнопки "🕘" і "☁️✅" продовжують працювати так,
   ніби заявку й не видаляли, навіть якщо локальне фото вже загублено.
   Майстер сам відкриває потрібний .json у Telegram, копіює весь його текст
   і вставляє в модалку нижче — жодних токенів чи ручного набору полів. */
function restoreTicketFromTelegramJson(jsonText){
  let parsed;
  try{ parsed = JSON.parse(jsonText); }
  catch(e){ showToast('Не вдалося розпізнати текст — перевірте, що вставили ВЕСЬ вміст .json-файлу'); return false; }
  if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)){
    showToast('Схоже, це не файл заявки — перевірте, що скопіювали правильний .json'); return false;
  }
  // NEW: перевіряємо не лише наявність date, а й що це справді схоже на
  // заявку (дата у форматі ДД.ММ.РРРР, тип — непорожній рядок, сума — число,
  // якщо взагалі вказана) — щоб випадковий чи пошкоджений JSON не потрапив
  // у список заявок і не поламав рендер картки.
  if(typeof parsed.date !== 'string' || !/^\d{2}\.\d{2}\.\d{4}$/.test(parsed.date.trim())){
    showToast('У файлі немає коректної дати (формат ДД.ММ.РРРР) — це точно заявка з Майстер-Трекера?'); return false;
  }
  if(typeof parsed.type !== 'string' || !parsed.type.trim()){
    showToast('У файлі не вказано тип заявки — перевірте, що скопіювали правильний .json'); return false;
  }
  if(parsed.sum!==undefined && parsed.sum!==null && typeof parsed.sum!=='number' && isNaN(Number(parsed.sum))){
    showToast('Поле "сума" у файлі має неправильний формат — перевірте .json'); return false;
  }
  if(parsed.content!==undefined && parsed.content!==null && typeof parsed.content!=='string'){
    showToast('Поле "зміст" у файлі має неправильний формат — перевірте .json'); return false;
  }
  const restored = JSON.parse(JSON.stringify(parsed));
  if(restored.sum!==undefined && restored.sum!==null) restored.sum = Number(restored.sum) || 0;
  restored.id = MTSyncEngineRuntime.uuid();
  delete restored.synced;
  tickets.push(restored);
  saveTickets();
  currentTicketDate = restored.date || currentTicketDate;
  renderTicketsScreen();
  showToast('✅ Заявку відновлено з Telegram!');
  return true;
}
function showRestoreFromTelegramModal(){
  openModal('♻️ Відновити заявку з Telegram', `
    <div style="font-size:12.5px; color:var(--text-dim); margin-bottom:10px; line-height:1.6;">
      1. Відкрийте закриту групу-архів у Telegram, знайдіть потрібну заявку (за датою чи адресою в тексті над файлами).<br>
      2. Відкрийте при ній файл <span style="font-family:var(--mono); font-size:11.5px;">ticket-XXXXXXXXXXXXX.json</span> — Telegram покаже його як текст — і скопіюйте увесь вміст файлу.<br>
      3. Вставте цей текст у поле нижче й натисніть "Відновити".
    </div>
    <textarea id="tgRestoreJsonInput" rows="8" style="width:100%; font-family:var(--mono); font-size:12px; resize:vertical;" placeholder='{"id":..., "type":"Ремонт", "date":"..."}'></textarea>
    <button type="button" class="btn btn-accent btn-block" id="tgRestoreJsonBtn" style="margin-top:10px;">♻️ Відновити заявку</button>
  `, {onOpen: (root)=>{
    root.querySelector('#tgRestoreJsonBtn').addEventListener('click', ()=>{
      const text = root.querySelector('#tgRestoreJsonInput').value.trim();
      if(!text){ showToast('Вставте текст .json-файлу'); return; }
      const ok = restoreTicketFromTelegramJson(text);
      if(ok) closeModal();
    });
  }});
}
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
  const monthKey = localMonthKey(now);
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
  // NEW: те саме застереження, що й у retrySyncQueue — без try/finally
  // виняток усередині циклу назавжди заблокував би повторний запуск і
  // лишив би модалку відкритою.
  try{
    for(const t of list){
      if(bulkExportCancelled) break;
      await backupTicketToTelegram(t);
      done++;
      const counterEl = document.getElementById('bulkExportCounter');
      if(counterEl) counterEl.textContent = `${done} / ${list.length}`;
      await new Promise(r=>setTimeout(r, 1400));
    }
  } finally {
    bulkExportRunning = false;
    closeModal();
  }
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
/* ---- Календар ---- */
const MONTH_NAMES = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const DOW_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
function renderCalendar(){
  document.getElementById('calMonthLabel').textContent = `${MONTH_NAMES[calendarViewDate.getMonth()]} ${calendarViewDate.getFullYear()}`;
  const grid = document.getElementById('calGrid');
  const year = calendarViewDate.getFullYear(), month = calendarViewDate.getMonth();
  const todayStr = formatDate(new Date());
  grid.innerHTML = buildCalendarGridHtml({year, month, tickets, selectedDate:currentTicketDate, todayStr, formatDateValue:formatDate});
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
  // NEW: на відміну від blankTicketObject() (порожні масиви — так зберігається
  // у самій заявці), тут, у стані ЖИВОЇ форми, одразу розгортаємо повний
  // каталог обладнання/кабелів/робіт — щоб було з чого вибирати чекбоксами.
  t.equipment = mergeEquipmentWithCatalog([], getEquipmentConfig());
  t.cables = mergeCablesWithCatalog([], getCableTypesConfig());
  t.presetWorks = mergePresetWorksWithCatalog([], getWorkTypesConfig());
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
  // NEW: для заявки, відновленої з хмари (cloudImported), правки в контенті
  // й сумі (поля f_rawContent/f_rawSum, синхронізуються syncFormToState)
  // раніше НІЯК не потрапляли в цю перевірку — жодне з полів вище для такої
  // заявки типово не заповнене (вона зберігає лише текстовий content, а не
  // розібрані city/address/phone/...). Через це для raw-заявок автозбереження
  // чернетки НЕ спрацьовувало, і попередження "є незбережені зміни" при виході
  // без збереження НЕ з'являлось — правки тихо губились.
  if(s.cloudImported && (s.content !== s._origContent || s.sum !== s._origSum)) return true;
  if(s.login || s.password) return true;
  if(s.type === 'Ремонт' && s.contractNumber) return true; // NEW: вручну введений номер договору для ремонту
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
  syncFormToState(); // NEW: без цього calcState міг лишатись застарілим (не оновлювався на кожне натискання клавіші) — автозбереження раз на 30с іноді записувало старі дані, а не те, що реально введено в полях
  if(!hasUnsavedChanges()) return; // немає що зберігати — не смітимо сховище
  if(!formTouchedByUser) return; // NEW: форму лише відкрили (можливо, з автопідстановкою з наряду/профілю) — руками ще нічого не вводили, це не "чернетка"
  try{
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      ts: Date.now(),
      editingTicketId,
      state: calcState,
      // Потрібно після перезапуску відрізнити фото самої збереженої заявки
      // від фото, доданих лише до чернетки й ще не підтверджених збереженням.
      originalPhotoKeys: calcOriginalPhotoKeys.slice()
    }));
  }catch(e){ /* сховище повне чи недоступне — пропускаємо, це не критично */ }
}

function clearDraft(){
  localStorage.removeItem(DRAFT_KEY);
}

// NEW: прибирає з IndexedDB фото, додані в поточному сеансі редагування,
// але так і не збережені в жодній заявці (щоб не накопичувалось "сміття"
// при скасуванні редагування/створення заявки з уже зробленими фото).
function cleanupUnsavedNewPhotos(){
  (calcState.photos||[]).forEach(key=>{
    if(key && String(key).startsWith('idb:') && !calcOriginalPhotoKeys.includes(key)) deletePhotoKey(key);
  });
}
function cleanupUnsavedDraftPhotos(draft){
  // Старі чернетки не мають цього списку. Не видаляємо їхні фото навмання:
  // частина з них могла належати вже збереженій заявці.
  if(!Array.isArray(draft.originalPhotoKeys)) return;
  const originalKeys = draft.originalPhotoKeys;
  (draft.state.photos||[]).forEach(key=>{
    if(key && String(key).startsWith('idb:') && !originalKeys.includes(key)) deletePhotoKey(key);
  });
}

function restoreDraftIfAny(){
  const raw = localStorage.getItem(DRAFT_KEY);
  if(!raw) return;
  let draft;
  try{ draft = JSON.parse(raw); } catch(e){ clearDraft(); return; }
  if(!draft || !draft.state) { clearDraft(); return; }
  const d = new Date(draft.ts);
  const ok = confirm(`Знайдено незбережену чернетку заявки від ${formatDate(d)} ${formatTime(d)}.\nВідновити її?`);
  if(!ok){ cleanupUnsavedDraftPhotos(draft); clearDraft(); return; }
  editingTicketId = draft.editingTicketId || null;
  loadTicketIntoForm(draft.state);
  if(Array.isArray(draft.originalPhotoKeys)) calcOriginalPhotoKeys = draft.originalPhotoKeys.slice();
  if(editingTicketId){
    document.getElementById('saveTicketBtn').textContent = 'Оновити заявку';
    document.getElementById('cancelEditBtn').classList.remove('hidden');
  }
  switchTab('calculator');
  showToast('Чернетку відновлено');
}

// NEW: "бригада на сьогодні" — перший вибір напарників за поточний календарний
// день запам'ятовується і сам підставляється в кожну наступну НОВУ заявку,
// поки ви його свідомо не зміните (тоді підставлятиметься вже нове значення).
// Наступного дня скидається — знову чекає першого вибору.
const DAILY_MASTERS_KEY = 'dailyMastersDefault';
function loadDailyMastersDefault(){
  try{
    const raw = JSON.parse(localStorage.getItem(DAILY_MASTERS_KEY));
    if(raw && raw.date === formatDate(new Date())) return raw.masters || [];
  }catch(e){}
  return null; // нічого не збережено на сьогодні (або запис ще з учорашнього дня)
}
function saveDailyMastersDefault(masters){
  try{ localStorage.setItem(DAILY_MASTERS_KEY, JSON.stringify({date: formatDate(new Date()), masters})); }catch(e){}
}
function resetCalcForm(presetDate, overrides){
  calcState = blankCalcState();
  naryadPendingCompletionId = null;
  formSessionId++; // NEW: новий сеанс форми — попередні "фото в польоті" себе впізнають і не приліпляться сюди
  if(presetDate) calcState.date = presetDate;
  calcOriginalPhotoKeys = []; // NEW: нова порожня заявка — жодного "оригінального" фото ще нема
  // NEW: дозволяє одразу підставити тип заявки й дані абонента (з профілю
  // навігатора адрес) у щойно відкриту порожню форму — застосовується ДО
  // логіки тегу за типом нижче, щоб автотег теж підхопив правильний тип.
  if(overrides) Object.assign(calcState, overrides);
  editingTicketId = null;
  feeIsAutoDefault = true; // NEW: нова заявка — ціну можна підставляти автоматично за типом
  tariffIsAutoDefault = true;
  formTouchedByUser = false; // NEW: нова (можливо, підставлена з наряду/профілю) форма — ще не "чернетка", доки самі не почнете її заповнювати
  // NEW: нова заявка стартує з типом "Підключення" — одразу вмикаємо тег "підключення"
  const defTag = TYPE_TAG_MAP[calcState.type];
  if(defTag){
    if(!settings.tags.includes(defTag)){ settings.tags.push(defTag); saveSettings(); }
    if(!calcState.tags.includes(defTag)) calcState.tags.push(defTag);
  }
  // NEW: підставляємо "бригаду на сьогодні", якщо вона вже обиралась раніше цього дня
  const dailyMasters = loadDailyMastersDefault();
  if(dailyMasters && dailyMasters.length){
    calcState.connectMasters = dailyMasters.map(m=>({...m}));
    dailyMasters.forEach(m=>{ if(!calcState.tags.includes(m.name)) calcState.tags.push(m.name); });
  }
  document.getElementById('saveTicketBtn').textContent = 'Зберегти заявку';
  document.getElementById('cancelEditBtn').classList.add('hidden');
  fillFormFromState();
  // NEW: якщо тип підставили через overrides (не "Підключення" за замовчуванням) —
  // ціну виклику/тариф перерахуємо під фактичний тип, а не під той, для якого
  // їх порахував blankCalcState() ще до застосування overrides.
  if(overrides && overrides.type){ applyDefaultCallFee(); applyDefaultTariff(); }
}

function loadTicketIntoForm(t){
  calcState = JSON.parse(JSON.stringify(t)); // глибока копія, щоб не мутувати реєстр до збереження
  naryadPendingCompletionId = null;
  formSessionId++; // NEW: те саме застереження, що й у resetCalcForm — новий сеанс форми
  // NEW: знімок оригінальних content/sum на момент відкриття — потрібен
  // лише для cloudImported (raw) заявок, де hasUnsavedChanges порівнює з
  // цими значеннями, щоб побачити правки в f_rawContent/f_rawSum (див. там).
  calcState._origContent = calcState.content || '';
  calcState._origSum = calcState.sum || 0;
  // NEW: старі заявки мають лише одне фото в полі photo — якщо масиву photos
  // ще нема (чи він порожній), а старе фото є, переносимо його в масив, щоб
  // форма з підтримкою до 3 фото показала його як завжди.
  if((!calcState.photos || !calcState.photos.length) && calcState.photo){
    calcState.photos = [calcState.photo];
  }
  if(!calcState.photos) calcState.photos = [];
  calcOriginalPhotoKeys = calcState.photos.slice(); // NEW: знімок "рідних" фото заявки — щоб при скасуванні прибрати з IndexedDB лише щойно додані в цьому сеансі, а не ці
  // NEW: у самій заявці тепер зберігається лише вибране (checked / meters>0),
  // тож тут завжди розгортаємо це назад у повний каталог для форми — працює
  // однаково і для нового "розрідженого" формату, і для старих заявок, де
  // ще зберігався весь каталог із checked:false (просто нічого не зміниться).
  calcState.equipment = mergeEquipmentWithCatalog(calcState.equipment, getEquipmentConfig());
  calcState.presetWorks = mergePresetWorksWithCatalog(calcState.presetWorks, getWorkTypesConfig());
  if(!calcState.cables || !calcState.cables.length){
    // NEW: сумісність із зовсім старими заявками — переносимо старі окремі поля
    // UTP/Оптика (якщо були) у новий динамічний список кабелів; для заявок, де
    // просто не було вибрано жодного кабелю, дає той самий (порожній) результат
    calcState.cables = getCableTypesConfig().map(c=>({id:c.id, label:c.label, meters:0, pricePerMeter:c.pricePerMeter}));
    const utp = calcState.cables.find(c=>c.id==='utp');
    if(utp && calcState.utpMeters) { utp.meters = Number(calcState.utpMeters)||0; utp.pricePerMeter = Number(calcState.utpPrice)||utp.pricePerMeter; }
    const optic = calcState.cables.find(c=>c.id==='optic');
    if(optic && calcState.opticMeters) { optic.meters = Number(calcState.opticMeters)||0; optic.pricePerMeter = Number(calcState.opticPrice)||optic.pricePerMeter; }
  } else {
    calcState.cables = mergeCablesWithCatalog(calcState.cables, getCableTypesConfig());
  }
  // якщо в збереженій заявці немає додаткових робіт — все одно показуємо
  // одне порожнє поле для вводу, а не порожній список з кнопкою "+"
  calcState.additionalWork = (calcState.additionalWork && calcState.additionalWork.length)
    ? calcState.additionalWork
    : [{desc:'', sum:0}];
  calcState.tags = calcState.tags || [];
  // Теги є частиною самої заявки. Якщо старий/імпортований запис має тег,
  // якого вже немає у загальному переліку Налаштувань, повертаємо його до
  // переліку, щоб він не зникав з форми під час редагування.
  let restoredTagList = false;
  calcState.tags.forEach(tag=>{
    if(!settings.tags.includes(tag)){
      settings.tags.push(tag);
      restoredTagList = true;
    }
  });
  if(restoredTagList) saveSettings();
  // сумісність зі старими заявками, де майстер зберігався як одне ім'я/літера,
  // а не масив (до того, як зробили множинний вибір майстрів)
  if(!calcState.connectMasters){
    calcState.connectMasters = (calcState.masterName || calcState.masterLetter)
      ? [{name: calcState.masterName || '', letter: calcState.masterLetter || ''}]
      : [];
  }
  // Ранні версії під час збереження ремонту могли стерти connectMasters,
  // але ім'я напарника лишалось у тегах. Відновлюємо такий вибір і для вже
  // наявних заявок, щоб він знову був видимим у формі.
  if(calcState.connectMasters.length===0){
    calcState.connectMasters = settings.masters
      .filter(master=>calcState.tags.includes(master.name))
      .map(master=>({name:master.name, letter:master.letter}));
  }
  editingTicketId = t.id;
  feeIsAutoDefault = false; // NEW: редагуємо існуючу заявку — ціну вже введено, автопідстановку вимикаємо
  tariffIsAutoDefault = false;
  formTouchedByUser = true; // NEW: це або реальне редагування наявної заявки, або відновлення чернетки — в обох випадках це вже "справжній" вміст, а не щойно підставлені за замовчуванням дані
  document.getElementById('saveTicketBtn').textContent = 'Оновити заявку';
  { const cancelBtn = document.getElementById('cancelEditBtn'); cancelBtn.textContent = 'Скасувати редагування'; cancelBtn.classList.remove('hidden'); } // NEW: скидаємо підпис — міг лишитись "Назад до пошуку" від попереднього створення нової заявки з профілю
  fillFormFromState();
}

/* Розбирає текст, вставлений з Viber/Telegram від диспетчера, на логін і пароль.
   Формат зазвичай — два рядки: перший логін, другий пароль. Якщо рядок один —
   пробуємо розбити по пробілу/табу; якщо нічого не вдалось — все йде в логін. */
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
  syncPhoneFieldMaskState(); // NEW: див. коментар біля оголошення функції
  document.getElementById('f_mac').value = calcState.macAddress || '';
  { const hint = document.getElementById('macHint'); if(hint) hint.style.display = (calcState.macAddress && !/^[0-9A-F]{12}$/.test(calcState.macAddress)) ? '' : 'none'; }
  document.getElementById('f_credRaw').value = [calcState.login, calcState.password].filter(Boolean).join('\n');
  updateCredParsedHint();
  document.getElementById('f_contractManual').value = calcState.type === 'Ремонт' ? (calcState.contractNumber || '') : ''; // NEW
  setDateFieldValue(calcState.date || '');
  document.getElementById('f_time').value = calcState.time || '';
  document.getElementById('f_callFee').value = calcState.callFee || 0;
  document.getElementById('f_tariff').value = calcState.tariff || 0;
  document.getElementById('f_payment').value = calcState.payment || '';
  updateMixedPaymentVisibility(); // NEW: показує/ховає перелік розбивки суми залежно від способу оплати (і сам малює позиції з calcState.itemPayments)
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

function renderPhotoPreview(){
  const wrap = document.getElementById('photoPreviewWrap');
  const cameraBtn = document.getElementById('photoCameraBtn');
  const galleryBtn = document.getElementById('photoGalleryBtn');
  const photos = calcState.photos || [];
  wrap.innerHTML = photos.map((p, i)=>`
    <div class="photo-thumb-wrap">
      <img class="photo-thumb" id="photoPreview${i}" src="">
      <button type="button" class="photo-remove" data-idx="${i}">✕</button>
    </div>`).join('');
  const fallbackFileIds = (calcState.tgPhotoFileIds && calcState.tgPhotoFileIds.length)
    ? calcState.tgPhotoFileIds
    : (calcState.tgPhotoFileId ? [calcState.tgPhotoFileId] : []);
  photos.forEach((p, i)=>{
    const img = document.getElementById('photoPreview'+i);
    const fallbackId = fallbackFileIds[i] || null;
    const resolved = getPhotoCached(p, (val)=>{ if(img) img.src = val; }, fallbackId);
    if(img) img.src = resolved || '';
  });
  // NEW: два окремі входи — "Камера" (capture=environment, відкриває саме
  // камеру) і "Галерея" (multiple, без capture — вибір із наявних фото).
  // Раніше була одна кнопка з input[multiple], а на Android Chrome
  // атрибут multiple прибирає пункт "Камера" з системного вибору — тому
  // зняти фото прямо з застосунку не виходило, лишалась тільки галерея.
  const full = photos.length >= 3;
  if(cameraBtn){ cameraBtn.disabled = full; cameraBtn.textContent = full ? '📷 Максимум 3 фото' : '📷 Камера'; }
  if(galleryBtn){ galleryBtn.disabled = full; galleryBtn.textContent = full ? '🖼️ Максимум 3 фото' : `🖼️ Галерея${photos.length ? ` (${photos.length}/3)` : ''}`; }
}

function computeTotal(){
  let calculation;
  if(calcState.cloudImported){ // NEW: для відновленої з хмари заявки сума вводиться вручну
    calculation = calculateTicketTotal({cloudImported:true, rawSum:Number(document.getElementById('f_rawSum').value)||0});
    document.getElementById('calcTotal').textContent = fmtMoney(calculation.total);
    return calculation.total;
  }
  // NEW: якщо оплату позначено як "Безкоштовно" — сума завжди 0, незалежно
  // від того, скільки обладнання/робіт/кабелів заповнено в калькуляторі
  // (раніше сума рахувалась як завжди, і "Безкоштовно" в оплаті на неї не впливало).
  const paymentEl = document.getElementById('f_payment');
  if(paymentEl && paymentEl.value === 'Безкоштовно'){
    calculation = calculateTicketTotal({payment:'Безкоштовно'});
    document.getElementById('calcTotal').textContent = fmtMoney(calculation.total);
    return calculation.total;
  }
  calculation = calculateTicketTotal({
    payment: paymentEl ? paymentEl.value : '',
    callFee: Number(document.getElementById('f_callFee').value)||0,
    tariff: Number(document.getElementById('f_tariff').value)||0,
    equipment: calcState.equipment,
    cables: calcState.cables,
    additionalWork: calcState.additionalWork,
    presetWorks: calcState.presetWorks
  });
  document.getElementById('calcTotal').textContent = fmtMoney(calculation.total);
  if(paymentEl && paymentEl.value === 'Змішана') renderMixedPaymentItems(); // NEW: перелік позицій і підсумок готівка/безготівка перераховуються при будь-якій зміні складу/цін
  return calculation.total;
}

// NEW: замість двох порожніх полів "скільки готівкою / скільки
// безготівкою" (які треба було рахувати вручну — саме те, для чого
// калькулятор і існує) — список УЖЕ вибраних позицій (виклик, тариф,
// обладнання, кабелі, роботи) з перемикачем 💵/💳 на кожну. Розбивка
// готівка/безготівка рахується сама, завжди гарантовано збігається із
// загальною сумою — рахувати в умі більше не треба.
function buildMixedPaymentItems(){
  return buildMixedPaymentItemsFromTicket({
    type: calcState.type,
    callFee: Number(document.getElementById('f_callFee').value)||0,
    tariff: Number(document.getElementById('f_tariff').value)||0,
    equipment: calcState.equipment, cables: calcState.cables,
    presetWorks: calcState.presetWorks, additionalWork: calcState.additionalWork
  });
}
// NEW: та сама розбивка на позиції, що й для живої форми (buildMixedPaymentItems
// вище), але працює з уже ЗБЕРЕЖЕНОЮ заявкою (без DOM-полів) — потрібна, щоб
// показати в тексті заявки й у профілі абонента не просто дві суми, а
// конкретно ЩО саме куплено готівкою, а що безготівкою.
// NEW: рядки "готівка: X (перелік позицій), безготівка: Y (перелік позицій)"
// для тексту заявки/профілю — щоб диспетчер одразу бачив, ЩО саме за яку
// оплату, а не лише дві суми без прив'язки до конкретного обладнання.
function renderMixedPaymentItems(){
  const wrap = document.getElementById('mixedPaymentItemsWrap');
  if(!wrap) return;
  const items = buildMixedPaymentItems();
  if(!calcState.itemPayments) calcState.itemPayments = {};
  // NEW: нову позицію (щойно додану заявку/обладнання) за замовчуванням
  // ставимо на "готівка" — типовий випадок "усе готівкою, крім однієї-двох
  // позицій" вимагає найменше тапів (перемкнути лише виняток на 💳)
  items.forEach(it=>{ if(!calcState.itemPayments[it.key]) calcState.itemPayments[it.key] = 'cash'; });
  if(!items.length){
    wrap.innerHTML = `<div style="font-size:12.5px; color:var(--text-faint); padding:6px 0;">Спочатку додайте виклик/обладнання/роботи вище</div>`;
  } else {
    wrap.innerHTML = items.map(it=>{
      const method = calcState.itemPayments[it.key];
      return `<div class="row" style="justify-content:space-between; align-items:center; gap:8px; padding:7px 0; border-bottom:1px solid var(--border);">
        <span style="flex:1; font-size:13.5px;">${escapeHtml(it.label)} — ${fmtMoney(it.amount)}</span>
        <div class="row" style="gap:4px;">
          <button type="button" class="btn btn-sm mixed-item-toggle ${method==='cash'?'btn-accent':''}" data-key="${escapeHtml(it.key)}" data-method="cash">💵</button>
          <button type="button" class="btn btn-sm mixed-item-toggle ${method==='card'?'btn-accent':''}" data-key="${escapeHtml(it.key)}" data-method="card">💳</button>
        </div>
      </div>`;
    }).join('');
  }
  // NEW: розбивка рахується сама з призначень вище — завжди коректна,
  // на відміну від ручного вводу двох чисел, де легко помилитись.
  const cash = items.reduce((s,it)=> s + (calcState.itemPayments[it.key]==='cash' ? it.amount : 0), 0);
  const card = items.reduce((s,it)=> s + (calcState.itemPayments[it.key]==='card' ? it.amount : 0), 0);
  calcState.cashAmount = cash;
  calcState.cardAmount = card;
  const hint = document.getElementById('mixedPaymentHint');
  if(hint) hint.innerHTML = `💵 Готівка: <b>${fmtMoney(cash)}</b> · 💳 Безготівка: <b>${fmtMoney(card)}</b>`;
}

// NEW: показує список позицій розбивки лише для "Змішана оплата" — коли
// частину суми (наприклад, абонплату) абонент кинув на карту, а частину
// (наприклад, роутер) віддав готівкою просто в руки. Раніше вся сума заявки
// могла бути зарахована лише ОДНИМ способом оплати, хоча реально бувало
// по-різному — звідси й плутанина при звірці з диспетчером.
function updateMixedPaymentVisibility(){
  const wrap = document.getElementById('mixedPaymentWrap');
  if(!wrap) return; // NEW: захист від старої версії index.html без цього блока — щоб не впала вся ініціалізація
  const isMixed = document.getElementById('f_payment').value === 'Змішана';
  wrap.classList.toggle('hidden', !isMixed);
  if(isMixed) renderMixedPaymentItems();
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
  if(calcState.type === 'Ремонт'){
    // NEW: для ремонту номер договору не генерується — його вже поставив
    // syncFormToState() з поля "Номер договору абонента", лишається тільки
    // скинути "знімок", що стосується автогенерації для підключень.
    calcState.contractNumberDate = '';
    calcState.contractNumberMastersKey = '';
    return;
  }
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
  // NEW: раніше номер рахувався як "кількість підключень сьогодні + 1"
  // (tickets.filter(...).length + 1) — якщо одну з сьогоднішніх заявок
  // видалили (наприклад, помилково створена), НАСТУПНИЙ згенерований номер
  // міг ЗБІГТИСЯ з номером заявки, що й досі існує (кількість зменшилась,
  // а вже видані номери — ні). Тепер беремо НАЙБІЛЬШИЙ вже використаний
  // сьогодні порядковий номер (з тексту самого contractNumber) і додаємо 1 —
  // видалення заявок посередині дня більше не може призвести до дубля.
  const todayConnections = tickets.filter(t=>
    t.type === 'Підключення' &&
    t.date === calcState.date &&
    String(t.id) !== String(editingTicketId||'')
  );
  let maxSeq = 0;
  todayConnections.forEach(t=>{
    const m = String(t.contractNumber||'').match(/-(\d+)[A-Za-zА-Яа-яЇїІіЄєҐґ]*$/);
    if(m){ const n = Number(m[1]); if(n>maxSeq) maxSeq = n; }
  });
  const seq = maxSeq + 1;
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
  // NEW: "(для договору)" при логіні/паролі актуально і для підключення
  // (новий договір), і для ремонту (номер вже існуючого договору абонента)
  { const sfx = document.getElementById('credCardDogovorSuffix'); if(sfx) sfx.style.display = (isConnect || isRepair) ? '' : 'none'; }
  // NEW: для ремонту абонент вже існує — номер договору не генерується, а
  // вводиться майстром вручну в окремому полі (див. syncFormToState/assignContractNumberIfNeeded)
  document.getElementById('contractManualWrap').classList.toggle('hidden', !isRepair || raw);
  document.getElementById('importedRawWrap').classList.toggle('hidden', !raw); // NEW
  document.getElementById('fullFormFields').classList.toggle('hidden', other);
  document.getElementById('fullFormBlocks').classList.toggle('hidden', other);
  // NEW: обладнання/вартість/MAC для сирої заявки не мають сенсу — сума редагується вручну
  document.getElementById('calcMacCard').classList.toggle('hidden', other || raw);
  document.getElementById('calcPricingBlocks').classList.toggle('hidden', other || raw);
  document.getElementById('f_payment').required = !other;
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
  // У режимі редагування автопідстановка ціни вимкнена, але сам підсумок
  // однаково має одразу реагувати на зміну обладнання.
  if(!feeIsAutoDefault || calcState.cloudImported){ computeTotal(); return; }
  const type = getEffectiveType();
  let def = null;
  if(type === 'Підключення') def = Number(settings.defaultConnectFee) || 0;
  else if(type === 'Ремонт') def = Number(settings.defaultRepairCallFee) || 0;
  if(def === null){ computeTotal(); return; }
  // Безкоштовний виклик — правило лише для ремонту. Вартість підключення
  // ніколи не залежить від проданого обладнання. Нульова позиція теж не
  // може спрацювати, навіть якщо майстер поставить поріг 0 грн.
  const threshold = Number(settings.freeRepairCallThreshold) || 0;
  if(type === 'Ремонт' && (calcState.equipment||[]).some(e=>e.checked && Number(e.price)>0 && Number(e.price)>=threshold)) def = 0;
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
  // NEW: для ремонту номер договору абонента вводиться вручну (абонент вже
  // існує) — на відміну від підключення, де номер генерується автоматично
  // в assignContractNumberIfNeeded()
  if(calcState.type === 'Ремонт'){
    calcState.contractNumber = document.getElementById('f_contractManual').value.trim();
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
  // NEW: для "Змішана" cashAmount/cardAmount і так вже актуальні — їх
  // рахує й одразу пише в calcState сам renderMixedPaymentItems() при
  // кожному тапі на 💵/💳, вручну тут рахувати нічого не треба. Для решти
  // способів оплати обнуляємо — щоб старі значення (з попереднього разу,
  // коли, наприклад, вибрали "Змішана", а потім передумали) не залишались
  // "мертвим вантажем" у заявці.
  if(calcState.payment !== 'Змішана'){
    calcState.cashAmount = 0;
    calcState.cardAmount = 0;
    calcState.itemPayments = {};
  }
  calcState.note = document.getElementById('f_note').value.trim();
  calcState.masterNote = document.getElementById('f_masterNote').value.trim();
  // NEW: для заявки, відновленої з хмари (cloudImported), контент і сума
  // редагуються напряму в полях f_rawContent/f_rawSum (не через звичайний
  // калькулятор) — раніше ця функція їх не читала, тож автозбереження
  // чернетки (яке викликає саме syncFormToState) записувало СТАРІ значення,
  // і правки в цих двох полях губились при випадковому закритті застосунку.
  if(calcState.cloudImported){
    calcState.content = document.getElementById('f_rawContent').value.trim();
    calcState.sum = Number(document.getElementById('f_rawSum').value)||0;
  }
  // geoLink вже синхронізується через setGeoLink
}

/* ---- Фото: зчитування + стиснення до ширини 800px ---- */
function handlePhotoFile(file){
  if(!file) return;
  if(!calcState.photos) calcState.photos = [];
  if(calcState.photos.length >= 3){ showToast('Максимум 3 фото на заявку'); return; }
  const sessionAtStart = formSessionId; // NEW: знімок сеансу форми — див. коментар біля оголошення formSessionId
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
      if(calcState.photos.length >= 3) return; // NEW: могли додати паралельно кілька файлів одразу — перевіряємо ще раз перед пушем
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      // NEW: раніше сире фото (сотні КБ у base64) лежало прямо в
      // calcState.photos, і кожні 30с автозбереження чернетки записувало
      // ЙОГО ЦІЛИКОМ у localStorage (ліміт ~5МБ). 2-3 фото за зміну легко
      // переповнювали сховище — JSON.stringify падав з QuotaExceededError,
      // яка гасилась порожнім catch(e){}, і чернетка (весь введений текст,
      // не лише фото) тихо переставала зберігатись, без жодного попередження.
      // Тепер фото одразу переносимо в IndexedDB (як і при остаточному
      // збереженні заявки — storePhoto) ДО того, як воно потрапить у
      // calcState.photos — запис в IndexedDB займає долі секунди, тож
      // затримка перед появою у прев'ю непомітна, зате чернетка в
      // localStorage завжди лишається легкою, незалежно від кількості й
      // розміру фото.
      storePhoto(dataUrl).then(key=>{
        if(!key) return;
        // NEW: поки йшов запис в IndexedDB, користувач міг скасувати заявку
        // або відкрити іншу (formSessionId змінився) — тоді calcState вже
        // зовсім ІНШИЙ об'єкт (не той, для якого фото знімали), і без цієї
        // перевірки фото "приліплювалось" би до чужої заявки. У такому
        // випадку просто видаляємо щойно записане фото з IndexedDB.
        if(formSessionId !== sessionAtStart){ deletePhotoKey(key); return; }
        if(calcState.photos.length >= 3){ deletePhotoKey(key); return; } // могли встигнути додати ще, поки це фото записувалось
        photoCacheSet(key, dataUrl); // одразу в кеш — прев'ю показується миттєво, без походу в IndexedDB
        calcState.photos.push(key);
        calcState.photo = calcState.photos[0]; // NEW: перше фото дублюється в старе поле photo — для коду, який ще читає лише його
        renderPhotoPreview();
      });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ---- Геолокація ---- */

function setGeoLink(link){
  calcState.geoLink = link;
  formTouchedByUser = true; // NEW: модалка геолокації живе поза #calcForm, тож звичайний input/change-делегат її не бачить — без цього рядка чернетка з самою лише геолокацією (без інших полів) не зберігалась
  // Геолокація тепер НЕ потрапляє в текст примітки/заявки — вона лише
  // для власного використання майстра (кнопка 📍 і бейдж з посиланням).
  renderGeoBadge();
}

/* Розпізнає координати з посилання Google Maps (формати @lat,lng / q=lat,lng / ll=lat,lng)
   або з простого тексту "lat,lng", введеного вручну */
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

/* NEW: редагування геолокації прямо з профілю абонента (навігатор адрес) —
   на відміну від калькулятора, тут немає власного calcState, тож посилання
   застосовується одразу до всіх заявок за цією адресою (ids), як і решта
   полів профілю. */
function openAbonentGeoEditModal(ids, currentLink){
  openModal(currentLink ? '✏️ Геолокація абонента' : '📍 Додати геолокацію', `
    <div style="font-size:13px; color:var(--text-dim); margin-bottom:10px;">
      Відкрий Google Maps → постав мітку → Поділитися → Копіювати посилання → встав нижче. Застосується до всіх заявок за цією адресою (${ids.length} шт.).
    </div>
    <button type="button" class="btn btn-block" id="abonentGeoOpenMapsBtn" style="margin-bottom:10px;">🗺️ Відкрити Google Maps</button>
    <div class="field"><label>Посилання або координати (50.4501, 30.5234)</label>
      <textarea id="abonentGeoPasteInput" placeholder="https://maps.app.goo.gl/... або 50.4501, 30.5234" style="min-height:60px;">${escapeHtml(currentLink||'')}</textarea>
    </div>
    <div class="row" style="gap:8px; margin-top:10px;">
      ${currentLink ? `<button type="button" class="btn btn-danger" id="abonentGeoClearBtn" style="flex:1;">🗑️ Прибрати</button>` : ''}
      <button type="button" class="btn btn-accent" id="abonentGeoSaveBtn" style="flex:2;">✅ Зберегти</button>
    </div>
  `, {onClose: renderAddressNav, onOpen: ()=>{
    document.getElementById('abonentGeoOpenMapsBtn').onclick = ()=> window.open('https://www.google.com/maps', '_blank');
    const clearBtn = document.getElementById('abonentGeoClearBtn');
    if(clearBtn) clearBtn.onclick = ()=>{
      ids.forEach(id=>{ const t = tickets.find(x=>String(x.id)===String(id)); if(t) t.geoLink=''; });
      saveTickets();
      showToast('Геолокацію прибрано');
      renderAddressNav();
    };
    document.getElementById('abonentGeoSaveBtn').onclick = ()=>{
      const raw = document.getElementById('abonentGeoPasteInput').value.trim();
      if(!raw){ showToast('Встав посилання або координати'); return; }
      const coords = parseMapsLink(raw);
      const link = coords ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}` : raw;
      ids.forEach(id=>{ const t = tickets.find(x=>String(x.id)===String(id)); if(t) t.geoLink=link; });
      saveTickets();
      showToast('✅ Геолокацію збережено');
      renderAddressNav();
    };
  }});
}

/* NEW: редагування примітки про абонента прямо з профілю — окремо від
   повного "Редагувати абонента", щоб не заходити всередину заради одного
   поля. Так само застосовується одразу до всіх заявок за цією адресою. */
function openAbonentNoteEditModal(ids, currentNote){
  openModal(currentNote ? '✏️ Примітка про абонента' : '📝 Додати примітку', `
    <div class="field"><textarea id="abonentNoteEditInput" placeholder="Наприклад: землячка з Кураховки" style="min-height:100px;">${escapeHtml(currentNote||'')}</textarea></div>
    <div class="row" style="gap:8px; margin-top:10px;">
      ${currentNote ? `<button type="button" class="btn btn-danger" id="abonentNoteClearBtn" style="flex:1;">🗑️ Прибрати</button>` : ''}
      <button type="button" class="btn btn-accent" id="abonentNoteSaveBtn" style="flex:2;">✅ Зберегти</button>
    </div>
  `, {onClose: renderAddressNav, onOpen: ()=>{
    const clearBtn = document.getElementById('abonentNoteClearBtn');
    if(clearBtn) clearBtn.onclick = ()=>{
      ids.forEach(id=>{ const t = tickets.find(x=>String(x.id)===String(id)); if(t) t.abonentNote=''; });
      saveTickets();
      showToast('Примітку прибрано');
      renderAddressNav();
    };
    document.getElementById('abonentNoteSaveBtn').onclick = ()=>{
      const val = document.getElementById('abonentNoteEditInput').value.trim();
      ids.forEach(id=>{ const t = tickets.find(x=>String(x.id)===String(id)); if(t) t.abonentNote=val; });
      saveTickets();
      showToast('✅ Примітку збережено');
      renderAddressNav();
    };
  }});
}

/* ---- Копіювати текст / Поділитись фото ---- */
async function saveTicketFromForm(e){
  e.preventDefault();
  // NEW: захист від подвійного тапу — на телефоні під час мережевої затримки
  // легко тапнути "Зберегти" двічі поспіль, і без цього обидва виклики
  // проходили валідацію й створювали дві майже однакові заявки. Кнопку
  // блокуємо одразу і гарантовано розблоковуємо в finally, незалежно від
  // того, яким шляхом (успіх, скасування, помилка) функція завершиться.
  const saveBtn = document.getElementById('saveTicketBtn');
  if(saveBtn.disabled) return;
  saveBtn.disabled = true;
  const saveBtnOriginalText = saveBtn.textContent;
  saveBtn.textContent = '⏳ Збереження...';
  try{
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

  // NEW: у саму заявку записуємо лише вибрані позиції каталогу (checked /
  // meters>0), а не весь каталог обладнання/кабелів/робіт із checked:false —
  // це і є той рефакторинг, що прибирає роздування об'єкта заявки. Форма й
  // далі повністю розгортає каталог при відкритті (loadTicketIntoForm /
  // blankCalcState) — тут лише те, що потрапляє у збережений об'єкт.
  calcState.equipment = (calcState.equipment||[]).filter(e=>e.checked).map(e=>({id:e.id, label:e.label, price:Number(e.price)||0}));
  calcState.cables = (calcState.cables||[]).filter(c=>Number(c.meters)>0).map(c=>({id:c.id, label:c.label, meters:Number(c.meters)||0, pricePerMeter:Number(c.pricePerMeter)||0}));
  calcState.presetWorks = (calcState.presetWorks||[]).filter(w=>w.checked).map(w=>({id:w.id, label:w.label, price:Number(w.price)||0, qty:Number(w.qty)||1}));

  // NEW: до 3 фото на заявку — кожне НОВЕ (сире, ще не idb:...) переносимо
  // в IndexedDB, а всі старі фото цієї заявки, яких більше нема в новому
  // списку (видалені чи замінені майстром), приберемо з IndexedDB, щоб не
  // копичити "сирітські" записи.
  if(!calcState.photos) calcState.photos = [];
  const prevPhotoKeys = [];
  if(editingTicketId){
    const prev = tickets.find(t=>String(t.id)===String(editingTicketId)); // NEW: String() — id з хмари приходить рядком, а локально створений може бути числом
    if(prev){
      if(prev.photos && prev.photos.length) prevPhotoKeys.push(...prev.photos);
      else if(prev.photo) prevPhotoKeys.push(prev.photo);
    }
  }
  const newPhotoKeys = [];
  for(const p of calcState.photos){
    if(p && !String(p).startsWith('idb:')){
      const key = await storePhoto(p);
      if(!key) return;
      newPhotoKeys.push(key);
    }
    else if(p) newPhotoKeys.push(p);
  }
  calcState.photos = newPhotoKeys;
  calcState.photo = newPhotoKeys[0] || null; // NEW: перше фото дублюється у старе поле — для коду, який ще читає лише його
  for(const key of prevPhotoKeys){
    if(!newPhotoKeys.includes(key)) await deletePhotoKey(key);
  }


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
      cleanupUnsavedNewPhotos(); // NEW: якщо скасували через дубль — не лишати щойно зроблені фото сиротами в IndexedDB
      return;
    }
  }

  let savedTicketRef = null; // NEW: посилання на щойно збережений об'єкт у tickets — для бекапу в Telegram нижче
  if(editingTicketId){
    // Зберігаємо ID до виходу з форми. Після збереження resetCalcForm()
    // обнуляє editingTicketId, а відповідь синхронізації приходить уже у фоні.
    // Без окремої копії callback не знаходив оновлену заявку, лишав її у
    // черзі та міг повторно відправляти оновлення при наступній синхронізації.
    const updatedTicketId = editingTicketId;
    calcState.id = updatedTicketId;
    const idx = tickets.findIndex(t=>String(t.id)===String(updatedTicketId)); // NEW: String() — те саме застереження, що й вище з фото
    if(idx>-1) tickets[idx] = JSON.parse(JSON.stringify(calcState));
    saveTickets();
    showToast('Заявку оновлено');
    if(idx>-1) savedTicketRef = tickets[idx];
  } else {
    calcState.id = MTSyncEngineRuntime.uuid();
    const newTicket = JSON.parse(JSON.stringify(calcState));
    tickets.push(newTicket);
    saveTickets();
    showToast('Заявку збережено');
    savedTicketRef = tickets.find(t=>t.id===newTicket.id);
  }
  if(savedTicketRef && naryadPendingCompletionId){
    const naryad = naryadQueue.find(n=>String(n.id)===String(naryadPendingCompletionId));
    if(naryad){
      naryad.done = true;
      // Зберігаємо стабільний зв'язок із щойно створеною заявкою. До цього
      // моменту черга містила лише сирий текст наряду, тому після перезапуску
      // застосунку без цього поля безпечно відкрити заявку на редагування було неможливо.
      naryad.ticketId = savedTicketRef.id;
      saveNaryadQueue();
      updateNaryadQueueBtn();
    }
    naryadPendingCompletionId = null;
  }
  if(savedTicketRef) backupTicketToTelegram(savedTicketRef); // NEW: фонова резервна копія тексту/фото в Telegram (не блокує збереження)

  currentTicketDate = calcState.date;
  clearDraft();
  resetCalcForm();
  returnAfterTicketEdit();
  renderTicketsScreen();
  }finally{
    saveBtn.disabled = false;
    saveBtn.textContent = saveBtnOriginalText;
  }
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



/* Графік годин по місяцях обраного року — щоб одразу бачити, в якому місяці скільки відпрацьовано */



function addShift(){
  const enteredHours = Number(document.getElementById('shiftHours').value);
  const hours = roundWorkedHours(enteredHours);
  if(!hours || hours<=0){ showToast('Вкажіть кількість годин'); return; }
  const coworker = coworkerSelection.size ? [...coworkerSelection].join(', ') : 'Сам';
  const shift = {id: MTSyncEngineRuntime.uuid(), date: currentShiftDate, hours, coworker};
  shifts.push(shift);
  saveShifts();
  syncShiftsMonthlyTelegramMessage(); // NEW: оновлюємо/надсилаємо місячне повідомлення в Telegram (у фоні, не блокує UI)
  document.getElementById('shiftHours').value = '';
  coworkerSelection = new Set();
  statsViewDate = parseDate(currentShiftDate);
  renderShiftsScreen();
  showToast(hours !== enteredHours ? `Зміну додано · округлено до ${hours} год` : 'Зміну додано');
}

function deleteShift(id){
  if(!confirm('Видалити цю зміну?')) return;
  shifts = shifts.filter(s=>String(s.id)!==String(id)); // NEW: id зміни — рядок (UUID), Number() ламав порівняння
  saveShifts();
  syncShiftsMonthlyTelegramMessage(); // NEW: те саме — місячне повідомлення в Telegram лишається актуальним і після видалення
  renderShiftsScreen();
  showToast('Зміну видалено');
}

/* Текстовий звіт за обраний місяць — для копіювання/відправки у Viber, Telegram тощо */
function buildShiftMonthReport(){
  const monthShifts = shifts.filter(s=>isSameMonth(s.date, statsViewDate))
    .sort((a,b)=> parseDate(a.date)-parseDate(b.date));
  return formatShiftMonthText(monthShifts, statsViewDate, MONTH_NAMES);
}

// NEW: одне повідомлення в Telegram на весь поточний місяць — щодня (при
// кожній зміні, доданій чи видаленій) редагується, а не дублюється новим.
// 1-го числа нового місяця автоматично починається НОВЕ повідомлення. По
// суті це живий бекап "Змін" прямо в переписці з ботом — на випадок втрати
// телефону видно все за місяць одним поглядом, без імпорту файлів.
function buildCurrentMonthShiftsTelegramText(){
  const now = new Date();
  const monthShifts = shifts.filter(s=>isSameMonth(s.date, now))
    .sort((a,b)=> parseDate(a.date)-parseDate(b.date));
  return formatShiftMonthText(monthShifts, now, MONTH_NAMES, `оновлено: ${formatDate(new Date())} ${formatTime(new Date())}`); // NEW: видно, що повідомлення живе й актуальне, а не застигле
}
let shiftsTelegramSyncBusy = false;
let shiftsTelegramSyncQueued = false;
async function syncShiftsMonthlyTelegramMessage(){
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgMyChatId||'').trim();
  if(!token || !chatId) return; // не налаштовано — тихо виходимо, це не обов'язкова функція
  // NEW: якщо додати дві зміни поспіль дуже швидко (наприклад, два різних
  // напарники за один день), обидва виклики цієї функції могли стартувати
  // майже одночасно — обидва бачили, що tgShiftsMsgId ще не встановлено для
  // цього місяця, і ОБИДВА надсилали НОВЕ повідомлення в Telegram замість
  // одного. Якщо синк уже йде, не запускаємо другий паралельно: позначаємо
  // один повтор після завершення поточного. Так останній текст включить усі
  // швидкі зміни, незалежно від фактичної затримки Telegram.
  if(shiftsTelegramSyncBusy){
    shiftsTelegramSyncQueued = true;
    return;
  }
  shiftsTelegramSyncBusy = true;
  try{
    const monthKey = localMonthKey(new Date());
    const text = buildCurrentMonthShiftsTelegramText();
    if(settings.tgShiftsMsgId && settings.tgShiftsMsgMonth === monthKey){
      // той самий місяць — редагуємо вже надіслане повідомлення
      const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, message_id: settings.tgShiftsMsgId, text: text.slice(0,4000)})
      });
      const data = await res.json();
      if(data.ok) return;
      // NEW: якщо редагування не вдалось (наприклад, повідомлення видалили
      // вручну з чату) — не мовчимо, а надсилаємо нове замість втраченого
    }
    // новий місяць або ще не надсилали цього місяця — нове повідомлення
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: chatId, text: text.slice(0,4000)})
    });
    const data = await res.json();
    if(data.ok){
      settings.tgShiftsMsgId = data.result.message_id;
      settings.tgShiftsMsgMonth = monthKey;
      saveSettings();
    }
  }catch(e){ /* немає інтернету чи Telegram недоступний — не критично, спробуємо при наступній зміні */ }
  finally{
    shiftsTelegramSyncBusy = false;
    if(shiftsTelegramSyncQueued){
      shiftsTelegramSyncQueued = false;
      syncShiftsMonthlyTelegramMessage();
    }
  }
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
/* ---- Експорт для NotebookLM ---- */
/* ---- Код Apps Script (для довідки користувачу) ---- */

/* ---------- 8. Прив'язка подій та ініціалізація ---------- */
function bindTabBar(){
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const tab = btn.dataset.tab;
      const currentlyOnCalculator = document.getElementById('screen-calculator').classList.contains('active');
      // NEW: раніше умова тут ще й перевіряла editingTicketId===null — тобто
      // попередження про незбережені зміни спрацьовувало ЛИШЕ для НОВОЇ
      // заявки. Якщо редагувати вже існуючу заявку (звичайну чи ☁️
      // відновлену з хмари) і просто тапнути на іншу вкладку — правки
      // тихо губились без жодного попередження (кнопка "Скасувати
      // редагування" своє попередження показує, але перехід через таби
      // йде іншим шляхом і її не зачіпає).
      if(currentlyOnCalculator && tab!=='calculator'){
        syncFormToState();
        if(hasUnsavedChanges()){
          const leave = confirm(editingTicketId ? 'Є незбережені правки заявки. Перейти без збереження?' : 'У калькуляторі є незбережені дані. Перейти без збереження?');
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
  // NEW: черга нарядів від диспетчера — кнопка під датою
  document.getElementById('naryadQueueBtn').addEventListener('click', ()=> showNaryadQueue());
  updateNaryadQueueBtn();

  // NEW: кнопки "Копіювати за день"/"Надіслати за день" прибрано з головного
  // екрана — той самий функціонал (і повний, з фільтрами за період) уже є
  // в модалці "Звіти", а тут вони лише захаращували екран і майже не
  // використовувались.

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
        syncEngine.flush().then(ok=>{
          renderTicketsScreen();
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
  document.getElementById('todayBtn').addEventListener('click', ()=>{
    const today = new Date();
    currentTicketDate = formatDate(today);
    calendarViewDate = new Date(today.getFullYear(), today.getMonth(), 1);
    if(!document.getElementById('calendarPanel').classList.contains('hidden')) renderCalendar();
    renderTicketsScreen();
  });
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
    const expBtn   = e.target.closest('.tc-expand-btn');
    const retryBtn = e.target.closest('.retry-sync-btn');
    const retryTgBtn = e.target.closest('.retry-tg-btn');
    const gotoProfileBtn = e.target.closest('.goto-profile-btn'); // NEW: замінила "На дату" на звичайних картках
    const moreBtn  = e.target.closest('.show-more-tickets-btn');
    const photoBadgeBtn = e.target.closest('.tc-photo-toggle-btn');
    if(photoBadgeBtn){ toggleTicketCardPhoto(photoBadgeBtn, document.getElementById('ticketList')); return; }
    const photoThumb = e.target.closest('.tc-photo-thumb');
    if(photoThumb){ openTicketPhotoFullscreen(photoThumb.dataset.full); return; }
    if(gotoProfileBtn){ goToTicketProfile(gotoProfileBtn.dataset.id); return; }
    if(moreBtn){
      ticketListRenderLimit += TICKET_LIST_PAGE_SIZE;
      renderMainTicketList();
      return;
    }
    if(editBtn){ editReturnAddrState = null; editTicket(editBtn.dataset.id); } // NEW: редагування зі звичайного списку — повертатись нема куди, скидаємо можливий "хвіст" від профілю
    if(delBtn)   deleteTicket(delBtn.dataset.id);
    if(shareBtn) shareTicket(shareBtn.dataset.id);
    if(tgBtn)    sendTicketToDispatcher(tgBtn.dataset.id);
    if(tgOpenBtn) openTicketInTelegram(tgOpenBtn.dataset.id);
    if(copyBtn)  copyTicketCardText(copyBtn.dataset.id);
    if(dgBtn)    showDogovor(dgBtn.dataset.id);
    if(retryBtn) retrySyncTicket(retryBtn.dataset.id);
    if(retryTgBtn) retryTelegramBackup(retryTgBtn.dataset.id);
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
    // NEW: спершу обираємо тип заявки, а не одразу відкриваємо порожню форму
    showTicketTypePicker(type=> startNewTicketFlow(type, null, null));
  });
  // NEW: свайп для зміни дня прибрано навмисно — занадто легко смикнути
  // випадково під час скролу списку і опинитись не на тій даті. Дата
  // тепер змінюється тільки кнопками ‹ › біля дати вгорі екрана.
}

function bindCalculatorScreen(){
  // <details> у деяких мобільних браузерах може змінювати scrollTop
  // прокручуваного контейнера після розкриття великого блоку. Нативний
  // toggle не потребує перерендеру, тому зберігаємо позицію до його дії та
  // повертаємо її після layout. Це спільний захист для всіх секцій калькулятора.
  const calcFormEl = document.getElementById('calcForm');
  const calcScrollEl = document.querySelector('main.screens');
  const rememberAccordionScroll = e=>{
    const summary = e.target.closest && e.target.closest('details > summary');
    if(!summary || !calcFormEl.contains(summary)) return;
    summary.parentElement._scrollTopBeforeToggle = calcScrollEl.scrollTop;
  };
  calcFormEl.addEventListener('pointerdown', rememberAccordionScroll, true);
  calcFormEl.addEventListener('click', rememberAccordionScroll, true);
  calcFormEl.addEventListener('keydown', e=>{
    if(e.key==='Enter' || e.key===' ') rememberAccordionScroll(e);
  }, true);
  calcFormEl.querySelectorAll('details').forEach(details=>{
    details.addEventListener('toggle', ()=>{
      const top = details._scrollTopBeforeToggle;
      if(!Number.isFinite(top)) return;
      requestAnimationFrame(()=> requestAnimationFrame(()=>{ calcScrollEl.scrollTop = top; }));
    });
  });
  // NEW: будь-яка реальна взаємодія з полями форми (а не автопідстановка з
  // наряду/профілю) позначає форму як "торкнуту руками" — від цього залежить,
  // чи вважати її чернеткою (див. formTouchedByUser і saveDraftToLocalStorage)
  document.getElementById('calcForm').addEventListener('input', ()=>{ formTouchedByUser = true; });
  document.getElementById('calcForm').addEventListener('change', ()=>{ formTouchedByUser = true; });
  // Автоматично виділяємо весь вміст числового поля при фокусі —
  // щоб не доводилось вручну видаляти «0» перед введенням ціни
  document.querySelectorAll('#calcForm input[type="number"]').forEach(el=>{
    el.addEventListener('focus', ()=> el.select());
  });
  ['f_callFee','f_tariff'].forEach(id=>{
    document.getElementById(id).addEventListener('input', computeTotal);
  });
  // NEW: при виборі "Безкоштовно" сума одразу обнуляється (див. computeTotal),
  // а при поверненні на "Готівка"/"Безготівка" — рахується знову як завжди.
  document.getElementById('f_payment').addEventListener('change', ()=>{ updateMixedPaymentVisibility(); computeTotal(); });
  // NEW: делегований клік по 💵/💳 в переліку розбивки суми ("Змішана" оплата)
  const mixedItemsWrapEl = document.getElementById('mixedPaymentItemsWrap');
  if(mixedItemsWrapEl) mixedItemsWrapEl.addEventListener('click', e=>{
    const btn = e.target.closest('.mixed-item-toggle');
    if(!btn) return;
    if(!calcState.itemPayments) calcState.itemPayments = {};
    calcState.itemPayments[btn.dataset.key] = btn.dataset.method;
    renderMixedPaymentItems();
  });
  document.getElementById('f_phone').addEventListener('input', formatPhoneInput);
  document.getElementById('f_type').addEventListener('change', ()=>{ applyDefaultTypeTag(); toggleTypeOtherField(); updateCallFeeLabel(); applyDefaultCallFee(); applyDefaultTariff(); });
  // NEW: при зміні міста — одразу підвантажуємо підказки вулиць саме для цього міста
  // NEW: підказка клієнта за адресою — якщо на цю ж адресу вже була заявка,
// пропонуємо підставити ім'я/телефон, щоб не вбивати вручну вдруге.
// Спрацьовує тільки для НОВОЇ заявки (не при редагуванні) і тільки якщо
// клієнта/телефон ще не вписані — нічого не нав'язуємо, якщо вже заповнено.
// NEW: тепер враховуємо і квартиру (не лише будинок — в одному будинку
// різні квартири можуть належати різним абонентам), і підставляємо не лише
// ім'я/телефон, а й логін/пароль/номер договору — це дані самого абонента,
// а не конкретного візиту, тож мають лишатись з ним від заявки до заявки.
function findPreviousTicketAtAddress(city, street, house, apartment){
  const norm = s => (s||'').trim().toLowerCase();
  if(!norm(city) || !norm(street) || !norm(house)) return null;
  const aptKey = (apartment||'').trim() || '(без кв.)';
  const matches = tickets.filter(t=>
    !t.cloudImported &&
    norm(t.city)===norm(city) && norm(t.street)===norm(street) && norm(t.house)===norm(house) &&
    ticketApartmentKey(t)===aptKey &&
    (t.clientName || t.phone || t.login || t.password || t.contractNumber)
  );
  if(!matches.length) return null;
  matches.sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
  return matches[0];
}
function maybeSuggestClientFromAddress(){
  if(editingTicketId) return; // при редагуванні вже існуючої заявки нічого не пропонуємо
  if(getEffectiveType() !== 'Ремонт') return; // NEW: для Підключення номер/логін і так генеруються заново — підставляти старі не варто
  if(calcState.clientName || calcState.phone) return; // щось уже вписано — не заважаємо
  const city = document.getElementById('f_city').value.trim();
  const street = document.getElementById('f_street').value.trim();
  const house = document.getElementById('f_house').value.trim();
  const apartment = document.getElementById('f_apartment').value.trim();
  const prev = findPreviousTicketAtAddress(city, street, house, apartment);
  if(!prev) return;
  const addr = [city, street, house, apartment ? `кв. ${apartment}` : ''].filter(Boolean).join(', ');
  openModal('Клієнт на цій адресі', `
    <div style="font-size:14px; margin-bottom:14px; color:var(--text-dim);">
      На адресі <strong style="color:var(--text);">${escapeHtml(addr)}</strong> вже була заявка:<br>
      ${prev.clientName ? escapeHtml(prev.clientName)+'<br>' : ''}${prev.phone ? escapeHtml(prev.phone) : ''}
    </div>
    <button type="button" class="btn btn-accent btn-block" id="useAddrClientBtn">Підставити дані</button>
    <button type="button" class="btn btn-block" id="skipAddrClientBtn" style="margin-top:8px;">Ні, це інша людина</button>
  `, {onOpen: ()=>{
    document.getElementById('useAddrClientBtn').addEventListener('click', ()=>{
      document.getElementById('f_client').value = prev.clientName || '';
      document.getElementById('f_phone').value = prev.phone || '';
      syncPhoneFieldMaskState(); // NEW: див. коментар біля оголошення функції
      calcState.clientName = prev.clientName || '';
      calcState.phone = prev.phone || '';
      // NEW: логін/пароль/номер договору — теж дані абонента, підставляємо разом з ім'ям
      if(prev.login || prev.password){
        document.getElementById('f_credRaw').value = [prev.login, prev.password].filter(Boolean).join('\n');
        updateCredParsedHint();
      }
      if(prev.contractNumber){
        document.getElementById('f_contractManual').value = prev.contractNumber;
      }
      closeModal();
      showToast('Дані абонента підставлено');
    });
    document.getElementById('skipAddrClientBtn').addEventListener('click', closeModal);
  }});
}
document.getElementById('f_house').addEventListener('blur', maybeSuggestClientFromAddress);
document.getElementById('f_apartment').addEventListener('blur', maybeSuggestClientFromAddress); // NEW: якщо адресу вже вбито, а квартиру дописали останньою

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

const photoCameraBtnEl = document.getElementById('photoCameraBtn');
  const photoGalleryBtnEl = document.getElementById('photoGalleryBtn');
  const f_photoCameraInputEl = document.getElementById('f_photoCameraInput');
  const f_photoInputEl = document.getElementById('f_photoInput');
  // NEW: захист від падіння всього застосунку, якщо на сторінці випадково
  // опиниться СТАРА версія index.html (без кнопок "Камера"/"Галерея") разом
  // із НОВИМ app.js — раніше через відсутній елемент тут виникала помилка
  // "Cannot read properties of null", яка зупиняла виконання решти скрипта
  // (звідси зникала дата, версія застосунку, список заявок).
  if(photoCameraBtnEl) photoCameraBtnEl.addEventListener('click', ()=> f_photoCameraInputEl && f_photoCameraInputEl.click());
  if(photoGalleryBtnEl) photoGalleryBtnEl.addEventListener('click', ()=> f_photoInputEl && f_photoInputEl.click());
  if(f_photoCameraInputEl) f_photoCameraInputEl.addEventListener('change', e=>{
    // NEW: капча з камери завжди дає лише один файл за раз (на відміну від
    // галереї, де можна вибрати одразу декілька) — тому обробляємо просто files[0]
    const file = e.target.files && e.target.files[0];
    if(file){
      if((calcState.photos||[]).length >= 3) showToast('Максимум 3 фото на заявку');
      else handlePhotoFile(file);
    }
    e.target.value = '';
  });
  if(f_photoInputEl) f_photoInputEl.addEventListener('change', e=>{
    const files = Array.from(e.target.files || []);
    const remaining = 3 - (calcState.photos||[]).length;
    files.slice(0, remaining).forEach(handlePhotoFile);
    if(files.length > remaining && remaining>0) showToast(`Додано лише ${remaining} з ${files.length} — максимум 3 фото на заявку`);
    else if(remaining<=0 && files.length) showToast('Максимум 3 фото на заявку');
    e.target.value = '';
  });
  document.getElementById('photoPreviewWrap').addEventListener('click', e=>{
    const btn = e.target.closest('.photo-remove');
    if(!btn) return;
    const idx = Number(btn.dataset.idx);
    // NEW: якщо це фото ще НЕ належить збереженій заявці (додане щойно в
    // цьому сеансі) — одразу прибираємо його з IndexedDB, а не лишаємо
    // "сиротою" без жодного посилання. Фото, які вже були в заявці до
    // початку редагування (є в calcOriginalPhotoKeys), не чіпаємо тут —
    // ними керує saveTicketFromForm при збереженні.
    const key = calcState.photos[idx];
    if(key && String(key).startsWith('idb:') && !calcOriginalPhotoKeys.includes(key)) deletePhotoKey(key);
    calcState.photos.splice(idx, 1);
    calcState.photo = calcState.photos[0] || null; // NEW: перше фото — і далі дублюється у старе поле photo
    renderPhotoPreview();
  });
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
    if(chk){
      const idx = Number(chk.dataset.eqidx);
      calcState.equipment[idx].checked = chk.checked;
      syncCatalogTagState(calcState.equipment[idx].label, chk.checked); // NEW: авто-тег за назвою матеріалу
      applyDefaultCallFee(); renderEquipmentList();
    }
  });
  document.getElementById('equipmentList').addEventListener('input', e=>{
    const price = e.target.closest('.eq-price');
    if(price){ calcState.equipment[Number(price.dataset.eqidx)].price = Number(price.value)||0; applyDefaultCallFee(); updateEquipmentSummary(); }
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
    if(chk){
      const idx = Number(chk.dataset.pwidx);
      calcState.presetWorks[idx].checked = chk.checked;
      syncCatalogTagState(calcState.presetWorks[idx].label, chk.checked); // NEW: авто-тег за назвою роботи
      computeTotal(); renderPresetWorksList();
    }
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
    // Ключі змішаної оплати для додаткових робіт залежать від індексу aw_N.
    // Після видалення рядка зсуваємо ключі наступних робіт разом зі списком,
    // щоб робота не успадковувала спосіб оплати видаленої сусідньої позиції.
    if(calcState.itemPayments){
      const updatedPayments = {};
      Object.entries(calcState.itemPayments).forEach(([key, method])=>{
        const match = key.match(/^aw_(\d+)$/);
        if(!match){ updatedPayments[key] = method; return; }
        const oldIndex = Number(match[1]);
        if(oldIndex < idx) updatedPayments[key] = method;
        else if(oldIndex > idx) updatedPayments[`aw_${oldIndex-1}`] = method;
      });
      calcState.itemPayments = updatedPayments;
    }
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
    saveDailyMastersDefault(calcState.connectMasters); // NEW: запам'ятовуємо поточний вибір як "бригаду на сьогодні"
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
    // NEW: та сама кнопка тепер править і "Скасувати редагування" (для наявної
    // заявки), і "Назад до пошуку" (для нової заявки, відкритої з профілю/
    // пошуку) — текст підтвердження підбираємо залежно від того, що з двох
    const confirmMsg = editingTicketId ? 'Скасувати редагування? Незбережені зміни буде втрачено.' : 'Повернутись назад? Введені у заявку дані буде втрачено.';
    if(hasUnsavedChanges() && !confirm(confirmMsg)) return;
    cleanupUnsavedNewPhotos(); // NEW: не лишати в IndexedDB фото, зроблені в цьому сеансі, якщо заявку скасовано
    clearDraft(); resetCalcForm(currentTicketDate); returnAfterTicketEdit();
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
  bindTabBar();
  bindTicketsScreen();
  bindCalculatorScreen();
  bindShiftsScreen();
  bindSettingsScreen();

  ticketsDb = await openTicketsDb();
  await loadTicketsFromIdb(); // NEW: підвантажує заявки з IndexedDB (з одноразовою міграцією зі старого localStorage, якщо потрібно) — має відбутись ДО міграції фото нижче, бо та проходиться по tickets
  syncTicketsSnapshot = JSON.parse(JSON.stringify(tickets));
  syncShiftsSnapshot = JSON.parse(JSON.stringify(shifts));
  const syncTransport = MTSyncTransport.create({
    fetch: window.fetch.bind(window),
    url: ()=>getScriptUrl(),
    secret: ()=>String(settings.syncHmacSecret||''),
    responseMode: ()=>settings.syncResponseMode==='readable'?'readable':'opaque',
    random: ()=>MTSyncEngineRuntime.uuid(),
    now: ()=>Date.now(),
    verifyTimeoutMs:1000
  });
  syncEngine = await new MTSyncEngineRuntime.Engine({
    transport:syncTransport,
    online:()=>navigator.onLine && !!getScriptUrl() && String(settings.syncHmacSecret||'').length>=32,
    onChange:()=>{ if(document.getElementById('syncQueueBanner')) renderSyncQueueBanner(); }
  }).init();
  await migrateLegacySyncState();

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
    syncEngine.flush();
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

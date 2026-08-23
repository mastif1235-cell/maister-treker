/* Settings defaults, migration and persistence. Loaded before app state. */
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

// NEW: назва тегу для матеріалу/роботи з переліку — той самий текст, що й у
// назві матеріалу/роботи, лише в нижньому регістрі (щоб виглядало як інші
// теги на кшталт 'ремонт', 'монтаж').
// NEW: додає в список тегів (Налаштування → Теги) тег для КОЖНОГО матеріалу й
// роботи з переліку, якщо такого тегу там ще нема. Викликається при
// завантаженні налаштувань і при доданні нового матеріалу/роботи — щоб теги
// завжди були в наявності, навіть якщо майстер ще жодного разу не відмічав
// цей матеріал/роботу в заявці.
function ensureCatalogTags(){
  let changed = false;
  [...getEquipmentConfig(), ...getWorkTypesConfig()].forEach(item=>{
    const tag = catalogTagFor(item.label);
    if(tag && !settings.tags.includes(tag)){ settings.tags.push(tag); changed = true; }
  });
  return changed;
}
// NEW: коли майстер відмічає/знімає позначку з матеріалу чи роботи в
// калькуляторі — відповідний тег автоматично вмикається/вимикається теж
// (наприклад, поставили галочку "Роутер" — тег "роутер" теж стає активним).
function syncCatalogTagState(label, checked){
  const tag = catalogTagFor(label);
  if(!tag) return;
  if(checked){
    if(!settings.tags.includes(tag)){ settings.tags.push(tag); saveSettings(); }
    if(!calcState.tags.includes(tag)) calcState.tags.push(tag);
  } else {
    const i = calcState.tags.indexOf(tag);
    if(i>-1) calcState.tags.splice(i,1);
  }
  // NEW: як і для прямого кліку по чипу тегу — намагаємось лише перемкнути
  // клас на вже наявній кнопці, а не перебудовувати весь innerHTML (це
  // скидало фокус і підкидало скрол сторінки вгору при кожній галочці
  // обладнання/роботи з автотегом). Повний перерендер лишається лише на
  // випадок, коли тег геть новий і кнопки для нього ще нема в DOM.
  const chip = Array.from(document.querySelectorAll('#calcTagChips [data-calctag]')).find(el=>el.dataset.calctag===tag);
  if(chip){
    chip.classList.toggle('active', calcState.tags.includes(tag));
    const summary = document.getElementById('tagsSummary');
    if(summary) summary.textContent = calcState.tags.length ? `— обрано: ${calcState.tags.length}` : '';
  } else {
    renderCalcTagChips();
  }
}

const DEFAULT_CABLE_TYPES = [
  {id:'utp',   label:'UTP',    pricePerMeter:7},
  {id:'optic', label:'Оптика', pricePerMeter:9},
];
// CABLE_TYPES_CONFIG тепер береться з settings.cableTypes (редагується в Налаштуваннях) —
// можна додати свій тип кабелю (наприклад, вуличний), а не лише UTP/Оптику
function getCableTypesConfig(){ return (settings && settings.cableTypes && settings.cableTypes.length) ? settings.cableTypes : DEFAULT_CABLE_TYPES; }

const SYNC_V66_SETTINGS_MIGRATION_VERSION = 1;

function sanitizeLegacySyncEndpoint(value){
  const raw = String(value || '').trim();
  if(!raw) return '';
  try{
    const url = new URL(raw);
    ['secret','syncSecret','syncHmacSecret'].forEach(key=>url.searchParams.delete(key));
    url.hash = '';
    return url.toString();
  }catch(e){
    return raw;
  }
}

function isReadyV66SyncEndpoint(value){
  try{
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && !url.search && !url.hash;
  }catch(e){
    return false;
  }
}

function migrateSyncSettingsV66(source, merged, nowIso){
  const original = source && typeof source === 'object' ? source : {};
  const target = merged && typeof merged === 'object' ? merged : {};
  const previous = target.syncV66Migration;
  const validPrevious = previous && typeof previous === 'object' &&
    Number(previous.version) === SYNC_V66_SETTINGS_MIGRATION_VERSION;

  const marker = validPrevious ? Object.assign({}, previous) : {
    version: SYNC_V66_SETTINGS_MIGRATION_VERSION,
    status: 'pending',
    legacyTicketEndpoint: sanitizeLegacySyncEndpoint(original.scriptUrl),
    legacyShiftsEndpoint: sanitizeLegacySyncEndpoint(original.shiftsScriptUrl),
    legacySecretWasPresent: !!String(original.syncSecret || ''),
    detectedAt: nowIso || new Date().toISOString(),
    completedAt: '',
    canonicalEndpoint: ''
  };

  // Keep both legacy endpoints for an explicit rollback, but remove secret
  // query parameters. Runtime v66 still has exactly one owner and uses only
  // scriptUrl; shiftsScriptUrl is compatibility evidence, not a transport.
  target.scriptUrl = sanitizeLegacySyncEndpoint(target.scriptUrl);
  target.shiftsScriptUrl = sanitizeLegacySyncEndpoint(target.shiftsScriptUrl);
  delete target.syncSecret;

  // Presence of the new HMAC value is the one-way cutover signal that cannot
  // exist in the legacy settings. Do not rewrite either endpoint automatically.
  if(marker.status !== 'complete' &&
    String(target.syncHmacSecret || '').length >= 32 &&
    isReadyV66SyncEndpoint(target.scriptUrl)){
    marker.status = 'complete';
    marker.canonicalEndpoint = target.scriptUrl;
    marker.completedAt = nowIso || new Date().toISOString();
  }

  target.syncV66Migration = marker;
  return target;
}

function loadSettings(){
  const s = loadJSON('settings', null);
  const base = {hourlyRate:150, tags:[...DEFAULT_TAGS], coworkers:[...DEFAULT_COWORKERS], cities:[], streets:{}, theme:'dark', scriptUrl:DEFAULT_SCRIPT_URL, shiftsScriptUrl:'', materials: DEFAULT_MATERIALS.map(m=>({...m})), workTypes: DEFAULT_WORK_TYPES.map(m=>({...m})), cableTypes: DEFAULT_CABLE_TYPES.map(c=>({...c})), defaultConnectFee:500, defaultRepairCallFee:300, freeRepairCallThreshold:800, defaultTariff:250, syncHmacSecret:'', syncResponseMode:'opaque', vizitkaUrl:'https://on-b6a966.netlify.app', dogovorUrl:'', masters: DEFAULT_MASTERS.map(m=>({...m})), tgBotToken:'', tgBackupChatId:'', tgDispatcherChatId:'', tgDispatchers:[{name:'',chatId:''},{name:'',chatId:''}], tgMyChatId:'', quickDialContacts:[],
    // NEW: захист входу — пароль зберігається як SHA-256 хеш (не відкритим
    // текстом), відбиток пальця — через WebAuthn (credential id, сам ключ
    // керується браузером/ОС, у нас лежить лише посилання на нього)
    appLockEnabled:false, appLockPasswordHash:'', appLockBiometricEnabled:false, appLockCredentialId:''};
  const merged = migrateSyncSettingsV66(s, s ? Object.assign(base, s) : base);
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

function saveSettings(){
  settings = migrateSyncSettingsV66(settings, settings);
  localStorage.setItem('settings', JSON.stringify(settings));
}

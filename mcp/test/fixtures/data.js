/* Shared test fixtures. Two dataset flavors:
   - BASE: clean realistic data (5 tickets, 3 shifts);
   - ADVERSARIAL: BASE + a ticket stuffed with secrets/tg fields in every
     place they could ever appear (fullDataJson keys, raw row keys, backupNote
     marker lines) — used to prove the redaction layer leaks nothing.
   Row shape mirrors Code.gs syncTicketFromRow_: {id,date,time,content,sum,
   tags(array),backupNote,fullDataJson,photo:null}. */

const SECRET_VALUES = {
  password: 'p@ssw0rd-SECRET',
  login: 'user123',
  masterNote: 'приватна записка-SECRET',
  tgPhotoFileId: 'AAAphotoFILEID',
  tgJsonMsgId: 'TGJSONMSGID777'
};

const BACKUP_NOTE_ADVERSARIAL = [
  'Геолокація: https://maps.google.com/?q=48.46,35.04',
  'Приватна примітка майстра: ' + SECRET_VALUES.masterNote,
  'Логін: ' + SECRET_VALUES.login,
  'Пароль: @local-only'
].join('\n');

function fullDataT1(extra){
  return Object.assign({
    type: 'Ремонт',
    city: 'Дніпро',
    street: 'вул. Шевченка',
    house: '12',
    apartment: '5',
    address: 'вул. Шевченка 12',
    clientName: 'Іван Петренко',
    phone: '0671234567',
    extraPhones: ['0509998877'],
    macAddress: 'AA:BB:CC:DD:EE:01',
    signal: '-67',
    payment: 'Готівка',
    cashAmount: 850,
    cardAmount: 0,
    baseCallFee: 300,
    callFee: 300,
    tariff: 0,
    contractNumber: 'Д-100',
    equipment: [{id:'onu', label:'ONU', price:800, checked:true}],
    cables: [{id:'utp', label:'UTP кабель', meters:10, pricePerMeter:5}],
    presetWorks: [{id:'router_setup', label:'Налаштування роутера', price:50, qty:1}],
    additionalWork: [{desc:'Кріплення кабелю', sum:0}],
    note: 'роутер клієнта',
    abonentNote: 'домофон 45',
    otherNote: '',
    geoLink: 'https://maps.google.com/?q=48.464,35.046',
    extraPhones2: 'unknown-field-should-drop',
    customUnknownKey: 'unknown-value-should-drop'
  }, extra || {});
}

const T1_CONTENT = '📋 ЗАЯВКА: РЕМОНТ\n📅 15.09.2026 09:15\n🏙️ Місто: Дніпро\n📍 Адреса: вул. Шевченка 12\n👤 Клієнт: Іван Петренко\n📞 Тел: 0671234567';

function row(id, date, time, content, sum, tags, fullData, backupNote, extraRowKeys){
  return Object.assign({
    id, date, time, content, sum, tags,
    backupNote: backupNote == null ? '' : backupNote,
    fullDataJson: JSON.stringify(fullData),
    photo: null
  }, extraRowKeys || {});
}

const BASE_ROWS = [
  row('t-001', '15.09.2026', '09:15', T1_CONTENT, 850, ['ремонт', 'діагностика'], fullDataT1(), 'Геолокація: https://maps.google.com/?q=48.464,35.046'),
  row('t-002', '15.09.2026', '13:40',
    '📋 ЗАЯВКА: МОНТАЖ\n📅 15.09.2026 13:40\n📍 Адреса: вул. Соборна 3\n📞 Тел: 0935556677', 1200, ['монтаж'],
    fullDataT1({
      type:'Монтаж', city:'Дніпро', street:'вул. Соборна', house:'3', apartment:'',
      address:'вул. Соборна 3', clientName:'Олена Ковальчук', phone:'0935556677', extraPhones:[],
      signal:'', payment:'Безготівка', cashAmount:0, cardAmount:1200, callFee:0, tariff:1200,
      contractNumber:'', note:'', abonentNote:'', equipment:[], cables:[], presetWorks:[],
      additionalWork:[], geoLink:'', signal2:undefined
    })),
  row('t-003', '16.09.2026', '10:30',
    '📋 ЗАЯВКА: АВАРІЯ\n📅 16.09.2026 10:30\n📍 Адреса: вул. Шевченка 12\n📞 Тел: 0671234567', 0, ['аварія'],
    fullDataT1({
      type:'Аварія', clientName:'Іван Петренко', payment:'Безкоштовно', cashAmount:0, cardAmount:0,
      callFee:0, tariff:0, signal:'-52', contractNumber:''
    })),
  row('t-004', '16.09.2026', '14:00',
    '📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\n📅 16.09.2026 14:00\n📍 Адреса: просп. Яворницького 8\n📞 Тел: 0682223344', 700.5, ['підключення'],
    fullDataT1({
      type:'Підключення', city:'Дніпро', street:'просп. Яворницького', house:'8', apartment:'21',
      address:'просп. Яворницького 8', clientName:'ТОВ «Мережа»', phone:'0682223344', extraPhones:['0443332211'],
      signal:'-67,5', payment:'Змішана', cashAmount:300.5, cardAmount:400, callFee:500, tariff:250,
      contractNumber:'Д-101', equipment:[{id:'router', label:'Роутер', price:600, checked:true}],
      cables:[], presetWorks:[], additionalWork:[{desc:'Налаштування PoE', sum:50}], geoLink:''
    })),
  row('t-005', '01.08.2026', '11:00',
    '📋 ЗАЯВКА: ПЕРЕНЕСЕННЯ\n📅 01.08.2026 11:00\n📍 Адреса: вул. Набережна 1\n📞 Тел: 0667778899', 500, ['перенесення'],
    fullDataT1({
      type:'Перенесення', city:'Дніпро', street:'вул. Набережна', house:'1', apartment:'',
      address:'вул. Набережна 1', clientName:'Петро Січовий', phone:'0667778899', extraPhones:[],
      payment:'Готівка', cashAmount:500, cardAmount:0, callFee:0, tariff:500, signal:'',
      contractNumber:'', equipment:[], cables:[], presetWorks:[], additionalWork:[], geoLink:''
    }))
];

const BASE_SHIFTS = [
  {id:'s-001', date:'15.09.2026', hours:8, coworker:'Олег'},
  {id:'s-002', date:'16.09.2026', hours:7.5, coworker:'Олег'},
  {id:'s-003', date:'01.08.2026', hours:5, coworker:'Марія'}
];

/* App-side FULL ticket objects (what the PWA keeps in memory after a restore):
   same entities as BASE_ROWS, used by parity tests to run the REAL app
   predicate/report functions. */
const BASE_APP_TICKETS = BASE_ROWS.map(function(r){
  const f = JSON.parse(r.fullDataJson);
  return {
    id:r.id, date:r.date, time:r.time, content:r.content, sum:r.sum, tags:r.tags,
    type:f.type, city:f.city, street:f.street, house:f.house, apartment:f.apartment,
    address:f.address, clientName:f.clientName, phone:f.phone, extraPhones:f.extraPhones,
    signal:f.signal, payment:f.payment, cashAmount:f.cashAmount, cardAmount:f.cardAmount
  };
});

function adversarialExtraFullData(){
  return {
    masterNote: SECRET_VALUES.masterNote,
    login: SECRET_VALUES.login,
    password: SECRET_VALUES.password,
    tgPhotoFileIds: [SECRET_VALUES.tgPhotoFileId],
    tgBackedUp: true,
    tgJsonMsgId: SECRET_VALUES.tgJsonMsgId,
    syncHmacSecret: 'injected-hmac-secret-0123456789',
    tgBotToken: 'injected-bot-token-0123456789'
  };
}

/* BASE + one adversarial ticket with secrets in every carrier:
   fullDataJson keys, raw row keys (legacy shapes) and backupNote markers. */
const ADVERSARIAL_ROWS = BASE_ROWS.concat([
  Object.assign(
    row('t-900', '17.09.2026', '08:00',
      '📋 ЗАЯВКА: РЕМОНТ\n📅 17.09.2026 08:00\n📍 Адреса: вул. Заповітна 9\n📞 Тел: 0990001122', 300, ['ремонт'],
      fullDataT1(adversarialExtraFullData())),
    {
      backupNote: BACKUP_NOTE_ADVERSARIAL,
      tgPhotoFileId: SECRET_VALUES.tgPhotoFileId,
      tgPhotoFileIds: [SECRET_VALUES.tgPhotoFileId],
      tgJsonMsgId: SECRET_VALUES.tgJsonMsgId,
      syncHmacSecret: 'row-level-hmac-secret-0123456789',
      tgBotToken: 'row-level-bot-token-0123456789'
    }
  )
]);

function listPayload(rows){
  return {
    status:'ok',
    tickets: rows,
    shifts: BASE_SHIFTS,
    states: {
      ticket: rows.map(function(r){ return {id:r.id, revision:1, tombstone:false}; }),
      shift: BASE_SHIFTS.map(function(s){ return {id:s.id, revision:1, tombstone:false}; })
    }
  };
}

const GAS_ROW_T1 = BASE_ROWS[0];

export const FIXTURES = {
  SECRET_VALUES,
  BACKUP_NOTE_ADVERSARIAL,
  BASE_ROWS,
  ADVERSARIAL_ROWS,
  BASE_SHIFTS,
  BASE_APP_TICKETS,
  GAS_ROW_T1,
  listPayload,
  baseListPayload: listPayload(BASE_ROWS),
  adversarialListPayload: listPayload(ADVERSARIAL_ROWS)
};

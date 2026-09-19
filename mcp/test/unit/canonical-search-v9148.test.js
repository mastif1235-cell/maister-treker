/* v91.48 — універсальний канонічний пошук по історичних заявках.

   Реальний production-кейс: UI показує 14 заявок у канонічному місті
   «Миколаївка 1», а AI v91.47 відповідав 8. Причина — не в UI: навігатор
   адрес групує за СТРУКТУРОВАНИМ значенням, яке майстер обрав зі списку
   (js/address-render.js buildAddressTree), а історичні рядки Google Sheets
   мають це значення неповним або в старому написанні («Миколаївка» без
   номера, «Миколаївка1», «Николаевка 1», «Миколаївка перша», адреса лише
   в legacy-тексті). Старий матчинг по score не бачив такі рядки.

   Цей файл — регресії на весь набір вимог v91.48:
   - 14/14 у Миколаївці 1 (реальна структура будинків);
   - сусіди (… 2, … 10, … 11, Новомиколаївка) НЕ потрапляють;
   - structured-місто перемагає суперечливу legacy-примітку;
   - той самий механізм для ВИГАДАНОГО міста (жодного хардкоду);
   - RU/UA/префікс вулиці — одна канонічна, схожі але різні — ні;
   - legacy-дата не виключає рядок із запиту без фільтра дат;
   - вибір READ-тула моделлю не змінює набір (count/list/search/address);
   - follow-up count → «покажи їх» дає той самий authoritative set. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createReadTools} from '../../src/tools/read.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {buildCanonicalCatalog, resolveCanonicalAddress} from '../../src/ask/canonical.js';
import {placeIdentity} from '../../src/ask/address.js';
import {ticketFromGasRow, redactTicket} from '../../src/gas/mappers.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';

/* ---------- фікстура: РЕАЛЬНА структура Миколаївки 1 (14 заявок) ---------- */
function row(id, o){
  return {
    id, date:o.date || '01.09.2026', time:'10:00', content:o.content || '', sum:o.sum || 0, tags:[],
    backupNote:o.backupNote || '',
    fullDataJson:o.full ? JSON.stringify(o.full) : ''
  };
}

const MYKOLAIVKA = [
  /* 1-3 Садова 19/21/56 — структуроване канонічне місто */
  row('m01', {full:{city:'Миколаївка 1', street:'Вул Садова', house:'19'}}),
  row('m02', {full:{city:'Миколаївка 1', street:'Вул Садова', house:'21'}}),
  row('m03', {full:{city:'Миколаївка1', street:'Вул Садова', house:'56'}}),           /* без пробілу */
  /* 4 Генерала Пушкіна 55 — російське написання міста */
  row('m04', {full:{city:'Николаевка 1', street:'Вул Генерала Пушкіна', house:'55'}}),
  /* 5-7 Центральна 118/12/50 — одна з legacy-датою */
  row('m05', {full:{city:'Миколаївка 1', street:'Вул Центральна', house:'118'}}),
  row('m06', {date:'5.7.2026', full:{city:'Миколаївка 1', street:'Вул Центральна', house:'12'}}),
  row('m07', {full:{city:'Миколаївка 1', street:'Вул Центральна', house:'50'}}),
  /* 8 Центральна БЕЗ номера будинку — адреса лише в legacy-тексті */
  row('m08', {content:'в Николаеве первой ул центральная дом не помню'}),
  /* 9 Педагогічна 9 */
  row('m09', {full:{city:'Миколаївка 1', street:'Вул Педагогічна', house:'9'}}),
  /* 10 Виноградна 7 — місто без номера частини (підтверджено в Sheets) */
  row('m10', {full:{city:'Миколаївка', street:'Вул Виноградна', house:'7'}, content:'Миколаївка виноградная 7'}),
  /* 11-13 Криворізська 9/39/16 — місто без номера, без пробілу, legacy-нотатка */
  row('m11', {full:{city:'Миколаївка', street:'Вул Криворізська', house:'9'}}),
  row('m12', {full:{city:'Миколаївка1', street:'Вул Криворізська', house:'39'}}),
  row('m13', {backupNote:'Геолокація: https://maps.google.com/?q=1\nПовніДаніJSON: {"city":"Миколаївка","street":"Вул Криворізька","house":"16"}'}),
  /* 14 Пʼятихатки 5 — словесний номер частини */
  row('m14', {full:{city:'Миколаївка перша', street:'Пʼятихатки', house:'5'}})
];

const NEIGHBOURS = [
  row('n01', {full:{city:'Миколаївка 2', street:'Вул Дружби', house:'8'}}),
  row('n02', {full:{city:'Миколаївка 2', street:'Вул Дружби', house:'10'}}),
  row('n03', {full:{city:'Миколаївка 2', street:'Вул Центральна', house:'2'}}),
  row('n04', {full:{city:'Миколаївка 10', street:'Вул Садова', house:'1'}}),
  row('n05', {full:{city:'Миколаївка 11', street:'Вул Садова', house:'2'}}),
  row('n06', {full:{city:'Новомиколаївка', street:'Вул Садова', house:'2'}})
];

function makeBase(rows){
  const mapped = rows.map(ticketFromGasRow);
  const tickets = mapped.map(redactTicket);
  return {
    tickets,
    shifts: [],
    searchIndex: mapped.map(function(t){ return {id:t.id, text:t.searchableText}; })
  };
}
function makeTools(base){
  const data = {getList: async function(){ return {ok:true, data:base}; }};
  return createReadTools({data});
}
function idsOf(result){
  return (result.data.tickets || []).map(function(t){ return String(t.id); }).sort();
}
function countOf(result){
  return result.data.total_matched != null ? result.data.total_matched : result.data.matched;
}

const BASE = makeBase(MYKOLAIVKA.concat(NEIGHBOURS));
const ALL14 = MYKOLAIVKA.map(function(r){ return r.id; }).sort();

/* ---------- 1. головний acceptance: 14 у Миколаївці 1 ---------- */

test('v91.48 acceptance: усі 14 історичних форм міста «Миколаївка 1» знайдено', async () => {
  const tools = makeTools(BASE);
  for(const city of ['Миколаївка 1', 'Николаевка первый', 'Миколаївка перша', 'Миколаївка1']){
    const counted = await tools.query_tickets({mode:'count', city});
    assert.equal(counted.ok, true);
    assert.equal(counted.data.matched, 14, `count для «${city}»`);
    const listed = await tools.query_tickets({mode:'list', city, limit:50});
    assert.deepEqual(idsOf(listed), ALL14, `набір для «${city}»`);
  }
});

/* ---------- 2. кожна історична форма розпізнана й підписана ---------- */

test('v91.48: кожне історичне написання мапиться на канонічне місто з поясненням', () => {
  const catalog = buildCanonicalCatalog(BASE.tickets);
  const legacyTextById = new Map(BASE.searchIndex.map(function(i){ return [String(i.id), i.text]; }));
  const canonicalKey = placeIdentity('Миколаївка 1');
  const expectations = {
    m01:['structured', 'structured', false],
    m03:['structured', 'structured', false],           /* «Миколаївка1» — той самий ключ */
    m04:['structured', 'structured', false],           /* «Николаевка 1» — той самий ключ */
    m06:['structured', 'structured', false],
    m08:['canonical-legacy', 'legacy', true],          /* адреса лише в legacy-тексті */
    m10:['canonical-completed', 'structured', true],   /* місто без номера + вулиця-доказ */
    m11:['canonical-completed', 'structured', true],
    m13:['canonical-completed', 'structured', true],   /* адреса з legacy «ПовніДаніJSON:» рядка */
    m14:['structured', 'structured', false]            /* «перша» → 1 */
  };
  for(const [id, [via, streetVia, completed]] of Object.entries(expectations)){
    const ticket = BASE.tickets.find(function(t){ return t.id === id; });
    const resolved = resolveCanonicalAddress(ticket, legacyTextById.get(id) || '', catalog);
    assert.equal(placeIdentity(resolved.city), canonicalKey, `${id}: ідентичність канонічного міста`);
    if(completed) assert.equal(resolved.city, 'Миколаївка 1', `${id}: показано канонічне написання`);
    assert.equal(resolved.via.city, via, `${id}: спосіб визначення міста`);
    assert.equal(resolved.via.street, streetVia, `${id}: джерело вулиці`);
  }
});

/* ---------- 3. сусіди не потрапляють у відповідь ---------- */

test('v91.48: Миколаївка 2 / 10 / 11 / Новомиколаївка ніколи не змішуються з Миколаївкою 1', async () => {
  const tools = makeTools(BASE);
  const counted = await tools.query_tickets({mode:'count', city:'Миколаївка 1'});
  assert.equal(counted.data.matched, 14);
  const listed = await tools.query_tickets({mode:'list', city:'Николаевка первый', limit:50});
  const ids = idsOf(listed);
  for(const bad of ['n01','n02','n03','n04','n05','n06']) assert.ok(!ids.includes(bad), `${bad} не має бути в Миколаївці 1`);

  const two = await tools.query_tickets({mode:'count', city:'Миколаївка 2'});
  assert.equal(two.data.matched, 3, 'Миколаївка 2 лишається окремим містом');
  const ten = await tools.query_tickets({mode:'count', city:'Миколаївка 10'});
  assert.equal(ten.data.matched, 1);
  const eleven = await tools.query_tickets({mode:'count', city:'Миколаївка 11'});
  assert.equal(eleven.data.matched, 1);
  const novo = await tools.query_tickets({mode:'count', city:'Новомиколаївка'});
  assert.equal(novo.data.matched, 1);
});

/* ---------- 4. structured-місто перемагає суперечливу legacy-примітку ---------- */

test('v91.48: structured city авторитетне — приватна примітка з іншим містом не перевизначає', async () => {
  const tools = makeTools(makeBase([
    row('p1', {content:'Николаевка 2, примітка диспетчера', full:{city:'Миколаївка 1', street:'Вул Садова', house:'77'}}),
    row('p2', {full:{city:'Миколаївка 2', street:'Вул Дружби', house:'8'}})
  ]));
  const listed = await tools.query_tickets({mode:'list', city:'Миколаївка 1', limit:100});
  assert.deepEqual(idsOf(listed), ['p1'], 'structured «Миколаївка 1» перемагає примітку');
  const other = await tools.query_tickets({mode:'list', city:'Миколаївка 2', limit:100});
  assert.deepEqual(idsOf(other), ['p2'], 'рядок із примітки не переїжджає в Миколаївку 2');
});

/* ---------- 5. універсальність: вигадане місто й вулиця ---------- */

test('v91.48: той самий механізм працює для вигаданого міста (жодного хардкоду)', async () => {
  const rows = [
    row('g1', {full:{city:'Зеленогірка 3', street:'Вул Лугова', house:'1'}}),
    row('g2', {full:{city:'Зеленогірка3', street:'Вул Лугова', house:'2'}}),      /* без пробілу */
    row('g3', {full:{city:'Зеленогірка', street:'Вул Кленова', house:'3'}}),      /* без номера частини */
    row('g4', {full:{city:'Зеленогірка третя', street:'Вул Лугова', house:'4'}}), /* словесний номер */
    row('g5', {content:'Зеленогірка 3, Вул Лугова 5'}),                            /* лише legacy-текст */
    row('g6', {full:{city:'Зеленогірка 3', street:'Вул Кленова', house:'6'}}),     /* доказ: Кленова лише в 3 */
    row('h1', {full:{city:'Зеленогірка 4', street:'Вул Лугова', house:'9'}})       /* інша частина */
  ];
  const tools = makeTools(makeBase(rows));
  const counted = await tools.query_tickets({mode:'count', city:'Зеленогірка 3'});
  assert.equal(counted.data.matched, 6, 'усі шість форм однієї частини');
  const listed = await tools.query_tickets({mode:'list', city:'Зеленогірка 3', limit:50});
  assert.deepEqual(idsOf(listed), ['g1','g2','g3','g4','g5','g6']);
  const other = await tools.query_tickets({mode:'count', city:'Зеленогірка 4'});
  assert.equal(other.data.matched, 1, 'інша частина не змішується');
});

/* ---------- 6-7. вулиці: RU/UA/префікс — одна; схожі але різні — ні ---------- */

const STREET_ROWS = [
  row('s1', {full:{city:'Миколаївка 1', street:'Вул Садова', house:'19'}}),
  row('s2', {full:{city:'Миколаївка 1', street:'Вул Садибна', house:'2'}}),
  row('s3', {full:{city:'Миколаївка 1', street:'Вул Виноградна', house:'7'}}),
  row('s4', {full:{city:'Миколаївка 1', street:'Вул Виноградівська', house:'8'}}),
  row('s5', {full:{city:'Миколаївка 1', street:'Вул Центральна', house:'14'}}),
  row('s6', {content:'Миколаївка 1, ул. Центральная 12'})
];
const STREET_BASE = makeBase(STREET_ROWS);

test('v91.48: «Вул Центральна» + «ул. Центральная» — одна канонічна вулиця', async () => {
  const tools = makeTools(STREET_BASE);
  const listed = await tools.query_tickets({mode:'list', city:'Миколаївка 1', limit:50});
  assert.deepEqual(idsOf(listed), ['s1','s2','s3','s4','s5','s6'].sort());
  const central = await tools.query_tickets({mode:'list', city:'Миколаївка 1', street:'Центральна', limit:50});
  assert.deepEqual(idsOf(central), ['s5','s6'], 'російське написання приєднується до канонічної вулиці');
  const places = await tools.list_places({});
  const city = places.data.places.find(function(p){ return p.city === 'Миколаївка 1'; });
  const centralStreets = city.streets.filter(function(s){ return s.street === 'Вул Центральна'; });
  assert.equal(centralStreets.length, 1, 'одна канонічна вулиця, не дві');
  assert.equal(centralStreets[0].ticket_count, 2);
});

test('v91.48: схожі, але РІЗНІ вулиці не зливаються', async () => {
  const tools = makeTools(STREET_BASE);
  const places = await tools.list_places({});
  const city = places.data.places.find(function(p){ return p.city === 'Миколаївка 1'; });
  const names = city.streets.map(function(s){ return s.street; });
  assert.ok(names.includes('Вул Садова') && names.includes('Вул Садибна'), 'Садова і Садибна лишаються різними');
  assert.ok(names.includes('Вул Виноградна') && names.includes('Вул Виноградівська'), 'Виноградна і Виноградівська лишаються різними');

  const vynogradna = await tools.query_tickets({mode:'list', city:'Миколаївка 1', street:'Виноградна', limit:50});
  assert.deepEqual(idsOf(vynogradna), ['s3'], 'запит по одній вулиці не тягне другу');
  const vinogradivska = await tools.query_tickets({mode:'list', city:'Миколаївка 1', street:'Виноградівська', limit:50});
  assert.deepEqual(idsOf(vinogradivska), ['s4']);
});

/* ---------- 8. legacy-дата не виключає рядок ---------- */

test('v91.48: рядок із legacy-датою 5.7.2026 входить у city-only запит і у фільтр дат', async () => {
  const tools = makeTools(BASE);
  const unfiltered = await tools.query_tickets({mode:'list', city:'Миколаївка 1', limit:50});
  assert.ok(idsOf(unfiltered).includes('m06'), 'без фільтра дат рядок не випадає');
  const ranged = await tools.query_tickets({mode:'list', city:'Миколаївка 1', date_from:'01.07.2026', date_to:'31.07.2026', limit:50});
  assert.deepEqual(idsOf(ranged), ['m06'], 'дата прочитана як 05.07.2026');
  const otherRange = await tools.query_tickets({mode:'list', city:'Миколаївка 1', date_from:'01.09.2026', date_to:'30.09.2026', limit:50});
  assert.ok(!idsOf(otherRange).includes('m06'), 'у вересні його немає');
});

/* ---------- 9-13. вибір READ-тула не змінює набір ---------- */

test('v91.48: query_tickets / list_tickets / search_tickets / find_tickets_by_address дають ті самі 14', async () => {
  const tools = makeTools(BASE);
  const viaQuery = await tools.query_tickets({mode:'list', city:'Николаевка первый', limit:50});
  const viaList = await tools.list_tickets({city:'Николаевка первый', limit:50});
  const viaSearch = await tools.search_tickets({query:'Николаевка первый', limit:50});
  const viaSearchBare = await tools.search_tickets({query:'Николаевке', limit:50});
  const viaAddress = await tools.find_tickets_by_address({address:'Николаевка первый', limit:50});

  assert.deepEqual(idsOf(viaQuery), ALL14, 'query_tickets');
  assert.deepEqual(idsOf(viaList), ALL14, 'list_tickets');
  assert.deepEqual(idsOf(viaSearch), ALL14, 'search_tickets (повна назва)');
  assert.deepEqual(idsOf(viaSearchBare), ALL14, 'search_tickets (лише назва без номера)');
  assert.deepEqual(idsOf(viaAddress), ALL14, 'find_tickets_by_address');
  assert.equal(countOf(viaList), 14);
  assert.equal(countOf(viaAddress), 14);
});

test('v91.48: повний набір рахується ДО пагінації (limit не змінює total)', async () => {
  const tools = makeTools(BASE);
  const page = await tools.query_tickets({mode:'list', city:'Миколаївка 1', limit:3});
  assert.equal(countOf(page), 14, 'total_matched — по всьому набору');
  assert.equal(page.data.tickets.length, 3, 'а повернено лише сторінку');
  const counted = await tools.query_tickets({mode:'count', city:'Миколаївка 1'});
  assert.equal(counted.data.matched, 14);
  const grouped = await tools.query_tickets({mode:'group', group_by:'city'});
  const group = grouped.data.groups.find(function(g){ return g.key === 'Миколаївка 1'; });
  assert.equal(group.count, 14, 'групування по всьому набору');
});

/* ---------- 14. follow-up: той самий authoritative set ---------- */

function scriptedModel(steps){
  let i = 0;
  return {seen:null, chat: async function(messages){
    this.seen = messages.map(function(m){ return {role:m.role, content:String(m.content || '')}; });
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    return step;
  }};
}
function call(name, args){
  const raw = JSON.stringify(args);
  return {ok:true, content:'', toolCalls:[{id:'call_1', name, argsRaw:raw}],
    assistantMessage:{role:'assistant', content:'', tool_calls:[{id:'call_1', type:'function', function:{name, arguments:raw}}]}};
}
function answer(text){ return {ok:true, content:text, toolCalls:[], assistantMessage:{role:'assistant', content:text}}; }

test('v91.48: «скільки заявок у Николаевке первый» → «покажи їх» повертає ті самі 14', async () => {
  const tools = makeTools(BASE);

  const model1 = scriptedModel([call('query_tickets', {mode:'count', city:'Николаевка первый'}), answer('У Миколаївці 1 — 14 заявок.')]);
  const orch1 = createAskOrchestrator({groq:model1, tools, toolDefs:TOOL_DEFINITIONS});
  const turn1 = await orch1.handle('Сколько заявок в Николаевке первый?');
  assert.equal(turn1.ok, true);
  assert.equal(turn1.total, 14, 'перша відповідь уже повна (було 8)');
  assert.equal(turn1.queryContext.total_matched, 14);
  assert.equal(turn1.queryContext.resolved_filters.city, 'Николаевка первый');

  /* модель намагається піти «ширшим» шляхом — Worker усе одно віддає
     авторитетний набір попереднього запиту */
  for(const wider of [
    {name:'search_tickets', args:{query:'заявки Миколаївка'}},
    {name:'find_tickets_by_address', args:{address:'Миколаївка'}},
    {name:'list_tickets', args:{}},
    {name:'query_tickets', args:{mode:'list', limit:50}}
  ]){
    const model2 = scriptedModel([call(wider.name, wider.args), answer('Ось вони.')]);
    const orch2 = createAskOrchestrator({groq:model2, tools, toolDefs:TOOL_DEFINITIONS});
    const turn2 = await orch2.handle('Покажи их пожалуйста', {
      history:[
        {role:'user', content:'Сколько заявок в Николаевке первый?'},
        {role:'assistant', content:'У Миколаївці 1 — 14 заявок.'}
      ],
      queryContext: turn1.queryContext
    });
    assert.equal(turn2.ok, true, wider.name);
    assert.equal(turn2.total, 14, `${wider.name}: модель не звужує й не розширює набір`);
  }
});

/* ---------- 15. privacy: приватні маркери не потрапляють в індекс пошуку ---------- */

test('v91.48 privacy: індекс пошуку містить адреси, але не приватні рядки', () => {
  const mapped = ticketFromGasRow({
    id:'pv', date:'01.09.2026', time:'10:00',
    content:'Місто: Миколаївка 1, Адреса: Вул Садова 19', sum:0, tags:[],
    backupNote:'Геолокація: https://maps.google.com/?q=1\nПриватна примітка майстра: ПРИВАТНЕ-СЛОВО-А\nЛогін: ЛОГІН-Б\nПароль: @local-only\nПовніДаніJSON: {"city":"Миколаївка","masterNote":"ПРИВАТНЕ-СЛОВО-В"}',
    fullDataJson: JSON.stringify({city:'Миколаївка 1', masterNote:'ПРИВАТНЕ-СЛОВО-Г', note:'публічна нотатка'})
  });
  assert.ok(mapped.searchableText.includes('Садова'), 'адреса лишається в індексі');
  assert.ok(mapped.searchableText.includes('публічна нотатка'), 'публічні нотатки лишаються');
  for(const secret of ['ПРИВАТНЕ-СЛОВО-А', 'ЛОГІН-Б', '@local-only', 'ПРИВАТНЕ-СЛОВО-В', 'ПРИВАТНЕ-СЛОВО-Г', 'masterNote']){
    assert.ok(!mapped.searchableText.includes(secret), 'приватне не індексується: ' + secret);
  }
  /* structured-поля з того ж «ПовніДаніJSON:» рядка все одно доступні інструментам */
  assert.equal(mapped.fullData.city, 'Миколаївка 1');
});

/* ---------- 16. запит БЕЗ номера частини: усі частини + явна неоднозначність ---------- */

test('v91.48: «Миколаївка» без номера охоплює всі частини, але позначається як неоднозначний', async () => {
  const tools = makeTools(BASE);
  const bare = await tools.query_tickets({mode:'count', city:'Миколаївка'});
  assert.equal(bare.data.matched, 19, '14 + 3 + 1 + 1 — усі частини цієї назви');
  assert.equal(bare.data.ambiguous, true, 'модель бачить, що місто не уточнене');
  assert.ok(bare.data.notes.some(function(n){ return n.includes('Уточніть'); }), 'є підказка уточнити місто');

  /* а запит З номером ніколи не розширюється */
  const one = await tools.query_tickets({mode:'count', city:'Миколаївка 1'});
  assert.equal(one.data.matched, 14);
  assert.equal(one.data.ambiguous, false);
});

/* v91.48 — універсальний канонічний пошук по історичних заявках.

   УВАГА ПРО ФІКСТУРУ (v91.48, друга редакція)
   ===========================================
   Список із 14 рядків нижче — ЦЕ СИНТЕТИЧНА СЕМАНТИЧНА фікстура: вона
   відтворює історичні НАПИСАННЯ (без номера частини, без пробілу, RU-форма,
   словесний номер, адреса лише в legacy-тексті), а НЕ production-перелік
   заявок. Незалежна перевірка реальної Google Sheets показала: structured
   city у реальних рядках часто БЕЗ номера частини, «Садова 21» трапляється
   кілька разів, а навігатор адрес показує унікальні city/street/house —
   тобто його список будинків НЕ є списком заявок (один будинок може мати
   декілька заявок). Тому ця фікстура нічого не доводить про реальну
   кількість 14 — вона перевіряє лише ПРАВИЛА вирішення адрес.

   Правила, які вона фіксує (і які перевіряють регресії):
   - рядок отримує номер частини ЛИШЕ за власним доказом: явний номер
     («Миколаївка1», «Николаевка 1»), словесний номер («перша»/«первый»),
     або власна вулиця, яку канонічний каталог знає І яку має рівно одна
     нумерована частина цієї назви;
   - доказ ІНШОГО рядка («у сусіднього «Миколаївка» була вулиця частини 1»)
     НЕ є доказом для цього рядка — жодного переносу цілої групи;
   - structured-місто, яке вже є в каталозі, авторитетне й не перекривається
     примітками;
   - недостатньо доказів → рядок лишається нерозв'язаним (ambiguous), але не
     зникає: запит за назвою без номера його показує, а запит за номером
     частини — ні, і про кількість таких рядків інструмент ПОВІДОМЛЯЄ;
   - той самий набір дають query_tickets / list_tickets / search_tickets /
     find_tickets_by_address (вибір READ-тула моделлю не змінює відповідь);
   - «Миколаївка» ≠ «Миколаївка 1/2/10/11» ≠ «Новомиколаївка»;
   - legacy-дата («5.7.2026») не виключає рядок із запиту без фільтра дат;
   - будинки в навігаторі ≠ кількість заявок. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createReadTools} from '../../src/tools/read.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {buildCanonicalCatalog, resolveCanonicalAddress} from '../../src/ask/canonical.js';
import {placeIdentity} from '../../src/ask/address.js';
import {ticketFromGasRow, redactTicket} from '../../src/gas/mappers.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';

/* ---------- СИНТЕТИЧНА семантична фікстура (не production-перелік) ---------- */
function row(id, o){
  return {
    id, date:o.date || '01.09.2026', time:'10:00', content:o.content || '', sum:o.sum || 0, tags:[],
    backupNote:o.backupNote || '',
    fullDataJson:o.full ? JSON.stringify(o.full) : ''
  };
}

const MYKOLAIVKA = [
  /* Садова 19/21/56 — структуроване канонічне місто + без пробілу */
  row('m01', {full:{city:'Миколаївка 1', street:'Вул Садова', house:'19'}}),
  row('m02', {full:{city:'Миколаївка 1', street:'Вул Садова', house:'21'}}),
  row('m03', {full:{city:'Миколаївка1', street:'Вул Садова', house:'56'}}),           /* без пробілу */
  /* Генерала Пушкіна 55 — російське написання міста */
  row('m04', {full:{city:'Николаевка 1', street:'Вул Генерала Пушкіна', house:'55'}}),
  /* Центральна 118/12/50 — одна з legacy-датою */
  row('m05', {full:{city:'Миколаївка 1', street:'Вул Центральна', house:'118'}}),
  row('m06', {date:'5.7.2026', full:{city:'Миколаївка 1', street:'Вул Центральна', house:'12'}}),
  row('m07', {full:{city:'Миколаївка 1', street:'Вул Центральна', house:'50'}}),
  /* Центральна БЕЗ номера будинку — адреса лише в legacy-тексті
     (власний доказ: словесний номер «первой» біля назви міста) */
  row('m08', {content:'в Николаеве первой ул центральная дом не помню'}),
  /* Педагогічна 9 */
  row('m09', {full:{city:'Миколаївка 1', street:'Вул Педагогічна', house:'9'}}),
  /* Виноградна 7 — місто без номера частини, вулиці немає в жодному
     канонічному structured-рядку → ВЛАСНОГО доказу немає */
  row('m10', {full:{city:'Миколаївка', street:'Вул Виноградна', house:'7'}, content:'Миколаївка виноградная 7'}),
  /* Криворізська 9/39/16 — місто без номера, без пробілу, legacy-нотатка;
     власний доказ m11/m13: саме цю вулицю має канонічний рядок m12 */
  row('m11', {full:{city:'Миколаївка', street:'Вул Криворізська', house:'9'}}),
  row('m12', {full:{city:'Миколаївка1', street:'Вул Криворізська', house:'39'}}),
  row('m13', {backupNote:'Геолокація: https://maps.google.com/?q=1\nПовніДаніJSON: {"city":"Миколаївка","street":"Вул Криворізька","house":"16"}'}),
  /* Пʼятихатки 5 — словесний номер частини (власний доказ) */
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
/* рядки, які ДОВОДЯТЬ свою частину 1 власними даними */
const PROVEN1 = ['m01','m02','m03','m04','m05','m06','m07','m08','m09','m11','m12','m13','m14'].sort();
const UNPROVEN = ['m10'];                       /* власного доказу немає */
const BARE_GROUP = PROVEN1.concat(UNPROVEN, ['n01','n02','n03','n04','n05']).sort();

/* ---------- 1. головний acceptance: лише доведені рядки ---------- */

test('v91.48 acceptance: усі історичні форми «Миколаївка 1» знайдено, недоведені — ні', async () => {
  const tools = makeTools(BASE);
  for(const city of ['Миколаївка 1', 'Николаевка первый', 'Миколаївка перша', 'Миколаївка1']){
    const counted = await tools.query_tickets({mode:'count', city});
    assert.equal(counted.ok, true);
    assert.equal(counted.data.matched, PROVEN1.length, `count для «${city}»`);
    const listed = await tools.query_tickets({mode:'list', city, limit:50});
    assert.deepEqual(idsOf(listed), PROVEN1, `набір для «${city}»`);
    assert.ok(!idsOf(listed).includes('m10'), 'рядок без власного доказу не переноситься в частину 1');
  }
});

test('v91.48: недоведений рядок не зникає — він у запиті за назвою без номера і порахований окремо', async () => {
  const tools = makeTools(BASE);
  const numbered = await tools.query_tickets({mode:'list', city:'Миколаївка 1', limit:50});
  assert.ok(!idsOf(numbered).includes('m10'));
  assert.deepEqual(numbered.data.unresolved_incomplete_city, {city:'Миколаївка', count:1});
  assert.ok(numbered.data.notes.some(function(n){ return n.includes('без номера частини'); }), 'майстер бачить, що рядок не включено');

  const bare = await tools.query_tickets({mode:'list', city:'Миколаївка', limit:50});
  assert.ok(idsOf(bare).includes('m10'), 'за назвою без номера рядок видно (у всіх частинах)');
  assert.deepEqual(idsOf(bare), BARE_GROUP);
  assert.equal(bare.data.ambiguous, true, 'без номера частини запит позначено як неоднозначний');
  assert.equal(bare.data.unresolved_incomplete_city, undefined, 'у запиті без номера нічого не «не включено»');
  assert.ok(!idsOf(bare).includes('n06'), 'Новомиколаївка — інша назва і не домішується');
});

/* ---------- 2. кожна історична форма розпізнана й підписана ---------- */

test('v91.48: кожне історичне написання мапиться на канонічне місто з поясненням', () => {
  const catalog = buildCanonicalCatalog(BASE.tickets);
  const legacyTextById = new Map(BASE.searchIndex.map(function(i){ return [String(i.id), i.text]; }));
  const canonicalKey = placeIdentity('Миколаївка 1');
  /* [via.city, via.street, показати канонічне написання?]
     Написання показуємо лише там, де місто ДОПОВНЕНО до канонічного: рядок
     зі своїм structured-містом зберігає ВЛАСНЕ написання (structured
     авторитетний), важлива лише ідентичність. */
  const expectations = {
    m01:['structured', 'structured', false],
    m03:['structured', 'structured', false],           /* «Миколаївка1» — той самий ключ */
    m04:['structured', 'structured', false],           /* «Николаевка 1» — той самий ключ */
    m06:['structured', 'structured', false],
    m08:['canonical-legacy', 'legacy', true],           /* адреса лише в legacy-тексті */
    m11:['canonical-completed', 'structured', true],    /* власна вулиця: Криворізська лише в 1 */
    m13:['canonical-completed', 'structured', true],    /* те саме, написання з «ПовніДаніJSON:» */
    m14:['structured', 'structured', false]             /* «перша» → 1 (власний словесний номер) */
  };
  for(const [id, [via, streetVia, shown]] of Object.entries(expectations)){
    const ticket = BASE.tickets.find(function(t){ return t.id === id; });
    const resolved = resolveCanonicalAddress(ticket, legacyTextById.get(id) || '', catalog);
    assert.equal(placeIdentity(resolved.city), canonicalKey, `${id}: ідентичність канонічного міста`);
    if(shown) assert.equal(resolved.city, 'Миколаївка 1', `${id}: показано канонічне написання`);
    assert.equal(resolved.via.city, via, `${id}: спосіб визначення міста`);
    assert.equal(resolved.via.street, streetVia, `${id}: джерело вулиці`);
    assert.equal(resolved.canonical, true, `${id}: канонічне місто підтверджено`);
  }

  /* m10 власного доказу не має: частину НЕ призначено */
  const m10 = BASE.tickets.find(function(t){ return t.id === 'm10'; });
  const r10 = resolveCanonicalAddress(m10, legacyTextById.get('m10') || '', catalog);
  assert.equal(r10.canonical, undefined, 'm10 не отримує номер частини');
  assert.equal(placeIdentity(r10.city), placeIdentity('Миколаївка'), 'm10 зберігає ВЛАСНЕ написання міста');
  assert.equal(r10.ambiguous, true, 'm10 позначено як невизначений');
  assert.equal(r10.via.city, 'structured', 'місто взято зі structured-поля рядка');
});

/* ---------- 3. сусіди не потрапляють у відповідь ---------- */

test('v91.48: Миколаївка 2 / 10 / 11 / Новомиколаївка ніколи не змішуються з Миколаївкою 1', async () => {
  const tools = makeTools(BASE);
  const counted = await tools.query_tickets({mode:'count', city:'Миколаївка 1'});
  assert.equal(counted.data.matched, PROVEN1.length);
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
  /* запит за частиною 2 теж попереджає про неповні рядки цієї ж назви */
  assert.deepEqual(two.data.unresolved_incomplete_city, {city:'Миколаївка', count:1});
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
    row('g3', {full:{city:'Зеленогірка', street:'Вул Кленова', house:'3'}}),      /* власний доказ: Кленова лише в 3 */
    row('g4', {full:{city:'Зеленогірка третя', street:'Вул Лугова', house:'4'}}), /* словесний номер */
    row('g5', {content:'Зеленогірка 3, Вул Лугова 5'}),                            /* лише legacy-текст */
    row('g6', {full:{city:'Зеленогірка 3', street:'Вул Кленова', house:'6'}}),
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

test('v91.48: query_tickets / list_tickets / search_tickets / find_tickets_by_address дають той самий набір', async () => {
  const tools = makeTools(BASE);
  const viaQuery = await tools.query_tickets({mode:'list', city:'Николаевка первый', limit:50});
  const viaList = await tools.list_tickets({city:'Николаевка первый', limit:50});
  const viaSearch = await tools.search_tickets({query:'Николаевка первый', limit:50});
  const viaAddress = await tools.find_tickets_by_address({address:'Николаевка первый', limit:50});

  assert.deepEqual(idsOf(viaQuery), PROVEN1, 'query_tickets');
  assert.deepEqual(idsOf(viaList), PROVEN1, 'list_tickets');
  assert.deepEqual(idsOf(viaSearch), PROVEN1, 'search_tickets (повна назва з номером)');
  assert.deepEqual(idsOf(viaAddress), PROVEN1, 'find_tickets_by_address');
  assert.equal(countOf(viaList), PROVEN1.length);
  assert.equal(countOf(viaAddress), PROVEN1.length);

  /* назва БЕЗ номера — теж однакова в усіх тулах і позначена як неоднозначна */
  const bareQuery = await tools.query_tickets({mode:'list', city:'Миколаївка', limit:50});
  const bareList = await tools.list_tickets({city:'Миколаївка', limit:50});
  const bareSearch = await tools.search_tickets({query:'Миколаївка', limit:50});
  const bareAddress = await tools.find_tickets_by_address({address:'Миколаївка', limit:50});
  for(const [name, res] of [['query', bareQuery], ['list', bareList], ['search', bareSearch], ['address', bareAddress]]){
    assert.deepEqual(idsOf(res), BARE_GROUP, `назва без номера: ${name}`);
    assert.equal(res.data.ambiguous, true, `назва без номера позначена як неоднозначна: ${name}`);
  }
});

test('v91.48: повний набір рахується ДО пагінації (limit не змінює total)', async () => {
  const tools = makeTools(BASE);
  const page = await tools.query_tickets({mode:'list', city:'Миколаївка 1', limit:3});
  assert.equal(countOf(page), PROVEN1.length, 'total_matched — по всьому набору');
  assert.equal(page.data.tickets.length, 3, 'а повернено лише сторінку');
  const counted = await tools.query_tickets({mode:'count', city:'Миколаївка 1'});
  assert.equal(counted.data.matched, PROVEN1.length);
  const grouped = await tools.query_tickets({mode:'group', group_by:'city'});
  const group = grouped.data.groups.find(function(g){ return g.key === 'Миколаївка 1'; });
  assert.equal(group.count, PROVEN1.length, 'групування по всьому набору');
});

test('v91.48: фраза з вулицею не перетворюється на «все місто» (і знаходиться за адресою)', async () => {
  const tools = makeTools(BASE);
  /* «Миколаївка виноградная» — це адреса конкретного рядка, а не запит про
     частину 1: раніше group-anchor віддавав на це 13 чужих рядків.
     Вільний пошук search_tickets лишається ТОЧНО таким, як предикат списку в
     застосунку (parity-тест), тому фразу зі вулицею шукає find_tickets_by_address. */
  const phrase = await tools.search_tickets({query:'Миколаївка виноградная', limit:50});
  assert.ok(!idsOf(phrase).includes('m01'), 'ціла частина 1 не повертається на адресну фразу');
  const byAddress = await tools.find_tickets_by_address({address:'Миколаївка виноградная', limit:50});
  assert.ok(idsOf(byAddress).includes('m10'), 'рядок знаходиться за власною адресою');
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

test('v91.48: «скільки заявок у Николаевке первый» → «покажи їх» повертає той самий набір', async () => {
  const tools = makeTools(BASE);

  const model1 = scriptedModel([call('query_tickets', {mode:'count', city:'Николаевка первый'}), answer('У Миколаївці 1 — 13 заявок.')]);
  const orch1 = createAskOrchestrator({groq:model1, tools, toolDefs:TOOL_DEFINITIONS});
  const turn1 = await orch1.handle('Сколько заявок в Николаевке первый?');
  assert.equal(turn1.ok, true);
  assert.equal(turn1.total, PROVEN1.length, 'перша відповідь — лише доведені рядки (було 8)');
  assert.equal(turn1.queryContext.total_matched, PROVEN1.length);
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
        {role:'assistant', content:'У Миколаївці 1 — 13 заявок.'}
      ],
      queryContext: turn1.queryContext
    });
    assert.equal(turn2.ok, true, wider.name);
    assert.equal(turn2.total, PROVEN1.length, `${wider.name}: модель не звужує й не розширює набір`);
  }
});

/* ---------- 15. НЕГАТИВНА регресія: жодного переносу цілої історичної групи ---- */

const GROUP_NEGATIVE = [
  row('g1', {full:{city:'Миколаївка 1', street:'Вул Садова', house:'19'}}),   /* канонічний власник Садової в 1 */
  row('g2', {full:{city:'Миколаївка 2', street:'Вул Дружби', house:'8'}}),    /* канонічний власник Дружби в 2 */
  row('g3', {full:{city:'Миколаївка', street:'Вул Садова', house:'21'}}),     /* ВЛАСНИЙ доказ → 1 */
  row('g4', {full:{city:'Миколаївка', street:'Вул Нова', house:'1'}}),        /* доказів немає → unresolved */
  row('g5', {full:{city:'Миколаївка', street:'Вул Дружби', house:'10'}}),     /* ВЛАСНИЙ доказ → 2 */
  row('g6', {full:{city:'Миколаївка', street:'Вул Нова', house:'2'}})         /* дзеркально: не їде в 2 */
];
const GROUP_BASE = makeBase(GROUP_NEGATIVE);

test('v91.48 NEGATIVE: «Миколаївка — Вул Нова» не уїжджає в частину лише через інший рядок групи', async () => {
  const tools = makeTools(GROUP_BASE);
  const catalog = buildCanonicalCatalog(GROUP_BASE.tickets);
  const legacyTextById = new Map(GROUP_BASE.searchIndex.map(function(i){ return [String(i.id), i.text]; }));

  /* 1. Стріт Садова є лише в частині 1 → рядок g3 має ВЛАСНИЙ доказ */
  const one = await tools.query_tickets({mode:'list', city:'Миколаївка 1', limit:50});
  assert.deepEqual(idsOf(one), ['g1','g3'], 'до частини 1 входять лише доведені рядки');

  /* 2. g4 («Вул Нова») НЕ отримує частину 1 тільки тому, що g3 її отримав */
  assert.ok(!idsOf(one).includes('g4'), 'g4 не можна переносити в частину 1 через сусідній рядок');

  /* 3. зеркальний кейс для частини 2 */
  const two = await tools.query_tickets({mode:'list', city:'Миколаївка 2', limit:50});
  assert.deepEqual(idsOf(two), ['g2','g5'], 'до частини 2 входять лише доведені рядки');
  assert.ok(!idsOf(two).includes('g6'), 'g6 не можна переносити в частину 2 через сусідній рядок');

  /* 4. обидва недоведені рядки лишаються видимими за назвою без номера
        (там нічого не «виключено», тож і попередження немає) */
  const bare = await tools.query_tickets({mode:'list', city:'Миколаївка', limit:50});
  assert.deepEqual(idsOf(bare), ['g1','g2','g3','g4','g5','g6']);
  assert.equal(bare.data.ambiguous, true);
  assert.equal(bare.data.unresolved_incomplete_city, undefined);
  /* а запит за номером частини рахує їх окремо: 2 недоведені рядки тієї назви */
  assert.deepEqual(one.data.unresolved_incomplete_city, {city:'Миколаївка', count:2});
  assert.deepEqual(two.data.unresolved_incomplete_city, {city:'Миколаївка', count:2});

  /* 5. і в резолвері вони теж не мають частини */
  for(const id of ['g4','g6']){
    const ticket = GROUP_BASE.tickets.find(function(t){ return t.id === id; });
    const resolved = resolveCanonicalAddress(ticket, legacyTextById.get(id) || '', catalog);
    assert.equal(resolved.canonical, undefined, `${id}: без власного доказу частини немає`);
    assert.equal(placeIdentity(resolved.city), placeIdentity('Миколаївка'), `${id}: місто лишається як у даних`);
    assert.equal(resolved.ambiguous, true, `${id}: позначено неоднозначним`);
  }

  /* 6. структурний захист: у каталозі більше немає карти якорів груп */
  assert.equal(catalog.groupAnchors, undefined, 'groupAnchors більше не існує');
  assert.equal(catalog.groupStreets, undefined, 'groupStreets більше не існує');
});

test('v91.48 NEGATIVE: доказ іншого рядка не діє навіть для текстового рядка без міста', async () => {
  const rows = [
    row('t1', {full:{city:'Миколаївка 1', street:'Вул Садова', house:'1'}}),
    row('t2', {full:{city:'Миколаївка 2', street:'Вул Дружби', house:'2'}}),
    row('t3', {content:'Миколаївка, Садова 3'}),      /* власний текст: словесного номера немає, вулиця є → 1 */
    row('t4', {content:'Миколаївка, Нова 4'})         /* жодного доказу → нікуди не переїжджає */
  ];
  const tools = makeTools(makeBase(rows));
  const one = await tools.query_tickets({mode:'list', city:'Миколаївка 1', limit:50});
  assert.deepEqual(idsOf(one), ['t1','t3'], 'текстовий рядок із канонічною вулицею має власний доказ');
  const two = await tools.query_tickets({mode:'list', city:'Миколаївка 2', limit:50});
  assert.deepEqual(idsOf(two), ['t2'], 'рядок t4 не їде і в частину 2');
  const bare = await tools.query_tickets({mode:'count', city:'Миколаївка'});
  assert.equal(bare.data.matched, 4, 'за назвою без номера видно всі рядки');
});

/* ---------- 16. будинки в навігаторі ≠ кількість заявок ---------- */

test('v91.48: список будинків не використовується як кількість заявок', async () => {
  const tools = makeTools(makeBase([
    row('h1', {full:{city:'Миколаївка 1', street:'Вул Садова', house:'19'}}),
    row('h2', {full:{city:'Миколаївка 1', street:'Вул Садова', house:'19'}}),
    row('h3', {full:{city:'Миколаївка 1', street:'Вул Садова', house:'21'}})
  ]));
  const places = await tools.list_places({});
  const city = places.data.places.find(function(p){ return p.city === 'Миколаївка 1'; });
  const street = city.streets.find(function(s){ return s.street === 'Вул Садова'; });
  assert.equal(street.ticket_count, 3, 'ticket_count — це заявки');
  assert.deepEqual(street.houses, ['19','21'], 'houses — це унікальні будинки');
  assert.notEqual(street.houses.length, street.ticket_count, 'два будинки ≠ три заявки');
  const counted = await tools.query_tickets({mode:'count', city:'Миколаївка 1', street:'Садова'});
  assert.equal(counted.data.matched, 3, 'пошук рахує заявки, не будинки');
});

/* ---------- 17. privacy: приватні маркери не потрапляють в індекс пошуку ---------- */

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

/* ---------- 18. runSmartQuery напряму: та сама семантика ---------- */

test('v91.48: runSmartQuery не тягне недоведений рядок у частину і повідомляє про нього', async () => {
  const base = BASE;
  const result = await runSmartQuery({tickets:base.tickets, shifts:[], searchIndex:base.searchIndex}, {mode:'count', city:'Миколаївка 1'});
  assert.equal(result.ok, true);
  assert.equal(result.data.matched, PROVEN1.length);
  assert.deepEqual(result.data.unresolved_incomplete_city, {city:'Миколаївка', count:1});
});

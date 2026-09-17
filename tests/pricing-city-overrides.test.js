'use strict';
/* 💰 Ціни: загальні ціни, індивідуальні ціни населених пунктів, наслідування,
   автопідстановка в нову заявку і недоторканність уже збережених заявок. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const store = require('../js/pricing/pricing-storage.js');
const service = require('../js/pricing/pricing-service.js');

const baseSettings = () => ({defaultRepairCallFee:300, defaultTariff:400, defaultConnectFee:500, cities:[], pricing:null});

/* A) Без індивідуальних цін місто наслідує всі три загальні ціни. */
{
  const settings = baseSettings();
  assert.deepEqual(store.generalPrices(settings), {callout:300, tariff:400, connection:500});
  assert.equal(service.effectivePrice(settings, 'callout', 'Дніпро'), 300);
  assert.equal(service.effectivePrice(settings, 'tariff', 'Дніпро'), 400);
  assert.equal(service.effectivePrice(settings, 'connection', 'Дніпро'), 500);
  assert.equal(service.citySummary(settings, 'Дніпро'), 'Використовує загальні ціни');
}

/* B) Індивідуальна ціна діє лише у своєму населеному пункті. */
{
  const settings = baseSettings();
  store.setOverride(settings, 'Таромське', 'connection', 600);
  assert.equal(service.effectivePrice(settings, 'connection', 'Таромське'), 600);
  assert.equal(service.effectivePrice(settings, 'connection', 'Миколаївка'), 500);
  assert.deepEqual(settings.pricing.cities['таромське'], {displayName:'Таромське', overrides:{connection:600}}, 'місто зберігає лише відхилення, а не копію всіх цін');
}

/* C) Зміна загальної ціни 500 → 550 не чіпає місто з індивідуальною ціною. */
{
  const settings = baseSettings();
  store.setOverride(settings, 'Таромське', 'connection', 600);
  store.setOverride(settings, 'Миколаївка', 'connection', 600);
  store.setGeneralPrice(settings, 'connection', 550);
  assert.equal(service.effectivePrice(settings, 'connection', 'Таромське'), 600);
  assert.equal(service.effectivePrice(settings, 'connection', 'Миколаївка'), 600);
  assert.equal(service.effectivePrice(settings, 'connection', 'Підгородне'), 550, 'міста без індивідуальної ціни підхопили нову загальну');
  assert.equal(settings.defaultConnectFee, 550, 'загальна ціна лишається в канонічному полі налаштувань');
}

/* D) «↩ Повернути загальну ціну» повертає місто до наслідування. */
{
  const settings = baseSettings();
  store.setOverride(settings, 'Таромське', 'connection', 600);
  store.setGeneralPrice(settings, 'connection', 550);
  assert.equal(store.clearOverride(settings, 'Таромське', 'connection'), true);
  assert.equal(service.effectivePrice(settings, 'connection', 'Таромське'), 550);
  assert.equal(store.hasOverride(settings, 'Таромське'), false);
  assert.ok(settings.pricing.cities['таромське'], 'сам населений пункт залишається у списку');
}

/* E) Три ціни незалежні: зміна «Виклик» не чіпає індивідуальне «Підключення». */
{
  const settings = baseSettings();
  store.setOverride(settings, 'Таромське', 'connection', 600);
  store.setGeneralPrice(settings, 'callout', 350);
  assert.equal(service.effectivePrice(settings, 'connection', 'Таромське'), 600);
  assert.equal(service.effectivePrice(settings, 'callout', 'Таромське'), 350);
  assert.equal(service.effectivePrice(settings, 'tariff', 'Таромське'), 400);
  const info = service.priceInfo(settings, 'connection', 'Таромське');
  assert.equal(info.status, 'Індивідуальна');
  assert.equal(service.priceInfo(settings, 'callout', 'Таромське').status, 'Загальна');
}

/* F) Збережена заявка не перераховується при зміні цін. */
{
  const settings = baseSettings();
  const augustTicket = {id:'t-08', city:'Таромське', type:'Підключення', callFee:500, tariff:0, sum:500};
  const before = JSON.stringify(augustTicket);
  store.setOverride(settings, 'Таромське', 'connection', 600);
  store.setGeneralPrice(settings, 'connection', 550);
  service.collectCities(settings, [augustTicket]);
  service.autofillFor(settings, 'Підключення', 'Таромське');
  assert.equal(JSON.stringify(augustTicket), before, 'жодна операція з цінами не торкається збереженої заявки');
  assert.equal(augustTicket.sum, 500);
}

/* G) Автопідстановка для нової заявки: місто + тип роботи. */
{
  const settings = baseSettings();
  store.setOverride(settings, 'Таромське', 'connection', 600);
  assert.deepEqual(service.autofillFor(settings, 'Підключення', 'Таромське'), {callFee:600, tariff:400});
  assert.deepEqual(service.autofillFor(settings, 'Підключення', 'Дніпро'), {callFee:500, tariff:400});
  assert.deepEqual(service.autofillFor(settings, 'Ремонт', 'Таромське'), {callFee:300, tariff:0}, 'ремонт бере «Виклик», тарифу не має');
  assert.deepEqual(service.autofillFor(settings, 'Інше', 'Таромське'), {callFee:0, tariff:0});
}

/* I) Дублікати за регістром і пробілами — один населений пункт. */
{
  const settings = baseSettings();
  const tickets = [{city:'Таромське'}, {city:'таромське'}, {city:'ТАРОМСЬКЕ'}, {city:'  Таромське  '}, {city:''}, {city:null}];
  const cities = service.collectCities(settings, tickets);
  assert.equal(cities.length, 1, 'один пункт незалежно від регістру й пробілів');
  assert.equal(cities[0].displayName, 'Таромське', 'для показу береться охайне написання');
  store.setOverride(settings, 'таромське', 'connection', 600);
  assert.equal(service.effectivePrice(settings, 'connection', 'ТАРОМСЬКЕ'), 600, 'ціна знаходиться за будь-яким написанням');
  assert.equal(Object.keys(settings.pricing.cities).length, 1);
}

/* J) Прибирання пункту з налаштувань цін не чіпає заявок. */
{
  const settings = baseSettings();
  const tickets = [{id:'t-1', city:'Таромське', sum:500}];
  store.setOverride(settings, 'Таромське', 'connection', 600);
  assert.equal(store.removeCity(settings, 'Таромське'), true);
  assert.equal(settings.pricing.cities['таромське'], undefined);
  assert.equal(tickets[0].sum, 500, 'заявка недоторкана');
  assert.equal(tickets[0].city, 'Таромське', 'місто в старій заявці не перейменовано');
  const cities = service.collectCities(settings, tickets);
  assert.equal(cities.length, 1, 'місто знову з\'являється зі списку заявок');
  assert.equal(cities[0].hasOverride, false, 'і знову наслідує загальні ціни');
  assert.equal(service.effectivePrice(settings, 'connection', 'Таромське'), 500);
}

/* Міграція: порожні/пошкоджені налаштування не валять модуль і нічого не стирають. */
{
  const settings = {defaultRepairCallFee:300, defaultTariff:400, defaultConnectFee:500, cities:['Дніпро'], tags:['ремонт']};
  assert.deepEqual(service.autofillFor(settings, 'Підключення', 'Дніпро'), {callFee:500, tariff:400});
  assert.deepEqual(settings.tags, ['ремонт'], 'сторонні налаштування не чіпаються');
  const broken = {pricing:{cities:{'x':{overrides:{connection:'не число'}}}}, defaultConnectFee:500};
  assert.equal(service.effectivePrice(broken, 'connection', 'x'), 500, 'пошкоджене значення ігнорується на користь загальної ціни');
  assert.equal(store.normalizeAmount(-5), null);
  assert.equal(store.normalizeAmount('abc'), null);
  assert.equal(store.normalizeAmount('600'), 600);
  const missing = {};
  assert.deepEqual(store.generalPrices(missing), {callout:300, tariff:250, connection:500}, 'без налаштувань беруться безпечні типові значення');
}

/* Інтеграція: загальні ціни НЕ дублюються новою структурою. */
{
  const settings = baseSettings();
  store.setGeneralPrice(settings, 'connection', 777);
  assert.equal(settings.defaultConnectFee, 777);
  assert.equal(settings.pricing ? settings.pricing.defaults : undefined, undefined, 'другої копії загальних цін не створено');
  store.setOverride(settings, 'Таромське', 'connection', 600);
  assert.equal(settings.pricing.defaults, undefined, 'навіть після створення pricing загальні ціни там не дублюються');
  const storageSource = fs.readFileSync(path.join(root, 'js', 'pricing', 'pricing-storage.js'), 'utf8');
  assert.match(storageSource, /defaultRepairCallFee/);
  assert.match(storageSource, /defaultTariff/);
  assert.match(storageSource, /defaultConnectFee/);
}

/* --- Виправлення багів, знайдених на телефоні --- */

/* A) Місто з довідника «Налаштування → Адреси → Міста» видно в «Цінах»
      навіть коли локальних заявок немає взагалі (preview-origin). */
{
  const settings = baseSettings();
  settings.cities = ['Таромське', 'Миколаївка1', 'Миколаївка', 'Привольне'];
  const cities = service.collectCities(settings, []);
  assert.deepEqual(cities.map(c=>c.displayName), ['Миколаївка', 'Миколаївка1', 'Привольне', 'Таромське']);
  assert.equal(cities.length, 4, 'нуль заявок — але довідник міст усе одно дає список');
}

/* B) Об'єднання довідника і заявок: жодне джерело не втрачається. */
{
  const settings = baseSettings();
  settings.cities = ['Таромське', 'Привольне'];
  const tickets = [{city:'Дніпро'}, {city:'Таромське'}];
  const names = service.collectCities(settings, tickets).map(c=>c.displayName);
  assert.deepEqual(names, ['Дніпро', 'Привольне', 'Таромське'], 'union довідника і заявок');
  assert.equal(names.filter(n=>n === 'Таромське').length, 1, 'спільне місто не дублюється');
}

/* C) Дедуплікація без урахування регістру й зайвих пробілів між джерелами. */
{
  const settings = baseSettings();
  settings.cities = ['таромське', '  ТАРОМСЬКЕ  '];
  const cities = service.collectCities(settings, [{city:'Таромське'}]);
  assert.equal(cities.length, 1, 'три написання з двох джерел — один пункт');
  assert.equal(cities[0].displayName, 'Таромське', 'для показу лишається охайне написання');
}

/* D) Єдине джерело правди: запис ціни через розділ «Ціни» змінює рівно ті
      самі канонічні поля налаштувань, що читає калькулятор заявки. */
{
  const settings = baseSettings();
  store.setGeneralPrice(settings, 'connection', 550);
  store.setGeneralPrice(settings, 'tariff', 420);
  store.setGeneralPrice(settings, 'callout', 310);
  store.setFreeCallThreshold(settings, 900);
  assert.equal(settings.defaultConnectFee, 550);
  assert.equal(settings.defaultTariff, 420);
  assert.equal(settings.defaultRepairCallFee, 310);
  assert.equal(settings.freeRepairCallThreshold, 900);
  assert.deepEqual(service.autofillFor(settings, 'Підключення', 'Будь-яке'), {callFee:550, tariff:420});
}

/* E) Дубля цін більше немає: старий блок прибрано з екрана, а обробники
      старих полів не лишились у коді. Загальні ціни редагуються рівно в
      одному місці, і другого сховища для них не створено. */
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const settingsDomain = fs.readFileSync(path.join(root, 'js', 'settings-domain.js'), 'utf8');
  const settingsRender = fs.readFileSync(path.join(root, 'js', 'settings-render.js'), 'utf8');
  for(const id of ['defaultConnectFeeInput', 'defaultTariffInput', 'defaultRepairCallFeeInput', 'freeRepairCallThresholdInput']){
    assert.equal(html.includes(id), false, `дубльоване поле ${id} прибрано з екрана`);
    assert.equal(settingsDomain.includes(id), false, `обробник ${id} прибрано`);
    assert.equal(settingsRender.includes(id), false, `рендер ${id} прибрано`);
  }
  assert.equal(html.includes('Ціни за замовчуванням'), false, 'старий дубльований акордеон прибрано');
  assert.equal((html.match(/💰 Ціни|pricingCard/g) || []).length >= 0, true);
  const ui = fs.readFileSync(path.join(root, 'js', 'pricing', 'pricing-ui.js'), 'utf8');
  assert.match(ui, /pricingFreeThreshold/, 'поріг безкоштовного виклику не втрачено — він переїхав у «Ціни»');
  const storageSource = fs.readFileSync(path.join(root, 'js', 'pricing', 'pricing-storage.js'), 'utf8');
  assert.match(storageSource, /settings\.freeRepairCallThreshold = amount/, 'поріг пишеться в канонічне поле, без другої копії');
}

/* Розділ мусить перемальовуватись при відкритті — інакше список міст
   лишався б знімком з моменту старту застосунку (саме цей баг і був). */
{
  const hub = fs.readFileSync(path.join(root, 'js', 'settings-render.js'), 'utf8');
  const openFn = hub.slice(hub.indexOf('function openSettingsHubSection'), hub.indexOf('function closeSettingsHubSection'));
  assert.match(openFn, /MTPricingUI\.render\(\)/, 'відкриття розділу перемальовує «Ціни» свіжими даними');
}

/* H) Ручну суму автопідстановка не затирає; зміна міста/типу — оновлює.
   Перевіряється на справжньому коді applyDefaultCallFee/applyDefaultTariff. */
{
  const source = fs.readFileSync(path.join(root, 'js', 'ticket-editor-domain.js'), 'utf8');
  const start = source.indexOf('function applyDefaultCallFee()');
  const end = source.indexOf('function syncFormToState()');
  assert.ok(start > 0 && end > start);
  const block = source.slice(start, end);

  const fields = {f_callFee:{value:'0'}, f_tariff:{value:'0'}, f_city:{value:'Таромське'}, f_type:{value:'Підключення'}};
  const settings = baseSettings();
  store.setOverride(settings, 'Таромське', 'connection', 600);
  const sandbox = {
    settings, calcState:{}, feeIsAutoDefault:true, tariffIsAutoDefault:true,
    MTPricingService:service,
    document:{getElementById:id=>fields[id] || null},
    getEffectiveType:()=>fields.f_type.value,
    safeNonNegativeNumber:(value, fallback=0)=>{const n=Number(value);return Number.isFinite(n)&&n>=0?n:fallback;},
    ticketBaseCallFee:state=>Number(state.baseCallFee)||0,
    effectiveTicketCallFee:state=>Number(state.baseCallFee)||0,
    computeTotal:()=>{}
  };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);

  vm.runInContext('applyDefaultCallFee(); applyDefaultTariff();', sandbox);
  assert.equal(fields.f_callFee.value, 600, 'G: індивідуальна ціна підставилась у нову заявку');
  assert.equal(fields.f_tariff.value, 400);

  fields.f_callFee.value = '1234';
  sandbox.feeIsAutoDefault = false;
  sandbox.calcState.baseCallFee = 1234;
  fields.f_city.value = 'Дніпро';
  vm.runInContext('applyDefaultCallFee();', sandbox);
  assert.equal(fields.f_callFee.value, 1234, 'H: введена вручну сума не затирається зміною міста');

  sandbox.feeIsAutoDefault = true;
  fields.f_type.value = 'Ремонт';
  vm.runInContext('applyDefaultCallFee(); applyDefaultTariff();', sandbox);
  assert.equal(fields.f_callFee.value, 300, 'явна зміна типу знову вмикає автопідстановку');
  assert.equal(fields.f_tariff.value, 0);

  delete sandbox.MTPricingService;
  fields.f_type.value = 'Підключення';
  vm.runInContext('applyDefaultCallFee();', sandbox);
  assert.equal(fields.f_callFee.value, 500, 'без модуля цін працює попередня поведінка на загальних налаштуваннях');
}

/* Розділ під'єднаний до рантайму й доступний офлайн. */
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  for(const asset of ['js/pricing/pricing-storage.js', 'js/pricing/pricing-service.js', 'js/pricing/pricing-ui.js']){
    assert.ok(html.includes(`<script src="${asset}"></script>`), `${asset} завантажується в index.html`);
    assert.ok(sw.includes(`'./${asset}'`), `${asset} потрапляє в офлайн-кеш`);
  }
  assert.ok(html.indexOf('js/pricing/pricing-storage.js') < html.indexOf('js/pricing/pricing-service.js'));
  assert.ok(html.indexOf('js/pricing/pricing-service.js') < html.indexOf('js/pricing/pricing-ui.js'));
  const ui = fs.readFileSync(path.join(root, 'js', 'pricing', 'pricing-ui.js'), 'utf8');
  assert.match(ui, /↩ Повернути загальну ціну/);
  assert.match(ui, /Зберегти загальні ціни/);
  assert.match(ui, /Використовує загальні ціни|citySummary/);
  assert.equal(/app\.js/.test(ui), false, 'логіка цін не мігрує в app.js');
}

console.log('PASS pricing: загальні ціни, індивідуальні ціни населених пунктів, наслідування, автопідстановка');

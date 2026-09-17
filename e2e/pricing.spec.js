'use strict';
/* 💰 Ціни: справжній браузерний сценарій — загальні ціни, індивідуальна ціна
   населеного пункту, наслідування при зміні загальної, повернення до
   загальної, автопідстановка в нову заявку і недоторканність старої заявки. */
const { test, expect, gotoApp, waitAppReady } = require('./app-test');

async function openPricing(page){
  await page.evaluate(()=>{ switchTab('settings'); renderSettingsScreen(); });
  const card = page.locator('#pricingCard');
  await expect(card).toHaveCount(1);
  await page.evaluate(()=>{ document.getElementById('pricingCard').open = true; });
  return card;
}

async function setGeneral(page, callout, tariff, connection){
  await page.evaluate(([c, t, n])=>{
    document.getElementById('pricingGeneralCallout').value = String(c);
    document.getElementById('pricingGeneralTariff').value = String(t);
    document.getElementById('pricingGeneralConnection').value = String(n);
    document.querySelector('[data-pricing-action="save-general"]').click();
  }, [callout, tariff, connection]);
}

test('💰 Ціни: загальні, індивідуальні, наслідування і автопідстановка', async ({ page, appEnv }) => {
  const errors = await gotoApp(page, appEnv.url);
  await waitAppReady(page);

  // Стара заявка (серпень) із сумою 500 — вона не має змінитися до кінця тесту.
  await page.evaluate(async ()=>{
    tickets.push({id:'old-aug', date:'01.08.2026', time:'10:00', type:'Підключення', city:'Таромське',
      street:'Центральна', house:'1', address:'Центральна 1', clientName:'Тест', phone:'',
      callFee:500, baseCallFee:500, tariff:0, sum:500, payment:'Готівка', tags:[], equipment:{}, cables:{},
      additionalWork:[], presetWorks:{}, photos:[]});
    tickets.push({id:'old-dnipro', date:'02.08.2026', time:'11:00', type:'Підключення', city:'Дніпро',
      street:'Січова', house:'2', address:'Січова 2', clientName:'Тест2', phone:'',
      callFee:500, baseCallFee:500, tariff:0, sum:500, payment:'Готівка', tags:[], equipment:{}, cables:{},
      additionalWork:[], presetWorks:{}, photos:[]});
    await saveTickets();
  });

  await openPricing(page);

  // C) Загальні ціни 300/400/500.
  await setGeneral(page, 300, 400, 500);
  expect(await page.evaluate(()=>[settings.defaultRepairCallFee, settings.defaultTariff, settings.defaultConnectFee]))
    .toEqual([300, 400, 500]);

  // D) Список населених пунктів зібрався із заявок.
  const cityKeys = await page.evaluate(()=>Array.from(document.querySelectorAll('[data-pricing-open]')).map(b=>b.dataset.pricingOpen));
  expect(cityKeys).toContain('таромське');
  expect(cityKeys).toContain('дніпро');

  // E) Таромське → Підключення = 600.
  await page.evaluate(()=>document.querySelector('[data-pricing-open="таромське"]').click());
  await page.evaluate(()=>{
    const input = document.querySelector('input[data-pricing-input="override"][data-kind="connection"]');
    input.value = '600';
    document.querySelector('[data-pricing-action="set-override"][data-kind="connection"]').click();
  });
  expect(await page.evaluate(()=>settings.pricing.cities['таромське'].overrides.connection)).toBe(600);
  await expect(page.locator('#pricingBody')).toContainText('Індивідуальна');

  // F) Інші пункти й далі наслідують загальну ціну.
  expect(await page.evaluate(()=>MTPricingService.effectivePrice(settings, 'connection', 'Дніпро'))).toBe(500);

  // G) Загальна 500 → 550: Таромське лишається 600, решта стає 550.
  await page.evaluate(()=>document.querySelector('[data-pricing-action="back"]').click());
  await setGeneral(page, 300, 400, 550);
  expect(await page.evaluate(()=>MTPricingService.effectivePrice(settings, 'connection', 'Таромське'))).toBe(600);
  expect(await page.evaluate(()=>MTPricingService.effectivePrice(settings, 'connection', 'Дніпро'))).toBe(550);

  // I) Автопідстановка в НОВУ заявку: місто + тип.
  await page.evaluate(()=>{ switchTab('calculator'); resetCalcForm(); });
  await page.evaluate(()=>{
    document.getElementById('f_type').value = 'Підключення';
    document.getElementById('f_type').dispatchEvent(new Event('change', {bubbles:true}));
    document.getElementById('f_city').value = 'Таромське';
    document.getElementById('f_city').dispatchEvent(new Event('change', {bubbles:true}));
  });
  expect(await page.evaluate(()=>Number(document.getElementById('f_callFee').value))).toBe(600);
  expect(await page.evaluate(()=>Number(document.getElementById('f_tariff').value))).toBe(400);

  // Інше місто в тій самій новій заявці — загальна ціна.
  await page.evaluate(()=>{
    document.getElementById('f_city').value = 'Дніпро';
    document.getElementById('f_city').dispatchEvent(new Event('change', {bubbles:true}));
  });
  expect(await page.evaluate(()=>Number(document.getElementById('f_callFee').value))).toBe(550);

  // J) Ручна сума не затирається при зміні міста.
  await page.evaluate(()=>{
    const fee = document.getElementById('f_callFee');
    fee.value = '1234';
    fee.dispatchEvent(new Event('input', {bubbles:true}));
    document.getElementById('f_city').value = 'Таромське';
    document.getElementById('f_city').dispatchEvent(new Event('change', {bubbles:true}));
  });
  expect(await page.evaluate(()=>Number(document.getElementById('f_callFee').value))).toBe(1234);

  // K) «↩ Повернути загальну ціну» → Таромське знову 550.
  await page.evaluate(()=>{ switchTab('settings'); renderSettingsScreen(); });
  await page.evaluate(()=>{ document.getElementById('pricingCard').open = true; });
  await page.evaluate(()=>document.querySelector('[data-pricing-open="таромське"]').click());
  await page.evaluate(()=>document.querySelector('[data-pricing-action="clear-override"][data-kind="connection"]').click());
  expect(await page.evaluate(()=>MTPricingService.effectivePrice(settings, 'connection', 'Таромське'))).toBe(550);

  // L) Старі заявки за весь сценарій не змінились.
  const oldTickets = await page.evaluate(()=>tickets.filter(t=>t.id.startsWith('old-')).map(t=>({id:t.id, sum:t.sum, callFee:t.callFee, city:t.city})));
  expect(oldTickets).toEqual([
    {id:'old-aug', sum:500, callFee:500, city:'Таромське'},
    {id:'old-dnipro', sum:500, callFee:500, city:'Дніпро'}
  ]);

  // M) Прибирання пункту з налаштувань цін не чіпає заявок.
  await page.evaluate(()=>{
    const remove = document.querySelector('[data-pricing-action="remove-city"]');
    if(remove) remove.click();
  });
  expect(await page.evaluate(()=>tickets.filter(t=>t.city==='Таромське').length)).toBe(1);

  // N) Верстка без горизонтального скролу на екрані телефона.
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  expect(errors).toEqual([]);
});

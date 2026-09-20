'use strict';
/* Stage 2B/2C end-to-end: у реальному браузері нова заявка одразу отримує
   зв'язок з довідником (cityId/streetId), а легасі-заявка без id прив'язується
   екраном «Перевірка адрес» ЛИШЕ після явного підтвердження — і повторний
   запуск нічого не змінює. Історичний текст і ticket.id лишаються незмінними. */
const {test,expect,gotoApp,waitServiceWorkerCacheReady}=require('./app-test');

async function createTicketWithAddress(page,clientName,city,street,house){
  await page.click('.tab-btn[data-tab="calculator"]');
  await expect(page.locator('#screen-calculator')).toBeVisible();
  await page.fill('#f_client',clientName);
  await page.fill('#f_city',city);
  await page.fill('#f_street',street);
  await page.fill('#f_house',house);
  await page.selectOption('#f_payment','Готівка');
  await page.click('#saveTicketBtn');
  await expect(page.locator('#toastRoot .toast',{hasText:'Заявку збережено'}).first()).toBeVisible({timeout:20_000});
  await expect(page.locator('#ticketList .ticket-card',{hasText:clientName}).first()).toBeVisible({timeout:20_000});
}

test('Stage 2B/2C: зв\'язок заявки з довідником і безпечна прив\'язка легасі-заявки',async({page,appEnv})=>{
  await page.addInitScript(()=>{
    if(!localStorage.getItem('settings'))localStorage.setItem('settings',JSON.stringify({cities:['Таромське'],streets:{'Таромське':['Вул Привокзальна']}}));
  });
  const errors=await gotoApp(page,appEnv.url);
  await waitServiceWorkerCacheReady(page);

  const directory=await page.evaluate(()=>{
    const city=settings.addressBook.cities.find(c=>c.name==='Таромське');
    const street=settings.addressBook.streets.find(s=>s.cityId===city.id);
    return {cityId:city.id,streetId:street.id};
  });
  expect(directory.cityId).toBeTruthy();
  expect(directory.streetId).toBeTruthy();

  /* 1) Stage 2B: нова заявка, створена через реальний UI, одразу має зв'язок */
  await createTicketWithAddress(page,'Stage 2B link','Таромське','Вул Привокзальна','3б');
  const created=await page.evaluate(()=>{
    const t=tickets[tickets.length-1];
    return {id:t.id,city:t.city,street:t.street,house:t.house,address:t.address,cityId:t.cityId,streetId:t.streetId};
  });
  expect(created.cityId).toBe(directory.cityId);
  expect(created.streetId).toBe(directory.streetId);
  expect(created.city).toBe('Таромське');
  expect(created.house).toBe('3б');

  /* 2) та сама заявка як ЛЕГАСІ-рядок (без id) — так виглядають заявки до 2B */
  await page.evaluate(async()=>{
    const t=tickets[tickets.length-1];
    delete t.cityId;
    delete t.streetId;
    await saveTickets();
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__mtAppInitDone===true);
  const legacyText=await page.evaluate(()=>{const t=tickets[tickets.length-1];return {id:t.id,cityId:t.cityId,streetId:t.streetId,text:JSON.stringify(t)};});
  expect(legacyText.cityId).toBeUndefined();

  /* 3) екран «Перевірка адрес»: спершу лише читає, прив'язка — після підтвердження */
  await page.click('.tab-btn[data-tab="settings"]');
  await page.click('[data-settings-hub="address"]');
  await page.locator('#addressLinkCheck').evaluate(el=>el.closest('details').open=true);
  await page.click('#addressLinkCheckBtn');
  await expect(page.locator('#addressLinkCheck')).toContainText('Точний збіг');
  /* план лише прочитав: заявка досі без id, нічого не записано */
  expect(await page.evaluate((id)=>{const t=tickets.find(x=>String(x.id)===String(id));return !t.cityId&&!t.streetId;},legacyText.id)).toBe(true);
  await page.click('#addressLinkApplyBtn');
  await page.click('[data-modal-confirm]');
  await expect(page.locator('#toastRoot .toast',{hasText:'Пов’язано заявок'})).toBeVisible({timeout:20_000});

  const linkedBack=await page.evaluate(()=>{
    const t=tickets[tickets.length-1];
    return {id:t.id,cityId:t.cityId,streetId:t.streetId,text:JSON.stringify(t)};
  });
  expect(linkedBack.cityId).toBe(directory.cityId);
  expect(linkedBack.streetId).toBe(directory.streetId);
  expect(linkedBack.id).toBe(legacyText.id);
  /* історичний текст заявки не змінився жодним символом, крім доданих id */
  expect(linkedBack.text.replace(/,"cityId":"[^"]*"/,'').replace(/,"streetId":"[^"]*"/,'')).toBe(legacyText.text);

  /* 4) ідемпотентність: повторний запуск не має що прив'язувати */
  await page.click('#addressLinkCheckBtn');
  await expect(page.locator('#addressLinkApplyBtn')).toBeDisabled();
  const after=await page.evaluate(()=>{
    const t=tickets[tickets.length-1];
    return {id:t.id,cityId:t.cityId,streetId:t.streetId,text:JSON.stringify(t)};
  });
  expect(after).toEqual(linkedBack);
  expect(errors).toEqual([]);
});

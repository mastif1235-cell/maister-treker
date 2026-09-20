'use strict';
const {test,expect,gotoApp,waitServiceWorkerCacheReady,createTicketViaUi}=require('./app-test');

test('AddressBook: migrate legacy directory, edit aliases and archive offline without rewriting tickets',async({page,context,appEnv})=>{
  await page.addInitScript(()=>{
    if(!localStorage.getItem('settings'))localStorage.setItem('settings',JSON.stringify({cities:['Шевченко','Таромське'],streets:{'Шевченко':['Вул Шевченко'],'Таромське':['Вул Привокзальна']}}));
  });
  const errors=await gotoApp(page,appEnv.url);
  await waitServiceWorkerCacheReady(page);
  const initial=await page.evaluate(()=>settings.addressBook);
  expect(initial.cities).toHaveLength(2);
  expect(initial.streets).toHaveLength(2);
  expect(initial.cities[0].id).not.toBe(initial.streets[0].id);
  await createTicketViaUi(page,'Stage 2A legacy ticket');
  const ticketsBefore=await page.evaluate(()=>JSON.stringify(tickets));
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__mtAppInitDone===true);
  expect(await page.evaluate(()=>settings.addressBook)).toEqual(initial);
  await page.click('.tab-btn[data-tab="settings"]');
  await page.click('[data-settings-hub="address"]');
  await page.locator('#cityMgmtList').evaluate(el=>el.closest('details').open=true);
  await page.locator('#streetMgmtList').evaluate(el=>el.closest('details').open=true);
  const city=initial.cities.find(c=>c.name==='Таромське');
  const street=initial.streets.find(s=>s.cityId===city.id);
  await page.click(`[data-address-edit="cities"][data-address-id="${city.id}"]`);
  await page.fill('#addressBookAliases','Таромское');
  await page.click('#addressBookSave');
  await page.selectOption('#streetMgmtCitySelect',city.id);
  await page.click(`[data-address-edit="streets"][data-address-id="${street.id}"]`);
  await page.fill('#addressBookName','Вулиця Привокзальна');
  await page.fill('#addressBookAliases','Вул Привокзальна\nПривокзальна\nПривокзальная');
  await page.click('#addressBookSave');
  expect(await page.evaluate(()=>MTAddressBook.resolve(settings.addressBook,'Таромское','Привокзальная'))).toEqual({status:'ALIAS_EXACT',cityId:city.id,streetId:street.id});
  await page.click(`[data-address-toggle="streets"][data-address-id="${street.id}"]`);
  await page.click('[data-modal-confirm]');
  expect(await page.evaluate(()=>settings.streets['Таромське'])).toEqual([]);
  await page.click(`[data-address-toggle="streets"][data-address-id="${street.id}"]`);
  expect(await page.evaluate(()=>settings.streets['Таромське'])).toEqual(['Вулиця Привокзальна']);
  await page.fill('#newCityInput','Дніпро');await page.click('#addCityBtn');
  const dnipro=await page.evaluate(()=>settings.addressBook.cities.find(c=>c.name==='Дніпро'));
  await page.selectOption('#streetMgmtCitySelect',dnipro.id);
  await page.fill('#newStreetInput','Вулиця Привокзальна');await page.click('#addStreetBtn');
  const other=await page.evaluate(()=>MTAddressBook.resolve(settings.addressBook,'Дніпро','Вулиця Привокзальна'));
  expect(other.status).toBe('EXACT');expect(other.streetId).not.toBe(street.id);
  // Actual encrypted-backup settings boundary, including the runtime sanitization wrapper.
  const roundtrip=await page.evaluate(()=>{
    const exported=securitySanitizeSettingsForBackup(settings);
    const restored=securityMergeImportedSettings(JSON.parse(JSON.stringify(exported)),settings);
    return JSON.stringify(restored.addressBook)===JSON.stringify(settings.addressBook);
  });
  expect(roundtrip).toBe(true);
  expect(await page.evaluate(()=>JSON.stringify(tickets))).toBe(ticketsBefore);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__mtAppInitDone===true);
  expect(await page.evaluate(()=>MTAddressBook.resolve(settings.addressBook,'Таромское','Привокзальная').streetId)).toBe(street.id);
  expect(await page.evaluate(()=>JSON.stringify(tickets))).toBe(ticketsBefore);
  expect(errors).toEqual([]);
});

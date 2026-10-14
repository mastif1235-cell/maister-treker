'use strict';
const {test,expect,gotoApp}=require('./app-test');
test('connection ONU checkbox controls inventory at +0; selected works reach dispatcher once',async({page,appEnv})=>{
 const errors=await gotoApp(page,appEnv.url);
 await page.click('.tab-btn[data-tab="calculator"]');
 await page.locator('details:has(#equipmentList) > summary').click();
 // Use catalog id to avoid label/font-dependent DOM matching.
 const idx=await page.evaluate(()=>calcState.equipment.findIndex(e=>e.id==='onu'));
 const checkbox=page.locator('.eq-check[data-eqidx="'+idx+'"]');
 await expect(checkbox).toBeChecked();
 await page.locator('#f_callFee').fill('500');await page.locator('#f_tariff').fill('0');await page.locator('#f_payment').selectOption('Готівка');
 const read=()=>page.evaluate(async()=>{
  const {buildDTO}=await import('/js/dispatcher-report-projection.mjs');
  const t={...calcState,id:'synthetic-browser-onu',type:'Підключення',payment:'Готівка',sum:computeTotal(),presetWorks:[{label:'Пайка оптики',checked:true},{label:'Монтаж розетки',checked:true},{label:'Пайка оптики',checked:true},{label:'Не обрано',checked:false}]};
  const d=await buildDTO(t,MTDispatcherReportCore,100);return {dto:d,total:t.sum,text:MTDispatcherReportCore.render([d]).blocks.find(b=>b.kind==='ticket').text};
 });
 const on=await read();expect(on.total).toBe(500);expect(on.dto.onu_used).toBe(1);expect(on.text.split('Пайка оптики').length-1).toBe(1);expect(on.text).toContain('Монтаж розетки');expect(on.text).not.toContain('Не обрано');
 await checkbox.uncheck();const off=await read();expect(off.total).toBe(500);expect(off.dto.onu_used).toBe(0);
 await checkbox.check();expect((await read()).dto.onu_used).toBe(1);
 await page.locator('#f_type').selectOption('Ремонт');await expect(checkbox).not.toBeChecked();
 await expect(page.locator('.eq-price[data-eqidx="'+idx+'"]')).toBeEnabled();
 await page.locator('#f_type').selectOption('Підключення');await expect(checkbox).toBeChecked();
 expect(errors).toEqual([]);
});

test('modern ONU OFF/ON survives real save, edit, IndexedDB restart and sync serialization',async({page,appEnv})=>{
 const errors=await gotoApp(page,appEnv.url);
 const openEquipment=async()=>{const details=page.locator('details:has(#equipmentList)');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();};
 const onuCheckbox=async()=>page.locator('.eq-check[data-eqidx="'+await page.evaluate(()=>calcState.equipment.findIndex(e=>e.id==='onu'))+'"]');
 const inspect=()=>page.evaluate(async()=>{
  const t=tickets.find(t=>t.clientName==='Synthetic modern ONU');
  const {buildDTO}=await import('/js/dispatcher-report-projection.mjs');
  const dto=await buildDTO(t,MTDispatcherReportCore,100);
  const roundtrip=MTRestoreFromSheets.cloudTicketToLocal(JSON.parse(JSON.stringify(ticketToSyncPayload(t)))).ticket;
  const again=await buildDTO(roundtrip,MTDispatcherReportCore,100);
  return {id:t.id,marker:t.onuAccountingVersion,used:dto.onu_used,total:t.sum,syncMarker:roundtrip.onuAccountingVersion,syncUsed:again.onu_used};
 });
 await page.click('.tab-btn[data-tab="calculator"]');await openEquipment();
 await page.fill('#f_client','Synthetic modern ONU');await page.fill('#f_callFee','500');await page.fill('#f_tariff','300');await page.selectOption('#f_payment','Готівка');
 await (await onuCheckbox()).uncheck();await page.click('#saveTicketBtn');
 await expect(page.locator('#screen-tickets')).toBeVisible();
 let saved=await inspect();expect(saved).toMatchObject({marker:1,used:0,total:800,syncMarker:1,syncUsed:0});
 await page.evaluate(id=>editTicket(id),saved.id);await openEquipment();await expect(await onuCheckbox()).not.toBeChecked();
 await (await onuCheckbox()).check();await page.click('#saveTicketBtn');await expect(page.locator('#screen-tickets')).toBeVisible();
 saved=await inspect();expect(saved).toMatchObject({marker:1,used:1,total:800,syncMarker:1,syncUsed:1});
 await page.evaluate(id=>editTicket(id),saved.id);await openEquipment();await expect(await onuCheckbox()).toBeChecked();
 await (await onuCheckbox()).uncheck();await page.click('#saveTicketBtn');await expect(page.locator('#screen-tickets')).toBeVisible();
 await page.context().setOffline(true);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__mtAppInitDone===true);
 saved=await inspect();expect(saved).toMatchObject({marker:1,used:0,total:800,syncMarker:1,syncUsed:0});
 await page.evaluate(id=>editTicket(id),saved.id);await openEquipment();await expect(await onuCheckbox()).not.toBeChecked();
 // Merely opening an old record must never silently install the schema marker.
 const legacy=await page.evaluate(()=>{
  const t={...tickets[0],id:'synthetic-legacy',equipment:[{id:'onu',label:'ONU',checked:false}]};delete t.onuAccountingVersion;loadTicketIntoForm(t);
  return {source:Object.hasOwn(t,'onuAccountingVersion'),editor:Object.hasOwn(calcState,'onuAccountingVersion')};
 });expect(legacy).toEqual({source:false,editor:false});
 await page.evaluate(()=>resetCalcForm());
 expect(await page.evaluate(()=>calcState.onuAccountingVersion)).toBe(1);
 await openEquipment();await (await onuCheckbox()).uncheck();
 await page.fill('#f_client','Synthetic after restart');await page.fill('#f_callFee','500');await page.fill('#f_tariff','300');await page.selectOption('#f_payment','Готівка');
 await page.click('#saveTicketBtn');await expect(page.locator('#screen-tickets')).toBeVisible();
 expect(await page.evaluate(async()=>{
  const t=tickets.find(t=>t.clientName==='Synthetic after restart');
  const {buildDTO}=await import('/js/dispatcher-report-projection.mjs');
  return {marker:t.onuAccountingVersion,used:(await buildDTO(t,MTDispatcherReportCore,100)).onu_used,total:t.sum};
 })).toEqual({marker:1,used:0,total:800});
 await page.context().setOffline(false);
 expect(errors).toEqual([]);
});

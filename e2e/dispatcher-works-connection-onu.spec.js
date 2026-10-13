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

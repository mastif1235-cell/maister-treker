'use strict';
const {test,expect,gotoApp}=require('./app-test');

test('real equipment/cable price variants stay distinct in browser period stats',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  const result=await page.evaluate(async()=>{
    const {buildDTO}=await import('/js/dispatcher-report-projection.mjs'),core=MTDispatcherReportCore;
    const ticket={id:'price-browser',date:'11.10.2026',time:'12:00',type:'Ремонт',sum:3500,payment:'Готівка',equipment:[{label:'Роутер',qty:1,price:1500},{label:'Роутер',qty:1,price:2300}],cables:[{label:'UTP',meters:10,pricePerMeter:10},{label:'UTP',meters:15,pricePerMeter:10},{label:'UTP',meters:20,pricePerMeter:15}]};
    const before=JSON.stringify(ticket),dto=await buildDTO(ticket,core,10),changed=await buildDTO({...ticket,equipment:[{label:'Роутер',qty:1,price:1501},{label:'Роутер',qty:1,price:2300}]},core,10),report=core.render([dto]);
    return {unchanged:before===JSON.stringify(ticket),materials:JSON.parse(dto.materials_json),totals:[report.daily['2026-10-11'].total,report.weekly['2026-10-05'].total,report.monthly['2026-10'].total],texts:report.blocks.filter(b=>['daily','weekly','monthly'].includes(b.kind)).map(b=>b.text.replace(/[\u00a0\u202f]/g,'')),priceHashChanged:dto.source_hash!==changed.source_hash};
  });
  expect(result.unchanged).toBe(true);expect(result.priceHashChanged).toBe(true);
  expect(result.materials.filter(m=>m.label==='Роутер')).toEqual([{label:'Роутер',quantity:1,unit:'шт.',unit_price:1500},{label:'Роутер',quantity:1,unit:'шт.',unit_price:2300}]);
  expect(result.materials.filter(m=>m.label==='UTP')).toEqual([{label:'UTP',quantity:25,unit:'м',unit_price:10},{label:'UTP',quantity:20,unit:'м',unit_price:15}]);
  expect(result.totals).toEqual([3500,3500,3500]);expect(result.texts).toHaveLength(3);
  for(const text of result.texts)for(const line of ['Роутер — 1 шт. — 1500 грн','Роутер — 1 шт. — 2300 грн','UTP — 25 м — 10 грн/м','UTP — 20 м — 15 грн/м'])expect(text).toContain(line);
  expect(errors).toEqual([]);
});

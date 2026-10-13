'use strict';
const {test,expect,gotoApp}=require('./app-test');
test('catalog and manual work prices are a breakdown, never a second addition to saved total',async({page,appEnv})=>{
 const errors=await gotoApp(page,appEnv.url);
 const result=await page.evaluate(async()=>{
  const {buildDTO}=await import('/js/dispatcher-report-projection.mjs');
  const t={id:'synthetic-browser-work-prices',date:'13.10.2026',time:'12:34',type:'Підключення',payment:'Готівка',callFee:500,tariff:300,equipment:[{id:'onu',label:'ONU',price:800},{id:'router',label:'Роутер',price:2300},{id:'ups',label:'ДБЖ',price:2500}],cables:[{label:'Оптика',meters:40,pricePerMeter:10}],presetWorks:[{id:'w1',label:'Пайка оптики',price:300,qty:1},{id:'w2',label:'Конектор',price:100,qty:1},{id:'w3',label:'Налаштування роутера',price:200,qty:1}],additionalWork:[{desc:'Прокладання кабелю в коробі',sum:450}],note:'Примітка остання'};
  t.sum=calculateTicketTotal(t).total;const before=JSON.stringify(t),d=await buildDTO(t,MTDispatcherReportCore,100);
  const rendered=MTDispatcherReportCore.render([d]);return {saved:t.sum,total:d.total,works:d.works_display,onu:d.onu_used,text:rendered.blocks.find(b=>b.kind==='ticket').text,statsTotal:rendered.monthly['2026-10'].total,unchanged:before===JSON.stringify(t)};
 });
 expect(result.saved).toBe(7050);expect(result.total).toBe(7050);expect(result.statsTotal).toBe(7050);expect(result.onu).toBe(1);expect(result.unchanged).toBe(true);
 expect(result.works).toBe('Пайка оптики — 300 грн\nКонектор — 100 грн\nНалаштування роутера — 200 грн\nПрокладання кабелю в коробі — 450 грн');
 for(const line of result.works.split('\n'))expect(result.text.split(line).length-1).toBe(1);
 expect(result.text.endsWith('Примітка остання')).toBe(true);expect(errors).toEqual([]);
});

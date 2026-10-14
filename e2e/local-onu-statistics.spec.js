'use strict';
const {test,expect,gotoApp,waitAppReady}=require('./app-test');
test('local day/week/month/all ONU reports reuse historical policy without writes, including offline restart',async({page,context,appEnv})=>{
 let gasRequests=0;await page.route('https://script.google.com/**',route=>{gasRequests++;return route.abort();});
 const errors=await gotoApp(page,appEnv.url);
 const before=await page.evaluate(async()=>{
  const connection=(id,patch={})=>({id,date:'14.10.2026',time:'12:00',type:'Підключення',tags:['connection'],content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\nSynthetic '+id,equipment:[],sum:800,payment:'Готівка',...patch});
  tickets=[connection('local-legacy'),connection('modern-off',{onuAccountingVersion:1,equipment:[{id:'onu',checked:false}]}),connection('modern-on',{onuAccountingVersion:1,equipment:[{id:'onu',checked:true,price:0}]}),connection('own-onu',{note:'ONU абонента'}),connection('1783937356227',{date:'23.06.2026',sum:0,equipment:[{id:'onu',checked:false}]}),connection('1783937356219',{date:'25.06.2026',equipment:[{id:'onu',checked:false}]}),connection('cca10ba0-41a2-4571-ac3c-02b57e2a19bc',{date:'23.09.2026',type:'Ремонт',tags:['repair'],content:'📋 ЗАЯВКА: РЕМОНТ',equipment:[]}),connection('1776938600051',{date:'23.04.2026'}),connection('1778319337856',{date:'09.05.2026',sum:0,content:'Пппп'})];
  await ticketsDbPut(tickets);currentTicketDate='14.10.2026';
  localStorage.setItem('mtDispatcherReportOutboxV1',JSON.stringify({endpoint:'',operations:[{id:'untouched-old-op',action:'upsert',version:100,attempts:3,next:0,error:'REPORT_NETWORK_ERROR'}],receipts:[{id:'old-receipt',version:99}],diagnostics:[],sync:null,lastError:'REPORT_NETWORK_ERROR',lastSuccess:'',inflight:null}));
  const snapshot={tickets:JSON.stringify(tickets),stored:JSON.stringify(await ticketsDbGet()),outbox:localStorage.getItem('mtDispatcherReportOutboxV1')};
  const forbid=()=>{throw Error('REPORT_MUST_NOT_WRITE')};saveTickets=forbid;saveTicketsLocalOnly=forbid;ticketsDbPut=forbid;
  openReportModal();return snapshot;
 });
 const output=page.locator('#reportOutput');
 for(const period of ['day','week','month']){
  await page.click('[data-rep="'+period+'"]');await expect(output).toContainText('ONU на підключеннях — 2 шт.');await expect(output).toContainText('ONU на ремонтах — 0 шт.');
 }
 await page.click('[data-rep="all"]');await expect(output).toContainText('ONU на ремонтах — 2 шт.');await expect(output).toContainText('Потребують перевірки');await expect(output).toContainText('cca10ba0-41a2-4571-ac3c-02b57e2a19bc');await expect(output).toContainText('1776938600051');await expect(output).not.toContainText('1778319337856');
 const text=await output.innerText();expect(text.split('ONU на підключеннях').length-1).toBe(1);expect(text.split('ONU на ремонтах').length-1).toBe(1);expect(text).not.toMatch(/Разом ONU|Заміна ONU|\n\s*• ONU —/);
 expect(await page.evaluate(async()=>({tickets:JSON.stringify(tickets),stored:JSON.stringify(await ticketsDbGet()),outbox:localStorage.getItem('mtDispatcherReportOutboxV1')}))).toEqual(before);
 await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await waitAppReady(page);
 await page.evaluate(()=>{currentTicketDate='14.10.2026';openReportModal();});await page.click('[data-rep="all"]');await expect(output).toContainText('ONU на підключеннях — 2 шт.');await expect(output).toContainText('ONU на ремонтах — 2 шт.');
 expect(await page.evaluate(()=>JSON.stringify(tickets))).toBe(before.tickets);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mtDispatcherReportOutboxV1')).receipts)).toEqual([{id:'old-receipt',version:99}]);
 expect(gasRequests).toBe(0);expect(errors).toEqual([]);
});

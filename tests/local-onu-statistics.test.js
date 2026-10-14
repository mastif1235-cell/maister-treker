'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),core=require('../js/dispatcher-report-core.js');
(async()=>{
 const p=await import('../js/dispatcher-report-projection.mjs');
 const connection=(id,patch={})=>({id,date:'14.10.2026',time:'12:00',type:'Підключення',tags:['connection'],content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\nSynthetic job '+id,equipment:[],sum:800,payment:'Готівка',...patch});
 const repair=(id,patch={})=>connection(id,{type:'Ремонт',tags:['repair'],content:'📋 ЗАЯВКА: РЕМОНТ\nSynthetic job '+id,equipment:[{id:'onu',label:'ONU',price:800}],...patch});
 const stats=list=>p.localOnuStatistics(list,core);
 assert.equal(stats([connection('legacy-false',{equipment:[{id:'onu',label:'ONU',checked:false}]})]).connection,1);
 assert.equal(stats([connection('legacy-empty')]).connection,1);
 assert.equal(stats([connection('modern-on',{onuAccountingVersion:1,equipment:[{id:'onu',label:'ONU',checked:true,price:0}]})]).connection,1);
 assert.equal(stats([connection('modern-off',{onuAccountingVersion:1,equipment:[]})]).connection,0);
 assert.equal(stats([connection('modern-false',{onuAccountingVersion:1,equipment:[{id:'onu',checked:false}]})]).connection,0);
 assert.equal(stats([connection('customer',{note:'у них своя ONU'})]).connection,0);
 assert.equal(stats([connection('own-router',{note:'роутер свой'})]).connection,1);
 assert.equal(stats([connection('1783937356209')]).connection,0);
 const malformed=stats([connection('bad-modern',{onuAccountingVersion:2})]);assert.equal(malformed.unknown[0].reason,'ONU_SELECTION_REVIEW_REQUIRED');
 const five=['1774458317612','1774458317619','1783937356212','1783937356227','1783937356219'];
 const fixtures=five.map(id=>connection(id,{equipment:[{id:'onu',label:'ONU',checked:false}],sum:id==='1783937356227'?0:800}));
 const frozen=JSON.stringify(fixtures);for(const t of fixtures)Object.freeze(t);
 const fiveStats=stats(fixtures);assert.equal(fiveStats.repair,5);assert.equal(fiveStats.connection,0);assert.equal(JSON.stringify(fixtures),frozen);
 const ten=['1783336285098','1781882915421','1781880526066','1781871158184','1781716436224','1781179383203','1781104713848','1780498750666','1780498841441','1779469363834'];
 const noStats=stats(ten.map(id=>connection(id,{equipment:[{id:'onu',checked:true}],note:'Замена ONU'})));assert.equal(noStats.repair,0);assert.equal(noStats.connection,0);
 assert.equal(stats(['1778579833958','1776093623146'].map(id=>repair(id))).repair,0);
 const pending=stats([repair('cca10ba0-41a2-4571-ac3c-02b57e2a19bc'),repair('1774458317609'),connection('1776938600051')]);
 assert.equal(pending.repair,0);assert.equal(pending.connection,0);assert.equal(pending.unknown.length,3);assert.equal(pending.unknown.filter(x=>x.reason==='UNKNOWN_ONU_CONSUMPTION').length,2);
 const excluded=stats([connection('1778319337856'),repair('1786990035908'),repair('1786951228806')]);assert.equal(excluded.connection+excluded.repair,0);assert.equal(excluded.excluded.length,3);
 const duplicate=connection('same');assert.equal(stats([duplicate,duplicate]).connection,1);const conflict=stats([duplicate,{...duplicate,sum:100}]);assert.equal(conflict.connection,0);assert.equal(conflict.unknown[0].reason,'DUPLICATE_ID_CONFLICT');
 const preferred=connection('1783937356200'),alias={...preferred,id:'1783435135970'};assert.equal(stats([preferred,alias]).connection,1);
 const otherJob=connection('second',{content:preferred.content+' changed'});assert.equal(stats([preferred,otherJob]).connection,2);
 assert.equal(stats([repair('quantity',{equipment:[{id:'onu',qty:2,price:0}]})]).repair,2);
 const october=[...Array.from({length:7},(_,i)=>connection('oct-'+i)),...Array.from({length:5},(_,i)=>repair('oct-repair-'+i))];assert.equal(stats(october).connection,7);assert.equal(stats(october).repair,5);
 // The new local decisions must not change existing dispatcher DTO/hash bytes.
 for(const id of ['1783937356227','1783937356219']){const t=repair(id,{equipment:[{id:'onu',checked:false}],sum:0});const before=await p.buildDTO(t,core,100);stats([t]);assert.deepEqual(await p.buildDTO(t,core,100),before);assert.equal(before.onu_used,0);}
 const ctx={isTicketOnuEquipment:core.isOnuEquipment};vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/calendar-stats-render.js','utf8'),ctx);
 const text=ctx.buildTicketReportText({list:october,title:'за місяць',full:false,totals:{count:12,total:12345,cashTotal:2345,cardTotal:10000},formatMoney:String,onuStats:stats([...october,...[repair('cca10ba0-41a2-4571-ac3c-02b57e2a19bc')]])});
 assert.equal(text.split('ONU на підключеннях').length-1,1);assert.equal(text.split('ONU на ремонтах').length-1,1);assert.match(text,/ONU на підключеннях — 7 шт\./);assert.match(text,/ONU на ремонтах — 5 шт\./);assert.match(text,/Потребують перевірки/);assert.match(text,/cca10ba0/);assert.doesNotMatch(text,/Разом ONU|Заміна ONU|\n\s*• ONU —/);assert.match(text,/12345/);
 const region=fs.readFileSync('js/reports-domain.js','utf8').split('async function renderReport(')[1];assert.doesNotMatch(region,/saveTickets\s*\(|enqueue\s*\(|syncAll\s*\(|rebuild\s*\(|setItem\s*\(|fetch\s*\(/);
 console.log('PASS local ONU reports: legacy/modern, 5 confirmed repairs, 13 prior decisions, UNKNOWN, excludes, dedup, zero-price, exact money/DTO/hash preservation, two lines only, no writes');
})().catch(error=>{console.error(error);process.exitCode=1;});

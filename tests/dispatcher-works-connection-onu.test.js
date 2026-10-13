'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../js/dispatcher-report-core.js');
const ctx={};vm.createContext(ctx);
for(const f of ['finance-utils.js','calendar-stats-render.js'])vm.runInContext(fs.readFileSync('js/'+f,'utf8'),ctx);
const ticket={id:'synthetic-onu',date:'13.10.2026',time:'12:34',type:'Підключення',callFee:500,tariff:0,sum:500,payment:'Готівка',equipment:[{id:'onu',label:'ONU',checked:true,price:9876}],cables:[],presetWorks:[]};
const card=d=>core.render([d]).blocks.find(b=>b.kind==='ticket').text;
(async()=>{
 const {buildDTO}=await import('../js/dispatcher-report-projection.mjs');
 const before=JSON.stringify(ticket),on=await buildDTO(ticket,core,100),offTicket={...ticket,equipment:[{...ticket.equipment[0],checked:false}]},off=await buildDTO(offTicket,core,101);
 assert.equal(ctx.calculateTicketTotal(ticket).total,500);assert.equal(ctx.calculateTicketTotal(offTicket).total,500);
 assert.equal(ctx.buildMixedPaymentItemsFromTicket(ticket).find(i=>i.key==='eq_onu').amount,0);
 assert.equal(on.onu_used,1);assert.equal(off.onu_used,0);assert.equal(on.total,500);assert.equal(off.total,500);
 assert.equal(JSON.parse(on.materials_json)[0].unit_price,undefined);assert(!on.materials_display.includes('9876'));
 assert.equal(JSON.stringify(ticket),before);
 const repair={...ticket,id:'repair',type:'Ремонт',note:'Замінено ONU',equipment:[{id:'onu',label:'ONU',price:300}],sum:800};
 const rd=await buildDTO(repair,core,100);assert.equal(rd.onu_used,1);assert.equal(rd.onu_replacement,1);assert.equal(core.stats([rd]).onu_connection,0);assert.equal(ctx.calculateTicketTotal(repair).total,800);
 const rows=[];for(let i=0;i<7;i++)rows.push(await buildDTO({...repair,id:'repair-'+i},core,100));for(let i=0;i<13;i++)rows.push(await buildDTO({...ticket,id:'connect-'+i},core,100));
 const stats=core.stats(rows);assert.equal(stats.onu_regular,7);assert.equal(stats.onu_connection,13);assert.equal(stats.onu_total,20);
 for(const text of ['ONU — 7 шт.','ONU на підключенні — 13 шт.','Разом ONU — 20 шт.'])assert(ctx.buildMonthlyEquipmentLines([...Array.from({length:7},()=>repair),...Array.from({length:13},()=>ticket)]).includes(text));
 const monthly=core.render(rows).monthly['2026-10'];assert.equal(monthly.onu_total,20);assert.equal(JSON.stringify(core.render(rows)),JSON.stringify(core.render(rows)));
 const stored=[];assert.equal(core.upsert(stored,on),'inserted');assert.equal(core.upsert(stored,on),'unchanged');assert.equal(stored.length,1);
 core.upsert(stored,off);assert.equal(core.stats(stored).onu_connection,0);core.upsert(stored,await buildDTO(ticket,core,102));assert.equal(core.stats(stored).onu_connection,1);assert.equal(stored.length,1);
 const duplicate=await buildDTO({...ticket,equipment:[ticket.equipment[0],ticket.equipment[0]]},core,100);assert.equal(duplicate.onu_used,1);assert.equal(JSON.parse(duplicate.materials_json)[0].quantity,1);
 for(const works of [[],[{label:'Пайка оптики',checked:true}],[{label:'Пайка оптики'},{label:'Монтаж розетки',checked:true},{label:'Пайка оптики',checked:true},{label:'Не обрано',checked:false}]]){
  const dto=await buildDTO({...ticket,presetWorks:works},core,100),text=card(dto);
  if(!works.length){assert(!('works_display' in dto));assert(!text.includes('Роботи:'));}
  else {assert.equal(text.split('Пайка оптики').length-1,1);assert(!text.includes('Не обрано'));if(works.length>1)assert.equal(text.split('Монтаж розетки').length-1,1);}
 }
 const other=await buildDTO({...ticket,type:'Інше',otherNote:'Нотатка',presetWorks:[{label:'Пайка оптики'}]},core,100);assert(!other.works_display);assert.equal(other.onu_used,0);
 const withWork=await buildDTO({...ticket,presetWorks:[{label:'Пайка оптики'}]},core,100);assert.notEqual(withWork.source_hash,on.source_hash);assert.throws(()=>core.validate({...withWork,works_display:'password: hidden'}),/PRIVACY_REJECTED/);
 ctx.settings={defaultConnectFee:500,defaultTariff:0};ctx.blankTicketObject=()=>({type:'Підключення'});ctx.formatDate=()=>ticket.date;ctx.formatTime=()=>ticket.time;ctx.mergeEquipmentWithCatalog=()=>[{id:'onu',label:'ONU',price:9876,checked:false},{id:'router',label:'Роутер',price:2000,checked:false}];ctx.getEquipmentConfig=()=>[];ctx.getCableTypesConfig=()=>[];ctx.getWorkTypesConfig=()=>[];ctx.mergeCablesWithCatalog=()=>[];ctx.mergePresetWorksWithCatalog=()=>[];
 vm.runInContext(fs.readFileSync('js/ticket-editor-core.js','utf8'),ctx);const fresh=ctx.blankCalcState();assert.equal(fresh.equipment[0].checked,true);assert.equal(fresh.equipment[1].checked,false);
 console.log('PASS works + connection ONU: default ON, OFF, +0 total, repair price, 7+13=20, edits, idempotency, no duplicates, privacy');
})().catch(e=>{console.error(e);process.exitCode=1;});

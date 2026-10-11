'use strict';
// Presentation only: no network, browser storage, GAS deployment or user data.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../js/dispatcher-report-core.js');
const context={escapeHtml:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),fmtMoney:n=>Number(n||0)+' грн',formatOnuSignal:()=>'',normalizeOnuSignal:v=>v,getDailyTicketNumber:()=>1,getScriptUrl:()=>'',settings:{},buildWorkSummaryLines:()=>[]};
context.globalThis=context;
vm.runInNewContext(fs.readFileSync('js/tickets-render.js','utf8'),context);
const dto={ticket_id:'visual-only',work_date:'2026-10-11',work_time:'12:00',work_type:'Ремонт',work_category:'repair',city:'Тестове місто',address_display:'Тестова 4',partner_display:'Майстер',materials_display:'ONU — 1 шт. — 800 грн\nUTP — 10 м — 100 грн',mac_onu:'',payment_type:'Готівка',amount:900,total:900,onu_used:1,onu_replacement:0,router_used:0,payment_cash:900,payment_cashless:0,payment_free_amount:0,payment_free_count:0,dispatcher_comment:''};
const card=r=>core.render([r]).blocks.find(b=>b.kind==='ticket').text;
const ordered=(text,parts)=>{let previous=-1;for(const p of parts){const at=text.indexOf(p);assert(at>previous,'section order/missing: '+p);previous=at;}};
ordered(card(dto),['Наряд №1','Тестове місто','Тестова 4','Напарник: Майстер','Матеріали:','ONU — 1 шт. — 800 грн','UTP — 10 м — 100 грн','Оплата:','Сума:','Разом:']);
for(const [field,label] of [['materials_display','Матеріали:'],['partner_display','Напарник:'],['mac_onu','MAC:'],['dispatcher_comment','Диспетчеру:'],['address_display','📍'],['payment_type','Оплата:']])assert(!card({...dto,[field]:''}).includes(label),field+' absent = no block');
const other=card({...dto,work_type:'Інше',dispatcher_comment:'Тестова нотатка',amount:0,total:0});
ordered(other,['Наряд №1','Тестова нотатка','Сума: 0 грн']);
for(const label of ['Матеріали:','Напарник:','MAC:','Оплата:','📍','Разом:','- - - -'])assert(!other.includes(label));
assert.equal(context.ticketDiagnosticHistoryHtml({}), '');
assert.equal(context.ticketDiagnosticHistoryHtml({diagnosticHistory:[]}), '');
const history=[{timestamp:'2026-10-11T12:00:00Z',summaryStatus:'ok',result:{latencyMs:12,resources:[]}}];
const snapshot=JSON.stringify(history),historyHtml=context.ticketDiagnosticHistoryHtml({diagnosticHistory:history});
assert(historyHtml.includes('Історія діагностик'));assert(historyHtml.includes('12 мс'));assert.equal(JSON.stringify(history),snapshot);
const ticket={id:'visual-only',date:'11.10.2026',time:'12:00',type:'Ремонт',sum:900,city:dto.city,address:dto.address_display,equipment:[{label:'ONU',qty:1,price:800},{label:'Нуль',qty:0,price:10}],cables:[{label:'UTP',meters:10,pricePerMeter:10},{label:'Оптика',meters:0}],content:'📋 ЗАЯВКА: РЕМОНТ\n🏙️ Місто: Тестове місто\n📍 Адреса: Тестова 4\n------------------\n🛠️ ONU: 1 шт. х 800 грн\n🔌 UTP: 10м х 10грн = 100грн\n- - - - - -\n💳 Оплата: Готівка\n💵 ІТОГО: 900 грн\n📝 Виконано',diagnosticHistory:[]};
const before=JSON.stringify(ticket),html=context.renderTicketCard(ticket);
ordered(html,['Тестова 4','class="tc-materials"','ONU — 1 шт. — 800 грн','UTP — 10 м — 100 грн','Оплата: Готівка','ІТОГО: 900 грн','Виконано']);
assert.equal((html.match(/ІТОГО:/g)||[]).length,1,'no duplicate total');
for(const label of ['tc-diagnostic-history','Діагностика ще','tc-tech','tc-creds','tc-network-links','tc-master-note','tc-tags','Нуль','Оптика','- - - -','------------------'])assert(!html.includes(label),'empty block/rule omitted: '+label);
assert.equal(JSON.stringify(ticket),before,'original ticket/content/materials are untouched');
const withHistory=context.renderTicketCard({...ticket,diagnosticHistory:history});
ordered(withHistory,['class="tc-materials"','ІТОГО:','Виконано','Історія діагностик']);
const noMaterials=context.renderTicketCard({...ticket,equipment:[],cables:[],content:'📋 Ремонт\n💵 ІТОГО: 900 грн'});
assert(!noMaterials.includes('tc-materials'));
const raw=context.ticketWorkContentPresentation('Робота\n🛠️ ONU: 1 шт.\n💳 Оплата: Готівка\n💵 ІТОГО: 900 грн\n📝 Нотатка');
assert(raw.work.includes('ONU'));assert(!raw.work.includes('ІТОГО'));assert(raw.closing.includes('Нотатка'));
const rows=[dto,{...dto,ticket_id:'day-two',work_date:'2026-10-10',work_category:'connection',onu_used:2,onu_replacement:1,router_used:1,payment_cash:0,payment_cashless:900},{...dto,ticket_id:'old-month',work_date:'2026-09-30',work_category:'other',amount:0,total:0,payment_cash:0,payment_free_count:1}];
const result=core.render(rows);
assert.deepEqual(result.layout.rows,result.blocks);
for(const frame of result.layout.statFrames)assert.equal(frame.column,2,'stats are in the same vertical column');
for(const period of ['daily','weekly','monthly']){
  assert.equal(Object.values(result[period]).reduce((n,s)=>n+s.ticket_count,0),3);
  assert.equal(Object.values(result[period]).reduce((n,s)=>n+s.total,0),1800);
  for(const [key,summary] of Object.entries(result[period])){
    const selected=rows.filter(r=>period==='daily'?r.work_date===key:period==='weekly'?core.weekKey(r.work_date)===key:r.work_date.slice(0,7)===key);
    assert.deepEqual(summary,core.stats(selected),'same existing aggregator: '+period);
  }
}
assert.equal(core.stats(rows).onu_used,4);assert.equal(core.stats(rows).router_used,1);
for(const b of result.blocks)assert(!b.text.includes('- - - -'));
console.log('PASS presentation A-L: order/omission/diagnostics/vertical stats/unchanged inputs and calculations');

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../js/dispatcher-report-core.js');
function setup(state='sent',tg=true){
  const ctx={escapeHtml:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;'),fmtMoney:n=>`${n} грн`,formatOnuSignal:()=>'',normalizeOnuSignal:v=>v,getDailyTicketNumber:()=>1,getScriptUrl:()=> 'configured',getEntityConflict:()=>null,isEntitySynced:()=>true,settings:{tgBotToken:tg?'test':'',tgBackupChatId:tg?'test':''},MTStorageRegistry:{key:()=> 'view'},localStorage:{getItem:()=>null,setItem(){}},MTDispatcherReport:{delivery:()=>({state,code:state==='error'?'STALE_VERSION':''}),badge:()=>`Таблиця Д ${state==='sent'?'✅':state==='error'?'❌':'⏳'}`}};
  ctx.globalThis=ctx;
  for(const f of ['js/tickets-render.js','js/tickets-compact-view.js'])vm.runInNewContext(fs.readFileSync(f,'utf8'),ctx);
  return ctx;
}
const ticket={id:'other-test',type:'Інше',date:'12.10.2026',time:'09:00',sum:999,otherNote:'Нотатка <test>',content:'Інше: Нотатка',tgBackedUp:true,city:'HIDDEN CITY',address:'HIDDEN ADDRESS',signal:-10,macAddress:'HIDDEN MAC',equipment:[{label:'HIDDEN ONU',qty:1,price:800}],diagnosticHistory:[{timestamp:'2026-10-12',result:{}}],photos:['idb:test-a','idb:test-b'],tgPhotoFileIds:['tg-a','tg-b']};
const ctx=setup(),before=JSON.stringify(ticket),html=ctx.renderTicketCard(ticket);
assert(html.includes('Нотатка &lt;test>'));
assert(!html.includes('tc-sum'));
for(const hidden of ['HIDDEN CITY','HIDDEN ADDRESS','HIDDEN MAC','HIDDEN ONU','tc-diagnostic-history'])assert(!html.includes(hidden));
assert(html.includes('tc-expand-btn')&&html.includes('tc-details tc-collapsed'));
assert(html.indexOf('tc-details')<html.indexOf('tc-status-row'),'note statuses are inside expanded details');
for(const badge of ['Таблиця ✅','Таблиця Д ✅','Telegram ✅'])assert(html.includes(badge));
assert(html.includes('tc-photo-toggle-btn')&&html.includes('📷 Фото (2)')&&html.includes('id="tcp-other-test"'));
assert(html.includes('idb:test-a')&&html.includes('tg-a'),'shared photo keys and Telegram IDs');
assert.equal(JSON.stringify(ticket),before);
assert(!ctx.renderTicketCard({...ticket,photos:[],photo:''}).includes('tc-photo-toggle-btn'));
assert(ctx.renderTicketCard({...ticket,photos:[],photo:'legacy-photo'}).includes('legacy-photo'));
assert(!setup('sent',false).renderTicketCard(ticket).includes('Telegram'));
for(const state of ['pending','error'])assert(setup(state).renderTicketCard(ticket).includes(`data-delivery-state="${state}"`));
const normal=ctx.renderTicketCard({...ticket,type:'Ремонт'});
assert(normal.includes('tc-sum')&&normal.indexOf('tc-status-row')<normal.indexOf('tc-details'));
assert(normal.includes('class="tc-details tc-collapsed"'),'normal ticket details remain collapsed');
assert(html.includes(ctx.ticketDeliveryBadges(ticket)),'same delivery helper output as normal tickets');
const compact=ctx.MTTicketCompactView.renderCard(ticket);
for(const forbidden of ['ticket-compact-sum','tc-sync-badge','tc-photo-toggle-btn','Telegram'])assert(!compact.includes(forbidden));
assert(compact.includes('Нотатка &lt;test>'));
ctx.MTTicketCompactView.setMode('compact');ctx.MTTicketCompactView.toggleExpanded(ticket.id);
assert.equal((compact.match(/class="btn ticket-view-expand-btn"/g)||[]).length,1);
const expanded=ctx.MTTicketCompactView.renderItem(ticket,ctx.renderTicketCard);
assert(expanded.includes('class="tc-details"'),'first compact expansion opens note details/statuses/photos');
assert(expanded.includes('tc-photo-toggle-btn'));
assert(expanded.includes('tc-status-row')&&expanded.includes('Нотатка &lt;test>'));
assert.equal((expanded.match(/ticket-view-collapse-btn/g)||[]).length,1,'one outer collapse control');
assert(!expanded.includes('tc-expand-btn'),'embedded note has no independent inner toggle');
ctx.MTTicketCompactView.toggleExpanded(ticket.id);
const collapsed=ctx.MTTicketCompactView.renderItem(ticket,ctx.renderTicketCard);
assert.equal(collapsed,compact,'collapse restores exactly the compact card');
assert(!collapsed.includes('ticket-compact-expanded')&&!collapsed.includes('tc-details'),'no orphan wrapper/details');
assert(ctx.renderTicketCard(ticket,{expanded:true}).includes('tc-expand-btn'),'standalone expanded note retains toggle');
assert(ctx.renderTicketCard(ticket,{suppressExpandToggle:true}).includes('tc-expand-btn'),'suppression requires embedded expansion');
for(const type of ['Ремонт','Підключення']){
  const ordinary={...ticket,type};
  assert.equal(ctx.renderTicketCard(ordinary,{expanded:true,suppressExpandToggle:true}),ctx.renderTicketCard(ordinary),'normal cards unchanged');
}
const dto={ticket_id:'other-test',work_date:'2026-10-12',work_time:'09:00',work_type:'Інше',work_category:'other',dispatcher_comment:'Report note',total:999,payment_type:'Готівка'};
const report=core.render([dto]).blocks.find(b=>b.kind==='ticket').text;
assert(report.includes('Report note'));
for(const forbidden of ['Разом','Сума','Оплата'])assert(!report.includes(forbidden));
for(const type of ['Ремонт','Підключення']){
  const text=core.render([{...dto,work_type:type}]).blocks.find(b=>b.kind==='ticket').text;
  assert.equal((text.match(/💰 Разом:/gu)||[]).length,1);
}
console.log('PASS other note: shared photos/delivery, first expansion, no report/header money, normal cards retained');

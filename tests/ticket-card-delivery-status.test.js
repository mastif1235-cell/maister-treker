'use strict';
/* v91.95 / runtime-140. Delivery statuses in the card (task 2):
   — compact row: no delivery badges (pinned separately in dispatcher-ui-clean);
   — first expand (card shell): Таблиця / Таблиця Д / Telegram statuses UNDER the
     address line and ABOVE the action buttons;
   — statuses are REAL: ✅ only for confirmed delivery, ⏳ queued, ❌ error. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function makeCtx(reportDelivery,reportBadge,synced,conflict,tg){
  const ctx={globalThis:{},escapeHtml:v=>String(v??'').replace(/</g,'&lt;'),fmtMoney:v=>Number(v||0)+' грн',
    MTStorageRegistry:{key:()=> 'view'},localStorage:{getItem:()=>null,setItem(){}},
    getScriptUrl:()=> 'https://script.google.com/legacy',getEntityConflict:()=>conflict,isEntitySynced:()=>synced,
    formatOnuSignal:()=>'',normalizeOnuSignal:v=>String(v??''),getDailyTicketNumber:()=>'№1',
    settings:{tags:[],tgBotToken:tg?'BOT':undefined,tgBackupChatId:tg?'CHAT':undefined},toolsNetworkPoints:[],
    MTDispatcherReport:reportDelivery?{delivery:()=>reportDelivery,badge:()=>reportBadge,enabled:()=>true}:undefined};
  ctx.globalThis=ctx;
  vm.runInNewContext(read('js/tickets-compact-view.js'),ctx,{filename:'js/tickets-compact-view.js'});
  vm.runInNewContext(read('js/tickets-render.js'),ctx,{filename:'js/tickets-render.js'});
  return ctx;
}
const ticket={id:'t-1',type:'Ремонт',date:'10.10.2026',time:'13:41',sum:6000,city:'Дніпро',street:'вул. Академіка Павлова',house:'3',apartment:'14',address:'Таромское, ул. Академика Павлова 3, кв.14',content:'🛠️ ДБЖ: 1 шт. х 2500 грн',equipment:[{label:'ДБЖ',qty:1,price:2500}],note:'роботи виконано'};

// Real ✅ states: legacy synced + report sent + Telegram backed up.
{
  const ctx=makeCtx({state:'sent',code:''},'Таблиця Д ✅',true,null,true);
  const card=ctx.renderTicketCard({...ticket,tgBackedUp:true});
  const sub=card.indexOf('tc-sub'),status=card.indexOf('tc-status-row'),actions=card.indexOf('tc-actions');
  assert.ok(sub>=0&&status>=0&&actions>=0,'address, status row and actions are rendered');
  assert.ok(sub<status&&status<actions,'statuses sit under the address and before action buttons');
  assert.ok(card.includes('Таблиця ✅'),'confirmed legacy sync shows ✅');
  assert.ok(card.includes('Таблиця Д ✅'),'server-confirmed report shows ✅');
  assert.ok(card.includes('Telegram ✅'),'backed-up Telegram shows ✅');
}
// Queued is ⏳, never ✅; a real error is ❌.
{
  const pending=makeCtx({state:'pending',code:''},'Таблиця Д ⏳',false,null,true).renderTicketCard(ticket);
  assert.ok(pending.includes('Таблиця ⏳'),'queued legacy sync shows ⏳');
  assert.ok(pending.includes('Таблиця Д ⏳'),'queued report shows ⏳');
  assert.ok(!pending.includes('✅'),'a queued operation never shows ✅');
  assert.ok(pending.includes('Telegram ⏳'),'pending Telegram shows ⏳');
  const failed=makeCtx({state:'error',code:'GOOGLE_CONNECTION_REQUIRED'},'Таблиця Д ❌',false,{code:'INVALID_INPUT'},false).renderTicketCard(ticket);
  assert.ok(failed.includes('Таблиця ❌'),'conflicting legacy sync shows ❌');
  assert.ok(failed.includes('Таблиця Д ❌'),'failed report shows ❌');
}
// Таблиця Д badge is shown only when the channel is configured/used.
{
  const off=makeCtx({state:'not_configured',code:'REPORT_NOT_CONFIGURED'},'',true,null,false).renderTicketCard(ticket);
  assert.ok(!off.includes('Таблиця Д'),'unconfigured report channel shows no badge');
  const none=makeCtx(null,'',true,null,false).renderTicketCard(ticket);
  assert.ok(none.includes('Таблиця ✅'),'legacy status still works without the report module');
}
// Compact rows never carry delivery badges (task 2, regression E).
{
  const ctx=makeCtx({state:'sent',code:''},'Таблиця Д ✅',true,null,true);
  const compact=ctx.MTTicketCompactView.renderCard(ticket);
  for(const text of ['tc-sync-badge','data-dispatcher-ticket-status','tc-status-row','Таблиця','Telegram','✅','⏳','❌'])assert.ok(!compact.includes(text),'compact row hides '+text);
}
console.log('PASS delivery statuses: real ✅/⏳/❌ under the address, compact clean');

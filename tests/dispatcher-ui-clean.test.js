'use strict';
/* v91.94 / runtime-139. Обов'язкові регресії UI (завдання 4, 8, 9–11):
   9) компактна картка «Інше» — лише дата/час/тип/сума/нотатка/«Розгорнути»;
   10) розгорнута «Інше» — лише дата/час/тип/нотатка/сума/редагувати/поділитись/видалити;
   11) компактний режим без службових бейджів синхронізації;
   4) на ГОЛОВНОМУ екрані немає глобального баннера «Таблиця Д — очікує...» —
   технічні статуси лише в Налаштуваннях.
   Жодне з тверджень існуючих тестів не послаблюється — це нові регресії. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const ctx={globalThis:{},MTStorageRegistry:{key:()=> 'view'},localStorage:{getItem:()=>null,setItem(){}},escapeHtml:v=>String(v??'').replace(/</g,'&lt;'),fmtMoney:v=>Number(v||0)+' грн'};
ctx.globalThis=ctx;
vm.runInNewContext(read('js/tickets-compact-view.js'),ctx,{filename:'js/tickets-compact-view.js'});
vm.runInNewContext(read('js/tickets-render.js'),ctx,{filename:'js/tickets-render.js'});

const other={id:'t-other',type:'Інше',date:'08.10.2026',time:'12:00',sum:0,otherNote:'Забрати ONU завтра',city:'SHOULD_NOT_DISPLAY',street:'SHOULD_NOT_DISPLAY',house:'1',address:'SHOULD_NOT_DISPLAY',
  clientName:'PRIVATE_CLIENT',phone:'PRIVATE_PHONE',equipment:[{label:'ONU',qty:1}],diagnosticHistory:[{}],connectMasters:['PRIVATE_PARTNER'],cables:[{label:'UTP',meters:5}]};
const normal={id:'t-normal',type:'Ремонт',date:'09.10.2026',time:'18:40',sum:450,city:'Дніпро',street:'вул. Робоча',house:'15',apartment:'27',clientName:'PRIVATE_CLIENT',phone:'PRIVATE_PHONE'};

// 9) компактна «Інше»: лише дата/час/тип/сума/нотатка/«Розгорнути».
{
  const compact=ctx.MTTicketCompactView.renderCard(other);
  for(const text of ['08.10.2026','12:00','Інше','0 грн','Забрати ONU завтра','Розгорнути'])assert.ok(compact.includes(text),'compact Інше shows '+text);
  for(const text of ['SHOULD_NOT_DISPLAY','Адресу не вказано','tc-status-row','PRIVATE_CLIENT','PRIVATE_PHONE','PRIVATE_PARTNER','1 шт.','UTP','Таблиця','Telegram'])assert.ok(!compact.includes(text),'compact Інше hides '+text);
}
// 11) компактний режим без службових бейджів (звіт/синхронізація/вимкнено).
{
  const compact=ctx.MTTicketCompactView.renderCard(normal);
  for(const text of ['tc-sync-badge','data-dispatcher-ticket-status','Таблиця Д','Таблиця ✅','Надіслано','Вимкнено','deliveryState','⏳','✅','❌'])assert.ok(!compact.includes(text),'compact card has no sync badge: '+text);
}
// 10) розгорнута «Інше»: лише дата/час/тип/нотатка/сума/редагувати/поділитись/видалити.
{
  const expanded=ctx.renderTicketCard(other);
  for(const text of ['08.10.2026','12:00','Інше','Забрати ONU завтра','0 грн','Редагувати','Переслати','Видалити'])assert.ok(expanded.includes(text),'expanded Інше shows '+text);
  for(const text of ['SHOULD_NOT_DISPLAY','діагнос','Напарник','Матеріали','PRIVATE_PARTNER','В профіль','Google Maps','PRIVATE_CLIENT','PRIVATE_PHONE','UTP','кабель'])assert.ok(!expanded.includes(text),'expanded Інше hides '+text);
}
// 4) без глобального баннера «Таблиця Д — очікує...» на головному екрані.
{
  const html=read('index.html'),client=read('js/dispatcher-report-client.js');
  assert.ok(!html.includes('dispatcherReportQueueBanner'),'no queue banner element on the main screen');
  assert.ok(!client.includes('dispatcherReportQueueBanner'),'no queue banner rendering code');
  assert.ok(!html.includes('Таблиця Д — очікує'),'no banner text in markup');
  assert.ok(!client.includes('Таблиця Д — очікує'),'no banner text in client');
}
// Структурні контракти, що захищають чистоту компактного режиму назавжди.
{
  const compact=read('js/tickets-compact-view.js'),render=read('js/tickets-render.js');
  assert.ok(!compact.includes('ticketDeliveryBadges('),'compact renderer never emits delivery badges');
  assert.ok(render.includes('const syncBadge = ticketDeliveryBadges(t);'),'full renderer keeps its existing delivery badge line');
  assert.ok(compact.includes('runtimeRevision:'),'module revision stays exposed for the runtime guard');
}
console.log('PASS UI clean: Інше compact note-only, Інше expanded safe fields, no sync badges, no global queue banner');

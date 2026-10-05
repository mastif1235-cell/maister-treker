'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=f=>fs.readFileSync(f,'utf8'),sent=[],ticket={id:'fixture',date:'05.10.2026',time:'10:00',type:'Ремонт',sum:300,payment:'Готівка',geoLat:48.45,geoLng:35.05,geoLink:'https://maps.app.goo.gl/private',signal:'-23',note:'Роботи виконано, geoLat: 48.45, geoLng: 35.05, signal before: -25; after: -23',content:'Заявка\nАдреса: Тестова 1\nMAC ONU: AA:BB\n📍 Геолокація: https://www.google.com/maps?q=48.45,35.05\n📶 Сигнал ONU: -23 dBm\nNote: Роботи виконано, geoLat: 48.45, geoLng: 35.05, signal before: -25; after: -23\nСума: 300 грн'};
const ctx={console,tickets:[ticket],calcState:ticket,navigator:{clipboard:{writeText:async text=>sent.push(text)},share:async o=>sent.push(o.text)},showToast(){},syncFormToState(){},getCurrentTicketText:()=>ticket.content};vm.createContext(ctx);vm.runInContext(read('js/share-domain.js'),ctx);vm.runInContext(read('js/photo-telegram-domain.js'),ctx);
const saved=read('js/tickets-domain.js');vm.runInContext(saved.slice(saved.indexOf('async function copyTicketCardText'),saved.indexOf('/* ---- "Знайти в Telegram"')),ctx);
for(const line of ['latitude: 48.45','longitude: 35.05','location: 48.45,35.05','GPS: 48.45,35.05','Координаты: 48.45,35.05','geoLat: 48.45','geoLng: 35.05','geoLink: private','ONU signal before: -25','signalAfter: -20','opticalLevel: -23','optical level: -23','https://maps.app.goo.gl/Private','📶 Сигнал ONU:\n-23'])assert.equal(ctx.dispatcherForwardText(line),'',line);
const inlineCases=[
 ['Note: выполнено, geoLat: 48.45, geoLng: 35.05','Note: выполнено'],
 ['Комментарий: координаты latitude 48.45 longitude 35.05','Комментарий: координаты'],
 ['Note: выполнено; location: 48.45,35.05 — проверено','Note: выполнено — проверено'],
 ['Note: lat/lng: 48.45,35.05, готово','Note: готово'],
 ['Note: lat 48.45 lng 35.05; готово','Note: готово'],
 ['Note: выполнено, https://www.google.com/maps?q=48.45,35.05, проверено','Note: выполнено, проверено'],
 ['Note: выполнено, location: https://example.invalid/coordinates, проверено','Note: выполнено, проверено'],
 ['Note: ONU signal before: -25; after: -20','Note:'],
 ['Комментарий: заменили ONU, signal -18 dBm, всё работает','Комментарий: заменили ONU, всё работает'],
 ['Note: signal before -25 dBm; signal after -20 dBm; готово','Note: готово'],
 ['Note: optical level before -25 dBm; after -20 dBm, работает','Note: работает'],
 ['Note: optical signal before: -25 dBm, работает','Note: работает'],
 ['Note: ONU signal before -25 -> after -20, работает','Note: работает'],
 ['Примітка: Сигнал ONU до: -25; після: -20, виконано','Примітка: виконано'],
 ['signal -18 dBm, заменили ONU','заменили ONU'],
 ['Адреса: Богдана Хмельницького 106, кв.29','Адреса: Богдана Хмельницького 106, кв.29'],
 ['Будинок 48.45, квартира 35.05','Будинок 48.45, квартира 35.05'],
 ['Сума: 300 грн; матеріали: 48.45; борг -20','Сума: 300 грн; матеріали: 48.45; борг -20'],
 ['Температура -18; зміна суми -25; будинок 20-22','Температура -18; зміна суми -25; будинок 20-22'],
 ['48.450123, 35.050123','48.450123, 35.050123'],
 ['Note: 48.45,35.05; 300 грн','Note: 48.45,35.05; 300 грн'],
 ['Note: выполнено, geoLat: -33.8, longitude: 151.2; -20 грн','Note: выполнено; -20 грн']
];
for(const [input,expected] of inlineCases){assert.equal(ctx.dispatcherForwardText(input),expected,input);assert.equal(ctx.dispatcherForwardText(expected),expected,'idempotent: '+input);}
assert.equal(ctx.dispatcherForwardText('Замінив ONU. Сигнал ONU: -23 dBm'),'Замінив ONU.');
for(const line of ['Сигнал ONU до: -25','Сигнал ONU після: -20','onuSignalBefore: -25','geoAccuracy: 5','locationTimestamp: 123'])assert.equal(ctx.dispatcherForwardText(line),'',line);
const before=JSON.stringify(ticket);
(async()=>{
 await ctx.copyTicketText();await ctx.copyTicketCardText('fixture');await ctx.shareTicket('fixture');await ctx.shareCurrentTicket();assert.equal(sent.length,4);
 const comment='Роботи перевірено, latitude 48.45 longitude 35.05; ONU signal before: -25; after: -20';
 const nodes={reportFullToggle:{checked:true},reportCommentInput:{value:comment},reportOutput:{},copyReportBtn:{},shareReportBtn:{}};
 Object.assign(ctx,{document:{getElementById:id=>nodes[id]||null},currentTicketDate:'05.10.2026',parseDate:()=>new Date(2026,9,5),fmtMoney:v=>v+' грн',buildMonthlyEquipmentLines:()=>[],escapeHtml:v=>v});
 for(const f of ['js/report-utils.js','js/calendar-stats-render.js','js/reports-domain.js'])vm.runInContext(read(f),ctx);
 ctx.renderReport('all');await nodes.copyReportBtn.onclick();await nodes.shareReportBtn.onclick();
 assert.equal(nodes.reportCommentInput.value,comment,'original comment is unchanged');
 ctx.chooseDispatcherAndSend=fn=>fn(['fixture-chat']);ctx.sendToTelegramChat=async(_id,text)=>{sent.push(text);return{ok:true};};
 await ctx.sendTicketToDispatcher('fixture');await ctx.sendCurrentTicketToDispatcher();
 await new Promise(r=>setImmediate(r));assert.equal(sent.length,8);
 for(const text of sent){assert.match(text,/Заявка/);assert.match(text,/Адреса: Тестова 1/);assert.match(text,/MAC ONU: AA:BB/);assert.match(text,/Роботи виконано/);assert.match(text,/300 грн/);assert.doesNotMatch(text,/geo|latitude|longitude|signal|dBm|Сигнал|maps\.|48\.45|35\.05|optical/iu);}
 assert.equal(JSON.stringify(ticket),before);assert.equal(ctx.tickets[0].signal,'-23');assert.equal(ctx.tickets[0].geoLat,48.45);assert.match(ctx.buildTelegramBackupText(ticket),/Геолокація/);assert.match(ctx.buildTelegramBackupText(ticket),/Сигнал ONU/);
 const app=read('app.js');vm.runInContext(app.slice(app.indexOf('function ticketToSyncPayload('),app.indexOf('function shiftToSyncPayload(')),ctx);
 const payload=ctx.ticketToSyncPayload(ticket),roundTrip=JSON.parse(payload.fullDataJson);
 for(const key of ['geoLat','geoLng','geoLink','signal','note'])assert.equal(roundTrip[key],ticket[key],`sync round-trip retains ${key}`);
 assert.equal(payload.content,ticket.content);assert.equal(JSON.stringify(ticket),before);
 const exports=read('js/reports-domain.js').split('/* ---- Масовий імпорт ---- */')[0];assert.doesNotMatch(exports,/dispatcherForwardText/,'personal TXT/MD export retains canonical content');
 console.log('PASS dispatcher boundary: eight copy/share/Telegram/report paths; sensitive variants; address/MAC/work/money intact; geo/signal and private archive/export unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=f=>fs.readFileSync(f,'utf8'),sent=[],ticket={id:'fixture',date:'05.10.2026',time:'10:00',type:'Ремонт',sum:300,payment:'Готівка',geoLat:48.45,geoLng:35.05,geoLink:'https://maps.app.goo.gl/private',signal:'-23',content:'Заявка\nАдреса: Тестова 1\nMAC ONU: AA:BB\n📍 Геолокація: https://www.google.com/maps?q=48.45,35.05\n📶 Сигнал ONU: -23 dBm\nРоботи виконано\nСума: 300 грн'};
const ctx={console,tickets:[ticket],calcState:ticket,navigator:{clipboard:{writeText:async text=>sent.push(text)},share:async o=>sent.push(o.text)},showToast(){},syncFormToState(){},getCurrentTicketText:()=>ticket.content};vm.createContext(ctx);vm.runInContext(read('js/share-domain.js'),ctx);vm.runInContext(read('js/photo-telegram-domain.js'),ctx);
const saved=read('js/tickets-domain.js');vm.runInContext(saved.slice(saved.indexOf('async function copyTicketCardText'),saved.indexOf('/* ---- "Знайти в Telegram"')),ctx);
for(const line of ['latitude: 48.45','longitude: 35.05','location: 48.45,35.05','GPS: 48.45,35.05','Координаты: 48.45,35.05','geoLat: 48.45','geoLng: 35.05','geoLink: private','ONU signal before: -25','signalAfter: -20','opticalLevel: -23','optical level: -23','48.450123, 35.050123','https://maps.app.goo.gl/Private','📶 Сигнал ONU:\n-23'])assert.equal(ctx.dispatcherForwardText(line),'',line);
assert.equal(ctx.dispatcherForwardText('Замінив ONU. Сигнал ONU: -23 dBm'),'Замінив ONU.');
for(const line of ['Сигнал ONU до: -25','Сигнал ONU після: -20','onuSignalBefore: -25','geoAccuracy: 5','locationTimestamp: 123'])assert.equal(ctx.dispatcherForwardText(line),'',line);
const before=JSON.stringify(ticket);
(async()=>{
 await ctx.copyTicketText();await ctx.copyTicketCardText('fixture');await ctx.shareTicket('fixture');await ctx.shareCurrentTicket();assert.equal(sent.length,4);
 const nodes={reportFullToggle:{checked:true},reportCommentInput:{value:'Роботи перевірено\nlatitude: 48.45\noptical level: -23 dBm'},reportOutput:{},copyReportBtn:{},shareReportBtn:{}};
 Object.assign(ctx,{document:{getElementById:id=>nodes[id]||null},currentTicketDate:'05.10.2026',parseDate:()=>new Date(2026,9,5),fmtMoney:v=>v+' грн',buildMonthlyEquipmentLines:()=>[],escapeHtml:v=>v});
 for(const f of ['js/report-utils.js','js/calendar-stats-render.js','js/reports-domain.js'])vm.runInContext(read(f),ctx);
 ctx.renderReport('all');await nodes.copyReportBtn.onclick();await nodes.shareReportBtn.onclick();
 ctx.chooseDispatcherAndSend=fn=>fn(['fixture-chat']);ctx.sendToTelegramChat=async(_id,text)=>{sent.push(text);return{ok:true};};
 await ctx.sendTicketToDispatcher('fixture');await ctx.sendCurrentTicketToDispatcher();
 await new Promise(r=>setImmediate(r));assert.equal(sent.length,8);
 for(const text of sent){assert.match(text,/Заявка/);assert.match(text,/Адреса: Тестова 1/);assert.match(text,/MAC ONU: AA:BB/);assert.match(text,/Роботи виконано/);assert.match(text,/300 грн/);assert.doesNotMatch(text,/geo|latitude|longitude|signal|dBm|Сигнал|maps\.|48\.45|35\.05|optical/iu);}
 assert.equal(JSON.stringify(ticket),before);assert.equal(ctx.tickets[0].signal,'-23');assert.equal(ctx.tickets[0].geoLat,48.45);assert.match(ctx.buildTelegramBackupText(ticket),/Геолокація/);assert.match(ctx.buildTelegramBackupText(ticket),/Сигнал ONU/);
 const app=read('app.js');vm.runInContext(app.slice(app.indexOf('function ticketToSyncPayload('),app.indexOf('function shiftToSyncPayload(')),ctx);
 const payload=ctx.ticketToSyncPayload(ticket),roundTrip=JSON.parse(payload.fullDataJson);
 for(const key of ['geoLat','geoLng','geoLink','signal'])assert.equal(roundTrip[key],ticket[key],`sync round-trip retains ${key}`);
 assert.equal(payload.content,ticket.content);assert.equal(JSON.stringify(ticket),before);
 const exports=read('js/reports-domain.js').split('/* ---- Масовий імпорт ---- */')[0];assert.doesNotMatch(exports,/dispatcherForwardText/,'personal TXT/MD export retains canonical content');
 console.log('PASS dispatcher boundary: eight copy/share/Telegram/report paths; sensitive variants; address/MAC/work/money intact; geo/signal and private archive/export unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});

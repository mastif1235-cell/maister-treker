'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const core=require('../js/tools-core.js');

const financeContext={
  MTToolsCore:core,
  fmtMoney:value=>`${Number(value)||0} грн`,
  normalizeOnuSignal:value=>String(value||''),
  effectiveTicketCallFee:ticket=>Number(ticket.callFee)||0,
  callFeeLabelFor:()=> 'Виклик',
  safeNonNegativeNumber:value=>Math.max(0,Number(value)||0),
  buildMixedPaymentBreakdownLines:()=>[]
};
vm.createContext(financeContext);
vm.runInContext(read('js/finance-utils.js'),financeContext);
const geoTicket={type:'Ремонт',date:'06.09.2026',time:'10:00',city:'Дніпро',address:'вул. Тестова, 1',payment:'Готівка',callFee:0,equipment:[],cables:[],presetWorks:[],additionalWork:[],geoLat:48.432389,geoLng:34.812238};
const mapsUrl=core.googleMapsUrl(geoTicket);
const content=financeContext.buildTicketContent(geoTicket,0);
assert.match(content,new RegExp(mapsUrl.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'GEO-DATA-4 content uses the official coordinate URL');
const legacy='https://maps.app.goo.gl/LegacyGeo123';
assert.match(financeContext.buildTicketContent({...geoTicket,geoLat:null,geoLng:null,geoLink:legacy},0),new RegExp(legacy.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'GEO-DATA-5 legacy geoLink remains the content fallback');
assert.equal(core.explicitCoordinates({geoLink:legacy}),null,'GEO-DATA-6 opaque short links never become fake coordinates');

const app=read('app.js');
const payloadSource=app.slice(app.indexOf('function ticketToSyncPayload'),app.indexOf('function shiftToSyncPayload'));
const payloadContext={MTToolsCore:core,formatDate:()=> '06.09.2026',formatTime:()=> '10:00',Date};
vm.createContext(payloadContext);vm.runInContext(payloadSource,payloadContext);
const sheetPayload=payloadContext.ticketToSyncPayload({...geoTicket,id:'ticket-geo-1',content,tags:[],sum:0});
const fullData=JSON.parse(sheetPayload.fullDataJson);
assert.equal(fullData.geoLat,48.432389,'GEO-DATA-3/9 fullDataJson keeps latitude');
assert.equal(fullData.geoLng,34.812238,'GEO-DATA-3/9 fullDataJson keeps longitude');
assert.match(sheetPayload.backupNote,/https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/,'Sheets human-readable backup column uses coordinates');
const legacyPayload=payloadContext.ticketToSyncPayload({...geoTicket,id:'ticket-geo-2',geoLat:null,geoLng:null,geoLink:legacy,content:'legacy',tags:[],sum:0});
assert.equal(JSON.parse(legacyPayload.fullDataJson).geoLink,legacy,'fullDataJson retains legacy geoLink when present');

const securityTelegramContext={console,MTToolsCore:core,buildTelegramBackupText:()=>''};
vm.createContext(securityTelegramContext);vm.runInContext(read('js/security-telegram.js'),securityTelegramContext);
const telegramText=securityTelegramContext.buildTelegramBackupText({...geoTicket,content:'Заявка'});
assert.match(telegramText,/https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/,'GEO-DATA-7 Telegram text uses canonical coordinates');
const telegramJson=securityTelegramContext.securityTelegramSanitizeTicketForArchive({...geoTicket,id:'ticket-geo-1'});
assert.equal(telegramJson.geoLat,48.432389);assert.equal(telegramJson.geoLng,34.812238,'Telegram JSON keeps coordinates');

const backupContext={console,crypto:webcrypto,TextEncoder,TextDecoder,btoa,atob};
vm.createContext(backupContext);vm.runInContext(read('js/backup-system.js'),backupContext);
(async()=>{
  backupContext.backupJson=JSON.stringify({app:'master-tracker',tickets:[{...geoTicket,id:'ticket-geo-1',geoLink:legacy}]});
  const backupPayload=vm.runInContext('JSON.parse(backupJson)',backupContext);
  const envelope=await backupContext.MTBackupSystem.encrypt(backupPayload,'geo-test-password');
  const restored=await backupContext.MTBackupSystem.decrypt(envelope,'geo-test-password');
  assert.equal(restored.tickets[0].geoLat,48.432389,'GEO-DATA-8 backup/restore keeps latitude');
  assert.equal(restored.tickets[0].geoLng,34.812238,'GEO-DATA-8 backup/restore keeps longitude');
  assert.equal(restored.tickets[0].geoLink,legacy,'backup/restore keeps legacy link');

  const editor=read('js/ticket-editor-domain.js'),calculator=read('js/calculator-render.js'),tools=read('js/tools-domain.js'),html=read('index.html'),styles=read('styles.css'),securityDom=read('js/security-dom-final-v65-18.js');
  const setGeoSource=editor.slice(editor.indexOf('function setGeoLink'),editor.indexOf('/* Розпізнає координати'));
  const editorContext={calcState:{},formTouchedByUser:false,renderGeoBadge(){}};vm.createContext(editorContext);vm.runInContext(setGeoSource,editorContext);
  editorContext.setGeoLink('',{lat:48.4323894,lng:34.8122384});assert.equal(editorContext.calcState.geoLat,48.432389);assert.equal(editorContext.calcState.geoLng,34.812238,'GEO-DATA-1 Save commits canonical numeric coordinates');
  editorContext.setGeoLink('');assert.equal(editorContext.calcState.geoLat,null);assert.equal(editorContext.calcState.geoLng,null,'explicit Remove clears canonical coordinates');
  assert.match(editor,/setGeoLink\(link,coords=null\)[\s\S]*calcState\.geoLat=Number[\s\S]*calcState\.geoLng=Number/,'GEO-DATA-1 picker commit writes form coordinates');
  assert.match(editor,/loadTicketIntoForm\(t\)[\s\S]*calcState\s*=\s*JSON\.parse\(JSON\.stringify\(t\)\)/,'GEO-DATA-2 edit reload restores ticket coordinates');
  assert.match(editor,/else if\(!link\)\{calcState\.geoLat=null;calcState\.geoLng=null;\}/,'explicit Remove clears both canonical coordinates');
  assert.match(html,/geoCoordinates[\s\S]*Відкрити в Google Maps/,'GEO-UI-2 saved-state exposes coordinates and Maps action');
  assert.match(calculator,/btn\.textContent='📍 Уточнити'/,'GEO-UI-2 saved-state changes the primary action');
  assert.match(editor,/explicitCoordinates\(calcState\)\)\{openTicketGeoPointPicker\(\);return;\}/,'saved-state Clarify opens the existing picker directly');
  assert.match(calculator,/btn\.textContent='📍 Додати геолокацію'/,'GEO-UI-1 empty state retains Add action');
  assert.match(securityDom,/MTToolsCore\.googleMapsUrl\(calcState\)/,'security DOM wrapper preserves coordinate-priority URL');
  assert.match(tools,/overlayClass:'ticket-geo-picker-overlay'/,'ticket picker uses the dedicated large layout');
  assert.match(styles,/ticket-geo-picker-overlay \.modal\{[^}]*height:95dvh/,'GEO-MAP-1 mobile picker uses almost the full viewport');
  assert.match(styles,/ticket-geo-picker-map\{[^}]*flex:1 1 auto/,'the map receives remaining picker space');
  assert.match(tools,/ticketGeoPointCancel[\s\S]*closePicker/,'GEO-DATA-10 Cancel does not commit the draft');
  assert.match(tools,/mountPicker[\s\S]*requestAnimationFrame/,'Leaflet picker still mounts after modal layout');
  console.log('PASS post-v91 geo save/content/Sheets/Telegram/backup/UI/mobile-picker regressions');
})().catch(error=>{console.error(error);process.exitCode=1;});

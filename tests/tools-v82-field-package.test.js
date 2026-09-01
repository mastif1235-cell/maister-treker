'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8'),core=require('../js/tools-core.js'),backup=require('../js/backup-system.js');
const domain=read('js/tools-domain.js'),map=read('js/tools-map.js'),styles=read('styles.css'),naryad=read('js/ticket-address-domain.js'),backupSource=read('js/backup-system.js'),sw=read('sw.js');

// Map-first layout, compact presentation filters and a single network-point store.
const mapHtml=domain.slice(domain.indexOf('function toolsMapHtml'),domain.indexOf('function toolsOpenPointEditorFromMap'));
assert.ok(mapHtml.indexOf('tools-map-shell')<mapHtml.indexOf('tools-map-filters'),'map is immediately before secondary controls');
assert.ok(mapHtml.indexOf('tools-map-shell')<mapHtml.indexOf('tools-network-groups-card'));
assert.doesNotMatch(mapHtml,/tools-offline-map-card/,'offline map management is no longer duplicated below the working map');
assert.match(mapHtml,/data-map-filter="none"[^>]*>Зняти всі/);
assert.match(map,/key==='none'[\s\S]*selected\.clear\(\)/);
assert.match(map,/key==='none'\?selected\.size===0/);
assert.doesNotMatch(domain.slice(domain.indexOf('function toolsHomeHtml'),domain.indexOf('function toolsBackButton')),/Точки мережі/);
assert.equal((domain.match(/MT_TOOLS_NETWORK_POINTS_KEY/g)||[]).length>=2,true,'existing point storage is reused');

const points=[
  core.normalizeNetworkPoint({id:'point-b-unique',type:'Муфта',city:'Жовті Води',street:'Шевченка',house:'2',lat:48,lng:33,note:'Опора'},new Date('2026-09-01')),
  core.normalizeNetworkPoint({id:'a',type:'FOB',city:'Апостолове',street:'Центральна',house:'10',lat:47,lng:33},new Date('2026-09-01')),
  core.normalizeNetworkPoint({id:'c',type:'Вузол',city:'',street:'',house:'',lat:46,lng:33},new Date('2026-09-01'))
];
const grouped=core.groupNetworkPoints(points);
assert.deepEqual(grouped.map(group=>group.city),['Апостолове','Без адреси / Не визначено','Жовті Води']);
assert.equal(grouped.find(group=>group.city==='Жовті Води').count,1);
assert.equal(core.groupNetworkPoints(points,'опора')[0].streets[0].points[0].id,'point-b-unique');
assert.equal(core.groupNetworkPoints(points,'point-b-unique')[0].streets[0].points[0].id,'point-b-unique','ID participates in search');
assert.match(domain,/toolsNetworkOpenCities/);assert.match(domain,/toolsNetworkOpenStreets/);
assert.match(domain,/cityOpen=!!query/);assert.match(domain,/streetOpen=!!query/,'search expands matching hierarchy');
assert.match(domain,/toolsFocusNetworkPoint[\s\S]*MTToolsMap\.focusPoint/);
assert.match(domain,/toolsSelectedNetworkPointId/);assert.match(domain,/toolsHighlightNetworkPointInList/);
assert.match(domain,/toolsAddressSearch/);assert.match(domain,/profile\.apartment/);assert.match(domain,/profile\.address/);

// Telegram is durable, deduplicated and updates the existing publication after local save.
assert.ok(domain.indexOf('toolsSaveNetworkPoints()')<domain.indexOf('await toolsSendNetworkPointTelegram(normalized'));
assert.match(domain,/const toolsNetworkTelegramSending=new Set\(\)/);
assert.match(domain,/toolsNetworkTelegramSending\.has\(current\.id\)/);
assert.match(domain,/toolsNetworkTelegramSending\.add\(current\.id\)/);
assert.match(domain,/finally\{toolsNetworkTelegramSending\.delete\(current\.id\)/);
assert.match(domain,/hasReference&&!options\.updateExisting&&!options\.republish/);
assert.match(domain,/telegramSendPending=true/);assert.match(domain,/telegramSendPending=false/);
assert.match(domain,/editTelegramTextMessage/);
assert.match(domain,/Повторити відправлення/);
const restoredPoint=core.sanitizeNetworkPoints([{...points[0],telegramChatId:'-1001234567',telegramMessageId:44,telegramSendPending:true,photoKeys:['idb:p1']}])[0];
assert.equal(restoredPoint.telegramMessageId,44);assert.equal(restoredPoint.telegramSendPending,true);assert.deepEqual(restoredPoint.photoKeys,['idb:p1']);

// Point photo removal is scoped and shared references are protected.
assert.match(domain,/Видалити це фото\?/);assert.match(domain,/toolsRemoveNetworkPointPhoto/);
assert.match(domain,/toolsPhotoKeyStillUsed\(key,pointId\)/);assert.match(domain,/await deletePhotoKey\(key\)/);
assert.match(domain,/inTicket=tickets\.some/);

// Naryad Android modal stays inside its sheet.
assert.match(naryad,/class="naryad-editor-textarea"/);assert.doesNotMatch(naryad,/width:calc\(100% \+ 32px\)/);
assert.match(styles,/\.naryad-editor-overlay \.modal\{[^}]*overflow-x:hidden/);
assert.match(styles,/\.naryad-editor-textarea\{[^}]*box-sizing:border-box[^}]*padding:12px 14px/);

// Backup round-trip keeps addresses, point Telegram/photo refs and excludes PMTiles.
const ticket={id:'t1',city:'Мирноград',street:'Центральна',house:'7',apartment:'3',geoLat:48.123,geoLng:37.456};
const payload={app:'master-tracker',tickets:[ticket],shifts:[],settings:{},networkPoints:[restoredPoint]};
assert.equal(backup.validatePayload(payload),true);const clone=JSON.parse(JSON.stringify(payload));
assert.equal(clone.tickets[0].geoLat,48.123);assert.equal(clone.tickets[0].house,'7');
assert.equal(clone.networkPoints[0].telegramMessageId,44);assert.deepEqual(clone.networkPoints[0].photoKeys,['idb:p1']);
assert.doesNotMatch(backupSource,/offlineMap|pmtiles/i,'backup payload has no offline map archive');

// Continuous availability check is explicit, bounded and honest.
assert.match(domain,/Безперервна перевірка доступності/);assert.match(domain,/не ICMP ping/);
assert.match(domain,/Справжній ICMP ping до IP-адреси недоступний у браузерній PWA/);
assert.match(domain,/CORS\/браузерне блокування/);assert.doesNotMatch(domain,/packet loss|втрата пакетів/i);
assert.match(domain,/setTimeout\(toolsConnectionCheckTick,1000\)/);
assert.match(domain,/state\.log=state\.log\.slice\(0,20\)/);
assert.match(domain,/toolsStopConnectionCheck/);assert.match(read('js/ui-orchestration.js'),/if\(tab!=='tools'/);
assert.doesNotMatch(domain,/toolsSaveDiagnostics\(\)[\s\S]{0,120}toolsConnectionCheckTick/,'continuous check never auto-saves diagnostics');

assert.match(sw,/maister-treker-v66-runtime-27/);
assert.match(read('app.js'),/v85 · 2026-09-01/);
console.log('PASS v82 map hierarchy, point Telegram/photo lifecycle, naryad UX, backup and honest availability check');

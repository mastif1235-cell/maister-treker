'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const domain=read('js/tools-domain.js'),map=read('js/tools-map.js'),styles=read('styles.css'),telegram=read('js/photo-telegram-domain.js'),offline=read('js/offline-map-storage.js');
const core=require('../js/tools-core.js');

assert.doesNotMatch(domain,/＋ Додати об’єкт<\/button>/);assert.doesNotMatch(domain,/◎ Моє місце<\/button>/,'large map actions are removed');
assert.match(domain,/tools-map-floating-controls/);assert.match(domain,/aria-label="Моє місце"/);assert.match(domain,/aria-label="Додати об’єкт"/);
assert.match(styles,/\.tools-map-floating-controls\{[^}]*position:absolute;[^}]*z-index:1001;[^}]*right:12px;[^}]*top:12px/,'floating controls stay above Leaflet at top-right');
assert.match(styles,/\.tools-map-floating-btn\{[^}]*width:46px;[^}]*height:46px/,'touch targets are mobile sized');
assert.match(map,/OpenStreetMap<\/a> contributors/,'required OSM attribution remains');assert.match(domain,/<details class="tools-map-info"><summary>ⓘ Про карту<\/summary>/,'privacy text is collapsed by default');
assert.match(domain,/toolsStartMapAddMode/);assert.match(domain,/MTToolsMap\.startPointPlacement/);assert.match(domain,/toolsLocateOnMap/);assert.match(domain,/MTToolsMap\.showUserLocation/,'existing add and GPS logic remain wired');

const oldPoint=core.normalizeNetworkPoint({id:'p1',type:'FOB',lat:48,lng:37,photoKeys:['idb:photo'],telegramChatId:'-100123456',telegramMessageId:77},new Date('2026-08-31T12:00:00Z'));
assert.equal(oldPoint.id,'p1');assert.deepEqual(oldPoint.photoKeys,['idb:photo']);assert.equal(oldPoint.telegramChatId,'-100123456');assert.equal(oldPoint.telegramMessageId,77,'point data and real Telegram reference survive normalization');
assert.match(telegram,/return \{ok:true,chatId:String\(chatId\),messageId:Number\(msgData\.result\?\.message_id\)\|\|0\}/,'transport exposes confirmed Telegram reference');
assert.match(telegram,/function telegramNetworkMessageLink[\s\S]*\/\^-100\\d\+\$\//,'network deep-link accepts only a real supergroup reference');
assert.match(domain,/telegramNetworkMessageLink\(firstResult\.chatId,firstResult\.messageId\)/);assert.match(domain,/Відкрити в Telegram/);assert.match(domain,/Надіслати повторно/);

assert.match(domain,/Зберегти межі області \(\.json\)/);assert.match(domain,/Це лише межі та масштаб, не файл карти/);assert.match(domain,/Додати офлайн-карту \(\.pmtiles\)/);
assert.match(domain,/parsed\?\.format==='master-tracker-offline-area-v1'/);assert.match(domain,/Це файл параметрів області, а не офлайн-карта/);assert.match(domain,/Потрібен файл офлайн-карти у форматі \.pmtiles/);
assert.match(domain,/<details class="tools-offline-more"><summary>Ще<\/summary>/);assert.match(domain,/<summary>Як працює офлайн-карта\?<\/summary>/,'offline explanations are collapsed');
assert.match(offline,/SLOTS=\['map-a\.pmtiles','map-b\.pmtiles'\]/);assert.match(offline,/previous=readMeta\(\)/);assert.match(offline,/catch\(error\)\{await removeSlot\(directory,theSlot\);throw error;\}/,'PMTiles replacement remains rollback-safe');assert.match(map,/function addOnlineBaseLayer/,'online map remains available');
console.log('PASS v81 floating map controls, Telegram reference and compact honest offline UX');

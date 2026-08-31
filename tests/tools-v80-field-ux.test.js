'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),core=require('../js/tools-core.js');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const domain=read('js/tools-domain.js'),map=read('js/tools-map.js'),editor=read('js/ticket-editor-domain.js'),address=read('js/address-render.js');
const styles=read('styles.css'),ticketsRender=read('js/tickets-render.js');

assert.match(domain,/MT_TOOLS_DRAFT_KEY/);assert.match(domain,/toolsCalculatorDraft=\{state:JSON\.parse/);assert.match(domain,/Повернутися до заявки/);assert.match(domain,/fillFormFromState\(\)/,'calculator draft is restored into the same form');
assert.match(editor,/setGeoLink\(link,coords\)/);assert.match(editor,/calcState\.geoLat=Number/,'coordinate input also populates the internal-map source');
assert.match(address,/На карті \/ Уточнити/,'existing coordinate is presented as one map location');
const homes=core.mapObjects([{id:'1',city:'Курахове',street:'Миру',house:'1',apartment:'1',geoLink:'50.1,30.2'},{id:'2',city:'Курахове',street:'Миру',house:'1',apartment:'2',geoLat:50.1,geoLng:30.2},{id:'3',city:'Курахове',street:'Нова',house:'2',geoLink:'https://maps.app.goo.gl/opaque'}],[]).filter(item=>item.kind==='home');
assert.equal(homes.length,1,'coordinate variants share one house marker and opaque short link is not fabricated');

const point=core.normalizeNetworkPoint({type:'Муфта',name:'Муфта біля опори',city:'Курахове',street:'Академіка Павлова',house:'опора 7',lat:47.99,lng:37.25,note:'ОСИ',photoKeys:['idb:1','idb:2']},new Date('2026-08-31T10:00:00Z'));
assert.equal(core.networkPointAddress(point),'Курахове, Академіка Павлова, опора 7');assert.equal(point.photoKeys.length,2);assert.equal(core.searchNetworkPoints([point],'академіка').length,1);assert.equal(core.searchNetworkPoints([point],'оси').length,1);
assert.match(domain,/map-add-object/);assert.match(domain,/FOB|Муфта/);assert.match(domain,/map-my-location/);assert.match(map,/showUserLocation/);assert.match(map,/accuracy/);
assert.match(domain,/Зберегти і надіслати в Telegram/);assert.ok(domain.indexOf('toolsSaveNetworkPoints()')<domain.indexOf('if(send)await toolsSendNetworkPointTelegram'),'local save precedes optional Telegram transport');
assert.match(domain,/multiple/);assert.match(domain,/slice\(0,3\)/);assert.match(domain,/toolsNetworkSearch/);

const estimate=core.estimateOfflineArea({minLat:48,minLng:37,maxLat:48.1,maxLng:37.1},10,12);assert.ok(estimate.tiles>0&&estimate.bytes>0);
const areaA=core.normalizeOfflineArea({id:'a',name:'Дніпро',minLat:48,minLng:37,maxLat:48.1,maxLng:37.1,minZoom:10,maxZoom:16},new Date('2026-08-31T10:00:00Z')),areaB=core.normalizeOfflineArea({id:'b',name:'Слобожанське',minLat:48.4,minLng:35,maxLat:48.6,maxLng:35.3,minZoom:11,maxZoom:16},new Date('2026-08-31T11:00:00Z'));
assert.deepEqual(core.sanitizeOfflineAreas([areaA,areaB]).map(item=>item.id),['a','b'],'multiple named areas survive normalization');assert.equal(core.sanitizeOfflineAreas([areaA,areaB].filter(item=>item.id!=='a')).length,1,'deleting one area keeps the other');
assert.ok(core.offlineBoundsOverlap(areaA,{minLat:47.9,minLon:36.9,maxLat:48.2,maxLon:37.2})>.9);assert.equal(core.offlineBoundsOverlap(areaA,{minLat:10,minLon:10,maxLat:11,maxLon:11}),0);
assert.match(domain,/Вибрати область/);assert.match(map,/root\.L\.rectangle/);assert.match(domain,/не робить масове завантаження з OpenStreetMap/);
assert.match(styles,/\.modal #modalBody\{[^}]*overflow-y:auto/);assert.match(styles,/\.tools-map-picker\{height:240px/);assert.match(styles,/max-width:600px[^}]*\.tools-map-picker\{height:280px/);assert.match(domain,/tools-point-editor-footer/);assert.match(domain,/toolsPointCancelBtn/);
assert.match(ticketsRender,/class="tc-details tc-collapsed"[\s\S]*class="tc-tags"/);assert.doesNotMatch(ticketsRender,/tc-tags-details/);
assert.match(domain,/Зберегти область/);assert.match(domain,/toolsSaveOfflineArea/);assert.match(domain,/toolsEditOfflineArea/);assert.match(domain,/toolsDeleteOfflineArea/);assert.match(domain,/toolsImportOfflineArea/);assert.match(domain,/Показати на карті/);assert.match(domain,/Тільки область збережена/);assert.match(domain,/Офлайн-карта встановлена/);assert.match(map,/drawBounds/);
console.log('PASS v80 draft return, unified geolocation, network-point UX, location and offline bounds');

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const data=read('js/data-utils.js'),editor=read('js/ticket-editor-domain.js'),tools=read('js/tools-domain.js'),core=require('../js/tools-core.js');
const context={URL};vm.createContext(context);vm.runInContext(data,context);

const raw='48.4501, 34.9833',direct=context.prepareGeoInput(raw);
assert.equal(direct.needsPicker,false);assert.equal(direct.coords.lat,48.4501);assert.equal(direct.link,'https://www.google.com/maps?q=48.4501,34.9833');
const query=context.prepareGeoInput('https://www.google.com/maps?q=48.4511,34.9844');
assert.equal(query.needsPicker,false);assert.equal(query.coords.lng,34.9844);
assert.equal(context.prepareGeoInput('https://maps.google.com/@48.4522,34.9855,17z').coords.lat,48.4522);
assert.equal(context.prepareGeoInput('https://maps.google.com/?ll=48.4533,34.9866').coords.lng,34.9866);

const short='https://maps.app.goo.gl/AbCdEf123',fallback=context.prepareGeoInput(short);
assert.equal(fallback.link,short,'short link is retained unchanged');assert.equal(fallback.coords,null,'no coordinates are fabricated');assert.equal(fallback.needsPicker,true);
assert.equal(context.isGoogleMapsShortLink('https://example.com/maps.app.goo.gl/x'),false,'arbitrary hosts are not treated as Google short links');
assert.equal(context.isGoogleMapsShortLink('javascript:maps.app.goo.gl/x'),false);
const other=context.prepareGeoInput('https://example.com/location');assert.equal(other.needsPicker,false);assert.equal(other.coords,null);assert.equal(other.link,'https://example.com/location');

assert.doesNotMatch(editor,/fetch\s*\([^)]*maps\.app\.goo\.gl/,'geo fallback never resolves short links over the network');
assert.match(editor,/Посилання збережено, але координати не визначено/);
assert.match(editor,/geoPasteRefineBtn[\s\S]*openTicketGeoPointPicker/,'draft fallback opens the existing map-picker flow directly');
assert.match(editor,/abonentGeoRefineBtn[\s\S]*openAbonentMapPointPicker\(ids\)/,'profile fallback opens its existing picker without address search');
assert.match(editor,/setGeoLink\(result\.link,result\.coords\)/,'ordinary coordinates keep the immediate local path');
assert.match(editor,/if\(coords\)\{calcState\.geoLat=/,'missing coordinates do not erase an existing confirmed point');
assert.match(tools,/function openTicketGeoPointPicker\(\)[\s\S]*MTToolsMap\.mountPicker/);
assert.match(tools,/setGeoLink\(calcState\.geoLink,point\)/,'picker confirms the point while retaining the short link');
assert.match(tools,/if\(!picker\?\.hasChanged\(\)\)/,'an existing point is not overwritten without explicit movement and save');

const mapped=core.mapObjects([{id:'t1',city:'Дніпро',street:'Миру',house:'1',geoLink:short,geoLat:48.45,geoLng:34.98}],[]);
assert.equal(mapped.length,1);assert.equal(mapped[0].kind,'home');assert.equal(mapped[0].lat,48.45,'saved profile coordinates remain the mapObjects source');
console.log('PASS v89 short Google Maps links use a safe local picker fallback');

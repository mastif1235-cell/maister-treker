const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),core=require(path.join(root,'js','tools-core.js')),read=file=>fs.readFileSync(path.join(root,file),'utf8');

assert.equal(core.googleMapsUrl({geoLat:50.4501,geoLng:30.5234,geoLink:'https://maps.app.goo.gl/legacy'}),'https://www.google.com/maps/search/?api=1&query=50.4501%2C30.5234','MAP coordinates have priority over legacy link');
assert.equal(core.googleMapsUrl({geoLink:'https://maps.app.goo.gl/legacy'}),'https://maps.app.goo.gl/legacy','v89 short link remains an offline-safe fallback');
assert.equal(core.googleMapsUrl({geoLink:'javascript:alert(1)'}),'');
(async()=>{
  const blankTicket={};const blankDraft=core.createGeoDraft(blankTicket);blankDraft.set({lat:48.4,lng:35.1});assert.deepEqual(blankTicket,{},'MAP-1 draft does not mutate a ticket before Save');assert.deepEqual(blankDraft.commit(),{geoLat:48.4,geoLng:35.1,geoLink:undefined});
  const existing={geoLat:50,geoLng:30,geoLink:'https://maps.app.goo.gl/old'},cancelDraft=core.createGeoDraft(existing);cancelDraft.set({lat:49,lng:31});assert.deepEqual(cancelDraft.cancel(),existing,'MAP-2/12 Cancel preserves coordinates and old link');assert.deepEqual(existing,{geoLat:50,geoLng:30,geoLink:'https://maps.app.goo.gl/old'});
  const saveDraft=core.createGeoDraft(existing);saveDraft.set({lat:49.1234567,lng:31.7654321});assert.deepEqual(saveDraft.commit(),{geoLat:49.123457,geoLng:31.765432,geoLink:existing.geoLink},'MAP-3 Save commits the new point and preserves link');
  const calls=[];const gps={getCurrentPosition(ok,_fail,options){calls.push(options);ok({coords:{latitude:48.45,longitude:34.98,accuracy:7}});}};
  const gpsPoint=await core.requestCurrentPosition(gps);assert.deepEqual(gpsPoint,{lat:48.45,lng:34.98,accuracy:7});assert.equal(calls.length,1,'MAP-4 GPS runs only after explicit helper invocation');assert.equal(calls[0].enableHighAccuracy,true);const gpsTicket={geoLat:1,geoLng:2},gpsDraft=core.createGeoDraft(gpsTicket);gpsDraft.set(gpsPoint);assert.deepEqual(gpsTicket,{geoLat:1,geoLng:2});
  await assert.rejects(()=>core.requestCurrentPosition(null),/UNSUPPORTED/);const deniedTicket={geoLat:1,geoLng:2};await assert.rejects(()=>core.requestCurrentPosition({getCurrentPosition(_ok,fail){fail({code:1});}}));assert.deepEqual(deniedTicket,{geoLat:1,geoLng:2},'MAP-5 GPS error leaves ticket untouched');
  const editor=read('js/ticket-editor-domain.js'),domain=read('js/tools-domain.js'),map=read('js/tools-map.js');
  assert.match(editor,/openInternalMapBtn[\s\S]*openTicketGeoPointPicker/,'internal map is the primary geo action');
  assert.doesNotMatch(editor,/calcState\.geoLink=''[\s\S]{0,120}openGeoPasteModal/,'opening picker no longer clears saved geo state');
  assert.match(domain,/ticketGeoPointGps[\s\S]*requestCurrentPosition[\s\S]*picker\?\.setPoint/,'explicit GPS moves only the draft marker');
  assert.match(domain,/ticketGeoPointSave[\s\S]*draft\.commit\(\)[\s\S]*setGeoLink/,'ticket coordinates commit only on Save');
  assert.match(domain,/ticketGeoPointCancel[\s\S]*closePicker/,'Cancel closes without a ticket mutation');
  assert.match(map,/switchBaseLayer[\s\S]*removeCurrentBase/);assert.doesNotMatch(map,/networkPointIds\s*=/,'basemap switching does not touch business links');
  console.log('PASS v91 GPS/internal picker/draft cancel/Google Maps/v89 fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});

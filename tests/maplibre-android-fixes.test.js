'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const adapter=read('js/tools-map-maplibre.js'),map=read('js/tools-map.js'),domain=read('js/tools-domain.js'),ui=read('js/ui-orchestration.js');

assert.match(adapter,/type:'symbol',source:'mt-objects'/,'objects use a symbol layer, not anonymous circles');
for(const category of ['private','apartment','FOB','Муфта','Вузол','Інше'])assert.ok(adapter.includes(category),`marker type ${category} remains represented`);
assert.doesNotMatch(adapter,/new gl\.FullscreenControl/,'the app owns the single fullscreen control');
assert.match(map,/MTToolsMapLibreAdapter\.selectBounds\(onDone\)/);assert.match(map,/MTToolsMapLibreAdapter\.drawBounds\(value\)/);
assert.match(adapter,/selectionGeoJson/);assert.match(adapter,/mt-selection-line/);
assert.match(domain,/function toolsLeaveOfflineSettings/);assert.match(ui,/toolsLeaveOfflineSettings\(\)/,'leaving Tools clears transient offline settings state');
const leaveBody=domain.slice(domain.indexOf('function toolsLeaveOfflineSettings'),domain.indexOf('function openOfflineMapSettings'));
assert.doesNotMatch(leaveBody,/save|remove|delete/i,'offline-settings exit changes no saved data');
assert.match(adapter,/handleConnectivityChange/);assert.match(adapter,/navigator\?\.onLine===false\?'offline'/);
assert.match(adapter,/Офлайн-карта не встановлена\. Імпортуйте файл \.pmtiles/);
assert.match(domain,/!MTToolsMap\.handleConnectivityChange\?\.\(\)/,'auto switching stays in-place for MapLibre');
assert.match(map,/return'leaflet'/,'ordinary URL still defaults to Leaflet');
console.log('PASS MapLibre Android marker/fullscreen/bounds/navigation/offline-switch regressions');

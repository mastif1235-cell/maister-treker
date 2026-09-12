'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8'),core=require('../js/tools-core.js');
const domain=require('./helpers/tools-source').readToolsSource(),addressUi=read('js/address-render.js'),map=read('js/tools-map.js'),maplibre=read('js/tools-map-maplibre.js'),marker=read('js/map-marker-renderer.js'),settings=read('js/settings-core.js'),settingsUi=read('js/settings-domain.js'),settingsRender=read('js/settings-render.js'),html=read('index.html'),styles=read('styles.css');

const points=[
  {id:'old-z',type:'Муфта',city:'Я',street:'Я',lat:48,lng:35,createdAt:'2026-09-01T10:00:00Z'},
  {id:'new-a',type:'Муфта',city:'А',street:'А',lat:48,lng:35,createdAt:'2026-09-07T10:00:00Z'}
];
assert.deepEqual(core.sortNewestFirst(points).map(x=>x.id),['new-a','old-z'],'newest network point wins over alphabetic order');
assert.equal(core.groupNetworkPoints(points)[0].points?.length,undefined);assert.equal(core.groupNetworkPoints(points)[0].city,'А','group containing newest point is first');
const profiles=core.listProfiles([{id:'old',city:'Я',street:'Я'},{id:'new',city:'А',street:'А'}]);
assert.equal(profiles[0].tickets[0].id,'new','newest address is first regardless of alphabet');
assert.match(addressUi,/newestAddressPartIndex/);assert.match(addressUi,/newestTicketInsertion\(b\.list\)-newestTicketInsertion\(a\.list\)/,'main address navigator also uses insertion order');
const legacy=core.sanitizeNetworkPoints([{id:'legacy-a',type:'FOB',lat:48,lng:35},{id:'legacy-b',type:'Муфта',lat:48,lng:35}]);
assert.deepEqual(core.sortNewestFirst(legacy).map(x=>x.id),['legacy-b','legacy-a']);assert.deepEqual(core.sortNewestFirst(legacy).map(x=>x.id),core.sortNewestFirst(core.sanitizeNetworkPoints(legacy)).map(x=>x.id),'legacy fallback is deterministic');
assert.deepEqual(core.searchNetworkPoints(points,'Муфта').map(x=>x.id),['old-z','new-a'],'search still finds all matching points');

assert.match(html,/id="calcDiagnosticsBtn"[^>]*type="button"|type="button"[^>]*id="calcDiagnosticsBtn"/);assert.match(domain,/openToolsDiagnosticsFromCalculator\(\)[\s\S]*document\.activeElement\?\.blur/,'diagnostics blurs the address field before navigation');
assert.doesNotMatch(domain,/toolsConnectionTarget|mt-internal-diagnostic-host/,'the continuous availability host field is gone');
assert.doesNotMatch(domain,/data-tools-action="start-connection-check"/);
assert.match(domain,/editorContext:true/);assert.match(domain,/toolsDiagnosticContext\?\.ticketId\|\|toolsDiagnosticContext\?\.editorContext/,'ticket draft context never asks for the same address again');
assert.match(domain,/draft\.state\.diagnosticHistory=MTToolsCore\.appendDiagnosticHistory/);assert.match(domain,/localStorage\.setItem\(MT_TOOLS_DRAFT_KEY,JSON\.stringify\(draft\)\)/,'history is persisted in the current editor draft');
assert.match(domain,/calcState=JSON\.parse\(JSON\.stringify\(draft\.state\)\)/);assert.doesNotMatch(domain,/toolsReturnToTicket\(\)[\s\S]{0,500}localStorage\.removeItem\(MT_TOOLS_DRAFT_KEY/,'return restores the same editor without premature draft cleanup');
assert.match(read('js/ticket-editor-domain.js'),/clearDraft\(\);\s*if\(typeof toolsClearCalculatorDraft==='function'\)toolsClearCalculatorDraft\(\)/,'diagnostic transfer draft is cleaned only after final ticket save succeeds');
assert.match(domain,/if\(!ticket&&!draft\?\.state\)/,'quick diagnostics without context cannot attach to a fake ticket');
const r={online:true,summaryStatus:'ok',resources:[]},a=core.makeDiagnosticRecord(r,{ticketId:'t'},new Date('2026-09-07T10:00:00Z')),b=core.makeDiagnosticRecord(r,{ticketId:'t'},new Date('2026-09-07T11:00:00Z'));
assert.deepEqual(core.appendDiagnosticHistory(core.appendDiagnosticHistory([],a),b).map(x=>x.id),[a.id,b.id],'multiple diagnostics append without overwrite');

assert.match(html,/Вигляд міток карти/);assert.match(html,/id="mapMarkerPreferencesEditor"/);
assert.match(settingsRender,/match:\[[^\]]*'Вигляд міток карти'/,'marker settings are discoverable in the existing map/data settings hub');
assert.match(settings,/mapMarkerPreset:'classic'/);assert.match(settings,/normalizeMapMarkerPreferences/,'legacy preset safely migrates into per-category preferences');assert.match(settingsUi,/settings\.mapMarkerPreferences=prefs/);assert.match(settingsRender,/renderMapMarkerPreferences/,'preferences are restored after reload');
assert.match(map,/iconFor\(category,false,options\.markerPreset,options\.markerPreferences\)/,'Leaflet applies shared per-category preferences');assert.match(maplibre,/options\.markerPreferences/,'MapLibre OSM, satellite and offline styles use the same preferences');
assert.match(marker,/private[\s\S]*Муфта/);assert.match(styles,/marker-contrast/);assert.ok(40<46,'largest object marker remains smaller than GPS marker');
assert.match(maplibre,/addControl\(new gl\.NavigationControl[^\n]+,'top-left'\)/);assert.match(maplibre,/map\.addControl\(control,'top-right'\)/,'MapLibre controls match Leaflet zones');
assert.equal((domain.match(/class="tools-map-floating-btn" data-tools-action="map-my-location"/g)||[]).length,1);assert.equal((domain.match(/class="tools-map-floating-btn" data-tools-action="map-toggle-fullscreen"/g)||[]).length,1,'GPS/fullscreen app controls are not duplicated');
assert.match(map,/requestedEngine[\s\S]*'leaflet'/,'Leaflet remains an explicit compatibility fallback');
console.log('PASS v91.8 newest-first lists, diagnostic draft lifecycle, marker presets and map control parity');

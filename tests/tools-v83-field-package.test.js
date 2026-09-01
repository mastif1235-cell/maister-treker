'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const domain=read('js/tools-domain.js'),map=read('js/tools-map.js'),styles=read('styles.css'),html=read('index.html'),settings=read('js/settings-domain.js'),core=read('js/tools-core.js');

const home=domain.slice(domain.indexOf('function toolsHomeHtml'),domain.indexOf('function toolsBackButton'));
const mapHtml=domain.slice(domain.indexOf('function toolsMapHtml'),domain.indexOf('function toolsNetworkGroupsHtml'));
assert.doesNotMatch(home,/Офлайн-карта/,'offline manager is removed from the Tools home');
assert.match(html,/id="openOfflineMapSettingsBtn"/);assert.match(settings,/openOfflineMapSettings/);
assert.doesNotMatch(mapHtml,/tools-offline-map-card|delete-offline-map|toolsMapBaseMode/,'working map has status only, not offline management');
assert.match(domain,/Збережена область[\s\S]*окремий файл \.pmtiles/);assert.match(domain,/JSON області не є картою/);
assert.match(domain,/Офлайн-карта не встановлена/);assert.match(domain,/Збережена лише область/);assert.match(domain,/Офлайн-карта встановлена/);

assert.match(mapHtml,/map-toggle-fullscreen/);assert.match(domain,/function toolsToggleMapFullscreen/);assert.match(map,/function invalidateSize/);assert.match(styles,/\.tools-map-shell\.tools-map-fullscreen/);assert.match(styles,/safe-area-inset-top/);
assert.match(mapHtml,/map-my-location/);assert.match(mapHtml,/map-add-object/);

const toggle=domain.slice(domain.indexOf("root.addEventListener('toggle'"),domain.indexOf("root.addEventListener('input'"));
assert.ok(toggle.indexOf('[data-network-street]')<toggle.indexOf('[data-network-city]'),'street toggle is handled before its parent city');
assert.match(domain,/tools-network-object/);assert.match(domain,/toolsShowNetworkPoint/);assert.match(domain,/toolsPointPhotoPreview/);assert.match(domain,/Показати на карті/);

const binding=domain.slice(domain.indexOf('function toolsBindAddressFromMap'),domain.indexOf('function toolsBoundsLabel'));
assert.doesNotMatch(binding,/currentCenter/,'selecting an address never captures the map center automatically');
assert.match(binding,/Зберегти координати/);assert.match(binding,/toolsOpenAddressBindingPicker/);assert.match(binding,/toolsAddressPickerGps/);
assert.ok(binding.indexOf('await saveTickets()')>binding.indexOf('toolsAddressPickerSave'),'coordinates persist only in the explicit save handler');

assert.match(domain,/toolsDiagnosticsProfileSearch/);assert.match(domain,/profile\.city,profile\.street,profile\.house,profile\.apartment,profile\.address/);
assert.match(domain,/Відгук інтернету/);assert.match(domain,/Стабільність відгуку/);assert.match(domain,/Що означають ці показники\?/);assert.match(domain,/не звичайний ICMP Ping/);
assert.match(core,/Відгук інтернету/);assert.match(core,/Стабільність відгуку/);

assert.match(styles,/\.naryad-editor-overlay #modalBody\{[^}]*padding:2px/);assert.match(styles,/\.naryad-editor-textarea:focus/);
console.log('PASS v83 offline settings, fullscreen map, network hierarchy, explicit address binding, diagnostics and naryad UI');

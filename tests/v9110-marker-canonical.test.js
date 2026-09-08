'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),renderer=require('../js/map-marker-renderer.js');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const categories=['private','apartment','FOB','Муфта','Вузол','Інше'];
for(const category of categories){for(const shape of renderer.SHAPES){const small=renderer.imageData(category,{shape,size:'small'}),medium=renderer.imageData(category,{shape,size:'medium'}),large=renderer.imageData(category,{shape,size:'large'});assert.equal(small.descriptor.shape,shape);assert.equal(medium.descriptor.category,category);assert.ok(small.width<medium.width&&medium.width<large.width);assert.ok(small.height<medium.height&&medium.height<large.height);assert.equal(medium.data.some((value,index)=>index%4!==3&&value===255),true,'canonical bitmap keeps white outline/icon');}}
assert.notDeepEqual([...renderer.imageData('private',{shape:'drop'}).data],[...renderer.imageData('FOB',{shape:'drop'}).data],'category icon mapping remains distinct');
assert.deepEqual(renderer.preference({shape:'invalid',size:'huge'}),{shape:'drop',size:'medium'});
const settings=read('js/settings-render.js'),maplibre=read('js/tools-map-maplibre.js'),leaflet=read('js/tools-map.js');
assert.match(settings,/MTMapMarkerRenderer[\s\S]*renderer\?\.dataUrl/,'Settings preview uses canonical renderer');
assert.match(maplibre,/MARKER_RENDERER\.imageData/,'MapLibre image registration uses canonical renderer');
assert.match(leaflet,/MTMapMarkerRenderer\.dataUrl/,'Leaflet fallback uses canonical renderer');
assert.doesNotMatch(settings,/shape-badge|border-radius:24%/,'Settings does not duplicate marker geometry');
assert.match(maplibre,/icon-image[^\n]+\['get','icon'\]/);assert.doesNotMatch(maplibre,/markerScale/,'size is baked into the complete canonical geometry');
assert.match(maplibre,/createOsmStyle/);assert.match(maplibre,/createSatelliteStyle/);assert.match(maplibre,/currentBase==='offline'/);assert.match(maplibre,/restoreApplicationOverlays=.*restoreObjects/);assert.match(maplibre,/map\.on\('style\.load',handleStyleLifecycle\)/,'canonical overlay is restored after every basemap style change');
console.log('PASS canonical marker geometry is shared by preview, MapLibre all basemaps and Leaflet fallback');

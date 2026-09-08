'use strict';
const assert=require('node:assert/strict');

(async()=>{
  const {createOfflineVectorLayers}=await import(`../js/tools-map-maplibre.js?cartography=${Date.now()}`);
  const schema=['boundaries','buildings','earth','landcover','landuse','places','pois','roads','transit','water'].map(id=>({id}));
  const layers=createOfflineVectorLayers('offline',schema);
  const byId=id=>layers.find(layer=>layer.id===id);

  for(const id of ['mt-offline-earth','mt-offline-water-fill','mt-offline-buildings','mt-offline-roads-highway','mt-offline-roads-major','mt-offline-roads-minor','mt-offline-place-labels','mt-offline-road-labels'])assert.ok(byId(id),`missing ${id}`);
  assert.equal(byId('mt-offline-water-fill').paint['fill-color'],'#b8d8ea');
  assert.equal(byId('mt-offline-buildings').minzoom,13);
  assert.equal(byId('mt-offline-place-labels').layout['text-field'][1][1],'name:uk');
  assert.deepEqual(byId('mt-offline-place-labels').layout['text-font'],['Arial','Roboto','Noto Sans','sans-serif']);
  assert.ok(layers.indexOf(byId('mt-offline-water-fill'))<layers.indexOf(byId('mt-offline-roads-highway')),'water renders below roads');
  assert.ok(layers.indexOf(byId('mt-offline-buildings'))<layers.indexOf(byId('mt-offline-road-labels')),'labels render above geometry');
  assert.ok(layers.every(layer=>layer.source==='offline'&&schema.some(item=>item.id===layer['source-layer'])),'style only references actual Protomaps source layers');
  assert.ok(layers.every(layer=>!JSON.stringify(layer).includes('http')),'offline cartography has no remote dependency');
  assert.deepEqual(createOfflineVectorLayers('offline',[{id:'roads'}]).map(layer=>layer['source-layer']),Array(6).fill('roads'),'missing optional layers are ignored safely');
  console.log('PASS readable Protomaps v4 offline cartography uses local fonts and no remote assets');
})().catch(error=>{console.error(error);process.exitCode=1;});

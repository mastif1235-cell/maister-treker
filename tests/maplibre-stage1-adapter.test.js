'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

(async()=>{
  const module=await import(`../js/tools-map-maplibre.js?test=${Date.now()}`);
  const calls={controls:[],events:{},rotation:0,resizes:0,removed:0,ease:null};
  class FakeMap{
    constructor(options){this.options=options;this.touchZoomRotate={enable(){calls.rotation++;},enableRotation(){calls.rotation++;}};}
    addControl(control,position){calls.controls.push([control.constructor.name,position]);}
    on(name,callback){calls.events[name]=callback;}
    getCenter(){return{lat:48.5,lng:35.1};}
    getZoom(){return 9;}
    getBearing(){return 27;}
    resize(){calls.resizes++;}
    easeTo(options){calls.ease=options;}
    remove(){calls.removed++;}
  }
  class NavigationControl{} class FullscreenControl{} class AttributionControl{}
  const fakeGl={Map:FakeMap,NavigationControl,FullscreenControl,AttributionControl};
  const fakeRoot={document:{createElement:()=>({getContext:name=>name==='webgl2'?{}:null})},requestAnimationFrame:callback=>callback()};
  const adapter=module.createMapLibreAdapter(fakeGl,fakeRoot);
  const mounted=adapter.mount({id:'map'},[],{initialView:{lat:48,lng:35,zoom:8,bearing:12}});
  assert.ok(mounted);
  assert.equal(mounted.options.dragRotate,true);
  assert.equal(mounted.options.touchZoomRotate,true);
  assert.deepEqual(mounted.options.center,[35,48]);
  assert.equal(mounted.options.bearing,12);
  assert.equal(mounted.options.style.sources.osm.tiles[0],'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(calls.rotation,2);
  assert.deepEqual(calls.controls.map(item=>item[0]),['NavigationControl','FullscreenControl','AttributionControl']);
  assert.deepEqual(adapter.captureView(),{lat:48.5,lng:35.1,zoom:9,bearing:27});
  assert.equal(adapter.focusPoint({lat:49,lng:36},16),true);
  assert.deepEqual(calls.ease,{center:[36,49],zoom:16});
  assert.equal(adapter.resize(),true);
  adapter.destroy();
  assert.equal(calls.removed,1);

  const html=read('index.html'),tools=read('js/tools-map.js'),sw=read('sw.js');
  assert.match(html,/vendor\/maplibre\/maplibre-gl\.css/);
  assert.match(html,/type="module" src="js\/tools-map-maplibre\.js"/);
  assert.match(html,/connect-src[^;"]*https:\/\/tile\.openstreetmap\.org/);
  assert.doesNotMatch(html,/cdn[^"']*maplibre/i);
  assert.match(tools,/options\.engine===['"]maplibre['"]/);
  assert.match(tools,/if\(view\)savedView=\{lat:view\.lat,lng:view\.lng,zoom:view\.zoom\}/);
  assert.match(tools,/hasLeaflet\(\)/);
  assert.match(html,/vendor\/leaflet\/leaflet\.js/);
  for(const asset of ['js/tools-map-maplibre.js','vendor/maplibre/maplibre-gl.css','vendor/maplibre/maplibre-gl.mjs','vendor/maplibre/maplibre-gl-shared.mjs','vendor/maplibre/maplibre-gl-worker.mjs'])assert.ok(sw.includes(`./${asset}`),`SW missing ${asset}`);
  const adapterSource=read('js/tools-map-maplibre.js');
  assert.match(adapterSource,/setWorkerUrl\(WORKER_URL\)/);
  assert.doesNotMatch(adapterSource,/MapTiler|apiKey|localStorage|indexedDB/);
  console.log('PASS MapLibre stage-1 adapter, local assets, native rotation/controls, OSM and Leaflet fallback wiring');
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

(async()=>{
  const module=await import(`../js/tools-map-maplibre.js?test=${Date.now()}`);
  const calls={controls:[],events:{},rotation:0,resizes:0,removed:0,ease:null,sources:{},layers:[],markers:[]};
  class FakeMap{
    constructor(options){this.options=options;this.touchZoomRotate={enable(){calls.rotation++;},enableRotation(){calls.rotation++;}};}
    addControl(control,position){calls.controls.push([control.constructor.name,position]);}
    on(name,callback){calls.events[name]=callback;}
    getCenter(){return{lat:48.5,lng:35.1};}
    getZoom(){return 9;}
    getBearing(){return 27;}
    isStyleLoaded(){return true;}
    getSource(id){return calls.sources[id]||null;}
    addSource(id,source){calls.sources[id]={...source,setData(data){this.data=data;}};}
    addLayer(layer){calls.layers.push(layer);}
    panTo(center){calls.pan=center;}
    off(name){delete calls.events[name];}
    resize(){calls.resizes++;}
    easeTo(options){calls.ease=options;}
    remove(){calls.removed++;}
  }
  class FakeMarker{constructor(options){this.options=options;calls.markers.push(this);this.events={};}setLngLat(value){this.value={lng:value[0],lat:value[1]};return this;}getLngLat(){return this.value;}addTo(){return this;}on(name,callback){this.events[name]=callback;return this;}remove(){this.removed=true;}}
  class NavigationControl{} class FullscreenControl{} class AttributionControl{}
  const fakeGl={Map:FakeMap,Marker:FakeMarker,NavigationControl,FullscreenControl,AttributionControl};
  const makeElement=()=>({className:'',title:'',textContent:'',children:[],appendChild(child){this.children.push(child);},getContext:name=>name==='webgl2'?{}:null});
  const fakeRoot={document:{createElement:makeElement},requestAnimationFrame:callback=>callback()};
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
  assert.equal(adapter.showUserLocation({lat:48.7,lng:35.2},25),true);
  assert.ok(calls.sources['mt-user-accuracy']);
  assert.ok(calls.layers.some(layer=>layer.id==='mt-user-accuracy-fill'));
  const placement=adapter.startPointPlacement({onPlace:point=>{calls.placed=point;}});calls.events.click({lngLat:{lat:48.8,lng:35.3}});assert.deepEqual(placement.getPoint(),{lat:48.8,lng:35.3});assert.deepEqual(calls.placed,{lat:48.8,lng:35.3});placement.cancel();
  const picker=adapter.mountPicker({id:'picker'},{initial:{lat:48.4,lng:35.4}});assert.deepEqual(picker.getPoint(),{lat:48.4,lng:35.4});picker.setPoint({lat:48.6,lng:35.6},false);assert.equal(picker.hasChanged(),true);assert.deepEqual(picker.getPoint(),{lat:48.6,lng:35.6});picker.destroy();
  adapter.destroy();
  assert.equal(calls.removed,2);

  const html=read('index.html'),tools=read('js/tools-map.js'),sw=read('sw.js');
  assert.match(html,/vendor\/maplibre\/maplibre-gl\.css/);
  assert.match(html,/type="module" src="js\/tools-map-maplibre\.js"/);
  assert.match(html,/connect-src[^;"]*https:\/\/tile\.openstreetmap\.org/);
  assert.doesNotMatch(html,/cdn[^"']*maplibre/i);
  assert.match(tools,/options\.engine===['"]maplibre['"]/);
  assert.match(tools,/MTToolsMapLibreAdapter\.showUserLocation/);
  assert.match(tools,/MTToolsMapLibreAdapter\.startPointPlacement/);
  assert.match(tools,/MTToolsMapLibreAdapter\.mountPicker/);
  assert.match(tools,/if\(view\)savedView=\{lat:view\.lat,lng:view\.lng,zoom:view\.zoom\}/);
  assert.match(tools,/hasLeaflet\(\)/);
  assert.match(html,/vendor\/leaflet\/leaflet\.js/);
  for(const asset of ['js/tools-map-maplibre.js','vendor/maplibre/maplibre-gl.css','vendor/maplibre/maplibre-gl.mjs','vendor/maplibre/maplibre-gl-shared.mjs','vendor/maplibre/maplibre-gl-worker.mjs'])assert.ok(sw.includes(`./${asset}`),`SW missing ${asset}`);
  const adapterSource=read('js/tools-map-maplibre.js');
  assert.match(adapterSource,/setWorkerUrl\(WORKER_URL\)/);
  assert.doesNotMatch(adapterSource,/MapTiler|apiKey|localStorage|indexedDB/);
  console.log('PASS MapLibre stage-1/2 adapter, OSM, native controls, GPS accuracy, placement, picker and Leaflet fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});

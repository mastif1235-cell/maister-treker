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
    on(name,layerOrCallback,callback){calls.events[callback?`${name}:${layerOrCallback}`:name]=callback||layerOrCallback;}
    getCenter(){return{lat:48.5,lng:35.1};}
    getZoom(){return 9;}
    getBearing(){return 27;}
    isStyleLoaded(){return true;}
    getSource(id){return calls.sources[id]||null;}
    addSource(id,source){calls.sources[id]={...source,setData(data){this.data=data;}};}
    addLayer(layer){calls.layers.push(layer);}
    getLayer(id){return calls.layers.find(layer=>layer.id===id)||null;}
    setFilter(id,filter){calls.filters={...(calls.filters||{}),[id]:filter};}
    getCanvas(){return{style:{}};}
    panTo(center){calls.pan=center;}
    off(name,layerOrCallback){delete calls.events[typeof layerOrCallback==='string'?`${name}:${layerOrCallback}`:name];}
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
  const objects=[{id:'house-1',category:'private',lat:48.2,lng:35.2,profiles:[{address:'Адреса'}]},{id:'fob-1',kind:'network',category:'FOB',type:'FOB',name:'FOB-1',lat:48.3,lng:35.3}];
  const selectedCategories=new Set(['private','FOB']);
  const mounted=adapter.mount({id:'map'},objects,{initialView:{lat:48,lng:35,zoom:8,bearing:12},selectedCategories,onSelect:item=>{calls.selected=item;},onAddHere:point=>{calls.addHere=point;}});
  assert.ok(mounted);
  assert.equal(mounted.options.dragRotate,true);
  assert.equal(mounted.options.touchZoomRotate,true);
  assert.deepEqual(mounted.options.center,[35,48]);
  assert.equal(mounted.options.bearing,12);
  assert.equal(mounted.options.style.sources.osm.tiles[0],'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(calls.rotation,2);
  assert.deepEqual(calls.controls.map(item=>item[0]),['NavigationControl','FullscreenControl','AttributionControl']);
  calls.events.load();
  assert.equal(calls.sources['mt-objects'].data.features.length,2);
  assert.equal(calls.sources['mt-objects'].data.features[1].properties.category,'FOB');
  calls.events['click:mt-objects']({features:[{properties:{index:1}}]});assert.equal(calls.selected,objects[1]);
  calls.events.contextmenu({lngLat:{lat:48.9,lng:35.9}});assert.deepEqual(calls.addHere,{lat:48.9,lng:35.9});
  assert.deepEqual(calls.filters['mt-objects'],['in',['get','category'],['literal',['private','FOB']]]);
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
  console.log('PASS MapLibre stages 1-3 adapter, controls, GPS/picker, GeoJSON objects/filters and Leaflet fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});

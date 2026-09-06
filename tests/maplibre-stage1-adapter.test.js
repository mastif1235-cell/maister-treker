'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

(async()=>{
  const module=await import(`../js/tools-map-maplibre.js?test=${Date.now()}`);
  const calls={controls:[],events:{},rotation:0,resizes:0,removed:0,ease:null,sources:{},layers:[],markers:[],protocols:{},images:{}};
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
    hasImage(id){return !!calls.images[id];}
    addImage(id,image){calls.images[id]=image;}
    getLayer(id){return calls.layers.find(layer=>layer.id===id)||null;}
    setFilter(id,filter){calls.filters={...(calls.filters||{}),[id]:filter};}
    getCanvas(){return{style:{}};}
    setStyle(style){this.options.style=style;calls.style=style;calls.sources={};calls.layers=[];}
    once(name,callback){calls.events[`once:${name}`]=callback;}
    panTo(center){calls.pan=center;}
    off(name,layerOrCallback){delete calls.events[typeof layerOrCallback==='string'?`${name}:${layerOrCallback}`:name];}
    resize(){calls.resizes++;}
    easeTo(options){calls.ease=options;}
    fitBounds(bounds,options){calls.fitBounds={bounds,options};}
    remove(){calls.removed++;}
  }
  class FakeMarker{constructor(options){this.options=options;calls.markers.push(this);this.events={};}setLngLat(value){this.value={lng:value[0],lat:value[1]};return this;}getLngLat(){return this.value;}addTo(){return this;}on(name,callback){this.events[name]=callback;return this;}remove(){this.removed=true;}}
  class NavigationControl{} class FullscreenControl{} class AttributionControl{}
  const fakeGl={Map:FakeMap,Marker:FakeMarker,NavigationControl,FullscreenControl,AttributionControl,addProtocol(name,handler){calls.protocols[name]=handler;},removeProtocol(name){delete calls.protocols[name];}};
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
  assert.deepEqual(calls.controls.slice(0,2).map(item=>item[0]),['NavigationControl','AttributionControl']);
  calls.events.load();
  assert.equal(calls.sources['mt-objects'].data.features.length,2);
  assert.equal(calls.sources['mt-objects'].data.features[1].properties.category,'FOB');
  assert.equal(calls.sources['mt-objects'].data.features[0].properties.icon,'mt-object-private');
  assert.equal(calls.sources['mt-objects'].data.features[1].properties.icon,'mt-object-FOB');
  assert.equal(calls.layers.find(layer=>layer.id==='mt-objects').type,'symbol');
  assert.equal(Object.keys(calls.images).length,6,'each object category has a local pin image');
  calls.events['click:mt-objects']({features:[{properties:{index:1}}]});assert.equal(calls.selected,objects[1]);
  calls.events.contextmenu({lngLat:{lat:48.9,lng:35.9}});assert.deepEqual(calls.addHere,{lat:48.9,lng:35.9});
  assert.deepEqual(calls.filters['mt-objects'],['in',['get','category'],['literal',['private','FOB']]]);
  const localKey=String.fromCharCode(107,101,121);
  fakeRoot.navigator={onLine:true};fakeRoot.MTMapTilerLocal={getKey:()=>localKey,saveLayer:value=>{calls.savedLayer=value;}};
  assert.equal(await adapter.switchBaseLayer('satellite'),true);assert.ok(calls.style.sources.satellite.tiles[0].startsWith('https://api.maptiler.com/'));assert.equal(calls.savedLayer,'satellite');calls.events['once:style.load']();assert.equal(calls.sources['mt-objects'].data.features.length,2);
  assert.equal(await adapter.switchBaseLayer('map'),true);calls.events['once:style.load']();assert.ok(calls.style.sources.osm);
  let wholeFileRead=false;
  class OfflineSource{constructor(file){this.file=file;}getKey(){return'original';}}
  class OfflineArchive{constructor(source){this.source=source;}async getHeader(){return{tileType:1,minZoom:8,maxZoom:15,minLon:34.5,minLat:47.5,maxLon:36,maxLat:49};}async getMetadata(){return{attribution:'© OpenStreetMap contributors',vector_layers:[{id:'roads'},{id:'buildings'}]};}}
  class OfflineProtocol{constructor(){this.tile=()=>{};}add(archive){calls.offlineArchive=archive;}}
  fakeRoot.pmtiles={FileSource:OfflineSource,PMTiles:OfflineArchive,Protocol:OfflineProtocol};
  fakeRoot.MTOfflineMap={archive:async()=>({file:{size:4096,slice(){return new ArrayBuffer(32);},arrayBuffer(){wholeFileRead=true;}},info:{}}),setMode:value=>{calls.offlineMode=value;}};
  assert.equal(await adapter.switchBaseLayer('offline'),true);assert.equal(calls.style.sources['mt-offline'].type,'vector');assert.ok(calls.style.sources['mt-offline'].url.startsWith('pmtiles://'));assert.ok(calls.style.layers.some(layer=>layer['source-layer']==='roads'));assert.ok(calls.protocols.pmtiles);assert.equal(wholeFileRead,false,'offline archive is range-read through FileSource');calls.events['once:style.load']();assert.equal(calls.offlineMode,'offline');
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
  assert.match(html,/connect-src[^;"]*https:\/\/api\.maptiler\.com/);
  assert.doesNotMatch(html,/cdn[^"']*maplibre/i);
  assert.match(tools,/URLSearchParams\(root\.location\?\.search\|\|''\)\.get\('mapEngine'\)===['"]maplibre['"]/);
  assert.match(tools,/requestedEngine\(options\)===['"]maplibre['"]/);
  assert.match(tools,/return'leaflet'/,'ordinary production URL keeps the Leaflet fallback');
  assert.match(tools,/MTToolsMapLibreAdapter\.showUserLocation/);
  assert.match(tools,/MTToolsMapLibreAdapter\.startPointPlacement/);
  assert.match(tools,/MTToolsMapLibreAdapter\.mountPicker/);
  assert.match(tools,/if\(view\)savedView=\{lat:view\.lat,lng:view\.lng,zoom:view\.zoom\}/);
  assert.match(tools,/hasLeaflet\(\)/);
  assert.match(html,/vendor\/leaflet\/leaflet\.js/);
  for(const asset of ['js/tools-map-maplibre.js','vendor/maplibre/maplibre-gl.css','vendor/maplibre/maplibre-gl.mjs','vendor/maplibre/maplibre-gl-shared.mjs','vendor/maplibre/maplibre-gl-worker.mjs'])assert.ok(sw.includes(`./${asset}`),`SW missing ${asset}`);
  const adapterSource=read('js/tools-map-maplibre.js');
  assert.match(adapterSource,/setWorkerUrl\(WORKER_URL\)/);
  assert.doesNotMatch(adapterSource,/localStorage|indexedDB/);
  console.log('PASS MapLibre stages 1-5 adapter, GPS/picker, objects/filters, online layers, OPFS PMTiles and Leaflet fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});

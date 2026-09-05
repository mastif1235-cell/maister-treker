const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','tools-map.js'),'utf8');
const requests=[];
function layer(url,options){const events={};return{url,options,events,on(name,fn){events[name]=fn;return this;},addTo(map){this.map=map;map.layers.add(this);requests.push(url);return this;},remove(){this.map?.layers.delete(this);}};}
const L={tileLayer:layer,control:()=>({addTo(map){this.map=map;if(this.onAdd)this.node=this.onAdd(map);return this;},remove(){}}),DomUtil:{create:()=>({innerHTML:'',querySelectorAll:()=>[],addEventListener(){}})},DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}}};
const status={textContent:'',classList:{toggle(){}}},map={layers:new Set(),businessMarkers:new Set(['home','FOB']),hasLayer(value){return this.layers.has(value);},removeLayer(value){this.layers.delete(value);}};
let key='',remembered='map';
const context={console,L,navigator:{onLine:true},MTMapTilerLocal:{getKey:()=>key,hasKey:()=>!!key,getLayer:()=>remembered,saveLayer:value=>{remembered=value;}},MTOfflineMap:{getMode:()=> 'online'},addEventListener(){},window:null,globalThis:null,encodeURIComponent};context.window=context;context.globalThis=context;vm.createContext(context);vm.runInContext(source,context);
(async()=>{
  await context.MTToolsMap.addBaseLayer(map,status,'online');
  assert.equal(requests.length,1);assert.match(requests[0],/tile\.openstreetmap\.org/);
  assert.equal(context.MTToolsMap.switchBaseLayer(map,'satellite',status),false,'KEY-1 no satellite layer/request without key');assert.equal(requests.length,1);assert.equal(map.businessMarkers.size,2);
  key='device-key';assert.equal(context.MTToolsMap.switchBaseLayer(map,'satellite',status),true);assert.equal(requests.length,2);assert.match(requests[1],/hybrid-v4/);assert.match(requests[1],/key=device-key/,'KEY-2 local key reaches only official tile URL');
  const satellite=[...map.layers].find(item=>item.url.includes('hybrid-v4'));satellite.events.tileerror();
  assert.match(requests.at(-1),/tile\.openstreetmap\.org/,'KEY-8 tile error falls back to normal map');assert.equal(map.businessMarkers.size,2,'business markers survive base-layer error');assert.equal(remembered,'map');
  key='';remembered='satellite';requests.length=0;const second={...map,layers:new Set(),businessMarkers:new Set(['draft'])};await context.MTToolsMap.addBaseLayer(second,status,'online');assert.equal(requests.length,1);assert.match(requests[0],/tile\.openstreetmap\.org/,'KEY-7 remembered satellite without key safely falls back');assert.equal(second.businessMarkers.has('draft'),true);
  key='remembered-key';remembered='satellite';requests.length=0;const third={...map,layers:new Set(),businessMarkers:new Set(['home','node'])};await context.MTToolsMap.addBaseLayer(third,status,'online');assert.match(requests[0],/hybrid-v4/,'MAP-10 remembered satellite restores online when key exists');context.MTToolsMap.switchBaseLayer(third,'map',status);assert.deepEqual([...third.businessMarkers],['home','node'],'MAP-9/11 map switch preserves home and network markers without duplicates');
  console.log('PASS v91 map layer no-key/local-key/error/fallback/marker preservation');
})().catch(error=>{console.error(error);process.exitCode=1;});

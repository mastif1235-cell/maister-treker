'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
async function harness(mode='auto'){
 const {createMapLibreAdapter}=await import(process.env.MT_MAP_BASELINE_SOURCE||'../js/tools-map-maplibre.js');
 const events={},sources={},layers=[];
 class MapStub{
  constructor(options){this.options=options;this.touchZoomRotate={enable(){},enableRotation(){}};}
  addControl(c){c.onAdd?.();}on(n,l,c){events[n]=c||l;}off(){}getCenter(){return{lat:48,lng:35};}getZoom(){return 10;}getBearing(){return 0;}
  isStyleLoaded(){return true;}getSource(k){return sources[k];}addSource(k,v){sources[k]={...v,setData(data){this.data=data;}};}getLayer(k){return layers.find(l=>l.id===k);}addLayer(l){layers.push(l);}hasImage(){return true;}setFilter(){}setMaxZoom(){}setStyle(s){this.options.style=s;}resize(){}remove(){}
 }
 const element=()=>({textContent:'',classList:{toggle(){}},getContext:()=>({}),addEventListener(){},querySelectorAll:()=>[]});
 const status=element(),empty={visible:false,classList:{toggle(_c,hidden){empty.visible=!hidden;}}};
 const root={document:{createElement:element},navigator:{onLine:true},requestAnimationFrame:fn=>fn(),MTOfflineMap:{getMode:()=>mode,archive:async()=>null}};
 const adapter=createMapLibreAdapter({Map:MapStub,NavigationControl:class{},AttributionControl:class{}},root);
 const map=adapter.mount(element(),[],{statusNode:status,emptyStateNode:empty});return{adapter,map,events,status,empty};
}
test('M3 missing Offline action before delayed online load retains latest status and empty state',async()=>{
 const h=await harness();assert.equal(await h.adapter.switchBaseLayer('offline'),false);assert.match(h.status.textContent,/не встановлена/);h.events.load();h.events['style.load']();
 assert.match(h.status.textContent,/не встановлена/);assert.equal(h.empty.visible,true);assert.ok(h.map.options.style.sources.osm);h.adapter.destroy();
});
test('L5 manual Map before delayed offline mount load is not replaced by stale offline intent',async()=>{
 const h=await harness('offline');await h.adapter.switchBaseLayer('map');h.events.load();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.status.textContent,'');assert.equal(h.empty.visible,false);assert.ok(h.map.options.style.sources.osm);h.adapter.destroy();
});

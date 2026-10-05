'use strict';
const assert=require('node:assert/strict'),ruler=require('../js/map-ruler.js');
const a={lat:0,lng:0},b={lat:0,lng:1},c={lat:1,lng:1};
assert.ok(Math.abs(ruler.distance(a,b)-111195.08)<1);
assert.equal(ruler.distance(a,a),0);
assert.ok(Math.abs(ruler.distance({lat:0,lng:179.9},{lat:0,lng:-179.9})-22239.02)<1,'antimeridian takes shortest path');
assert.equal(ruler.format(999),'999 м');assert.equal(ruler.format(1234),'1.23 км');
const state=ruler.createState();assert.equal(state.add(a),false);assert.equal(state.activate(),true);state.add(a);state.add(b);state.add(c);
assert.ok(Math.abs(state.snapshot().distance-ruler.distance(a,b)-ruler.distance(b,c))<1e-6);
state.snapshot().points[0].lat=40;assert.equal(state.snapshot().points[0].lat,0,'snapshot cannot mutate the measurement');
assert.equal(state.add({lat:NaN,lng:0}),false);assert.equal(state.add({lat:91,lng:0}),false);
state.undo();assert.equal(state.snapshot().points.length,2);state.clear();assert.equal(state.snapshot().distance,0);assert.equal(state.isActive(),true);state.add(a);state.exit();assert.equal(state.isActive(),false);assert.deepEqual(state.snapshot().points,[]);
assert.equal(ruler.createState(()=>{},()=>false).activate(),false,'placement/selection blocks measurement');
function element(){const nodes={};return{nodes,style:{},listeners:{},innerHTML:'',querySelector(selector){return nodes[selector]||(nodes[selector]={setAttribute(k,v){this[k]=v;},disabled:false,hidden:false,textContent:''});},addEventListener(name,fn){this.listeners[name]=fn;},removeEventListener(name){delete this.listeners[name];},remove(){this.removed=true;}};}
for(const engine of ['leaflet','maplibre']){
 const container=element(),events={},sources={'real-objects':{data:'unchanged'},'real-gps':{data:'unchanged'}},layers={'real-objects':{id:'real-objects'},'real-gps':{id:'real-gps'}},ownGroups=[];
 const map={on(k,fn){(events[k]||=new Set()).add(fn);},off(k,fn){events[k]?.delete(fn);},getContainer:()=>container,isStyleLoaded:()=>true,addControl(c){c.onAdd();},removeControl(c){c.onRemove();},getSource:id=>sources[id],getLayer:id=>layers[id],addSource(id,s){sources[id]={...s,setData(data){this.data=data;}};},addLayer:l=>{layers[l.id]=l;},removeLayer:id=>{delete layers[id];},removeSource:id=>{delete sources[id];}};
 const emit=(k,v)=>[...(events[k]||[])].forEach(fn=>fn(v));
 const root={document:{createElement:element},L:{control:()=>({addTo(){this.onAdd();},remove(){this.removed=true;}}),DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}},layerGroup:()=>{const g={addTo(){ownGroups.push(this);return this;},remove(){this.removed=true;}};return g;},polyline:()=>({addTo(){}}),circleMarker:()=>({addTo(){}})}};
 const before=JSON.stringify({sources,layers}),controller=ruler.attach(map,engine,root);controller.activate();emit('click',engine==='leaflet'?{latlng:a}:{lngLat:a});emit('click',engine==='leaflet'?{latlng:b}:{lngLat:b});assert.equal(controller.snapshot().points.length,2);
 if(engine==='maplibre'){assert.equal(sources['mt-ruler'].data.features.length,3);for(const id of ['mt-ruler-line','mt-ruler-points'])delete layers[id];delete sources['mt-ruler'];emit('style.load');assert.equal(sources['mt-ruler'].data.features.length,3,'style switch restores only transient ruler overlays');}
 controller.undo();assert.equal(controller.snapshot().points.length,1);controller.clear();assert.equal(controller.snapshot().distance,0);controller.exit();assert.equal(JSON.stringify({sources,layers}),before,'real objects/GPS untouched by clear and exit');
 if(engine==='leaflet')assert(ownGroups.every(g=>g.removed),'only measurement groups are removed');controller.destroy();assert.equal(events.click.size,0);assert.equal(controller.isActive(),false);
}
console.log('PASS ruler: distance/total/units/undo/clear/exit; Leaflet+MapLibre clicks, style restore, own-overlay cleanup, no real object/GPS mutation');

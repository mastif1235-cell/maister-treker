'use strict';
const assert=require('node:assert/strict');

(async()=>{
  const {createOfflineVectorLayers}=await import(`../js/tools-map-maplibre.js?cartography=${Date.now()}`);
  const schema=['boundaries','buildings','earth','landcover','landuse','places','pois','roads','water'].map(id=>({id,fields:id==='buildings'?{addr_housenumber:'String'}:{}}));
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
  assert.deepEqual(createOfflineVectorLayers('offline',[{id:'roads'}]).map(layer=>layer['source-layer']),Array(7).fill('roads'),'missing optional layers are ignored safely');
  const house=byId('mt-offline-house-numbers'),local=byId('mt-offline-road-labels-local'),major=byId('mt-offline-road-labels');
  assert.equal(house['source-layer'],'buildings');assert.equal(house.minzoom,16);
  assert.deepEqual(house.layout['text-field'],['get','addr_housenumber']);
  assert.equal(house.layout['text-padding'],.5);assert.equal(house.paint['text-halo-color'],'#ffffff');
  assert.equal(house.layout['text-allow-overlap'],false);assert.equal(house.layout['text-ignore-placement'],true);
  assert.ok(!createOfflineVectorLayers('offline',[{id:'buildings',fields:{height:'Number'}}]).some(l=>l.id==='mt-offline-house-numbers'),'unsupported schema does not invent a house-number field');
  function evalExpr(e,p,type){if(!Array.isArray(e))return e;const args=e.slice(1);switch(e[0]){case'get':return p[args[0]];case'has':return Object.hasOwn(p,args[0]);case'geometry-type':return type;case'literal':return args[0];case'all':return args.every(a=>evalExpr(a,p,type));case'any':return args.some(a=>evalExpr(a,p,type));case'!':return!evalExpr(args[0],p,type);case'==':return evalExpr(args[0],p,type)===evalExpr(args[1],p,type);case'in':return evalExpr(args[1],p,type).includes(evalExpr(args[0],p,type));case'coalesce':return args.map(a=>evalExpr(a,p,type)).find(v=>v!==null&&v!==undefined);default:throw new Error('Unsupported test expression '+e[0]);}}
  assert.equal(evalExpr(house.filter,{kind:'address',addr_housenumber:'95-А'},'Point'),true);
  assert.equal(evalExpr(house.filter,{kind:'building',addr_housenumber:'95-А'},'Polygon'),false,'no duplicate building polygon label');
  assert.equal(evalExpr(house.filter,{kind:'address'},'Point'),false);
  for(const detail of ['residential','service','unclassified','living_street','pedestrian','alley','driveway']){
    // Real audit found name:uk-only roads (e.g. Успішна вулиця).
    const properties={kind:'minor_road',kind_detail:detail,'name:uk':'Успішна вулиця'};
    assert.equal(evalExpr(local.filter,properties,'LineString'),true,detail);
    assert.equal(evalExpr(major.filter,properties,'LineString'),false,'disjoint labels avoid duplicate names');
  }
  assert.equal(evalExpr(local.filter,{kind:'minor_road'},'LineString'),false,'unnamed roads stay unnamed');
  assert.equal(evalExpr(major.filter,{kind:'major_road',name:'Street'},'LineString'),true);
  assert.equal(evalExpr(local.layout['text-field'],{'name:uk':'Українська',name:'Default','name:en':'English'}),'Українська');
  assert.equal(evalExpr(local.layout['text-field'],{name:'Default','name:en':'English'}),'Default');
  assert.equal(evalExpr(local.layout['text-field'],{'name:en':'English'}),'English');
  assert.equal(local.minzoom,14);assert.equal(local.layout['text-padding'],1);
  assert.equal(local.layout['text-allow-overlap'],false);assert.equal(major.layout['text-allow-overlap'],false);
  assert.deepEqual(local.layout['symbol-spacing'].slice(-2),[18,75]);
  assert.deepEqual(house.layout['text-size'].slice(-4),[17,11,18,12]);
  console.log('PASS readable Protomaps v4 offline cartography uses local fonts and no remote assets');
})().catch(error=>{console.error(error);process.exitCode=1;});

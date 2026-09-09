'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {loadRuntime,verifyExtraction}=require('./helpers/tools-source');
const core=require('../js/tools-core.js');verifyExtraction();
const values=new Map(),writes=[],headers={specVersion:3,tileType:1,minLat:48,maxLat:49,minLon:34,maxLon:36,minZoom:10,maxZoom:16};
let nodes={},modal=null,selectionCallback=null,installCalls=0,failInstall=false,quotaEnough=true,removed=0,exportBlob=null;
const previous={areaId:'old',size:1000,header:headers};let installed=previous;
const element=id=>nodes[id]||(nodes[id]={value:'',innerHTML:'',classList:{add(){},remove(){}},click(){},scrollIntoView(){}});
const ctx={
 MTToolsCore:core,loadJSON:(key,fallback)=>values.has(key)?JSON.parse(values.get(key)):fallback,
 localStorage:{setItem(key,value){writes.push(key);values.set(key,value);}},settings:{},tickets:[],
 document:{getElementById:element,createElement:()=>({click(){}})},escapeHtml:v=>String(v??''),showToast(){},confirm:()=>true,
 MTOfflineMap:{readMeta:()=>installed,getMode:()=> 'auto',formatBytes:v=>String(v),supported:()=>true,inspectFile:async file=>({fileName:file.name,size:file.size,header:headers}),
 quotaFor:async()=>({enough:quotaEnough,available:100000}),install:async(file,info,options)=>{installCalls++;if(failInstall)throw Error('fixture failure');installed={...info,...options};},
 remove:async()=>{removed++;return true;}},
 MTToolsMap:{selectBounds(callback){selectionCallback=callback;},drawBounds(){}},
 openModal(title,html,options){nodes={};modal={title,html,options};options?.onOpen?.();},closeModal(){modal=null;},
 appNavigationCanGoBack:()=>false,
 Blob,URL:{createObjectURL(blob){exportBlob=blob;return 'blob:fixture';},revokeObjectURL(){}},setTimeout:callback=>callback()
};
loadRuntime(ctx);ctx.renderToolsScreen=()=>{};
(async()=>{
 installed=null;assert.match(ctx.toolsOfflineHtml(),/Спочатку додайте область/);installed=previous;
 element('toolsOfflineMinZoom').value='10';element('toolsOfflineMaxZoom').value='16';
 ctx.toolsStartOfflineBoundsSelection();selectionCallback({minLat:48,maxLat:49,minLng:34,maxLng:36});
 element('toolsOfflineAreaName').value='Region';ctx.toolsSaveOfflineArea();
 let areas=ctx.toolsLoadOfflineAreas();assert.equal(areas.length,1);const id=areas[0].id;
 assert.equal(areas[0].name,'Region');assert.equal(areas[0].maxZoom,16);
 ctx.toolsEditOfflineArea(id);element('toolsOfflineAreaName').value='Renamed';ctx.toolsSaveOfflineArea();
 assert.equal(ctx.toolsLoadOfflineAreas()[0].id,id);assert.equal(ctx.toolsLoadOfflineAreas()[0].name,'Renamed');
 assert.match(ctx.toolsOfflineAreasHtml(ctx.toolsLoadOfflineAreas()),/Вибрати файл .pmtiles і встановити/);
 ctx.toolsExportOfflineArea(id);const exported=JSON.parse(await exportBlob.text());
 assert.equal(exported.format,'master-tracker-offline-area-v1');assert.deepEqual(exported.bounds,{minLat:48,minLng:34,maxLat:49,maxLng:36});
 assert.deepEqual(exported.zoom,{min:10,max:16});
 const file={name:'fixture.pmtiles',size:1000};
 await ctx.toolsPrepareOfflineMap(file,id);assert.equal(installCalls,0,'file selection only opens confirmation');
 element('toolsOfflineMapCancelBtn').onclick();assert.equal(installed,previous,'cancel retains existing map');
 quotaEnough=false;await ctx.toolsPrepareOfflineMap(file,id);assert.equal(installCalls,0,'quota failure does not install');
 quotaEnough=true;await ctx.toolsPrepareOfflineMap(file,id);
 failInstall=true;await element('toolsOfflineMapConfirmBtn').onclick({currentTarget:element('toolsOfflineMapConfirmBtn')});
 assert.equal(installed,previous,'failed installation keeps previous map');assert.equal(element('toolsOfflineMapConfirmBtn').disabled,false);
 failInstall=false;await ctx.toolsPrepareOfflineMap(file,id);await element('toolsOfflineMapConfirmBtn').onclick({currentTarget:element('toolsOfflineMapConfirmBtn')});
 assert.equal(installed.areaId,id);assert.match(ctx.toolsOfflineAreasHtml(ctx.toolsLoadOfflineAreas()),/Офлайн-карта встановлена/);
 const count=installCalls;await ctx.toolsPrepareOfflineMap({name:'area.json',size:100,text:async()=>JSON.stringify(exported)},id);
 assert.equal(installCalls,count,'definition JSON is not tile data and cannot replace PMTiles');
 const savedMap=installed;ctx.toolsDeleteOfflineArea(id);
 assert.equal(ctx.toolsLoadOfflineAreas().length,0);assert.equal(installed,savedMap);assert.equal(removed,0,'area deletion never deletes PMTiles');
 assert.ok(writes.every(key=>key==='mtOfflineAreasV1'),'existing area key only');
 assert.equal(vm.runInContext('toolsOfflinePendingBounds',ctx),null);
 console.log('PASS offline extraction: exact APIs, list/create/edit/delete, bounds/export, file confirmation/quota/replace, preserved PMTiles and keys');
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {loadRuntime,verifyExtraction}=require('./helpers/tools-source');
verifyExtraction();
const core=require('../js/tools-core');let installed=null,initialized=0,manager=null;
const root={innerHTML:''},compact={textContent:''};
const ctx={MTToolsCore:core,loadJSON:(_key,value)=>value,settings:{},tickets:[],escapeHtml:v=>String(v??''),appNavigationCanGoBack:()=>false,
  MTOfflineMap:{readMeta:()=>installed,getMode:()=> 'auto',formatBytes:()=> 'not used'},
  MTToolsMap:{CATEGORY_META:Object.fromEntries(core.MAP_CATEGORIES.map(c=>[c,{icon:'',label:c}])),captureView(){}},requestAnimationFrame(){},
  document:{getElementById:id=>id==='toolsScreenRoot'?root:id==='toolsOfflineMapCompactStatus'?compact:id==='toolsOfflineDownloadCard'?manager:null},
  toolsOfflineDownloadHtml:()=>'<section id="toolsOfflineDownloadCard"></section>',toolsInitOfflineDownloadUi:()=>{initialized++;}};
loadRuntime(ctx);ctx.toolsNetworkGroupsHtml=()=>'';ctx.toolsOfflineHtml=()=>'<div>offline settings</div>';
let html=ctx.toolsMapHtml();assert(html.includes('Офлайн-карта не встановлена'));assert(!html.includes('toolsOfflineDownloadCard'));
installed={size:114207260,version:'2026-09-30'};html=ctx.toolsMapHtml();
assert(html.includes('✅ Офлайн-карта встановлена · 114.2 МБ'));assert(!html.includes('toolsOfflineDownloadCard'));
assert.equal((html.match(/Офлайн-карта встановлена/g)||[]).length,1);
ctx.renderToolsScreen('map');assert.equal(initialized,0,'map must not initialize the full download manager');
ctx.renderToolsScreen('offline');assert.equal(initialized,1);assert(root.innerHTML.includes('toolsOfflineDownloadCard'));
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/tools-offline-download-ui.js'),'utf8'),ctx);
ctx.toolsUpdateOfflineDownloadUi({active:installed});assert.equal(compact.textContent,'✅ Офлайн-карта встановлена · 114.2 МБ');
ctx.toolsUpdateOfflineDownloadUi({active:null});assert.equal(compact.textContent,'Офлайн-карта не встановлена');
manager={dataset:{},innerHTML:'',querySelector:()=>({})};
ctx.MTOfflineMapCatalog=[{id:'dnipro-oblast',title:'Дніпропетровська область',size:114207260}];
ctx.MTOfflineDownloader={supported:()=>true};ctx.mtOfflineMapTokenStatus=()=>({configured:true,persistent:true});
const manifest={...ctx.MTOfflineMapCatalog[0],version:'2026-09-30'};
const state={phase:'idle',active:null,journal:null,manifest,configured:true,busy:false};
ctx.toolsUpdateOfflineDownloadUi(state);assert(manager.innerHTML.includes('Завантажити'));assert(manager.innerHTML.includes('Версія: 2026-09-30'));
ctx.toolsUpdateOfflineDownloadUi({...state,phase:'downloading'});assert(manager.innerHTML.includes('Зупинити'));
ctx.toolsUpdateOfflineDownloadUi({...state,phase:'paused',journal:{downloadedBytes:100,totalSize:114207260}});assert(manager.innerHTML.includes('Продовжити'));
ctx.toolsUpdateOfflineDownloadUi({...state,phase:'ready',active:{...manifest,mapId:'dnipro-oblast',updatedAt:'2026-09-30T00:00:00Z'}});
for(const text of ['Відкрити','Оновити','Видалити','Версія: 2026-09-30'])assert(manager.innerHTML.includes(text),text+' remains in full manager');
console.log('PASS map compact status, decimal MB, no download/token card on map, settings-only manager and live status update');

'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {loadRuntime,verifyExtraction,read}=require('./helpers/tools-source');
const core=require('../js/tools-core.js');
verifyExtraction();
let nodes={},modal=null,renders=0,deleted=[],sent=[],writes=[];
function element(id){return nodes[id]||(nodes[id]={value:'',files:[],disabled:false,innerHTML:'',textContent:'',events:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],scrollIntoView(){},addEventListener(type,fn){assert.equal(this.events[type],undefined,'listener not duplicated on '+id);this.events[type]=fn;}});}
const store=new Map();
const ctx={
 MTToolsCore:core,loadJSON:(key,fallback)=>store.has(key)?JSON.parse(store.get(key)):fallback,
 localStorage:{setItem(key,value){writes.push(key);store.set(key,value);}},settings:{cities:[],streets:{}},
 tickets:[{id:'ticket-a',city:'City',street:'Street',photos:['shared']}],
 document:{getElementById:element,querySelectorAll:()=>[],querySelector:()=>null},window:{addEventListener(){}},
 escapeHtml:v=>String(v??''),showToast(){},confirm:()=>true,
 MTToolsMap:{destroyPicker(){},focusPoint(){}},closeModal(){modal=null;},
 openModal(title,html,options){nodes={};modal={title,html,options};options?.onOpen?.();},
 deletePhotoKey:async key=>deleted.push(key),saveTickets:async()=>true,
 telegramNetworkMessageLink:()=>'',resolvePhotoAsync:async()=>null
};
loadRuntime(ctx);
const state=()=>vm.runInContext('toolsNetworkPoints',ctx);
ctx.renderToolsScreen=()=>{renders++;};
ctx.toolsSendNetworkPointTelegram=async p=>{sent.push(p.id);return true;};
function fill(overrides={}){for(const [id,value] of Object.entries({toolsPointType:'FOB',toolsPointCity:'City',toolsPointStreet:'Street',toolsPointHouse:'1',toolsPointLabel:'03',toolsPointLat:'48.45',toolsPointLng:'35.01',toolsPointNote:'Note',...overrides}))element(id).value=value;}
(async()=>{
 assert.equal(modal,null,'script load opens nothing');
 ctx.bindToolsScreen();
 ctx.toolsOpenNetworkPointEditor();
 assert.equal(state().length,0,'opening does not persist');
 fill();
 await element('toolsPointSaveBtn').onclick();
 assert.equal(state().length,1);const id=state()[0].id;
 assert.equal(state()[0].name,'FOB 03');assert.equal(state()[0].city,'City');
 assert.equal(JSON.parse(store.get('mtNetworkPointsV1'))[0].id,id);
 assert.deepEqual(sent,[id],'existing Telegram action still follows local save');
 state()[0].photoKeys=['shared','private'];state()[0].photoKey='shared';state()[0].profileId='profile-a';
 ctx.toolsOpenNetworkPointEditor(id);fill({toolsPointNote:'Edited'});
 await element('toolsPointSaveBtn').onclick();
 assert.equal(state()[0].note,'Edited');assert.deepEqual(Array.from(state()[0].photoKeys),['shared','private']);assert.equal(state()[0].profileId,'profile-a');
 ctx.toolsOpenNetworkPointEditor(id);fill({toolsPointNote:'Cancelled'});
 element('toolsPointCancelBtn').onclick();
 assert.equal(state()[0].note,'Edited','cancel leaves persisted record intact');
 vm.runInContext("toolsNetworkSearch='edited'",ctx);
 assert.match(ctx.toolsNetworkGroupsHtml(),/FOB 03/);assert.match(ctx.toolsNetworkGroupsHtml(),/City/);assert.match(ctx.toolsNetworkGroupsHtml(),/Street/);
 vm.runInContext("toolsNetworkSearch='absent'",ctx);assert.doesNotMatch(ctx.toolsNetworkGroupsHtml(),/FOB 03/);
 const beforeTicket=JSON.stringify(ctx.tickets);
 const originalShow=ctx.toolsShowNetworkPoint;ctx.toolsShowNetworkPoint=()=>{};
 ctx.toolsConfirmDeleteNetworkPoint(id);element('toolsPointDeleteCancelBtn').onclick();
 assert.equal(state().length,1,'cancel delete does not remove point');
 ctx.toolsShowNetworkPoint=originalShow;
 state().push(core.normalizeNetworkPoint({id:'keep',type:'Муфта',lat:48,lng:35}));
 const beforeRenders=renders;
 assert.equal(await ctx.toolsDeleteNetworkPoint(id),true);
 assert.deepEqual(Array.from(state(),p=>p.id),['keep']);assert.ok(renders>beforeRenders,'map/list refresh follows deletion');
 assert.ok(!core.mapObjects(ctx.tickets,state()).some(p=>p.id===id),'deleted marker absent');
 assert.deepEqual(deleted,['private'],'shared ticket photo retained');
 assert.equal(JSON.stringify(ctx.tickets),beforeTicket,'unlinked ticket/profile data preserved');
 // Execute the original transport function with fake explicit transport, never the network.
 const source=read('js/tools-network-points.js'),start=source.indexOf('async function toolsSendNetworkPointTelegram'),end=source.indexOf('function toolsStoreCompressedPhoto');
 vm.runInContext(source.slice(start,end),ctx);
 ctx.settings.tgBotToken='fixture-only';ctx.settings.tgBackupChatId='fixture-chat';
 let messages=0;ctx.sendToTelegramChat=async(chat,text)=>{messages++;assert.match(text,/NETWORK_POINT_JSON/);return{ok:true,chatId:chat,messageId:1};};
 ctx.telegramNetworkMessageLink=(chat,id)=>chat&&id?'fixture-link':'';
 assert.equal(await ctx.toolsSendNetworkPointTelegram(state()[0]),true);assert.equal(messages,1);
 assert.ok(writes.every(key=>key==='mtNetworkPointsV1'),'same storage key');
 console.log('PASS network extraction: exact bodies/globals, create/edit/cancel/delete, search/grouping, photos, persistence, Telegram and marker refresh');
})().catch(error=>{console.error(error);process.exitCode=1;});

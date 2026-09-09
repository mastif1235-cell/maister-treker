'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {loadRuntime,verifyExtraction,read}=require('./helpers/tools-source');
const core=require('../js/tools-core.js');verifyExtraction();
let nodes={},listeners=0,saves=0,back=null,filled=0,copied='';
const values=new Map(),element=id=>nodes[id]||(nodes[id]={value:'',innerHTML:'',textContent:'',disabled:false,classList:{toggle(){},add(){},remove(){}},addEventListener(){listeners++;}});
const ctx={
 MTToolsCore:core,loadJSON:(key,fallback)=>fallback,localStorage:{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null,removeItem:k=>values.delete(k)},
 tickets:[{id:'a',city:'City',street:'Street',diagnosticHistory:[]}],settings:{},calcState:{},editingTicketId:null,calcOriginalPhotoKeys:[],
 document:{getElementById:element},window:{addEventListener(){listeners++;}},navigator:{clipboard:{writeText:async text=>{copied=text;}}},
 MTToolsMap:{captureView(){},destroyMap(){}},escapeHtml:v=>String(v??''),showToast(){},switchTab(){},fillFormFromState(){filled++;},
 appNavigationPush(key,callback){back=callback;},appNavigationCanGoBack:()=>false,saveTickets:async()=>{saves++;return true;},
 AbortController,clearTimeout,appBackButtonHtml:()=>'',closeModal(){}
};
loadRuntime(ctx);vm.runInContext(read('js/tools-diagnostics-network.js'),ctx);
(async()=>{
 assert.equal(listeners,0,'loading UI/network declarations attaches no listeners');
 ctx.bindToolsScreen();const bound=listeners;
 ctx.toolsOpenDiagnostics({address:'City Street',ticketId:'a'});
 assert.match(element('toolsScreenRoot').innerHTML,/City Street/);
 assert.equal(saves,0);assert.equal(vm.runInContext('toolsDiagnosticSaved',ctx),false,'opening never claims saved result');
 ctx.toolsOpenDiagnostics({address:'City Street',ticketId:'a'});
 assert.equal(listeners,bound,'reopening does not rebind');
 vm.runInContext("toolsDiagnosticResult=MTToolsCore.sanitizeDiagnosticResult({online:true,summaryStatus:'ok',latencyMs:10});toolsDiagnosticRunAt=new Date('2026-09-09T12:00:00Z');",ctx);
 await ctx.toolsSaveCurrentDiagnostic();
 assert.equal(saves,1);assert.equal(ctx.tickets[0].diagnosticHistory.length,1);
 assert.equal(vm.runInContext('toolsDiagnosticSaved',ctx),true);
 await ctx.toolsSaveCurrentDiagnostic();assert.equal(saves,1,'same run is not appended twice');
 await ctx.toolsCopyDiagnostic();assert.match(copied,/City Street/);
 const before=JSON.stringify(ctx.tickets);
 ctx.toolsResetDiagnosticAddress();assert.equal(vm.runInContext('toolsDiagnosticContext',ctx),null);
 assert.equal(JSON.stringify(ctx.tickets),before,'address reset does not delete saved history');
 ctx.toolsOpenDiagnostics({address:'Previous address'});back();
 assert.equal(vm.runInContext('toolsDiagnosticContext',ctx),null,'exit clears context');
 ctx.toolsOpenDiagnostics();assert.doesNotMatch(element('toolsScreenRoot').innerHTML,/Previous address/);
 assert.equal(JSON.stringify(ctx.tickets),before,'open/close leaves ticket/history unchanged');
 vm.runInContext("toolsCalculatorDraft={state:{city:'Draft city',street:'Draft street'},editingTicketId:null,originalPhotoKeys:['photo-a']};",ctx);
 ctx.toolsOpenDiagnostics({address:'Draft city',editorContext:true},'calculator');
 back();assert.equal(ctx.calcState.city,'Draft city');assert.equal(filled,1);assert.deepEqual(Array.from(ctx.calcOriginalPhotoKeys),['photo-a']);
 assert.equal(vm.runInContext('toolsDiagnosticContext',ctx),null);
 assert.equal(listeners,bound,'return-to-ticket does not add listeners');
 assert.match(ctx.toolsProfileDiagnosticsHtml(ctx.tickets),/Історія/);
 console.log('PASS diagnostics extraction: exact API, open/close/context/reset, history save guard, copy, ticket return and listener lifecycle');
})().catch(error=>{console.error(error);process.exitCode=1;});

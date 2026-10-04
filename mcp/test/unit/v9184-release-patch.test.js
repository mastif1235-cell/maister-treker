import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {workEvents} from '../../src/ask/work-events.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {resolveRosterCoworker,coworkerForms} from '../../src/ask/coworker-names.js';
import {workIntent} from '../../src/ask/work-intent.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
const base={id:'SYNTHETIC',date:'15.09.2026',type:'Підключення',macAddress:'001122334455',equipment:[],cables:[],tags:[],connectMasters:['Женя']};
const semantic={entity:'onu',action:'install',profile:'onu_physical',category:'definite'};
const units=a=>a.events.filter(e=>e.entity==='onu'&&e.category==='definite').reduce((s,e)=>s+(e.quantity||0),0);
test('old ONU fault is not reuse for connection + valid MAC, with or without structured stock',()=>{
 for(const profile of ['work_v2','onu_physical','physical_consumption'])for(const note of ['старая ONU','На старой ONU жужжат дросселя','ONU старая гудит'])for(const equipment of [[],[{label:'ONU',qty:1}]]){
  const a=workEvents({...base,note,equipment},'',{...semantic,profile});
  assert.equal(units(a),1,JSON.stringify({profile,note,equipment}));
  assert.ok(!a.contexts.some(c=>c.reason==='reused_onu_transfer'));
 }
});
test('explicit retained/transfer/used/customer ONU stays excluded; new/structured precedence never doubles',()=>{
 for(const note of ['оставили старую ONU','перенесли эту же ONU','ONU б/у','ONU клиента','повторно использовали ONU','использовали существующую ONU','перенос с другого адреса, ONU старая']){
  for(const equipment of [[],[{label:'ONU',qty:1}]])assert.equal(units(workEvents({...base,note,equipment},'',semantic)),0,note);
 }
 for(const note of ['На старой ONU жужжат дросселя, поставил ONU','ONU клиента, поставил новую ONU'])assert.equal(units(workEvents({...base,note,equipment:[{label:'ONU',qty:2}]},'',semantic)),2);
});
function scripted(envelopes,answer){let round=0;return createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat:async()=>round++?{ok:true,content:answer,toolCalls:[],assistantMessage:{role:'assistant',content:answer}}:{ok:true,content:'',toolCalls:envelopes.map((p,i)=>({id:'q'+i,name:'query_tickets',argsRaw:JSON.stringify(p)})),assistantMessage:{role:'assistant',content:'',tool_calls:[]}}},tools:{query_tickets:async p=>runSmartQuery({tickets:[base,{...base,id:'AUG',date:'15.08.2026'}],shifts:[],searchIndex:[]},p)}});}
test('two independent aggregate periods do not overwrite the final comparison with the last period',async()=>{
 const periods=[['01.09.2026','30.09.2026'],['01.08.2026','31.08.2026']].map(([date_from,date_to])=>({mode:'count',date_from,date_to,semantic}));
 const answer='Сентябрь: 1 ONU. Август: 1 ONU. Количество одинаковое.';
 const result=await scripted(periods,answer).handle('Сравни сентябрь и август');
 assert.equal(result.ok,true);assert.equal(result.answer,answer);
});
test('one-period aggregate still gets the compact deterministic backstop',async()=>{
 const p={mode:'count',date_from:'01.09.2026',date_to:'30.09.2026',semantic};
 const result=await scripted([p],'business-derived technical explanation').handle('Посчитай установленные ONU за указанный период');
 assert.match(result.answer,/1 ONU/);assert.doesNotMatch(result.answer,/technical|business-derived/);
});
test('trusted roster accepts RU/UA instrumental forms, without fuzzy or ambiguous resolution',()=>{
 for(const [name,ru,ua] of [['Женя','Женей','Женею'],['Петя','Петей','Петею'],['Паша','Пашей','Пашею']]){
  for(const form of [ru,ua]){
   assert.equal(resolveRosterCoworker(form,[name]),name);
   const p=workIntent((form===ua?'Скільки ONU поставив з ':'Сколько ONU поставил с ')+form+' за сентябрь?',new Date('2026-10-04'),[name]);
   assert.equal(p.coworker,name);
  }
 }
 assert.ok(!coworkerForms('Женя').has('женєю'));assert.ok(!coworkerForms('Петя').has('петєю'));
 assert.equal(resolveRosterCoworker('Женечкой',['Женя']),null);
 assert.equal(resolveRosterCoworker('Женей',['Женя','Женей']),null);
});
test('placement membership Set matches strict some semantics for duplicate/ambiguous/malformed IDs and linear operation count',()=>{
 const source=fs.readFileSync(new URL('../../src/ask/smart-query.js',import.meta.url),'utf8');
 const match=/const placementIds=new Set\(placements.map\(e=>e.ticket_id\)\);\s*const excludedContexts=([^;]+);/.exec(source);
 assert.ok(match,'actual pipeline uses the proven membership implementation');
 const actual=new Function('physicalScope','placements','workById',match[0]+'return excludedContexts;');
 const scope=['A','A',1,'1',null,undefined,'MISSING',NaN].map(id=>({id}));
 for(const ids of [['A'],['1'],[1],[null],[undefined],['undefined'],['NaN'],['A','A','1'],[]]){
  const placements=ids.map(ticket_id=>({ticket_id})),workById=new Map(scope.map((t,i)=>[t.id,{contexts:[i]}]));
  const old=scope.filter(t=>!placements.some(e=>e.ticket_id===String(t.id))).flatMap(t=>workById.get(t.id).contexts||[]);
  assert.deepEqual(actual(scope,placements,workById),old);
 }
 const S=400,P=500;let reads=0;
 const placements=Array.from({length:P},(_,i)=>({get ticket_id(){reads++;return 'PLACED'+i;}}));
 const physicalScope=Array.from({length:S},(_,i)=>({id:'EXCLUDED'+i})),workById=new Map(physicalScope.map(t=>[t.id,{contexts:[]}])) ;
 physicalScope.filter(t=>!placements.some(e=>e.ticket_id===String(t.id)));assert.equal(reads,S*P);
 reads=0;actual(physicalScope,placements,workById);assert.equal(reads,P,'each placement ID read once instead of S*P comparisons');
});

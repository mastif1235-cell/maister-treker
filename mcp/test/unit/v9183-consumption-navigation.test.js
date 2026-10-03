import test from 'node:test';
import assert from 'node:assert/strict';
import {workEvents} from '../../src/ask/work-events.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {workAnswer} from '../../src/ask/work-intent.js';
import {createAskOrchestrator,exactAddressCandidateId} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
const base={id:'SYNTHETIC_REPAIR',date:'18.09.2026',time:'12:44',type:'Ремонт',equipment:[{label:'ONU',qty:1,price:0}],connectMasters:['Женя'],tags:[],cables:[],presetWorks:[],additionalWork:[],macAddress:''};
const sem={entity:'onu',action:'install',profile:'onu_physical',category:'definite',signal_context:'subscriber'};
test('repair selected ONU and old-unit fault note is consumption, not reuse',()=>{
 const a=workEvents({...base,note:'На старой ONU жужжат дросселя'},'',sem);
 assert.equal(a.events.filter(e=>e.entity==='onu'&&e.category==='definite').reduce((s,e)=>s+e.quantity,0),1);
 assert.ok(!(a.contexts||[]).some(e=>e.reason==='reused_onu_transfer'));
});
test('weak old-unit descriptions do not override structured stock; explicit reuse still excludes',()=>{
 for(const note of ['старая ONU','на старой ONU проблема','старая ONU гудит','На старой ону жужжат дросиля сильно прям','не оставили старую ONU','надо перенести ONU','перенесли роутер, старая ONU гудит']){
  const a=workEvents({...base,note},'',sem);
  assert.equal(a.events.filter(e=>e.category==='definite'&&e.entity==='onu').reduce((s,e)=>s+e.quantity,0),1,note);
 }
 for(const note of ['перенесли эту же ONU','оставили старую ONU','использовали существующую ONU','повторно использовали ONU','ONU абонента','клиентская ONU','своя ONU','залишили стару ONU','повторно використали ONU']){
  const a=workEvents({...base,note},'',sem);
  assert.equal(a.events.filter(e=>e.category==='definite'&&e.entity==='onu').length,0,note);
  assert.equal(a.contexts.length,1,note);
 }
});
test('exact address selection narrows apartment and date, refuses ambiguous/missing candidates',()=>{
 const rows=[{...base,id:'A',address:'Тестове, Вул Садова 106, кв. 29'},{...base,id:'B',address:'Тестове, Вул Садова 106, кв. 30'},{...base,id:'C',date:'19.09.2026',address:'Тестове, Вул Садова 106, кв. 29'}];
 assert.equal(exactAddressCandidateId('Открой Садова 106 кв.29 за 18.09.2026',rows),'A');
 assert.equal(exactAddressCandidateId('Открой Садова 106',rows),null);
 assert.equal(exactAddressCandidateId('Открой Садова 106 кв.31',rows),null);
 assert.equal(exactAddressCandidateId('Открой Садова 106 кв.29',rows.slice(0,1)),'A');
 assert.equal(exactAddressCandidateId('Открой Скворцова 106',[{...base,street:'Скворцова',house:'106',id:'NO_APARTMENT'}]),'NO_APARTMENT','street letters do not become a fictitious apartment filter');
});
test('replacement/exclusion details preserve exact coworker/period across serialized follow-up',async()=>{
 const tickets=[{...base,id:'OLD_FAULT',note:'На старой ONU жужжат дросселя'},{...base,id:'OWNED',note:'ONU абонента'},{...base,id:'REUSED',note:'оставили старую ONU'},{...base,id:'OTHER_PERSON',connectMasters:['Петя'],note:'ONU абонента'}],calls=[];
 const o=createAskOrchestrator({groq:{chat(){throw new Error('no LLM');}},toolDefs:TOOL_DEFINITIONS,tools:{query_tickets:async p=>{calls.push(p);return runSmartQuery({tickets,shifts:[],searchIndex:[]},p);}}});
 const first=await o.handle('Сколько ONU поставил с Женей за сентябрь',{now:new Date('2026-10-03'),coworkerRoster:['Женя']});
 const options={queryContext:JSON.parse(JSON.stringify(first.queryContext))};
 const excluded=await o.handle('Покажи исключённые',options);
 assert.equal(excluded.total,2);assert.deepEqual(excluded.referentTickets.map(t=>t.id).sort(),['OWNED','REUSED']);
 assert.equal(calls.at(-1).coworker,'Женя');assert.equal(calls.at(-1).date_from,'01.09.2026');assert.equal(calls.at(-1).semantic.category,'excluded');
 assert.doesNotMatch(excluded.answer,/customer_owned|reused_onu|source|confidence/);
 const replaced=await o.handle('Покажи замены',options);
 assert.equal(replaced.total,1);assert.equal(replaced.referentTickets[0].id,'OLD_FAULT');
 const reopened=await o.handle('Открой карточку',{selectedTicketId:JSON.parse(JSON.stringify(replaced.referentTickets[0].id))});
 assert.deepEqual(reopened.presentation,{kind:'single_ticket',ticket_id:'OLD_FAULT'});
});
test('default physical aggregate answer is compact and contains no diagnostic terms',()=>{
 const tickets=Array.from({length:20},(_,i)=>({...base,id:'SYNTHETIC_'+i,type:i<13?'Підключення':'Ремонт',note:''}));
 const p={mode:'count',coworker:'Женя',date_from:'01.09.2026',date_to:'30.09.2026',semantic:sem};
 const d=runSmartQuery({tickets,shifts:[],searchIndex:[]},p).data,a=workAnswer(d,p,{question:'Сколько я ONU поставил с Женей за сентябрь'});
 assert.match(a,/20 ONU/);assert.match(a,/13/);assert.match(a,/7/);assert.match(a,/Жен/);
 assert.doesNotMatch(a,/Знайдено|заявок|business-derived|explicit|source|confidence|reused_onu_transfer|Показати заявки|подій/iu);
 assert.ok(a.split('\n').length<=4);
});
const call=(args)=>({ok:true,content:'',toolCalls:[{id:'safe',name:'query_tickets',argsRaw:JSON.stringify(args)}],assistantMessage:{role:'assistant',content:'',tool_calls:[]}});
const done={ok:true,content:'Одна заявка за зазначеною датою.',toolCalls:[],assistantMessage:{role:'assistant',content:'Одна заявка за зазначеною датою.'}};
test('explicit open with a fresh unique date query selects one concrete card',async()=>{
 let round=0;
 const row={...base,city:'Тестове',street:'Вул Садова',house:'106',apartment:'29',address:'Тестове, Вул Садова 106, кв. 29'};
 const o=createAskOrchestrator({groq:{chat:async()=>round++?done:call({mode:'list',date_from:base.date,date_to:base.date})},toolDefs:TOOL_DEFINITIONS,tools:{query_tickets:async()=>({ok:true,data:{mode:'list',matched:1,total_matched:1,tickets:[row],resolved_filters:{date_from:base.date,date_to:base.date}}})}});
 const a=await o.handle('Открой заявку за 18.09.2026 где случай повторно использованной ONU',{chatSessionId:'synthetic-v9183-session',now:new Date('2026-10-03T12:00:00Z')});
 assert.equal(a.selectedTicketId,base.id);assert.deepEqual(a.presentation,{kind:'single_ticket',ticket_id:base.id});assert.equal(a.resultSet,null);assert.deepEqual(a.resultItems,[]);
});
test('referent-only exact address honors previous period, not stale same-house dates',async()=>{
 const rows=[{...base,id:'SEPT_REPAIR',address:'Тестове, Вул Садова 106, кв. 29'},{...base,id:'AUG_REPAIR',date:'18.08.2026',address:'Тестове, Вул Садова 106, кв. 29'}];
 const o=createAskOrchestrator({groq:{chat:async()=>done},toolDefs:TOOL_DEFINITIONS,tools:{}});
 const a=await o.handle('Открой заявку Садова 106 кв.29',{contextTickets:rows,queryContext:{resolved_filters:{date_from:'01.09.2026',date_to:'30.09.2026'},total_matched:2}});
 assert.deepEqual(a.presentation,{kind:'single_ticket',ticket_id:'SEPT_REPAIR'});
});
test('model-routed semantic aggregate also uses compact code-owned answer',async()=>{
 const p={mode:'count',date_from:'01.09.2026',date_to:'30.09.2026',semantic:sem};let round=0;
 const o=createAskOrchestrator({groq:{chat:async()=>round++?{...done,content:'business-derived long technical explanation'}:call(p)},toolDefs:TOOL_DEFINITIONS,tools:{query_tickets:async args=>runSmartQuery({tickets:[base],shifts:[],searchIndex:[]},args)}});
 const a=await o.handle('Посчитай установленные ONU за указанный период');
 assert.match(a.answer,/1 ONU/);assert.doesNotMatch(a.answer,/business-derived|technical/);assert.ok(a.answer.split('\n').length<=4);
});
test('one returned row from a larger result is not an unambiguous selection',async()=>{
 let round=0;const o=createAskOrchestrator({groq:{chat:async()=>round++?done:call({mode:'list',limit:1})},toolDefs:TOOL_DEFINITIONS,tools:{query_tickets:async()=>({ok:true,data:{mode:'list',total_matched:19,tickets:[base],resolved_filters:{}}})}});
 const a=await o.handle('Открой заявку за сентябрь',{chatSessionId:'synthetic-ambiguity'});
 assert.equal(a.selectedTicketId,null);assert.equal(a.presentation,null);assert.equal(a.total,19);
});
test('compact coworker grouping retains per-coworker physical quantities, not event counts',()=>{
 const tickets=[{...base,id:'TWO_UNITS',equipment:[{label:'ONU',qty:2}]},{...base,id:'ONE_UNIT'}];
 const p={mode:'group',group_by:'coworker',semantic:sem},d=runSmartQuery({tickets,shifts:[],searchIndex:[]},p).data;
 const a=workAnswer(d,p,{question:'Сколько ONU поставил по напарникам?'});
 assert.match(a,/Женя: 3 шт\./);assert.doesNotMatch(a,/business-derived|confidence|source/);
});

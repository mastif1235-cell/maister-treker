import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCombinedFollowUp} from '../../src/ask/combined-query-state.js';
import {resolvePeriodFollowUp} from '../../src/ask/period-query-state.js';
import {fromExisting,reduceAnalyticsState,toExisting} from '../../src/ask/analytics-query-state.js';
import {projectQueryFilters} from '../../src/ask/query-context.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
const now=new Date('2026-10-04T12:00:00Z'),roster=['Женя','Петя','Паша','Петр'];
const context=()=>({mode:'count',total_matched:20,resolved_filters:projectQueryFilters({date_from:'01.09.2026',date_to:'30.09.2026',coworker:'Женя',semantic:{entity:'onu',action:'install',profile:'onu_physical'}})});
const fixture={tickets:[{id:'SYNTHETIC_PETYA',date:'15.08.2026',type:'Ремонт',equipment:[{label:'ONU',qty:1}],tags:['Петя'],connectMasters:[],cables:[]}],shifts:[],searchIndex:[]};
for(const [phrase,name] of [
 ['а в августе с Петей?','Петя'],['а за август с Пашей?','Паша'],['а у серпні з Петром?','Петр'],['а у серпні з Пашею?','Паша'],
 ['А в августе с Женей?','Женя'],['А у серпні з Женею?','Женя'],['А у серпні з Петею?','Петя'],['А в августе с Пашей?','Паша'],
 ['А за серпень із Петею?','Петя'],['А в августе 2025 с Петей?','Петя']]){
 test(`combined RU/UA exact trusted morphology: ${phrase}`,()=>{
  const c=context(),before=JSON.stringify(c),r=resolveCombinedFollowUp(phrase,now,c,roster);
  assert.equal(r.path,'query_state_combined');assert.equal(r.intent.coworker,name);assert.equal(r.intent.mode,'count');
  assert.equal(r.intent.date_from,phrase.includes('2025')?'01.08.2025':'01.08.2026');
  assert.equal(r.intent.date_to,phrase.includes('2025')?'31.08.2025':'31.08.2026');
  assert.deepEqual(r.intent.semantic,c.resolved_filters.semantic);assert.equal(JSON.stringify(c),before);
  assert.deepEqual(Object.keys(r.patch.changes),['periods','coworker']);
 });
}
test('combined patch keeps ALL other representable filters, work type and count',()=>{
 const c=context();Object.assign(c.resolved_filters,{type:'Ремонт',city:'Тестове',street:'Тестова',house:'1',apartment:'2',tags:['Гарантія'],payment:'безкоштовно',sum_min:0,sum_max:100,has_signal:true,signal_worse_than:-25,items:[{text:'ONU',kind:'equipment',quantity:1}]});
 const r=resolveCombinedFollowUp('А в августе с Петей?',now,c,roster);
 assert.deepEqual(projectQueryFilters(r.intent),{...c.resolved_filters,date_from:'01.08.2026',date_to:'31.08.2026',coworker:'Петя'});
 assert.equal(r.intent.mode,'count');assert.ok(!Object.hasOwn(r.intent,'group_by'));
});
test('unknown/ambiguous name, unsupported field or ambiguous phrase atomically falls back',()=>{
 for(const q of ['А в августе с Неизвестным?','А в августе с Женечкой?','А в августе с Петей и Пашей?','А в августе и сентябре с Петей?','А в августе с Петей только ремонты?','А роутеры в августе?','А без Жени?','А со всеми?','А в августе?','Открой карточку']){
  const c=context(),before=JSON.stringify(c);assert.deepEqual(resolveCombinedFollowUp(q,now,c,roster),{path:'legacy_combined',intent:null});assert.equal(JSON.stringify(c),before);
 }
 assert.equal(resolveCombinedFollowUp('А в августе с Петром?',now,context(),['Петя']).intent,null);
 assert.equal(resolveCombinedFollowUp('А в августе с Петей?',now,context(),['Петя','Петей']).intent,null);
 for(const c of [null,{}, {...context(),mode:'list'},{...context(),mode:'group'}, {...context(),comparison:{periods:[]}}])assert.equal(resolveCombinedFollowUp('А в августе с Петей?',now,c,roster).intent,null);
 const c=context();c.resolved_filters.phone_digits={provided:true,length:7};const before=JSON.stringify(c);assert.equal(resolveCombinedFollowUp('А в августе с Петей?',now,c,roster).intent,null);assert.equal(JSON.stringify(c),before);
});
test('reload, next September and reducer ANY keep exact remaining state',()=>{
 const first=resolveCombinedFollowUp('А в августе с Петей?',now,context(),roster).intent;
 const loaded=JSON.parse(JSON.stringify({mode:'count',resolved_filters:projectQueryFilters(first)}));
 assert.deepEqual(resolveCombinedFollowUp('А в августе с Петей?',now,JSON.parse(JSON.stringify(context())),roster).intent,first);
 const september=resolvePeriodFollowUp('А в сентябре?',now,loaded).intent;
 assert.equal(september.coworker,'Петя');assert.equal(september.date_from,'01.09.2026');assert.deepEqual(september.semantic,first.semantic);
 const previous=fromExisting(loaded.resolved_filters,{mode:'count'}),any=reduceAnalyticsState(previous,{changes:{coworker:{op:'REPLACE',value:{kind:'any'}}}});
 assert.equal(any.ok,true);const plan=toExisting(any.state)[0],{coworker,...keep}=first;assert.deepEqual(plan,keep);
});
test('D1 executes exactly one query and no provider, repeats 100 times, reload next period',async()=>{
 let provider=0;const calls=[];
 const o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){provider++;throw new Error('No provider allowed');}},tools:{query_tickets:async p=>{calls.push(p);return runSmartQuery(fixture,p);}}});
 let last;
 for(let i=0;i<100;i++){
  const c=JSON.parse(JSON.stringify(context()));last=await o.handle('А в августе с Петей?',{now,queryContext:c,coworkerRoster:roster});
  assert.equal(last.ok,true);assert.equal(last.total,1);assert.equal(last.meta.rounds,0);assert.equal(last.meta.toolCallsMade,1);
  assert.equal(calls[i].coworker,'Петя');assert.equal(calls[i].mode,'count');assert.equal(calls[i].semantic.profile,'onu_physical');
 }
 assert.equal(calls.length,100);assert.equal(provider,0);
 const next=await o.handle('А в сентябре?',{now,queryContext:JSON.parse(JSON.stringify(last.queryContext)),coworkerRoster:roster});
 assert.equal(next.meta.rounds,0);assert.equal(calls.at(-1).coworker,'Петя');assert.equal(calls.at(-1).date_from,'01.09.2026');
});
test('unknown/ambiguous combined phrase uses whole legacy path, never a partial deterministic query',async()=>{
 for(const q of ['А в августе с Неизвестным?','А в августе с Петей и Пашей?']){
  let provider=0,queries=0;const c=context(),before=JSON.stringify(c);
  const o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{async chat(){provider++;return {ok:false,code:'SYNTHETIC_STOP'};}},tools:{query_tickets:async()=>{queries++;throw new Error('Partial query');}}});
  const r=await o.handle(q,{now,queryContext:c,coworkerRoster:roster});assert.equal(r.ok,false);assert.equal(queries,0);assert.equal(provider,1);assert.equal(r.queryContext,undefined);assert.equal(JSON.stringify(c),before);
 }
});
test('query error does not publish new context; selected navigation is never an analytics filter',async()=>{
 const c=context(),before=JSON.stringify(c);let calls=0;
 const o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw Error('No provider');}},tools:{query_tickets:async p=>{calls++;assert.ok(!Object.hasOwn(p,'selectedTicketId'));return {ok:false,code:'SYNTHETIC_NETWORK'};}}});
 const r=await o.handle('А в августе с Петей?',{now,queryContext:c,coworkerRoster:roster,selectedTicketId:'SYNTHETIC_SELECTION'});
 assert.equal(r.ok,false);assert.equal(r.queryContext,undefined);assert.equal(calls,1);assert.equal(JSON.stringify(c),before);
});

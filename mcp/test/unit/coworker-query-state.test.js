import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCoworkerFollowUp,resolvePeriodFollowUp} from '../../src/ask/period-query-state.js';
import {projectQueryContext,sanitizeIncomingQueryContext} from '../../src/ask/query-context.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';

const roster=['Артем','Петя','Женя','Паша'],now=new Date('2026-10-04T12:00:00Z');
const semantic={entity:'onu',action:'install',profile:'onu_physical',category:'definite',signal_context:'subscriber'};
const context=(mode='count')=>({mode,resolved_filters:{date_from:'01.09.2026',date_to:'30.09.2026',coworker:'Женя',semantic}});
const ticket=(id,extra={})=>({id,date:'15.09.2026',type:'Ремонт',equipment:[{label:'ONU',qty:1}],tags:[],connectMasters:[],...extra});
const fixture={tickets:[ticket('DIRECT',{connectMasters:['Женя']}),ticket('TAG',{tags:['Женя']}),
 ticket('OTHER',{connectMasters:[{name:'Петя'}]}),ticket('SHIFT_ONLY'),ticket('NOT_FUZZY',{tags:['Женечка']}),
 ticket('OUTSIDE',{date:'15.08.2026'})],shifts:[{date:'15.09.2026',coworker:'Женя',hours:8}],searchIndex:[]};

for(const [phrase,name] of [['А без Жени?','Женя'],['без Жені','Женя'],['без Пети','Петя'],['Без Петі!','Петя']])
 test(`EXCLUDE only replaces coworker: ${phrase}`,()=>{
  const c=context(),before=JSON.stringify(c),next=resolveCoworkerFollowUp(phrase,c,roster);
  assert.equal(next.path,'query_state_coworker');
  const {coworker,...kept}=c.resolved_filters;
  assert.deepEqual(next.intent,{mode:'count',...kept,coworker_exclude:name});
  assert.equal(JSON.stringify(c),before);
 });
for(const phrase of ['А со всеми?','Со всеми','з усіма','А з усіма майстрами?'])
 test(`ANY keeps period and count: ${phrase}`,()=>{
  const c=context(),next=resolveCoworkerFollowUp(phrase,c,roster),{coworker,...kept}=c.resolved_filters;
  assert.deepEqual(next.intent,{mode:'count',...kept});
 });
test('all inherited dimensions preserved; count/list/group mode preserved',()=>{
 for(const mode of ['count','list','group']){
  const c=context(mode);if(mode==='group')c.group_by='coworker';
  Object.assign(c.resolved_filters,{type:'Ремонт',city:'Тестове',street:'Тестова',house:'1',apartment:'2',tags:['Тест'],
   payment:'готівка',sum_min:0,sum_max:100,has_signal:true,signal_worse_than:-20,items:[{text:'ONU',kind:'equipment',quantity:1}]});
  const n=resolveCoworkerFollowUp('А без Жени?',c,roster).intent;
  assert.equal(n.mode,mode);assert.equal(n.type,'Ремонт');
  for(const [key,value] of Object.entries(c.resolved_filters))if(key!=='coworker')assert.deepEqual(n[key],value);
  if(mode==='list')assert.equal(n.limit,8);if(mode==='group')assert.equal(n.group_by,'coworker');
 }
});
test('closed grammar and invalid/ambiguous roster/context fall back atomically',()=>{
 for(const q of ['А без Жени в августе?','Без Жени и Пети','А со всеми только ремонты?','А без Жени или со всеми?',
  'Без Женечки','Без Неизвестного','Со всеми и роутеры','Открой карточку'])assert.equal(resolveCoworkerFollowUp(q,context(),roster).intent,null,q);
 for(const c of [null,{},context('unknown'),{mode:'count',resolved_filters:{semantic}},
  {mode:'count',resolved_filters:{...context().resolved_filters,date_from:'31.02.2026'}},
  {mode:'count',resolved_filters:{...context().resolved_filters,coworker_exclude:'Петя'}}])
  assert.equal(resolveCoworkerFollowUp('А без Жени?',c,roster).intent,null);
 assert.equal(resolveCoworkerFollowUp('Без Жени',context(),[]).intent,null);
 assert.equal(resolveCoworkerFollowUp('Без Жени',context(),['Женя','Жени']).intent,null);
});
test('exclusion removes direct and exact tags, never shift-only or fuzzy tags; count/list/group parity',()=>{
 const plans=['count','list','group'].map(mode=>resolveCoworkerFollowUp('А без Жени?',{...context(mode),...(mode==='group'?{group_by:'coworker'}:{})},roster).intent);
 for(const p of plans){const r=runSmartQuery(fixture,p);assert.equal(r.ok,true);assert.equal(r.data.total_matched,3);assert.equal(r.data.work_totals.quantity_sum,3);}
 const list=runSmartQuery(fixture,plans[1]);assert.deepEqual(new Set(list.data.tickets.map(t=>t.id)),new Set(['OTHER','SHIFT_ONLY','NOT_FUZZY']));
 assert.equal(runSmartQuery(fixture,resolveCoworkerFollowUp('А со всеми?',context(),roster).intent).data.total_matched,5);
 assert.equal(runSmartQuery(fixture,{...plans[0],coworker:'Петя'}).ok,false);
 assert.equal(runSmartQuery(fixture,{coworker_exclude:'Женя'}).ok,false);
});
test('queryContext reload retains EXCLUDE; period-only continuation preserves it; ANY removes it',()=>{
 const p=resolveCoworkerFollowUp('А без Жени?',context(),roster).intent;
 const result=runSmartQuery(fixture,p),loaded=sanitizeIncomingQueryContext(JSON.parse(JSON.stringify(projectQueryContext(result.data))));
 assert.equal(loaded.resolved_filters.coworker_exclude,'Женя');
 assert.deepEqual(resolveCoworkerFollowUp('А без Жени?',loaded,roster).intent,p);
 const aug=resolvePeriodFollowUp('А в августе?',now,loaded).intent;
 assert.equal(aug.coworker_exclude,'Женя');assert.equal(aug.date_from,'01.08.2026');
 const any=resolveCoworkerFollowUp('А со всеми?',loaded,roster).intent;
 assert.equal(any.coworker_exclude,undefined);assert.equal(any.coworker,undefined);assert.equal(any.mode,'count');
});
test('runtime intercepts before provider; one fresh query; failure publishes no context',async()=>{
 let calls=0,provider=0;
 const o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){provider++;throw Error('No LLM');}},
  tools:{query_tickets:async p=>{calls++;return runSmartQuery(fixture,p);}}});
 for(const [q,n] of [['А без Жени?',3],['А со всеми?',5]]){
  const r=await o.handle(q,{now,queryContext:JSON.parse(JSON.stringify(context())),coworkerRoster:roster});
  assert.equal(r.ok,true);assert.equal(r.total,n);assert.equal(r.meta.rounds,0);assert.equal(r.meta.toolCallsMade,1);
  if(q.includes('без'))assert.match(r.answer,/без Жени/iu);
 }
 assert.equal(calls,2);assert.equal(provider,0);
 const fail=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw Error('No LLM');}},tools:{query_tickets:async()=>({ok:false,code:'SYNTHETIC'})}});
 assert.equal((await fail.handle('А без Жени?',{now,queryContext:context(),coworkerRoster:roster})).queryContext,undefined);
});
test('excluded evidence follow-up and grouped context survive serialization without LLM/schema widening',async()=>{
 const calls=[],o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw Error('No LLM');}},
  tools:{query_tickets:async p=>{calls.push(p);return runSmartQuery(fixture,p);}}});
 const excluded=await o.handle('А без Жени?',{now,queryContext:context(),coworkerRoster:roster});
 const shown=await o.handle('Дай списком',{now,queryContext:JSON.parse(JSON.stringify(excluded.queryContext)),coworkerRoster:roster});
 assert.equal(shown.ok,true);assert.equal(shown.total,3);assert.equal(calls[1].mode,'list');assert.equal(calls[1].limit,8);
 assert.equal(shown.queryContext.resolved_filters.coworker_exclude,'Женя');
 const c={...context('group'),group_by:'coworker'};
 const group=await o.handle('А без Жени?',{now,queryContext:c,coworkerRoster:roster});
 assert.equal(group.ok,true);assert.equal(group.queryContext.group_by,'coworker');
 const any=await o.handle('А со всеми?',{now,queryContext:JSON.parse(JSON.stringify(group.queryContext)),coworkerRoster:roster});
 assert.equal(any.ok,true);assert.equal(calls[3].mode,'group');assert.equal(calls[3].group_by,'coworker');
 assert.equal(calls[3].coworker_exclude,undefined);
 assert.equal(TOOL_DEFINITIONS.find(t=>t.name==='query_tickets').inputSchema.properties.coworker_exclude,undefined);
});

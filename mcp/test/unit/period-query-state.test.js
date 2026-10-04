import test from 'node:test';
import assert from 'node:assert/strict';
import {temporalWorkIntent} from '../../src/ask/work-intent.js';
import {resolvePeriodFollowUp} from '../../src/ask/period-query-state.js';
import {projectQueryFilters} from '../../src/ask/query-context.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
const now=new Date('2026-10-04T12:00:00Z');
const context=(mode='count')=>({mode,resolved_filters:projectQueryFilters({date_from:'01.09.2026',date_to:'30.09.2026',
 coworker:'Женя',semantic:{entity:'onu',action:'install',profile:'onu_physical'}})});
const canonical=args=>({...args,semantic:projectQueryFilters({semantic:args.semantic}).semantic});
const ticket={id:'SYNTHETIC',date:'15.08.2026',type:'Підключення',macAddress:'001122334455',equipment:[],cables:[],tags:[],connectMasters:['Женя']};
const fixture={tickets:[ticket,{...ticket,id:'REPAIR',type:'Ремонт',macAddress:'',equipment:[{label:'ONU',qty:1}]}],shifts:[],searchIndex:[]};
for(const phrase of ['А в августе?','А за август?','А в август?','А за серпень?','А у серпні?','за август 2026','А в августе 2025?']){
 for(const mode of ['count','list'])test(`old/new period parity: ${mode} ${phrase}`,()=>{
  const c=context(mode),before=JSON.stringify(c);
  const old=temporalWorkIntent(phrase,now,c),next=resolvePeriodFollowUp(phrase,now,c);
  assert.equal(next.path,'query_state_period');assert.ok(old);
  assert.deepEqual(canonical(next.intent),canonical(old));
  assert.deepEqual(runSmartQuery(fixture,next.intent),runSmartQuery(fixture,old));
  assert.equal(JSON.stringify(c),before);
  assert.equal(next.intent.coworker,'Женя');assert.equal(next.intent.mode,mode);
  if(mode==='list') assert.equal(next.intent.limit,8);
 });
}
test('supported filters/items/type/profile retained; period alone changes',()=>{
 const c=context();Object.assign(c.resolved_filters,{city:'Тестове',street:'Тестова',house:'1',apartment:'2',
  city_id:'11111111-1111-4111-8111-111111111111',street_id:'22222222-2222-4222-8222-222222222222',
  type:'Ремонт',tags:['Гарантія'],payment:'безкоштовно',sum_min:0,sum_max:100,has_signal:true,
  signal_worse_than:-25,signal_worse_or_equal:-27,signal_better_than:-35,items:[{text:'ONU',kind:'equipment',quantity:1,unit_price:0,total:0}]});
 const old=temporalWorkIntent('А в августе?',now,c),next=resolvePeriodFollowUp('А в августе?',now,c);
 assert.equal(next.path,'query_state_period');assert.deepEqual(next.intent,old);
 assert.deepEqual(runSmartQuery(fixture,next.intent),runSmartQuery(fixture,old));
});
test('August->September and round-trip replace only period; reload same result',()=>{
 const c=context(),aug=resolvePeriodFollowUp('А в августе?',now,c).intent;
 const loaded=JSON.parse(JSON.stringify(c));
 assert.deepEqual(resolvePeriodFollowUp('А в августе?',now,loaded).intent,aug);
 const august={mode:aug.mode,resolved_filters:projectQueryFilters(aug)};
 const restored=resolvePeriodFollowUp('А в сентябре?',now,august).intent;
 assert.deepEqual(projectQueryFilters(restored),c.resolved_filters);
});
test('group/stats/exists/absent semantic contexts and non-period questions are ineligible',()=>{
 for(const mode of ['group','stats','exists','unknown']) assert.equal(resolvePeriodFollowUp('А в августе?',now,context(mode)).intent,null);
 for(const q of ['А в августе с Петей?','Сравни сентябрь и август','А только ремонты?',
  'А роутеры в августе?','Покажи заявки','Открой карточку','А без Жени?','А со всеми?','А в августе и сентябре?']){
  const n=resolvePeriodFollowUp(q,now,context());assert.equal(n.path,'legacy_temporal');assert.equal(n.intent,null,q);
 }
 for(const c of [null,{}, {mode:'count',resolved_filters:{}},{mode:'count',resolved_filters:{city:'Тестове'}}])
  assert.equal(resolvePeriodFollowUp('А в августе?',now,c).intent,null);
});
test('adapter unsupported input atomically returns exact legacy fallback, no widening',()=>{
 for(const extra of [{phone_digits:{provided:true,length:7}}, {mac:true}, {date_from:'31.02.2026'}, {items:[{text:'ONU',kind:'unsupported'}]}]){
  const c=context();Object.assign(c.resolved_filters,extra);const before=JSON.stringify(c);
  const n=resolvePeriodFollowUp('А в августе?',now,c);
  assert.equal(n.path,'fallback');assert.deepEqual(n.intent,temporalWorkIntent('А в августе?',now,c));
  assert.equal(JSON.stringify(c),before);
 }
});
test('normalized semantic defaults preserve legacy semantics without LLM reconstruction',()=>{
 const c={mode:'count',resolved_filters:{semantic:{entity:'onu',action:'install',profile:'onu_physical'},coworker:'Женя'}};
 const n=resolvePeriodFollowUp('А в августе?',now,c),old=temporalWorkIntent('А в августе?',now,c);
 assert.deepEqual(canonical(n.intent),canonical(old));
 assert.deepEqual(runSmartQuery(fixture,n.intent),runSmartQuery(fixture,old));
});
test('216-case mode/profile/workType matrix keeps legacy eligibility and all query envelopes',()=>{
 const questions=['А в августе?','А за август?','А в август?','А за серпень?','А у серпні?',
  'А в сентябре?','А за вересень?','А в августе 2025?','А в августе с Петей?',
  'Сравни сентябрь и август','Открой карточку','А только ремонты?'];
 let cases=0,eligible=0;
 for(const mode of ['count','list','group'])for(const profile of ['work_v2','onu_physical','physical_consumption'])
  for(const type of [undefined,'Ремонт'])for(const question of questions){
   const c={mode,resolved_filters:projectQueryFilters({date_from:'01.09.2026',date_to:'30.09.2026',
    coworker:'Женя',type,semantic:{entity:'onu',action:'install',profile}})};
   const a=temporalWorkIntent(question,now,c),b=resolvePeriodFollowUp(question,now,c);
   assert.deepEqual(b.intent,a,JSON.stringify({question,mode,profile,type}));
   if(a){assert.deepEqual(runSmartQuery(fixture,a),runSmartQuery(fixture,b.intent));eligible++;}
   cases++;
  }
 assert.equal(cases,216);assert.equal(eligible,96);
});
test('runtime performs one fresh query, same golden total after literal context serialization',async()=>{
 const tickets=[];
 for(const [month,connections,repairs] of [[9,13,7],[8,15,12]])for(const [type,n] of [['Підключення',connections],['Ремонт',repairs]]){
  for(let i=0;i<n;i++)tickets.push({...ticket,id:`SYNTHETIC_${month}_${type}_${i}`,date:`15.0${month}.2026`,type,
   macAddress:type==='Підключення'?'001122334455':'',equipment:type==='Ремонт'?[{label:'ONU',qty:1}]:[]});
 }
 const calls=[],ctx={tickets,shifts:[],searchIndex:[]};
 const o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw new Error('No LLM for period-only');}},
  tools:{query_tickets:async p=>{calls.push(p);return runSmartQuery(ctx,p);}}});
 const q1=await o.handle('Сколько ONU я поставил с Женей за сентябрь?',{now,coworkerRoster:['Женя']});
 assert.equal(q1.total,20);assert.equal(calls.length,1);
 const before=JSON.stringify(q1.queryContext),loaded=JSON.parse(before);
 const q2=await o.handle('А в августе?',{now,queryContext:loaded});
 assert.equal(q2.total,27);assert.equal(calls.length,2);
 assert.deepEqual(calls[1],temporalWorkIntent('А в августе?',now,loaded));
 const noReload=await o.handle('А в августе?',{now,queryContext:q1.queryContext});
 assert.deepEqual(noReload,q2);assert.equal(calls.length,3);
 assert.equal(JSON.stringify(q1.queryContext),before);
 assert.equal(calls[1].type,undefined);assert.equal(calls[1].semantic.profile,'onu_physical');
});
test('runtime failure does not publish new state; selected ticket never enters period transition',async()=>{
 const c=context(),before=JSON.stringify(c);
 for(const fails of ['throw','error']){
  let calls=0;
  const o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw new Error('No LLM');}},
   tools:{query_tickets:async()=>{calls++;if(fails==='throw')throw new Error('synthetic network failure');return {ok:false,code:'SYNTHETIC_ERROR'};}}});
  const result=await o.handle('А в августе?',{now,queryContext:c,selectedTicketId:'SYNTHETIC_SELECTED'});
  assert.equal(result.ok,false);assert.equal(result.queryContext,undefined);assert.equal(calls,1);
  assert.equal(JSON.stringify(c),before);
 }
 const planned=resolvePeriodFollowUp('А в августе?',now,c);
 assert.ok(!JSON.stringify(planned).includes('selectedTicketId'));
});
test('navigation between analytics turns remains its own lifecycle, without period query',async()=>{
 let queries=0;
 const o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw new Error('Selected navigation needs no LLM');}},
  tools:{query_tickets:async()=>{queries++;throw new Error('Navigation must not execute analytics');}}});
 const c=context(),before=JSON.stringify(c);
 const nav=await o.handle('Открой карточку',{now,queryContext:c,selectedTicketId:ticket.id,contextTickets:[ticket]});
 assert.equal(nav.ok,true);assert.deepEqual(nav.presentation,{kind:'single_ticket',ticket_id:ticket.id});
 assert.equal(queries,0);assert.equal(JSON.stringify(c),before);
 // No new lifecycle mechanism: use exactly whatever existing navigation emits.
 const period=resolvePeriodFollowUp('А в августе?',now,nav.queryContext);
 assert.deepEqual(period.intent,temporalWorkIntent('А в августе?',now,nav.queryContext));
});

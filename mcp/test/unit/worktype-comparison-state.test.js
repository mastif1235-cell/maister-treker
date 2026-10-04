import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAnalyticsFollowUp} from '../../src/ask/worktype-comparison-state.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {sanitizeIncomingQueryContext} from '../../src/ask/query-context.js';
const now=new Date('2026-10-04T12:00:00Z');
const context={mode:'count',resolved_filters:{date_from:'01.09.2026',date_to:'30.09.2026',coworker:'Женя',semantic:{entity:'onu',action:'install',category:'definite',profile:'onu_physical',signal_context:'subscriber'}}};
const repairs=['а только ремонты?','только ремонты','а ремонты?','только ремонтные заявки','а тільки ремонти?','тільки ремонти','а ремонти?','тільки ремонтні заявки'];
for(const q of repairs)test(`D2 typed KEEP/REPLACE: ${q}`,()=>{
 const before=JSON.stringify(context),r=resolveAnalyticsFollowUp(q,now,context);
 assert.equal(r.plans.length,1);assert.deepEqual(r.patch,{changes:{workType:{op:'REPLACE',value:'Ремонт'}}});
 assert.deepEqual(r.plans[0],{mode:'count',...context.resolved_filters,type:'Ремонт'});assert.equal(JSON.stringify(context),before);
});
for(const [q,months] of [['сравни сентябрь и август',[9,8]],['сравни август и сентябрь',[8,9]],['порівняй вересень і серпень',[9,8]],['порівняй серпень і вересень',[8,9]]])test(`D4 ordered periods: ${q}`,()=>{
 const r=resolveAnalyticsFollowUp(q,now,context);assert.equal(r.plans.length,2);
 r.plans.forEach((p,i)=>{assert.equal(p.date_from,`01.0${months[i]}.2026`);assert.equal(p.coworker,'Женя');assert.equal(p.mode,'count');assert.deepEqual(p.semantic,context.resolved_filters.semantic)});
 assert.deepEqual(Object.keys(r.patch.changes),['periods']);
});
test('closed grammar/ineligible states atomically fallback',()=>{
 for(const q of ['а только ремонты с Петей?','сравни сентябрь и август без Жени','сравни сентябрь и сентябрь','а без Жени?','а со всеми?','а роутеры?'])assert.equal(resolveAnalyticsFollowUp(q,now,context),null);
 for(const c of [null,{}, {...context,mode:'list'},{...context,mode:'stats'}, {...context,resolved_filters:{...context.resolved_filters,mac:true}}, {...context,resolved_filters:{city:'Тест'}}])assert.equal(resolveAnalyticsFollowUp('а только ремонты?',now,c),null);
});
const fixture={tickets:[],shifts:[],searchIndex:[]};
for(const [month,c,r]of [[9,13,7],[8,15,12]])for(const [type,n]of [['Підключення',c],['Ремонт',r]])for(let i=0;i<n;i++)fixture.tickets.push({id:`SYN_${month}_${type}_${i}`,date:`15.0${month}.2026`,type,connectMasters:['Женя'],tags:[],equipment:type==='Ремонт'?[{label:'ONU',qty:1}]:[],macAddress:type==='Підключення'?'001122334455':'',cables:[]});
function runtime(failureAt=0){let calls=[];const o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw Error('eligible path MUST NOT call provider')}},tools:{query_tickets:async p=>{calls.push(p);return calls.length===failureAt?{ok:false,code:'SYN_FAIL'}:runSmartQuery(fixture,p)}}});return {o,calls}}
test('D2 before-provider interception + repair->August chain',async()=>{
 const {o,calls}=runtime();const a=await o.handle('А только ремонты?',{now,queryContext:context});assert.equal(a.total,7);assert.equal(a.meta.rounds,0);assert.equal(calls.length,1);
 const b=await o.handle('А в августе?',{now,queryContext:JSON.parse(JSON.stringify(a.queryContext))});assert.equal(b.total,12);assert.equal(calls[1].type,'Ремонт');assert.equal(calls[1].coworker,'Женя');
});
test('D4 retains both results/context; reload -> repairs applies to both',async()=>{
 const {o,calls}=runtime();const a=await o.handle('Сравни сентябрь и август',{now,queryContext:context});assert.equal(a.ok,true);assert.equal(a.meta.rounds,0);assert.equal(a.meta.toolCallsMade,2);assert.equal(calls.length,2);
 assert.deepEqual(a.comparison.results.map(x=>x.total),[20,27]);assert.match(a.answer,/20/);assert.match(a.answer,/27/);
 assert.equal(a.queryContext.resolved_filters.date_from,undefined);assert.equal(a.queryContext.comparison.periods.length,2);
 const loaded=sanitizeIncomingQueryContext(JSON.parse(JSON.stringify(a.queryContext)));assert.deepEqual(loaded,a.queryContext);
 const b=await o.handle('А только ремонты?',{now,queryContext:loaded});assert.deepEqual(b.comparison.results.map(x=>x.total),[7,12]);assert.equal(calls.length,4);assert.ok(calls.slice(2).every(x=>x.type==='Ремонт'));
});
test('second-period failure publishes no partial state/result',async()=>{
 const {o,calls}=runtime(2);const a=await o.handle('Сравни сентябрь и август',{now,queryContext:context});assert.equal(a.ok,false);assert.equal(a.code,'SYN_FAIL');assert.equal(a.queryContext,undefined);assert.equal(a.comparison,undefined);assert.equal(calls.length,2);
});
test('invalid comparison intake cannot degrade to single/all-time state',()=>{
 for(const comparison of [{periods:[]},{periods:[{from:'31.02.2026',to:'30.09.2026'},{from:'01.08.2026',to:'31.08.2026'}]},{periods:[{from:'01.09.2026',to:'30.09.2026'}]}])assert.equal(sanitizeIncomingQueryContext({mode:'count',resolved_filters:context.resolved_filters,comparison}),null);
});
test('all supported extra filters KEEP; date parser anchors previous year',()=>{
 const c=structuredClone(context);Object.assign(c.resolved_filters,{city:'Тест',street:'Тестова',house:'1',apartment:'2',type:'Підключення',tags:['тест'],has_signal:true,sum_min:0,items:[{text:'ONU',kind:'equipment',quantity:1}]});
 const r=resolveAnalyticsFollowUp('А только ремонты?',now,c);assert.deepEqual(r.plans[0],{mode:'count',...c.resolved_filters,type:'Ремонт'});
 c.resolved_filters.date_from='01.09.2025';c.resolved_filters.date_to='30.09.2025';
 const a=resolveAnalyticsFollowUp('Сравни август и сентябрь',now,c);assert.ok(a.plans.every(p=>p.date_from.endsWith('.2025')));assert.ok(a.plans.every(p=>p.type==='Підключення'));
});
test('comparison unsupported follow-up clarifies, never queries all-time; no private data in results',async()=>{
 const {o,calls}=runtime();const a=await o.handle('Сравни сентябрь и август',{now,queryContext:context});
 assert.ok(!JSON.stringify(a).includes('001122334455'));
 const b=await o.handle('Покажи заявки',{now,queryContext:a.queryContext});assert.equal(b.meta.clarification,true);assert.equal(calls.length,2);assert.deepEqual(b.queryContext,a.queryContext);
 const fresh=await o.handle('Сколько ONU я поставил с Женей за сентябрь?',{now,queryContext:a.queryContext,coworkerRoster:['Женя']});assert.equal(fresh.total,20);assert.equal(calls.length,3);assert.equal(fresh.queryContext.comparison,undefined);
});

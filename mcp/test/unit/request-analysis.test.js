import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestAnalysis} from '../../src/ask/request-analysis.js';
import {workEvents} from '../../src/ask/work-events.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {createReadTools} from '../../src/tools/read.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';

function freeze(value){
  for(const key of Object.keys(value))if(value[key]&&typeof value[key]==='object')freeze(value[key]);
  return Object.freeze(value);
}
const row=(id,date='15.09.2026',extra={})=>({id,date,type:'Підключення',macAddress:'001122334455',
  note:'',connectMasters:['Женя'],tags:[],equipment:[],cables:[],presetWorks:[],additionalWork:[],...extra});
const fixture=freeze({tickets:[row('A'),row('B','15.08.2026'),row('C','16.09.2026',{type:'Ремонт',equipment:[{label:'ONU',qty:1}]}),
  row('D','17.09.2026',{note:'оставили старую ONU'}),row('E','18.09.2026',{note:'ONU клиента'}),
  row('F','19.09.2026',{note:'заменил ONU, поставил роутер',cables:[{label:'UTP',meters:15}],signal:'-27'}),
  row('G','20.09.2026',{note:'поставил 2 ONU; поставил 3 ONU'})],shifts:[],searchIndex:[]});
const semantic={entity:'onu',action:'install',profile:'onu_physical'};
const count={mode:'count',semantic};
function measured(execution){
  let calls=0;
  return {execution:{load:execution.load,analyze(ticket,index,profile,compute){
    return execution.analyze(ticket,index,profile,()=>{calls++;return freeze(compute());});
  }},calls:()=>calls};
}

test('row identity, source identity, profile identity; IDs cannot collide',()=>{
  const cache=createRequestAnalysis(),index=[],a=row('SAME'),b=row('SAME');let calls=0;
  const compute=()=>({n:++calls});
  assert.equal(cache.analyze(a,index,'',compute),cache.analyze(a,index,'',compute));
  assert.notEqual(cache.analyze(a,index,'',compute),cache.analyze(b,index,'',compute));
  cache.analyze(a,[],'',compute);cache.analyze(a,index,'work_v2',compute);
  cache.analyze(a,index,'onu_physical',compute);cache.analyze(a,index,'physical_consumption',compute);
  assert.equal(calls,6);
  for(const id of ['',null,undefined])cache.analyze(row(id),index,'',compute);
  assert.equal(calls,9);
});
test('exception is not cached; disposal releases state even if context is retained',()=>{
  const cache=createRequestAnalysis(),t=row('A'),index=[];let calls=0;
  assert.throws(()=>cache.analyze(t,index,'',()=>{calls++;throw Error('synthetic');}));
  cache.analyze(t,index,'',()=>++calls);cache.analyze(t,index,'',()=>++calls);
  assert.equal(calls,2);cache.dispose();
  cache.analyze(t,index,'',()=>++calls);cache.analyze(t,index,'',()=>++calls);
  assert.equal(calls,4);
});
test('changed public index gets a distinct analysis; semantic filtering options reuse same analysis',()=>{
  const cache=measured(createRequestAnalysis()),t=row('INDEX','15.09.2026',{type:'Ремонт'});
  const first=freeze({tickets:[t],shifts:[],searchIndex:[{id:t.id,text:'поставил ONU'}]});
  const second=freeze({...first,searchIndex:[{id:t.id,text:'поставил роутер'}]});
  for(const ctx of [first,second])for(const category of ['definite','all']){
    const args={mode:'list',semantic:{entity:'onu',action:'install',category,profile:'physical_consumption'}};
    assert.deepEqual(runSmartQuery(ctx,args,cache.execution),runSmartQuery(ctx,args));
  }
  assert.equal(cache.calls(),2);
});
test('successful read pinned, concurrent read shared, failure/exception retried',async()=>{
  const cache=createRequestAnalysis();let calls=0;
  const loader=async()=>({ok:true,n:++calls});
  const [a,b]=await Promise.all([cache.load(loader),cache.load(loader)]);
  assert.equal(a,b);assert.equal(await cache.load(loader),a);assert.equal(calls,1);
  let failures=0;const failed=async()=>{failures++;return {ok:false};};
  await cache.load(failed);await cache.load(failed);assert.equal(failures,2);
  const throwing=async()=>{failures++;throw Error('synthetic');};
  await assert.rejects(cache.load(throwing));await assert.rejects(cache.load(throwing));assert.equal(failures,4);
  cache.dispose();await cache.load(loader);assert.equal(calls,2);
});
test('masterNote never read; keys/context/response contain no private material',()=>{
  const cache=createRequestAnalysis(),ticket=row('SAFE');
  Object.defineProperty(ticket,'masterNote',{get(){throw Error('private note accessed');}});
  const index=[],result=cache.analyze(ticket,index,'onu_physical',()=>workEvents(ticket,'',{profile:'onu_physical'}));
  assert.equal(result.events[0].quantity,1);
  assert.equal(JSON.stringify(cache),'{}');assert.deepEqual(Object.keys(cache),[]);
  assert.ok(!JSON.stringify(result).includes(ticket.macAddress));
  assert.ok(!JSON.stringify(result).includes('masterNote'));
});
for(const n of [1,2,4,8])test(`operation counts: ${n} broad calls reuse unique row/profile analyses`,()=>{
  const cache=measured(createRequestAnalysis());
  for(let i=0;i<n;i++)assert.deepEqual(runSmartQuery(fixture,count,cache.execution),runSmartQuery(fixture,count));
  assert.equal(cache.calls(),fixture.tickets.length);
});
test('multi-period scans/filtering stay independent; repeat analyses do not multiply',()=>{
  const cache=measured(createRequestAnalysis());let expected=0;
  for(let i=0;i<8;i++){
    const args={...count,date_from:i%2?'01.08.2026':'01.09.2026',date_to:i%2?'31.08.2026':'30.09.2026',coworker:'Женя'};
    const actual=runSmartQuery(fixture,args,cache.execution);
    assert.deepEqual(actual,runSmartQuery(fixture,args));expected+=actual.data.total_matched;
  }
  assert.ok(expected>0);assert.equal(cache.calls(),fixture.tickets.length);
});
test('full deterministic envelopes/evidence/groups/exclusions parity across filters and profiles',()=>{
  const cache=measured(createRequestAnalysis()),before=JSON.stringify(fixture);
  for(const profile of [undefined,'work_v2','onu_physical','physical_consumption'])
    for(const mode of ['count','list','group','stats','exists'])
      for(const category of ['definite','all','excluded','ambiguous']){
        const args={mode,group_by:'coworker',limit:3,semantic:{...semantic,profile,category},coworker:'Женя'};
        assert.deepEqual(runSmartQuery(fixture,args,cache.execution),runSmartQuery(fixture,args));
      }
  for(const entity of ['onu','router','cable',undefined])for(const action of ['install','replace',undefined]){
    const args={mode:'group',group_by:'entity',semantic:{entity,action,profile:'physical_consumption',signal_context:'any'}};
    assert.deepEqual(runSmartQuery(fixture,args,cache.execution),runSmartQuery(fixture,args));
  }
  for(const args of [{mode:'count'},{mode:'list',coworker:'Женя'},{mode:'group',group_by:'type'}])
    assert.deepEqual(runSmartQuery(fixture,args,cache.execution),runSmartQuery(fixture,args));
  assert.equal(JSON.stringify(fixture),before);
});
test('duplicate/malformed IDs preserve baseline behavior without analysis aliasing',()=>{
  const ctx=freeze({tickets:[row('DUP'),row('DUP','15.09.2026',{note:'ONU клиента'}),row(''),row(undefined)],shifts:[],searchIndex:[]});
  const cache=measured(createRequestAnalysis());
  for(let i=0;i<2;i++)assert.deepEqual(runSmartQuery(ctx,{...count,mode:'list'},cache.execution),runSmartQuery(ctx,{...count,mode:'list'}));
  assert.equal(cache.calls(),4);
});
test('read tool uses stable snapshot identities despite provider returning fresh JSON each time',async()=>{
  let reads=0;const tools=createReadTools({data:{getList:async()=>{reads++;return {ok:true,data:JSON.parse(JSON.stringify(fixture))};}}});
  const cache=measured(createRequestAnalysis());
  const first=await tools.query_tickets(count,cache.execution);
  for(let i=0;i<7;i++)assert.deepEqual(await tools.query_tickets(count,cache.execution),first);
  assert.equal(reads,1);assert.equal(cache.calls(),fixture.tickets.length);
  await tools.query_tickets(count);assert.equal(reads,2); // raw MCP remains uncached
});
test('orchestrator shares one context across all tool calls; next/concurrent handles isolated; finally disposes',async()=>{
  let reads=0,computations=0;const contexts=[];
  const read=createReadTools({data:{getList:async()=>{reads++;return {ok:true,data:JSON.parse(JSON.stringify(fixture))};}}});
  const tools={query_tickets:async(args,execution)=>{
    contexts.push(execution);
    const spy={load:execution.load,analyze:(t,s,p,compute)=>execution.analyze(t,s,p,()=>{computations++;return compute();})};
    return read.query_tickets(args,spy);
  }};
  const groq={chat:async(messages)=>messages.at(-1).role==='user'
    ? {ok:true,assistantMessage:{role:'assistant',content:null},toolCalls:Array.from({length:8},(_,i)=>({id:String(i),name:'query_tickets',argsRaw:JSON.stringify(count)}))}
    : {ok:true,toolCalls:[],content:'Синтетичне порівняння'}};
  const ask=createAskOrchestrator({groq,tools,toolDefs:TOOL_DEFINITIONS});
  const result=await ask.handle('Сравни сентябрь и август',{});
  assert.equal(result.ok,true);assert.equal(reads,1);assert.equal(computations,fixture.tickets.length);
  assert.equal(new Set(contexts).size,1);assert.ok(!JSON.stringify(result).includes('analyze'));
  const t=row('LIFETIME'),source=[];let disposedCalls=0;
  contexts[0].analyze(t,source,'',()=>++disposedCalls);contexts[0].analyze(t,source,'',()=>++disposedCalls);
  assert.equal(disposedCalls,2);
  await Promise.all([ask.handle('Сравни сентябрь и август',{}),ask.handle('Сравни сентябрь и август',{})]);
  assert.equal(new Set(contexts).size,3);assert.equal(reads,3);assert.equal(computations,3*fixture.tickets.length);
});
test('orchestrator early deterministic path owns/disposes its context; error exit too',async()=>{
  const contexts=[];const ask=createAskOrchestrator({groq:{chat:async()=>{throw Error('must not call provider');}},
    toolDefs:TOOL_DEFINITIONS,tools:{query_tickets:async(args,execution)=>{contexts.push(execution);return runSmartQuery(fixture,args,execution);}}});
  const result=await ask.handle('Сколько ONU поставил с Женей за сентябрь?',{now:new Date('2026-10-04T12:00:00Z'),coworkerRoster:['Женя']});
  assert.equal(result.ok,true);assert.equal(contexts.length,1);
  let calls=0;for(let i=0;i<2;i++)contexts[0].analyze(fixture.tickets[0],fixture.searchIndex,'',()=>++calls);
  assert.equal(calls,2);
  const failed=createAskOrchestrator({groq:{chat:async()=>({ok:false,code:'SYNTHETIC_FAILURE'})},toolDefs:TOOL_DEFINITIONS,tools:{}});
  assert.equal((await failed.handle('Сравни сентябрь и август',{})).code,'SYNTHETIC_FAILURE');
});
test('concurrent handles with different snapshots cannot observe each other data',async()=>{
  let reads=0;const outcomes=new Map(),identities=new Map();
  const read=createReadTools({data:{getList:async()=>{
    const n=++reads;
    await new Promise(resolve=>setTimeout(resolve,n===1?5:0));
    return {ok:true,data:freeze({tickets:[row('ISOLATED_'+n,'15.09.2026',{equipment:[{label:'ONU',qty:n}]})],shifts:[],searchIndex:[]})};
  }}});
  const tools={query_tickets:async(p,execution)=>{
    const result=await read.query_tickets({...p,mode:'list'},execution);
    if(!outcomes.has(execution))outcomes.set(execution,[]);
    outcomes.get(execution).push(result.data.work_totals.quantity_sum);
    if(!identities.has(execution))identities.set(execution,new Set());
    for(const t of result.data.tickets)identities.get(execution).add(t.id);
    return result;
  }};
  const groq={chat:async(messages)=>messages.at(-1).role==='user'
    ? {ok:true,assistantMessage:{role:'assistant',content:null},toolCalls:[0,1].map(i=>({id:String(i),name:'query_tickets',argsRaw:JSON.stringify(count)}))}
    : {ok:true,toolCalls:[],content:'Синтетичне порівняння'}};
  const ask=createAskOrchestrator({groq,tools,toolDefs:TOOL_DEFINITIONS});
  const results=await Promise.all([ask.handle('Сравни сентябрь и август',{}),ask.handle('Сравни сентябрь и август',{})]);
  assert.ok(results.every(result=>result.ok));assert.equal(reads,2);assert.equal(outcomes.size,2);
  assert.deepEqual([...outcomes.values()].sort((a,b)=>a[0]-b[0]),[[1,1],[2,2]]);
  assert.deepEqual([...identities.values()].map(ids=>[...ids]).sort(),[['ISOLATED_1'],['ISOLATED_2']]);
});
test('failed query read remains an error; next call pins only the successful read',async()=>{
  let reads=0;
  const tools=createReadTools({data:{getList:async()=>++reads===1?{ok:false,code:'SYNTHETIC_READ_FAILURE'}:{ok:true,data:fixture}}});
  const execution=createRequestAnalysis();
  assert.deepEqual(await tools.query_tickets(count,execution),{ok:false,code:'SYNTHETIC_READ_FAILURE'});
  const expected=runSmartQuery(fixture,count);
  for(let i=0;i<8;i++)assert.deepEqual(await tools.query_tickets(count,execution),expected);
  assert.equal(reads,2);execution.dispose();
});
test('provider failure after a query still disposes analysis; no state in prompt/logs/response',async()=>{
  let held,rounds=0;const messagesSeen=[],logs=[];
  const originalLog=console.log;console.log=(...values)=>logs.push(values);
  try{
    const ask=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,
      tools:{query_tickets:async(p,execution)=>{held=execution;return runSmartQuery(fixture,p,execution);}},
      groq:{chat:async messages=>{messagesSeen.push(JSON.stringify(messages));return ++rounds===1
        ? {ok:true,assistantMessage:{role:'assistant',content:null},toolCalls:[{id:'q',name:'query_tickets',argsRaw:JSON.stringify(count)}]}
        : {ok:false,code:'SYNTHETIC_FAILURE'};}}});
    const result=await ask.handle('Сравни сентябрь и август',{});
    assert.equal(result.code,'SYNTHETIC_FAILURE');assert.ok(!JSON.stringify(result).includes('analyze'));
    assert.ok(messagesSeen.every(s=>!s.includes('createRequestAnalysis')&&!s.includes('masterNote')));
    assert.deepEqual(logs,[]);assert.equal(JSON.stringify(held),'{}');
    let executions=0;for(let i=0;i<2;i++)held.analyze(fixture.tickets[0],fixture.searchIndex,'onu_physical',()=>++executions);
    assert.equal(executions,2);
  }finally{console.log=originalLog;}
});

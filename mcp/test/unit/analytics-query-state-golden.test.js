/* Synthetic safety harness for frozen v91.84, not a copy of customer rows. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {workEvents} from '../../src/ask/work-events.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {fromExisting,toExisting} from '../../src/ask/analytics-query-state.js';
const semantic={entity:'onu',action:'install',profile:'onu_physical',category:'definite'};
const row={id:'SYNTHETIC',date:'15.09.2026',type:'Ремонт',equipment:[],cables:[],tags:[],connectMasters:[],note:'',macAddress:''};
const tickets=[];
for(const [month,connections,repairs,withCoworkerConnections,withCoworkerRepairs] of [[9,20,8,13,7],[8,15,12,15,12]]){
 for(const [kind,n,matched] of [['connection',connections,withCoworkerConnections],['repair',repairs,withCoworkerRepairs]]){
  for(let i=0;i<n;i++)tickets.push({...row,id:`SYNTHETIC_${month}_${kind}_${i}`,date:`15.0${month}.2026`,
   type:kind==='connection'?'Підключення':'Ремонт',
   // MAC is an invented fixture value, never production data.
   macAddress:kind==='connection'?'001122334455':'',
   equipment:kind==='repair'&&i!==n-1?[{label:'ONU',qty:1,price:0}]:[],
   note:kind==='repair'&&i===n-1?'Поменял онушку по гарантии':'',
   connectMasters:i<matched&&i%2===0?['Женя']:[],tags:i<matched&&i%2===1?['Женя']:[]});
 }
}
const ctx={tickets,shifts:[],searchIndex:[]};
for(const [name,filters,total,connections,repairs] of [
 ['September all',{date_from:'01.09.2026',date_to:'30.09.2026'},28,20,8],
 ['September coworker',{date_from:'01.09.2026',date_to:'30.09.2026',coworker:'Женя'},20,13,7],
 ['August coworker',{date_from:'01.08.2026',date_to:'31.08.2026',coworker:'Женя'},27,15,12]
])test('v91.84 golden '+name+' and pure adapter engine parity',()=>{
 const args={mode:'count',...filters,semantic},actual=runSmartQuery(ctx,args);
 assert.equal(actual.ok,true);assert.equal(actual.data.work_totals.quantity_sum,total);
 const b=actual.data.work_totals.onu_breakdown;
 assert.equal(b.new_connections,connections);assert.equal(b.replacements,repairs);
 const compiled=toExisting(fromExisting(actual.data.resolved_filters,{mode:'count'}))[0];
 assert.deepEqual(runSmartQuery(ctx,compiled).data,actual.data);
});
test('frozen temporal follow-up including serialized reload keeps scope and golden counts',async()=>{
 const calls=[];
 const o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,
  groq:{chat(){throw new Error('Existing deterministic temporal path must remain unchanged');}},
  tools:{query_tickets:async p=>{calls.push(p);return runSmartQuery(ctx,p);}}});
 const first=await o.handle('Сколько ONU я поставил с Женей за сентябрь?',{now:new Date('2026-10-04'),coworkerRoster:['Женя']});
 assert.equal(first.total,20);
 const next=await o.handle('А в августе?',{now:new Date('2026-10-04'),queryContext:JSON.parse(JSON.stringify(first.queryContext))});
 assert.equal(next.total,27);assert.equal(calls.at(-1).type,undefined);
 assert.deepEqual(calls.at(-1).semantic,calls[0].semantic);
 assert.equal(calls.at(-1).coworker,calls[0].coworker);assert.equal(calls.at(-1).mode,'count');
});
for(const [name,fields,note,quantity] of [
 ['connection',{type:'Підключення',macAddress:'001122334455'},'',1],
 ['old fault',{type:'Підключення',macAddress:'001122334455'},'На старой ONU жужжат дросселя',1],
 ['retained',{type:'Підключення',macAddress:'001122334455'},'оставили старую ONU',0],
 ['transfer',{type:'Підключення',macAddress:'001122334455'},'перенесли эту же ONU',0],
 ['used',{type:'Підключення',macAddress:'001122334455'},'ONU б/у',0],
 ['owned',{type:'Підключення',macAddress:'001122334455'},'ONU клиента',0],
 ['structured dedup',{equipment:[{label:'ONU',qty:1}]},'заменил ONU',1],
 ['structured two',{equipment:[{label:'ONU',qty:2}]},'',2],
 ['free warranty',{},'поменял онушку по гарантии бесплатно',1],
 ['planned',{},'завтра заменим ONU',0],['negated',{},'не поставил ONU',0],['signal',{},'ONU -27 dBm',0]
])test('frozen physical safety '+name,()=>{
 const analysis=workEvents({...row,...fields,note},'',semantic);
 assert.equal(analysis.events.filter(e=>e.entity==='onu'&&e.category==='definite').reduce((s,e)=>s+(e.quantity||0),0),quantity);
});
test('QueryState runtime ownership limited to period/combined bridges; READ-ONLY contract stays frozen',()=>{
 const root=new URL('../../src/',import.meta.url);
 function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const path=new URL(entry.name+(entry.isDirectory()?'/':''),dir);
  if(entry.isDirectory()) scan(path);
  else if(entry.name.endsWith('.js')&&entry.name!=='analytics-query-state.js'){
   if(!['period-query-state.js','combined-query-state.js'].includes(entry.name))
    assert.doesNotMatch(fs.readFileSync(path,'utf8'),/analytics-query-state/,'only approved pure planning bridges may import QueryState');
  }
 }}scan(root);
 assert.equal(TOOL_DEFINITIONS.length,12);
 assert.ok(TOOL_DEFINITIONS.every(t=>t.annotations.readOnlyHint&&!t.annotations.destructiveHint));
});

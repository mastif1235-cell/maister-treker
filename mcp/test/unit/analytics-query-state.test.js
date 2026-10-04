import test from 'node:test';
import assert from 'node:assert/strict';
import {fromExisting,toExisting,normalizeAnalyticsState,reduceAnalyticsState} from '../../src/ask/analytics-query-state.js';
const sep={from:'01.09.2026',to:'30.09.2026'}, aug={from:'01.08.2026',to:'31.08.2026'};
const base=()=>fromExisting({date_from:sep.from,date_to:sep.to,coworker:'Женя',
  semantic:{entity:'onu',action:'install',profile:'physical_consumption'},type:'Ремонт'},{mode:'count'});
const replace=(field,value)=>({changes:{[field]:{op:'REPLACE',value}}});
const reduce=(s,p)=>{const r=reduceAnalyticsState(s,p);assert.equal(r.ok,true);return r.state;};

test('period-only / entity-only patches preserve independent constraints',()=>{
 const s=base(), n=reduce(s,replace('periods',[aug]));
 assert.deepEqual({...n,periods:s.periods},s);
 const router=reduce(s,replace('entity','router'));
 assert.deepEqual(router.periods,s.periods);assert.deepEqual(router.coworker,s.coworker);
 assert.equal(router.profile,'physical_consumption');
});
test('KEEP and REMOVE absent constraint are idempotent; independent patches commute',()=>{
 const s=base(), keep={changes:{entity:{op:'KEEP'}}}, remove={changes:{groupBy:{op:'REMOVE'}}};
 assert.deepEqual(reduce(reduce(s,keep),keep),s);
 assert.deepEqual(reduce(reduce(s,remove),remove),s);
 const p=replace('periods',[aug]),c=replace('coworker',{kind:'include',name:'Петя'});
 assert.deepEqual(reduce(reduce(s,p),c),reduce(reduce(s,c),p));
});
test('coworker REMOVE is Any, not Exclude; compiler refuses unsupported exclusion',()=>{
 const s=base(), any=reduce(s,{changes:{coworker:{op:'REMOVE'}}});
 assert.deepEqual(any.coworker,{kind:'any'});assert.equal(toExisting(any)[0].coworker,undefined);
 const exclude=reduce(s,replace('coworker',{kind:'exclude',name:'Женя'}));
 assert.deepEqual(exclude.coworker,{kind:'exclude',name:'Женя'});
 assert.throws(()=>toExisting(exclude),/Phase 2/);
});
test('invalid and ambiguous patches have no partial commit and do not mutate inputs',()=>{
 const s=base(),before=JSON.stringify(s);
 for(const p of [{changes:{periods:{op:'REPLACE',value:[aug]},entity:{op:'REPLACE',value:'nonsense'}}},
   {changes:{workType:{op:'REPLACE'}}},{changes:{coworker:{op:'REPLACE',value:{kind:'exclude'}}}},
   {changes:{periods:{op:'REPLACE',value:[{from:'31.02.2026'}]}}},
   {changes:{entity:{op:'KEEP',value:'router'}}},
   {changes:{measure:{op:'REPLACE',value:'kg'}}},
   {clarification:'What does all mean?',changes:{periods:{op:'REPLACE',value:[aug]}}}]){
   const r=reduceAnalyticsState(s,p);assert.equal(r.ok,false);assert.equal(r.state,s);
   assert.equal(JSON.stringify(s),before);
 }
});
test('explicit null is invalid, never a disguised REMOVE',()=>{
 const s=base();
 for(const field of ['periods','coworker','filters','aggregation','measure']){
  assert.throws(()=>normalizeAnalyticsState({...s,[field]:null}));
  assert.equal(reduceAnalyticsState(s,replace(field,null)).ok,false);
 }
 assert.equal(reduceAnalyticsState(s,{changes:null}).ok,false);
 assert.equal(reduceAnalyticsState(s,replace('coworker',{kind:'any',note:undefined})).ok,false);
 assert.equal(reduceAnalyticsState(s,replace('filters',{sum_min:Infinity})).ok,false);
 assert.equal(reduceAnalyticsState(s,replace('filters',{city:new Date()})).ok,false);
});
test('dependent ONU profile is rejected atomically, never silently reused for router',()=>{
 const s=fromExisting({semantic:{profile:'onu_physical',entity:'onu',action:'install'}},{mode:'count'});
 assert.equal(reduceAnalyticsState(s,replace('entity','router')).ok,false);
 const next=reduce(s,{changes:{entity:{op:'REPLACE',value:'router'},profile:{op:'REPLACE',value:'physical_consumption'}}});
 assert.equal(next.entity,'router');assert.equal(next.profile,'physical_consumption');
});
test('serialization, deterministic compiler, isolation and deep input immutability',()=>{
 const s=base(),before=JSON.stringify(s);
 assert.deepEqual(normalizeAnalyticsState(JSON.parse(before)),s);
 assert.deepEqual(toExisting(s),toExisting(JSON.parse(before)));
 const out=toExisting(s);out[0].semantic.entity='router';assert.equal(JSON.stringify(s),before);
 for(const key of ['masterNote','note','tickets','resultSet','selectedTicketId','error','cooldown','requestId','status','answer','password']){
   assert.throws(()=>normalizeAnalyticsState({...s,[key]:'private'}));
   assert.throws(()=>fromExisting({[key]:'private'}));
   assert.equal(reduceAnalyticsState(s,replace(key,'private')).ok,false);
 }
});
test('supported resolved filters round-trip including item scope and UUIDs',()=>{
 const filters={date_from:sep.from,date_to:sep.to,city:'Дніпро',street:'Тестова',house:'1б',apartment:'2',
  city_id:'11111111-1111-4111-8111-111111111111',street_id:'22222222-2222-4222-8222-222222222222',
  tags:['Гарантія'],payment:'безкоштовно',sum_min:0,sum_max:100,signal_worse_than:-25,
  signal_worse_or_equal:-28,signal_better_than:-35,has_signal:true,
  items:[{text:'ONU',kind:'equipment',unit_price:0,quantity:1,total:0}],coworker:'Женя',type:'Ремонт',
  semantic:{entity:'onu',action:'install',category:'definite',signal_context:'subscriber',profile:'physical_consumption'}};
 const args=toExisting(fromExisting(filters,{mode:'group',group_by:'type'}))[0];
 assert.deepEqual(args,{mode:'group',...filters,group_by:'type'});
 for(const mode of ['list','exists','count','stats']) assert.deepEqual(toExisting(fromExisting({}, {mode})),[{mode}]);
 assert.deepEqual(toExisting(fromExisting({items:[{quantity:2,kind:'equipment',text:'ONU'}]})),
  [{mode:'list',items:[{text:'ONU',kind:'equipment',quantity:2}]}]);
});
test('unrepresentable/lossy/redacted filters fail explicitly, never widen queries',()=>{
 for(const f of [{phone_digits:{provided:true,length:7}},{mac:true},{contract:true},
  {items:[{text:'ONU',kind:'unknown'}]},{tags:Array(21).fill('x')},{city:'x'.repeat(101)},
  {date_from:'30.09.2026',date_to:'01.09.2026'},{semantic:null}]) assert.throws(()=>fromExisting(f));
 assert.throws(()=>normalizeAnalyticsState({...base(),filters:JSON.parse('{"__proto__":{"evil":true}}')}));
 assert.equal({}.evil,undefined);
});
test('multiple periods compile separate deterministic plans, not a last-period overwrite',()=>{
 const s=reduce(base(),replace('periods',[sep,aug]));
 const plans=toExisting(s);assert.equal(plans.length,2);
 assert.equal(plans[0].date_from,sep.from);assert.equal(plans[1].date_from,aug.from);
 assert.equal(plans[0].coworker,plans[1].coworker);
});
test('metamorphic temporal and entity round-trips; independent August state equivalence',()=>{
 const s=base();
 const august=reduce(s,replace('periods',[aug]));
 const {mode,...filters}=toExisting(s)[0];
 const independent=fromExisting({...filters,date_from:aug.from,date_to:aug.to},{mode});
 assert.deepEqual(august,independent);
 assert.deepEqual(reduce(august,replace('periods',[sep])),s);
 assert.deepEqual(reduce(reduce(s,replace('entity','router')),replace('entity','onu')),s);
});

// Independent reference model: uses field assignment/defaults, no production
// reducer or normalizer. Generated cases deliberately stay in supported schema.
function reference(state,patch){
 const out=structuredClone(state);
 for(const [k,c] of Object.entries(patch.changes)){
   if(c.op==='REPLACE') out[k]=structuredClone(c.value);
   if(c.op==='REMOVE'){
     if(k==='coworker') out[k]={kind:'any'};
     else if(k==='periods') out[k]=[];
     else if(k==='aggregation') out[k]='list';
     else delete out[k];
   }
 }
 return out;
}
test('model-based 1–8 transition chains on five independent fields',()=>{
 const operations=[replace('periods',[aug]),replace('periods',[sep]),replace('coworker',{kind:'include',name:'Петя'}),
  {changes:{coworker:{op:'REMOVE'}}},replace('workType','Підключення'),{changes:{workType:{op:'REMOVE'}}},
  replace('entity','router'),replace('entity','onu'),replace('aggregation','list'),replace('aggregation','count'),
  {changes:{periods:{op:'KEEP'}}}];
 let seed=8491,transitions=0;
 for(let length=1;length<=8;length++) for(let sample=0;sample<128;sample++){
   let actual=base(),expected=base();
   for(let i=0;i<length;i++){
     seed=(Math.imul(seed,1664525)+1013904223)>>>0;
     const p=operations[seed%operations.length];
     expected=reference(expected,p);actual=reduce(actual,p);
     assert.deepEqual(actual,expected);transitions++;
   }
 }
 assert.equal(transitions,4608);
});

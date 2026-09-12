'use strict';
const assert=require('node:assert/strict');
const core=require('../js/sync-engine-core.js');
const {Engine}=require('../js/sync-engine-runtime.js');
const restore=require('../js/restore-from-sheets.js');

let seq=0;
const random=()=>`baseline_${++seq}_abcdefghijklmnop`;

// 1. cloud revision > 1 → наступна правка йде з правильною наступною revision.
let state=core.seedBaseline({records:{}},'ticket','t1',{revision:7,tombstone:false});
assert.equal(state.records['ticket:t1'].committedRevision,7);
state=core.enqueue(state,{entity:'ticket',id:'t1',payload:{content:'edit'}},random);
assert.equal(core.pending(state)[0].revision,8,'ticket edit continues at 8');
assert.equal(core.pending(state)[0].action,'updateTicket','existing cloud ticket edits as update');

// 2. те саме для shift.
state=core.seedBaseline({records:{}},'shift','s1',{revision:3,tombstone:false});
state=core.enqueue(state,{entity:'shift',id:'s1',payload:{hours:9}},random);
assert.equal(core.pending(state)[0].revision,4,'shift edit continues at 4');
assert.equal(core.pending(state)[0].action,'updateShift');

// 3. одразу після seed немає pending у черзі.
state=core.seedBaseline({records:{}},'ticket','t2',{revision:5,tombstone:false});
assert.equal(core.pending(state).length,0,'seeded baseline is not queued');

// 4. правка після restore стає в чергу рівно один раз.
state=core.enqueue(state,{entity:'ticket',id:'t2',payload:{content:'x'}},random);
assert.equal(core.pending(state).length,1,'one edit enqueues once');

// 7. відсутня/нульова revision → безпечна поведінка: наступна правка = revision 1 add.
state=core.seedBaseline({records:{}},'ticket','t3',{revision:0,tombstone:false});
state=core.enqueue(state,{entity:'ticket',id:'t3',payload:{content:'legacy'}},random);
assert.equal(core.pending(state)[0].revision,1);
assert.equal(core.pending(state)[0].action,'addTicket');

// 8. повторний restore не відкочує revision назад.
state=core.seedBaseline({records:{}},'ticket','t4',{revision:9,tombstone:false});
state=core.seedBaseline(state,'ticket','t4',{revision:6,tombstone:false});
assert.equal(state.records['ticket:t4'].committedRevision,9,'no regression to lower revision');

// seed не затирає незавершену мутацію.
state=core.enqueue(core.seedBaseline({records:{}},'ticket','t5',{revision:2,tombstone:false}),{entity:'ticket',id:'t5',payload:{content:'x'}},random);
assert.throws(()=>core.seedBaseline(state,'ticket','t5',{revision:3,tombstone:false}),/PENDING_MUTATION/);

// 9/10. конфлікт local не чіпає baseline; cloud отримує серверний baseline.
function ticketToSyncPayload(t){
  return {id:String(t.id||''),date:String(t.date||''),time:String(t.time||''),content:String(t.content||''),sum:Number(t.sum)||0,tags:Array.isArray(t.tags)?t.tags:[],backupNote:'',fullDataJson:JSON.stringify({city:t.city||'',clientName:t.clientName||''})};
}
const deps={blankTicketObject:()=>({}),parseBackupNote:()=>({geoLink:'',masterNote:'',login:'',password:'',fullData:null}),ticketToSyncPayload};
const local=[{id:'c1',date:'01.09.2026',time:'10:00',content:'local',sum:100,tags:[],city:'Київ',clientName:'Іван'}];
const cloudRow={id:'c1',date:'01.09.2026',time:'10:00',content:'cloud',sum:100,tags:[],backupNote:'',fullDataJson:JSON.stringify({city:'Київ',clientName:'Іван'})};
const plan=restore.buildTicketPlan(local,[cloudRow],deps);
assert.equal(plan.stats.conflictCount,1);
assert.deepEqual(restore.baselineRequests(plan,{c1:'local'}),[],'local conflict keeps local baseline');
assert.deepEqual(restore.baselineRequests(plan,{c1:'cloud'}),[{entity:'ticket',id:'c1'}],'cloud conflict fetches cloud baseline');
assert.equal(restore.applyTicketPlan(local,[cloudRow],{c1:'local'},deps)[0].content,'local','local decision keeps local content');
assert.equal(restore.applyTicketPlan(local,[cloudRow],{c1:'cloud'},deps)[0].content,'cloud','cloud decision imports cloud content');

// Engine integration: seed → edit → server accepts наступну revision без STALE.
function storage(seed){let value=JSON.parse(JSON.stringify(seed||{records:{}}));return{load:async()=>JSON.parse(JSON.stringify(value)),save:async v=>{value=JSON.parse(JSON.stringify(v));},value:()=>value};}
(async()=>{
  let online=true;const sends=[];
  const db=storage();
  const engine=new Engine({core,storage:db,payload:(_entity,item)=>item,online:()=>online,transport:{send:async m=>{sends.push(m);return{ok:true,state:{revision:m.revision,tombstone:false}};}}});
  await engine.init();
  await engine.seedBaseline('ticket','t1',{revision:7,tombstone:false});
  assert.equal(engine.pendingCount(),0,'seeded entity not pending');
  await engine.recordDiff('ticket',[{id:'t1',content:'old'}],[{id:'t1',content:'new'}]);
  await engine.loop;
  assert.equal(sends.length,1);
  assert.equal(sends[0].revision,8,'server receives next revision, not 1');
  assert.equal(sends[0].action,'updateTicket');
  assert.equal(engine.pendingCount(),0);

  const shiftSends=[];
  const shiftDb=storage();
  const shiftEngine=new Engine({core,storage:shiftDb,payload:(_entity,item)=>item,online:()=>true,transport:{send:async m=>{shiftSends.push(m);return{ok:true,state:{revision:m.revision,tombstone:false}};}}});
  await shiftEngine.init();
  await shiftEngine.seedBaseline('shift','s1',{revision:4,tombstone:false});
  await shiftEngine.recordDiff('shift',[{id:'s1',hours:8}],[{id:'s1',hours:9}]);
  await shiftEngine.loop;
  assert.equal(shiftSends[0].revision,5,'shift server receives next revision');
  assert.equal(shiftSends[0].action,'updateShift');

  console.log('PASS restore seeds durable server baseline so next edits skip STALE');
})().catch(error=>{console.error(error);process.exitCode=1;});

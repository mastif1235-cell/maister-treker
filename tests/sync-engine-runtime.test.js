'use strict';
const assert=require('node:assert/strict');
const core=require('../js/sync-engine-core.js');
const {Engine}=require('../js/sync-engine-runtime.js');
function storage(seed={records:{}}){let value=JSON.parse(JSON.stringify(seed));let saves=0;return{load:async()=>JSON.parse(JSON.stringify(value)),save:async v=>{saves++;value=JSON.parse(JSON.stringify(v));},value:()=>value,saves:()=>saves};}
const payload=id=>({id,date:'23.08.2026',time:'10:00',content:'x',sum:1,tags:[]});
(async()=>{
  let online=false,sends=0;const db=storage();
  const engine=new Engine({core,storage:db,payload:(_entity,item)=>item,online:()=>online,transport:{send:async m=>{sends++;return{ok:true,state:{revision:m.revision,tombstone:m.action==='deleteTicket'}};}}});
  await engine.init();
  await engine.recordDiff('ticket',[],[payload('t1')]);
  assert.equal(sends,0,'offline queues without network');assert.equal(core.pending(db.value()).length,1,'journal durable before send');
  online=true;const a=engine.flush(),b=engine.flush();assert.equal(a,b,'only one recovery loop');await a;assert.equal(sends,1);assert.equal(engine.pendingCount(),0);

  const pending=core.markAttempted(core.enqueue({records:{}},{entity:'ticket',id:'restart',payload:payload('restart')},()=> 'restart_request_abcdefghijkl'),'ticket','restart');
  const restartDb=storage(pending);let restartSends=0;
  const restarted=new Engine({core,storage:restartDb,payload:(_entity,item)=>item,online:()=>true,transport:{send:async m=>{restartSends++;return{ok:true,state:{revision:m.revision,tombstone:false}};}}});
  await restarted.init();await restarted.loop;assert.equal(restartSends,1,'already-online startup recovers head');

  let tail=core.enqueue({records:{}},{entity:'ticket',id:'tail',payload:payload('tail')},()=> 'head_request_abcdefghijkl');tail=core.markAttempted(tail,'ticket','tail');tail=core.enqueue(tail,{entity:'ticket',id:'tail',payload:{...payload('tail'),content:'edit'}},()=> 'tail_request_abcdefghijkl');
  const tailDb=storage(tail);let order=[];const tailEngine=new Engine({core,storage:tailDb,payload:(_entity,item)=>item,online:()=>true,transport:{send:async m=>{order.push(m.action);return{ok:true,state:{revision:m.revision,tombstone:false}};}}});
  await tailEngine.init();await tailEngine.loop;assert.deepEqual(order,['addTicket','updateTicket'],'restart recovers head then tail serially');

  const stuckItem={entity:'ticket',id:'production-gap',action:'addTicket',revision:2,requestId:'stuck_request_abcdefghijkl',body:{...payload('production-gap'),action:'addTicket',revision:2}};
  const stuckDb=storage({records:{'ticket:production-gap':{entity:'ticket',id:'production-gap',committedRevision:1,tombstone:false,head:stuckItem,tail:null}}});
  const recoveredSends=[];
  const recoveryEngine=new Engine({core,storage:stuckDb,payload:(_entity,item)=>item,online:()=>true,transport:{send:async m=>{
    recoveredSends.push({action:m.action,revision:m.revision,id:m.id});
    if(m.revision===2)return{ok:false,result:{status:'error',code:'REVISION_GAP',state:{revision:0,rowIndex:-1,tombstone:false}}};
    return{ok:true,state:{revision:1,tombstone:false}};
  }}});
  await recoveryEngine.init();await recoveryEngine.loop;
  assert.deepEqual(recoveredSends,[{action:'addTicket',revision:2,id:'production-gap'},{action:'addTicket',revision:1,id:'production-gap'}],'only exact missing-row addTicket gap is rebased once');
  assert.equal(recoveryEngine.pendingCount(),0,'recovered ticket is acknowledged normally');
  assert.equal(stuckDb.value().records['ticket:production-gap'].committedRevision,1,'recovered ticket commits revision one');
  const exactGapState={records:{'ticket:production-gap':{entity:'ticket',id:'production-gap',committedRevision:1,tombstone:false,head:stuckItem,tail:null}}};
  for(const server of [{revision:1,rowIndex:-1,tombstone:false},{revision:0,rowIndex:2,tombstone:false},{revision:0,rowIndex:-1,tombstone:true}]){
    const rejected=core.recoverUncommittedAddTicketGap(exactGapState,stuckItem,server,()=> 'unused_request_abcdefghijkl');
    assert.equal(rejected.recovered,false,'recovery rejects every non-exact server state');
    assert.deepEqual(rejected.state,exactGapState,'rejected recovery leaves the journal unchanged');
  }

  let transportOk=false,backoffSends=0,timerId=0;const timers=[];
  const backoffDb=storage();
  const backoffEngine=new Engine({core,storage:backoffDb,payload:(_entity,item)=>item,online:()=>true,retryDelays:[2000,5000,15000,30000],setTimeout:(fn,delay)=>{const timer={id:++timerId,fn,delay,cancelled:false};timers.push(timer);return timer.id;},clearTimeout:id=>{const timer=timers.find(item=>item.id===id);if(timer)timer.cancelled=true;},transport:{send:async m=>{backoffSends++;return transportOk?{ok:true,state:{revision:m.revision,tombstone:false}}:{ok:false,result:{status:'error',code:'NETWORK'}};}}});
  await backoffEngine.init();await backoffEngine.recordDiff('ticket',[],[payload('backoff')]);await backoffEngine.loop;
  assert.equal(backoffSends,1,'transport failure performs only one immediate request');
  assert.equal(timers.length,1,'transport failure schedules one retry timer');
  assert.equal(timers[0].delay,2000,'automatic retry starts with two-second backoff');
  await Promise.resolve();await Promise.resolve();
  assert.equal(backoffSends,1,'microtasks do not create a request storm');
  for(const expectedDelay of [5000,15000,30000,30000]){
    timers[timers.length-1].fn();await backoffEngine.loop;
    assert.equal(timers[timers.length-1].delay,expectedDelay,'automatic retries advance and cap the backoff');
  }
  transportOk=true;timers[timers.length-1].fn();await backoffEngine.loop;
  assert.equal(backoffSends,6,'transport performs exactly one successful send after recovery');
  assert.equal(backoffEngine.pendingCount(),0,'successful delayed retry clears pending');

  transportOk=false;const manualTimers=[];let manualSends=0;
  const manualEngine=new Engine({core,storage:storage(),payload:(_entity,item)=>item,online:()=>true,retryDelays:[2000,5000,15000,30000],setTimeout:(fn,delay)=>{const timer={id:manualTimers.length+1,fn,delay,cancelled:false};manualTimers.push(timer);return timer.id;},clearTimeout:id=>{const timer=manualTimers.find(item=>item.id===id);if(timer)timer.cancelled=true;},transport:{send:async m=>{manualSends++;return transportOk?{ok:true,state:{revision:m.revision,tombstone:false}}:{ok:false,result:{status:'error',code:'NETWORK'}};}}});
  await manualEngine.init();await manualEngine.recordDiff('ticket',[],[payload('manual')]);await manualEngine.loop;
  assert.equal(manualSends,1,'manual scenario begins with one failed request');
  transportOk=true;await manualEngine.flush();
  assert.equal(manualSends,2,'manual flush retries immediately without waiting for timer');
  assert.equal(manualTimers[0].cancelled,true,'manual flush cancels scheduled automatic retry');
  assert.equal(manualEngine.pendingCount(),0,'manual retry clears pending after success');
  console.log('PASS durable-before-send/offline-online/single-loop/startup head/head+tail recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});

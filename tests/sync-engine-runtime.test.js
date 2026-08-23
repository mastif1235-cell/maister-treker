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
  console.log('PASS durable-before-send/offline-online/single-loop/startup head/head+tail recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict');
const core=require('../js/sync-engine-core.js');
const {createServer,createDevice,clone}=require('./helpers/sync-gas-harness.js');
(async()=>{
  for(const entity of ['ticket','shift']){
    let state={records:{}};
    for(let i=0;i<4;i++){
      state=core.enqueue(state,{entity,id:'synthetic',payload:{content:'offline-'+i}},()=> 'synthetic-request-'+i);
      const head=core.pending(state)[0];
      assert.equal(head.revision,head.body.revision,'offline coalescing keeps wire revision equal');
    }
    state=core.markAttempted(state,entity,'synthetic');
    for(let i=0;i<4;i++)state=core.enqueue(state,{entity,id:'synthetic',payload:{content:'tail-'+i}},()=> 'synthetic-tail-'+i);
    const r=state.records[entity+':synthetic'];
    assert.equal(r.tail.revision,r.tail.body.revision);
    core.assertInvariants(state);
  }
  const server=createServer(),A=await createDevice({server,online:false});
  await A.addTicket({id:'offline-synthetic',date:'01.02.2026',time:'10:00',content:'first',sum:100});
  await A.editTicket('offline-synthetic',{content:'second'});
  await A.editTicket('offline-synthetic',{content:'final'});
  const restarted=await createDevice({server,online:false,journal:A.journal(),tickets:clone(A.ctx.tickets)});
  restarted.setOnline(true);await restarted.flush();
  assert.equal(restarted.engine.pendingCount(),0);
  assert.equal(server.ticketRow('offline-synthetic').content,'final');
  assert.equal(server.ticketRow('offline-synthetic').sum,100);
  assert.equal(server.ticketIds().length,1);
  restarted.setOnline(false);
  await restarted.editTicket('offline-synthetic',{content:'edit-1'});
  await restarted.editTicket('offline-synthetic',{content:'edit-2'});
  restarted.setOnline(true);await restarted.flush();
  assert.equal(restarted.engine.pendingCount(),0);
  assert.equal(server.state('ticket','offline-synthetic').revision,2);
  assert.equal(server.ticketRow('offline-synthetic').content,'edit-2');
  console.log('PASS A01 offline create/edit coalescing, attempted tail, restart and real mock GAS delivery');
})().catch(e=>{console.error(e);process.exitCode=1;});

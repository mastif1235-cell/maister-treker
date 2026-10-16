'use strict';
// Diagnostic only: real repository GAS runs entirely in the in-memory harness.
const assert=require('node:assert/strict');
const {createServer,createDevice,clone}=require('../tests/helpers/sync-gas-harness');
(async()=>{
  const server=createServer(),seed=await createDevice({server});
  await seed.addTicket({id:'synthetic-partial',date:'01.02.2026',time:'10:00',content:'baseline',sum:100});
  const baseline={tickets:clone(seed.ctx.tickets),journal:seed.journal()};
  const A=await createDevice({server,...baseline}),B=await createDevice({server,...baseline});
  const write=server.context.syncWriteEntityState_;let fail=true;
  server.context.syncWriteEntityState_=function(...args){if(fail){fail=false;throw Error('synthetic state commit failure');}return write(...args);};
  await A.editTicket('synthetic-partial',{content:'partially written A'});
  assert.equal(server.ticketRow('synthetic-partial').content,'partially written A');
  assert.equal(server.state('ticket','synthetic-partial').revision,1);
  assert.equal(A.engine.pendingCount(),1);
  await B.editTicket('synthetic-partial',{content:'B at the same revision'});
  assert.equal(server.ticketRow('synthetic-partial').content,'B at the same revision');
  assert.equal(server.state('ticket','synthetic-partial').revision,2);
  console.log('CONFIRMED A05: row write precedes state commit; different mutation at same revision accepted. BLOCKED: requires a durable server prepare/commit recovery protocol. No production access.');
})().catch(e=>{console.error(e);process.exitCode=1;});

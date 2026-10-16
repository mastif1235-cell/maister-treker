'use strict';
const assert=require('node:assert/strict');
const transport=require('../js/sync-transport'),{createServer,HMAC_SECRET,createDevice,ticketToSyncPayload}=require('./helpers/sync-gas-harness');
(async()=>{
  const ticket={id:'synthetic-cell',date:'01.02.2026',time:'10:00',content:'synthetic',sum:100};
  const large=JSON.stringify({v:'x'.repeat(50001-8)});
  assert.equal(large.length,50001);
  const server=createServer();
  assert.equal(server.context.syncValidTicket_({...ticket,fullDataJson:large}),false,'GAS must reject before Sheets write');
  const device=await createDevice({server,online:false});
  device.engine.payload=(_entity,t)=>({...ticketToSyncPayload(t),fullDataJson:large});
  device.setOnline(true);await device.addTicket(ticket);
  assert.equal(device.engine.pendingCount(),1);assert.equal(device.conflict('ticket',ticket.id).code,'INVALID_INPUT');
  assert.equal(server.ticketRow(ticket.id),null);assert.equal(device.ticket(ticket.id).sum,100);
  const mutation={entity:'ticket',id:ticket.id,action:'addTicket',requestId:'synthetic-cell-request',body:{...ticket,fullDataJson:large.slice(0,50000)}};
  assert.ok(await transport.signedEnvelope(mutation,HMAC_SECRET,()=> 'synthetic-nonce-123456789',Date.now));
  console.log('PASS H3 fullDataJson cell cap; oversized ticket parked intact with no server write or truncation');
})().catch(e=>{console.error(e);process.exitCode=1;});

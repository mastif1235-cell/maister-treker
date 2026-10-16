'use strict';
// A known main snapshot is NOT proof of the active private GAS deployment.
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {createServer,createDevice,clone}=require('./helpers/sync-gas-harness');
(async()=>{
  const source=execFileSync('git',['show','97842f230b76008ac26058a303048053f63fc27e:Code.gs'],{encoding:'utf8'});
  const server=createServer({source}),d=await createDevice({server});
  await d.addTicket({id:'synthetic-legacy',date:'01.02.2026',time:'10:00',content:'first',sum:100});
  assert.equal(d.isSynced('ticket','synthetic-legacy'),true);
  await d.editTicket('synthetic-legacy',{content:'second'});
  assert.equal(server.ticketRow('synthetic-legacy').content,'second');assert.equal(server.ticketRow('synthetic-legacy').sum,100);
  const result=await d.transport.listAll('tickets');
  assert.equal(result.ok,true);assert.equal(result.result.tickets.length,1);
  assert.equal(result.result.scope,undefined,'old server ignores scoped-list hint without changing the protocol');
  const previous=clone(d.ctx.tickets);d.ctx.tickets=[];await d.engine.recordDiff('ticket',previous,[]);await d.flush();
  assert.equal(d.isSynced('ticket','synthetic-legacy'),true);
  server.context.PropertiesService.getScriptProperties().deleteProperty('MT_SHIFTS_SPREADSHEET_ID');
  assert.equal((await d.transport.listAll('tickets')).ok,false,'A04 scoped independence still requires the new primary GAS; failure is explicit');
  console.log('PASS new client / known main GAS snapshot: add, edit, list, delete; no claim about live deployment');
})().catch(e=>{console.error(e);process.exitCode=1;});

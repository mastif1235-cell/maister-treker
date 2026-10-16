'use strict';
const assert=require('node:assert/strict');
const {createServer,createDevice,clone}=require('./helpers/sync-gas-harness');
(async()=>{
  const device=await createDevice({server:createServer(),online:false,modules:['backup']});
  await device.addTicket({id:'synthetic-queue',date:'01.02.2026',time:'10:00',content:'pending',sum:100});
  const journal=device.journal(),tickets=clone(device.ctx.tickets);
  for(const broken of [{records:{bad:{tail:{revision:2}}}}, {}, (()=>{const j=clone(journal);Object.values(j.records)[0].head.body.revision=999;return j;})()]){
    const saves=device.storage.saves();
    await assert.rejects(()=>device.restoreFileBackup({tickets:[],syncJournal:broken}),/BAD_PAYLOAD/);
    assert.deepEqual(device.journal(),journal);assert.deepEqual(clone(device.ctx.tickets),tickets);
    assert.equal(device.storage.saves(),saves,'invalid journal rejected before any durable replacement');
  }
  const save=device.storage.save;
  await assert.rejects(()=>device.restoreFileBackup({tickets:[],syncJournal:{records:{}}}),/BACKUP_PENDING_LOCAL_CHANGES/);
  assert.deepEqual(device.journal(),journal,'live pending work blocks replacement before writes');
  const idle=await createDevice({server:createServer(),online:false,modules:['backup']});
  const idleJournal=idle.journal(),idleTickets=clone(idle.ctx.tickets);
  idle.storage.save=async()=>{throw new Error('synthetic journal write failure');};
  device.storage.save=async()=>{throw new Error('synthetic journal write failure');};
  await assert.rejects(()=>idle.restoreFileBackup({tickets:[],syncJournal:clone(journal)}),/synthetic journal write failure/);
  assert.deepEqual(idle.journal(),idleJournal);assert.deepEqual(clone(idle.ctx.tickets),idleTickets);
  assert.deepEqual(device.journal(),journal);assert.deepEqual(clone(device.ctx.tickets),tickets);
  device.storage.save=save;
  console.log('PASS A03 malformed journal rejected before restore writes; live pending queue retained');
})().catch(e=>{console.error(e);process.exitCode=1;});

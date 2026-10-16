'use strict';
const assert=require('node:assert/strict');
const {createServer,createDevice}=require('./helpers/sync-gas-harness');
(async()=>{
  const server=createServer(),device=await createDevice({server});
  await device.addTicket({id:'synthetic-read',date:'01.02.2026',time:'10:00',sum:100});
  server.context.PropertiesService.getScriptProperties().deleteProperty('MT_SHIFTS_SPREADSHEET_ID');
  const response=await device.transport.listAll('tickets');
  assert.equal(response.ok,true,'ticket-only reading must not open shift workbook');
  assert.equal(response.result.tickets.length,1);
  assert.equal(response.result.scope,'tickets');
  const restore=require('../js/restore-from-sheets');
  const payload=JSON.parse(JSON.stringify(response.result));
  assert.equal(restore.validateCloudListPayload(payload,'tickets').ok,true);
  assert.equal(restore.validateCloudListPayload(payload,'both').ok,false,'partial read cannot clear shifts');
  assert.equal((await device.transport.listAll()).ok,false,'full read must not silently pretend missing shifts are empty');
  console.log('PASS A04 independent signed ticket-only read; full-read shift errors remain explicit');
})().catch(e=>{console.error(e);process.exitCode=1;});

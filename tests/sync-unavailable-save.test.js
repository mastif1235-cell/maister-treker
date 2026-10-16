'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const storage=fs.readFileSync('js/ticket-state-storage.js','utf8');
const app=fs.readFileSync('app.js','utf8');
const badge=app.slice(app.indexOf('function isEntitySynced('),app.indexOf('function getEntityConflict('));
const core=require('../js/sync-engine-core.js');
function context(values,engine){
  const c={tickets:[{id:'synthetic',content:'edit',sum:100}],syncTicketsSnapshot:[{id:'synthetic',content:'before',sum:100}],
    ticketsRevision:0,syncEngine:engine,MTSyncEngineCore:core,showToast(){},ticketsDbPut:async()=>true,
    localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
  vm.createContext(c);vm.runInContext(storage+'\n'+badge,c);return c;
}
(async()=>{
  const values=new Map(),c=context(values,null);
  assert.equal(await c.saveTickets(),true,'ticket remains durable locally');
  assert.equal(c.syncTicketsSnapshot[0].content,'before','missing engine cannot advance journal baseline');
  assert.equal(c.isEntitySynced('ticket','synthetic'),false);
  const restarted=context(values,{state:{records:{}}});
  restarted.syncTicketsSnapshot=JSON.parse(JSON.stringify(restarted.tickets));
  assert.equal(restarted.isEntitySynced('ticket','synthetic'),false,'durable warning survives restart');
  assert.equal(restarted.isEntitySynced('ticket','untouched'),true);
  const fail=context(new Map(),{recordDiff:()=>Promise.reject(Error('synthetic quota')),state:{records:{}}});
  await fail.saveTickets();assert.equal(fail.isEntitySynced('ticket','synthetic'),false);
  c.syncEngine={recordDiff:async()=>{},state:{records:{}}};
  await c.saveTickets();assert.equal(c.isEntitySynced('ticket','synthetic'),true,'marker cleared only after successful journaling of the diff');
  console.log('PASS A12 durable unjournaled marker, truthful badge, preserved baseline and local data');
})().catch(e=>{console.error(e);process.exitCode=1;});

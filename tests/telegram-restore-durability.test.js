'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/telegram-full-snapshot.js','utf8');
const ticket={id:'synthetic-restore',date:'01.02.2026',type:'Ремонт',content:'synthetic',sum:100};
function context(save){const c={tickets:[],deletedTickets:[],saveTicketsLocalOnly:save,blankTicketObject:()=>({}),document:{addEventListener(){}},photoDbGet:async()=>null,photoDbPut:async()=>true};vm.createContext(c);vm.runInContext(source,c);return c;}
const snapshot={MT_FULL_SNAPSHOT:1,schema:1,tickets:[ticket]};
(async()=>{
  const c=context(async()=>false);
  assert.equal((await c.restoreFromTelegramFullSnapshot(snapshot)).ok,false,'failed save cannot report successful restore');
  assert.equal(c.tickets.length,0,'failed restore remains retryable');
  c.saveTicketsLocalOnly=async()=>true;
  assert.equal((await c.restoreFromTelegramFullSnapshot(snapshot)).restored,1);
  console.log('PASS A10 Telegram restore requires durable local save and remains retryable');
})().catch(e=>{console.error(e);process.exitCode=1;});

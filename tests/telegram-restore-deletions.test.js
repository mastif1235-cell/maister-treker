'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/telegram-full-snapshot.js','utf8');
const snapshot={MT_FULL_SNAPSHOT:1,schema:1,tickets:[{id:'synthetic-deleted',date:'01.02.2026',type:'Ремонт',sum:100}]};
(async()=>{
  for(const evidence of ['trash','tombstone','pending-delete']){
    let saves=0;const c={tickets:[],deletedTickets:evidence==='trash'?[{id:'synthetic-deleted'}]:[],
      syncEngine:{state:{records:evidence==='trash'?{}:{'ticket:synthetic-deleted':{entity:'ticket',id:'synthetic-deleted',tombstone:evidence==='tombstone',head:evidence==='pending-delete'?{action:'deleteTicket'}:null}}}},
      saveTicketsLocalOnly:async()=>{saves++;return true;},blankTicketObject:()=>({}),document:{addEventListener(){}}};
    vm.createContext(c);vm.runInContext(source,c);
    assert.equal(c.analyzeSnapshotForRestore(snapshot).deletedCount,1,evidence+' recognized in preview');
    const result=await c.restoreFromTelegramFullSnapshot(snapshot);
    assert.equal(result.skippedDeleted,1);assert.equal(c.tickets.length,0);assert.equal(saves,0);
  }
  console.log('PASS A11 local trash, durable tombstones and pending deletes prevent old snapshot resurrection');
})().catch(e=>{console.error(e);process.exitCode=1;});

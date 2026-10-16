'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {functions}=require('./helpers/tools-source');
const fn=functions(fs.readFileSync('js/tickets-domain.js','utf8')).find(f=>f.name==='deleteTicket');
(async()=>{
  for(const mode of ['removed','reordered']){
    let release,entered;
    const started=new Promise(r=>entered=r),c={tickets:[{id:'A'},{id:'B'}],openConfirmModal:async()=>true,
      moveTicketToTrash:async()=>{entered();return new Promise(r=>release=r);},showToast(){},renderTicketsScreen(){},saveTickets:async()=>true};
    vm.createContext(c);vm.runInContext(fn.body,c);
    const deleting=c.deleteTicket('A');await started;
    c.tickets=mode==='removed'?[{id:'B'}]:[{id:'B'},c.tickets[0]];
    release({ok:true});await deleting;
    assert.deepEqual(c.tickets.map(t=>t.id),['B'],'concurrent array changes must preserve B');
  }
  console.log('PASS A06 deletion uses stable ID after asynchronous trash persistence');
})().catch(e=>{console.error(e);process.exitCode=1;});

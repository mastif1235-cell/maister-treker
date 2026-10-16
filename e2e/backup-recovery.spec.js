'use strict';
const {test,expect,gotoApp,waitAppReady}=require('./app-test');

for(const fault of ['none','notification','journal','ticket','interrupted','rollback-fails','corrupt','prewrite','incoming-pending']){
  test('backup recovery persists across real IndexedDB reopen: '+fault,async({page,appEnv})=>{
    await gotoApp(page,appEnv.url);
    const result=await page.evaluate(async fault=>{
      openConfirmModal=async()=>true;
      tickets=[{id:'synthetic-backup',date:'01.02.2026',content:'previous',sum:100}];
      syncTicketsSnapshot=JSON.parse(JSON.stringify(tickets));await saveTicketsLocalOnly();
      await syncEngine.replaceState({records:{}});
      const previous={tickets:JSON.parse(JSON.stringify(tickets)),ticketSnapshot:JSON.parse(JSON.stringify(tickets)),shifts:null,settings:null,tools:null,journal:{records:{}}};
      if(fault==='interrupted'){
        await backupDbPut('backup-restore-checkpoint-v1',{version:1,previous});
        localStorage.setItem('mtBackupRestorePendingV1','1');
        tickets=[{id:'synthetic-backup',content:'partial',sum:100}];await ticketsDbPut(tickets);
        return {blocked:MTBackupRestoreBlocked()};
      }
      const save=syncEngine.storage.save.bind(syncEngine.storage);let once=true;
      if(fault==='notification')syncEngine.onChange=()=>{throw Error('synthetic notification');};
      if(fault==='journal'||fault==='rollback-fails')syncEngine.storage.save=async s=>{
        if(once||fault==='rollback-fails'){once=false;throw Error('synthetic journal refusal');}return save(s);
      };
      if(fault==='ticket'){
        const put=ticketsDbPut;ticketsDbPut=async t=>{if(once){once=false;return false;}return put(t);};
      }
      const restoredTicket={id:'synthetic-backup',date:'01.02.2026',content:'restored',sum:100};
      const journal=fault==='incoming-pending'?MTSyncEngineCore.enqueue({records:{}},{entity:'ticket',id:restoredTicket.id,payload:ticketToSyncPayload(restoredTicket)},MTSyncEngineRuntime.uuid):
        fault==='corrupt'?{records:{bad:{tail:{revision:2}}}}:{records:{}};
      await backupDbPut('synthetic-import',{app:'master-tracker',tickets:[restoredTicket],syncJournal:journal});
      if(fault==='prewrite')backupDbPut=async()=>false;
      await restoreDailyBackup('synthetic-import');
      return {blocked:MTBackupRestoreBlocked(),synced:isEntitySynced('ticket','synthetic-backup')};
    },fault);
    if(fault==='rollback-fails')expect(result).toEqual({blocked:true,synced:false});
    await page.reload({waitUntil:'domcontentloaded'});await waitAppReady(page);
    const durable=await page.evaluate(async()=>({tickets:(await ticketsDbRead()).value,journal:await MTSyncJournalStorage.load(),blocked:MTBackupRestoreBlocked(),synced:isEntitySynced('ticket','synthetic-backup')}));
    expect(durable.tickets).toHaveLength(1);
    expect(durable.tickets[0].content).toBe(['none','notification','incoming-pending'].includes(fault)?'restored':'previous');
    expect(durable.tickets[0].sum).toBe(100);
    if(fault==='incoming-pending'){
      expect(durable.synced).toBe(false);expect(durable.journal.records['ticket:synthetic-backup'].head.revision).toBe(1);
    }else expect(durable.journal).toEqual({records:{}});
    expect(durable.blocked).toBe(false);
  });
}

for(const mode of ['tail','delete']){
  test('backup cannot lose pending '+mode+' across IndexedDB reopen',async({page,appEnv})=>{
    await gotoApp(page,appEnv.url);
    const before=await page.evaluate(async mode=>{
      openConfirmModal=async()=>true;
      tickets=[{id:'synthetic-pending',date:'01.02.2026',content:'pending',sum:100}];
      await syncEngine.recordDiff('ticket',[],tickets);
      await syncEngine.persistTransition(s=>MTSyncEngineCore.markAttempted(s,'ticket','synthetic-pending'));
      const previous=JSON.parse(JSON.stringify(tickets));
      if(mode==='delete')tickets=[];else tickets[0].content='pending second edit';
      await syncEngine.recordDiff('ticket',previous,tickets);await saveTicketsLocalOnly();
      const journal=await MTSyncJournalStorage.load();
      await backupDbPut('synthetic-import',{tickets:[],syncJournal:{records:{}}});
      await restoreDailyBackup('synthetic-import');
      return journal;
    },mode);
    await page.reload({waitUntil:'domcontentloaded'});await waitAppReady(page);
    const after=await page.evaluate(async()=>({journal:await MTSyncJournalStorage.load(),synced:isEntitySynced('ticket','synthetic-pending')}));
    expect(after.journal).toEqual(before);expect(after.synced).toBe(false);
  });
}

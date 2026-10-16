'use strict';
const assert=require('node:assert/strict');
const {createServer,createDevice,clone}=require('./helpers/sync-gas-harness');
const ticket={id:'synthetic-restore',date:'01.02.2026',time:'10:00',content:'local',sum:100};
(async()=>{
  let checks=0;
  // Pending head, several edits/tail and delete must survive an attempted older restore.
  for(const mode of ['head','tail','delete']){
    const d=await createDevice({server:createServer(),online:false,modules:['backup']});
    await d.addTicket(ticket);
    if(mode==='tail'){
      await d.engine.persistTransition(s=>d.ctx.MTSyncEngineCore.markAttempted(s,'ticket',ticket.id));
      await d.editTicket(ticket.id,{content:'second edit'});await d.editTicket(ticket.id,{content:'third edit'});
      assert.ok(d.record('ticket',ticket.id).tail);
    }
    if(mode==='delete'){
      // A separate acknowledged device models an actual pending deletion.
      await d.engine.replaceState({records:{'ticket:synthetic-restore':{entity:'ticket',id:ticket.id,committedRevision:1,tombstone:false,head:null,tail:null}}});
      await d.engine.recordDiff('ticket',clone(d.ctx.tickets),[]);d.ctx.tickets=[];
    }
    const before=d.journal(),data=clone(d.ctx.tickets),writes=d.ctx.ticketWrites;
    await assert.rejects(()=>d.restoreFileBackup({tickets:[],syncJournal:{records:{}}}),/BACKUP_PENDING_LOCAL_CHANGES/);
    assert.deepEqual(await d.storage.load(),before);assert.deepEqual(clone(d.ctx.tickets),data);assert.equal(d.ctx.ticketWrites,writes);
    const reopened=await createDevice({server:createServer(),online:false,journal:await d.storage.load(),tickets:data});
    assert.equal(reopened.isSynced('ticket',ticket.id),false);checks++;
  }
  // Notification failure after commit is not a storage failure: keep the complete new state.
  const source=await createDevice({server:createServer(),online:false});await source.addTicket(ticket);
  const d=await createDevice({server:createServer(),online:false,modules:['backup']});
  d.engine.onChange=()=>{throw Error('synthetic notification');};
  assert.equal(await d.restoreFileBackup({tickets:[ticket],syncJournal:source.journal()}),true);
  const reopened=await createDevice({server:createServer(),online:false,journal:await d.storage.load(),tickets:clone(d.ctx.tickets)});
  assert.equal(reopened.isSynced('ticket',ticket.id),false);assert.equal(reopened.ticket(ticket.id).sum,100);checks++;
  // Before-write refusal and failure after ticket persistence both preserve old state.
  for(const point of ['snapshot','ticket','journal','journal-after-commit','photo-migration']){
    const x=await createDevice({server:createServer(),online:false,tickets:[ticket],modules:['backup']});
    const old=clone(x.ctx.tickets),journal=x.journal();
    const save=x.storage.save,put=x.ctx.saveTicketsLocalOnly;let once=true;
    if(point==='snapshot')x.ctx.backupDbPut=async()=>false;
    if(point==='ticket')x.ctx.saveTicketsLocalOnly=async()=>{if(once){once=false;return false;}return put();};
    if(point.startsWith('journal'))x.storage.save=async s=>{if(once){once=false;if(point==='journal-after-commit')await save(s);throw Error('synthetic journal refusal');}return save(s);};
    if(point==='photo-migration')x.ctx.migrateLegacyPhotosToIdb=async()=>{throw Error('synthetic photo migration');};
    await assert.rejects(()=>x.restoreFileBackup({tickets:[{...ticket,content:'backup',sum:100}],syncJournal:{records:{}}}));
    assert.deepEqual(clone(x.ctx.tickets),old);assert.deepEqual(await x.storage.load(),journal);checks++;
  }
  const deleted=await createDevice({server:createServer(),online:false,modules:['backup']});
  await deleted.engine.seedBaseline('ticket',ticket.id,{revision:4,tombstone:true});
  await deleted.restoreFileBackup({tickets:[ticket],syncJournal:{records:{}}});
  assert.equal(deleted.ctx.tickets.length,0);assert.equal(deleted.record('ticket',ticket.id).tombstone,true);checks++;
  const photo=await createDevice({server:createServer(),online:false,tickets:[ticket],modules:['backup']});
  let photoWrites=0;photo.ctx.photoDbGet=async()=> 'data:image/png;base64,OLD';photo.ctx.photoDbPut=async()=>{photoWrites++;return true;};
  await assert.rejects(()=>photo.restoreFileBackup({tickets:[ticket],photoData:{'idb:synthetic-photo':'data:image/png;base64,NEW'}}),/PHOTO_RESTORE_CONFLICT/);
  assert.equal(photoWrites,0);assert.equal(photo.ticket(ticket.id).sum,100);checks++;
  console.log('PASS backup recovery journal scenarios: '+checks);
})().catch(e=>{console.error(e);process.exitCode=1;});

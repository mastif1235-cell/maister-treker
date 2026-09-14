'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','tickets-domain.js'),'utf8');
const start=source.indexOf('async function deleteTicket('),end=source.indexOf('\nfunction renderDeletedTicketsList(){',start);
assert.ok(start>=0&&end>start,'trash transaction helpers have one bounded source block');
const now=Date.UTC(2026,8,14),day=24*60*60*1000;
function harness({deletedTickets=[],persistFails=false,ticketPersistFails=false,photoFailure=false}={}){
  const writes=[],physicalDeletes=[],toasts=[],events=[];let ticketWrites=0;
  const context={
    DELETED_TICKET_RETENTION_DAYS:30,deletedTickets:JSON.parse(JSON.stringify(deletedTickets)),tickets:[],
    Date:{now:()=>now},Promise,Set,Array,JSON,String,Number,globalThis:null,
    localStorage:{setItem(key,value){events.push('trash-save');writes.push({key,value});if(persistFails)throw new Error('quota');}},
    showToast:message=>toasts.push(message),renderTicketsScreen(){},renderDeletedTicketsList(){},
    openConfirmModal:async()=>true,MTSyncEngineRuntime:{uuid:()=> 'restored-id'},currentTicketDate:'14.09.2026',
    saveTickets:async()=>{ticketWrites++;events.push('ticket-save');return !ticketPersistFails;},
    deletePhotoKey:async key=>{events.push(`photo:${key}`);if(photoFailure)throw new Error('photo storage unavailable');physicalDeletes.push(key);return true;}
  };
  context.globalThis=context;
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  return {context,writes,physicalDeletes,toasts,events,get ticketWrites(){return ticketWrites;}};
}
(async()=>{
  // A. Normal trash commits its recovery record first and keeps a recent photo.
  const normal=harness();
  const moved=await normal.context.moveTicketToTrash({id:'normal',photos:['idb:normal']});
  assert.equal(moved.ok,true,'normal trash is committed');
  assert.equal(normal.context.deletedTickets.length,1);assert.deepEqual(normal.physicalDeletes,[],'recent photo remains recoverable');
  assert.match(normal.writes[0].value,/idb:normal/,'trash metadata reaches durable storage before any possible cleanup');
  const deleteFlow=harness();deleteFlow.context.tickets.push({id:'delete-normal',photos:['idb:delete-normal']});
  assert.equal(await deleteFlow.context.deleteTicket('delete-normal'),true,'normal delete waits for durable trash and local ticket save');
  assert.equal(deleteFlow.context.tickets.length,0);assert.equal(deleteFlow.context.deletedTickets.length,1);assert.deepEqual(deleteFlow.physicalDeletes,[]);

  // B. Restore makes the live ticket durable before it removes the trash metadata.
  const restore=harness({deletedTickets:[{id:'old',deletedAt:now-2*day,photos:['idb:restore'],content:'saved'}]});
  assert.equal(await restore.context.restoreDeletedTicket(now-2*day),true,'restore succeeds');
  assert.equal(restore.ticketWrites,1,'restored ticket is durably saved first');
  assert.deepEqual(restore.events,['ticket-save','trash-save'],'restore commits the live ticket before committing removal from the basket');
  assert.equal(restore.context.tickets[0].id,'restored-id');assert.equal(restore.context.deletedTickets.length,0);
  assert.deepEqual(restore.physicalDeletes,[],'restore never destroys its photo');
  const restorePersistenceFailure=harness({deletedTickets:[{id:'restore-failed',deletedAt:now-2*day,photos:['idb:restore-failed']}],ticketPersistFails:true});
  assert.equal(await restorePersistenceFailure.context.restoreDeletedTicket(now-2*day),false,'restore is not reported successful if saving the live ticket fails');
  assert.equal(restorePersistenceFailure.context.tickets.length,0);assert.equal(restorePersistenceFailure.context.deletedTickets.length,1,'failed restore retains the complete basket recovery record');
  assert.deepEqual(restorePersistenceFailure.physicalDeletes,[]);

  // C. Expiry commits the reduced basket before physical cleanup begins.
  const expiry=harness({deletedTickets:[{id:'expired',deletedAt:now-31*day,photos:['idb:expired-a','idb:expired-b']} ]});
  const expiryResult=await expiry.context.cleanupExpiredDeletedTickets(now);
  assert.deepEqual({...expiryResult},{ok:true,removed:1,cleanupFailed:false});
  assert.equal(expiry.context.deletedTickets.length,0);
  assert.deepEqual(expiry.physicalDeletes.sort(),['idb:expired-a','idb:expired-b']);
  assert.ok(expiry.writes.length===1,'only the committed post-expiry metadata is saved');
  assert.ok(expiry.events.indexOf('trash-save')<expiry.events.indexOf('photo:idb:expired-a'),'physical cleanup begins only after metadata write');

  // D/F. A localStorage failure leaves the old basket state and every physical photo untouched.
  const persistenceFailure=harness({deletedTickets:[{id:'expired',deletedAt:now-31*day,photos:['idb:keep']}],persistFails:true});
  const failedExpiry=await persistenceFailure.context.cleanupExpiredDeletedTickets(now);
  assert.equal(failedExpiry.ok,false);assert.equal(persistenceFailure.context.deletedTickets.length,1);assert.deepEqual(persistenceFailure.physicalDeletes,[]);
  const failedPurge=await persistenceFailure.context.purgeDeletedTicket(now-31*day);
  assert.equal(failedPurge,false);assert.equal(persistenceFailure.context.deletedTickets.length,1);assert.deepEqual(persistenceFailure.physicalDeletes,[],'no physical delete follows a failed metadata transition');
  const failedMove=await persistenceFailure.context.moveTicketToTrash({id:'new',photos:['idb:new']});
  assert.equal(failedMove.ok,false);assert.equal(persistenceFailure.context.deletedTickets.length,1,'failed normal trash preserves the existing recovery list');
  const failedDelete=harness({persistFails:true});failedDelete.context.tickets.push({id:'delete-failed',photos:['idb:delete-failed']});
  assert.equal(await failedDelete.context.deleteTicket('delete-failed'),false,'ticket deletion is not reported successful when the trash cannot persist');
  assert.equal(failedDelete.context.tickets.length,1);assert.equal(failedDelete.context.deletedTickets.length,0);assert.deepEqual(failedDelete.physicalDeletes,[],'failed delete leaves ticket and photo references untouched');
  assert.ok(failedDelete.toasts.some(message=>/не вдалося безпечно зберегти/i.test(message)),'failed delete gives a clear recovery warning');

  // E. A physical cleanup failure is reported after metadata commit; the photo remains, never becomes data loss.
  const cleanupFailure=harness({deletedTickets:[{id:'expired',deletedAt:now-31*day,photos:['idb:still-here']}],photoFailure:true});
  const failedCleanup=await cleanupFailure.context.cleanupExpiredDeletedTickets(now);
  assert.equal(failedCleanup.ok,true);assert.equal(failedCleanup.cleanupFailed,true);assert.equal(cleanupFailure.context.deletedTickets.length,0);
  assert.deepEqual(cleanupFailure.physicalDeletes,[],'failed photo deletion does not claim to have destroyed the blob');
  assert.ok(cleanupFailure.toasts.some(message=>/не вдалося прибрати/.test(message)),'physical cleanup failure is visible to the user');
  const sharedPhoto=harness({deletedTickets:[{id:'expired',deletedAt:now-31*day,photos:['idb:shared']}]});sharedPhoto.context.tickets.push({id:'live',photos:['idb:shared']});
  await sharedPhoto.context.cleanupExpiredDeletedTickets(now);
  assert.deepEqual(sharedPhoto.physicalDeletes,[],'an expired trash record never destroys a photo still referenced by a live ticket');

  assert.match(source,/if\(!saveDeletedTickets\(retained\)\)[\s\S]*?return \{ok:false[\s\S]*?deleteUnreferencedTicketPhotos/,'expiry cannot enter physical cleanup before metadata persistence succeeds');
  assert.match(source,/if\(!saveDeletedTickets\(next\)\)return \{ok:false[\s\S]*?deleteUnreferencedTicketPhotos/,'normal trash cannot enter physical cleanup before metadata persistence succeeds');
  assert.doesNotMatch(source,/DELETED_TICKETS_MAX/,'the old automatic 31st-ticket/photo purge remains removed');
  console.log('PASS photo trash commits metadata first and preserves blobs across persistence/cleanup failures');
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const settingsSource=fs.readFileSync(path.join(root,'js','settings-core.js'),'utf8');
const ticketsSource=fs.readFileSync(path.join(root,'js','tickets-domain.js'),'utf8');
const appSource=fs.readFileSync(path.join(root,'app.js'),'utf8');

const saveDeletedSource=ticketsSource.slice(ticketsSource.indexOf('function saveDeletedTickets(){'),ticketsSource.indexOf('\nfunction restoreDeletedTicket',ticketsSource.indexOf('function saveDeletedTickets(){')));
const migrationSource=appSource.slice(appSource.indexOf('async function migrateLegacySyncState(){'),appSource.indexOf('\nfunction isEntitySynced',appSource.indexOf('async function migrateLegacySyncState(){')));

function settingsContext(lock){
  const writes=[];
  const context={URL,Date,settings:{theme:'dark'},loadJSON:()=>null,localStorage:{setItem:(key,value)=>writes.push([key,value])}};
  if(lock!==undefined) context.MTSingleWriterLock={warn:()=>lock};
  vm.createContext(context);vm.runInContext(settingsSource,context);
  return {context,writes};
}
function deletedContext(lock){
  const writes=[];
  const context={deletedTickets:[{id:'deleted'}],localStorage:{setItem:(key,value)=>writes.push([key,value])}};
  if(lock!==undefined) context.MTSingleWriterLock={warn:()=>lock};
  vm.createContext(context);vm.runInContext(saveDeletedSource,context);
  return {context,writes};
}
async function migrationContext(lock){
  const writes=[];let journalWrites=0,ticketWrites=0,trashWrites=0;
  const context={tickets:[{id:'legacy',synced:false}],deletedTickets:[{id:'gone',pendingCloudDelete:true}],shifts:[{id:'shift'}],localStorage:{getItem:()=>null,setItem:(key,value)=>writes.push([key,value])},
    syncEngine:{recordDiff:async()=>{journalWrites++;},persistTransition:async()=>{journalWrites++;},core:{enqueue(){}}},MTSyncEngineRuntime:{uuid:()=> 'uuid'},ticketsDbPut:async()=>{ticketWrites++;},saveDeletedTickets:()=>{trashWrites++;}};
  if(lock!==undefined) context.MTSingleWriterLock={warn:()=>lock};
  vm.createContext(context);vm.runInContext(migrationSource,context);await context.migrateLegacySyncState();
  return {writes,journalWrites,ticketWrites,trashWrites};
}

(async()=>{
  const readerSettings=settingsContext(false);readerSettings.context.saveSettings();
  assert.equal(readerSettings.writes.length,0,'SW-A reader cannot persist settings');
  const readerTrash=deletedContext(false);readerTrash.context.saveDeletedTickets();
  assert.equal(readerTrash.writes.length,0,'SW-B reader cannot persist deleted tickets');

  const writerSettings=settingsContext(true);writerSettings.context.saveSettings();
  const writerTrash=deletedContext(true);writerTrash.context.saveDeletedTickets();
  assert.equal(writerSettings.writes.length,1,'SW-C writer still saves settings');
  assert.equal(writerTrash.writes.length,1,'SW-C writer still saves deleted tickets');

  const readerMigration=await migrationContext(false);
  assert.deepEqual(readerMigration,{writes:[],journalWrites:0,ticketWrites:0,trashWrites:0},'SW-D reader skips all startup migration persistence');

  assert.doesNotThrow(()=>settingsContext(undefined).context.saveSettings(),'SW-E settings save remains compatible without lock runtime');
  assert.doesNotThrow(()=>deletedContext(undefined).context.saveDeletedTickets(),'SW-E trash save remains compatible without lock runtime');
  await assert.doesNotReject(()=>migrationContext(undefined),'SW-E migration remains compatible without lock runtime');
  console.log('PASS settings, trash and legacy migration persistence obey the single-writer gate');
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const storageSource=fs.readFileSync(path.join(root,'js','ticket-state-storage.js'),'utf8');
const editorSource=fs.readFileSync(path.join(root,'js','ticket-editor-domain.js'),'utf8');

function createStorageContext({dbPut,setItem,recordDiff}={}){
  const values=new Map();
  const events=[];
  const context={
    console,
    tickets:[{id:'ticket-1',content:'durable'}],
    ticketsRevision:0,
    syncTicketsSnapshot:[],
    syncEngine:{recordDiff:recordDiff||(()=>{events.push('journal');return Promise.resolve();})},
    ticketsDbPut:dbPut||(()=>{events.push('idb');return Promise.resolve(true);}),
    ticketsDbGet:async()=>[],
    loadJSON:()=>[],
    showToast:()=>{},
    localStorage:{
      getItem:key=>values.has(key)?values.get(key):null,
      setItem:(key,value)=>{if(setItem)return setItem(key,value);values.set(key,value);},
      removeItem:key=>values.delete(key)
    }
  };
  vm.createContext(context);
  vm.runInContext(storageSource,context);
  return {context,values,events};
}

(async()=>{
  let resolveDb;
  const deferred=createStorageContext({dbPut:()=>new Promise(resolve=>{resolveDb=resolve;})});
  let settled=false;
  const pending=deferred.context.saveTickets().then(value=>{settled=true;return value;});
  await Promise.resolve();
  assert.equal(settled,false,'saveTickets waits for IndexedDB transaction completion');
  resolveDb(true);
  assert.equal(await pending,true,'successful IndexedDB write confirms local durability');

  const fallback=createStorageContext({dbPut:async()=>false});
  assert.equal(await fallback.context.saveTickets(),true,'successful emergency fallback is accepted as recoverable local durability');
  assert.match(fallback.values.get('pendingTicketsFallback'),/ticket-1/,'emergency fallback contains the ticket');

  const failed=createStorageContext({dbPut:async()=>false,setItem:()=>{throw new Error('quota');}});
  assert.equal(await failed.context.saveTickets(),false,'failed IndexedDB and failed fallback reject local durability');

  const ordered=createStorageContext();
  assert.equal(await ordered.context.saveTickets(),true);
  assert.deepEqual(ordered.events,['journal','idb'],'sync journal remains durable before ticket IndexedDB');

  const saveStart=editorSource.indexOf('async function saveTicketFromForm');
  const saveBody=editorSource.slice(saveStart);
  const awaitPosition=saveBody.indexOf('localSaved = await saveTickets()');
  const successPosition=saveBody.indexOf('showToast(successMessage)');
  const backupPosition=saveBody.indexOf('backupTicketToTelegram(savedTicketRef)');
  const clearDraftPosition=saveBody.indexOf('clearDraft()');
  assert.ok(awaitPosition>=0 && successPosition>awaitPosition && clearDraftPosition>successPosition,'success and draft clearing happen only after local durability');
  assert.ok(saveBody.indexOf('if(!localSaved)')<clearDraftPosition && saveBody.indexOf('return;',saveBody.indexOf('if(!localSaved)'))<clearDraftPosition,'failed local persistence keeps the draft and form open');
  assert.ok(backupPosition>awaitPosition && !/await\s+backupTicketToTelegram/.test(saveBody),'Telegram backup remains background after local save');
  assert.match(saveBody,/saveBtn\.disabled = true[\s\S]*finally\{[\s\S]*saveBtn\.disabled = false/,'double-submit protection remains active while saving');
  assert.doesNotMatch(storageSource,/await\s+syncEngine\.flush|return\s+syncEngine\.flush/,'local save does not wait for Google transport');
  console.log('PASS ticket local durability gate/fallback/failure/background sync/double-submit');
})().catch(error=>{console.error(error);process.exitCode=1;});

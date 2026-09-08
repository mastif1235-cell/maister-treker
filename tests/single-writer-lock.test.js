'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','single-writer-lock.js'),'utf8');
function manager(){let held=false;return{request(_name,_options,callback){if(held)return Promise.resolve(callback(null));held=true;return Promise.resolve(callback({name:'lock'})).finally(()=>{held=false;});}};}
function fallbackStorage(){const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};}
let uuid=0,now=1000;
function tab(locks,storage=fallbackStorage()){const timers=new Map();let timerId=0;const context={console,Date:{now:()=>now},Math,crypto:{randomUUID:()=>`owner-${++uuid}`},navigator:{locks},localStorage:storage,setInterval:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),addEventListener(){},location:{reload(){}},document:undefined};vm.createContext(context);vm.runInContext(source,context);return{api:context.MTSingleWriterLock,tick:()=>[...timers.values()].forEach(fn=>fn()),storage};}
(async()=>{
  const locks=manager(),aTab=tab(locks),bTab=tab(locks),a=aTab.api,b=bTab.api;assert.equal(await a.acquire(),true,'first tab is the writer');assert.equal(await b.acquire(),false,'second tab becomes read-only');
  let stored=[{id:'base'}];const aMemory=[...stored,{id:'ticket-A'}],bStale=[...stored];if(a.canWrite())stored=aMemory;if(b.canWrite())stored=bStale;
  assert.deepEqual(stored.map(x=>x.id),['base','ticket-A'],'stale second tab cannot overwrite the first tab ticket');assert.equal(b.warn(),false,'reader guard blocks persistence');
  a.releaseForTest();await new Promise(resolve=>setImmediate(resolve));const reopened=tab(locks).api;assert.equal(await reopened.acquire(),true,'closed writer releases the browser lock for PWA reopen');reopened.releaseForTest();

  const shared=fallbackStorage(),firstTab=tab(undefined,shared),secondTab=tab(undefined,shared),first=firstTab.api,second=secondTab.api;
  assert.equal(await first.acquire(),true,'fallback grants one writer without Web Locks');assert.equal(await second.acquire(),false,'fallback blocks a concurrent second writer');assert.equal(await first.acquire(),true,'same owner reentry remains writable');
  assert.equal(second.releaseForTest(),undefined);assert.equal(shared.values.has(first.FALLBACK_KEY),true,'wrong owner cannot release another tab lease');
  now+=first.LEASE_MS+1;assert.equal(second.tryFallbackAcquireForTest(),true,'expired/stale owner is recovered deterministically');assert.equal(first.tryFallbackAcquireForTest(),false,'old owner cannot reclaim a live replacement lease');
  second.releaseForTest();const reloaded=tab(undefined,shared).api;assert.equal(await reloaded.acquire(),true,'reload/crash recovery acquires a released lease offline');reloaded.releaseForTest();
  const burst=tab(undefined,shared).api;assert.equal(await Promise.all(Array.from({length:20},()=>burst.acquire())).then(values=>values.every(Boolean)),true,'rapid same-tab save bursts keep one writer');burst.releaseForTest();
  console.log('PASS Web Locks and deterministic offline lease fallback block concurrent writers and recover stale owners');
})().catch(error=>{console.error(error);process.exitCode=1;});

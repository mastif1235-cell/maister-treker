'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','single-writer-lock.js'),'utf8');
function manager(){let held=false;return{request(_name,_options,callback){if(held)return Promise.resolve(callback(null));held=true;return Promise.resolve(callback({name:'lock'})).finally(()=>{held=false;});}};}
function tab(locks){const context={console,navigator:{locks},location:{reload(){}},document:undefined};vm.createContext(context);vm.runInContext(source,context);return context.MTSingleWriterLock;}
(async()=>{
  const locks=manager(),a=tab(locks),b=tab(locks);assert.equal(await a.acquire(),true,'first tab is the writer');assert.equal(await b.acquire(),false,'second tab becomes read-only');
  let stored=[{id:'base'}];const aMemory=[...stored,{id:'ticket-A'}],bStale=[...stored];if(a.canWrite())stored=aMemory;if(b.canWrite())stored=bStale;
  assert.deepEqual(stored.map(x=>x.id),['base','ticket-A'],'stale second tab cannot overwrite the first tab ticket');assert.equal(b.warn(),false,'reader guard blocks persistence');
  a.releaseForTest();await new Promise(resolve=>setImmediate(resolve));const reopened=tab(locks);assert.equal(await reopened.acquire(),true,'closed writer releases the browser lock for PWA reopen');reopened.releaseForTest();
  const unsupported=tab(undefined);assert.equal(await unsupported.acquire(),true,'single-tab fallback remains writable when Web Locks is unavailable');
  console.log('PASS single-writer lock blocks stale tab overwrite and releases on close/reopen');
})().catch(error=>{console.error(error);process.exitCode=1;});

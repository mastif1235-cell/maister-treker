'use strict';
/* Регресія аудиту (P1 спостережуваність): у застосунку не було глобального
   збирача падінь — необроблені реєкції зникали без сліду, а сховище PWA на
   Android могло бути витіснене без будь-якого захисту. Тепер:
     - MTSafeErrorInstall глобальні 'unhandledrejection'/'error' → той самий
       знеособлений канал (редакція секретів, без preventDefault);
     - кільцевий буфер останніх 25 помилок для діагностики;
     - navigator.storage.persist() — один раз на старті + після першого
       жесту, з захистом від повторних запитів. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');

// ---- 1) глобальні обробники + буфер ----
{
  const logs=[];const listeners={};
  const context={console:{error:v=>logs.push(String(v))},
    addEventListener:(name,fn)=>{listeners[name]=fn;},
    Date,performance:{now:()=>Date.now()}};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'js/safe-error.js'),'utf8'),context);
  assert.ok(context.MTSafeError.recentErrors&&context.MTSafeError.installGlobalHandlers,'new API exposed');
  assert.ok(listeners.unhandledrejection&&listeners.error,'handlers auto-installed in a browser-like context');
  listeners.unhandledrejection({reason:Object.assign(new Error('sync blew up with token=123456:SECRETSECRETSECRET'),{name:'TypeError'})});
  const recent=JSON.parse(JSON.stringify(context.MTSafeError.recentErrors()));
  assert.equal(recent.length,1,'rejection записана в буфер');
  assert.equal(recent[0].scope,'unhandled-rejection');
  const line=logs.at(-1);
  assert.ok(line.includes('unhandled-rejection'),'і в консоль');
  assert.doesNotMatch(line,/SECRETSECRETSECRET/,'секрети відредаговані навіть у глобальному каналі');
  // дедупликація: та сама помилка двічі в межах 2с → один запис
  const before=JSON.parse(JSON.stringify(context.MTSafeError.recentErrors())).length;
  listeners.unhandledrejection({reason:Object.assign(new Error('sync blew up with token=123456:SECRETSECRETSECRET'),{name:'TypeError'})});
  assert.equal(JSON.parse(JSON.stringify(context.MTSafeError.recentErrors())).length,before,'шум не множать');
  // window 'error' подія без error-об'єкта
  listeners.error({message:'Script failed at https://x/app.js'});
  assert.equal(JSON.parse(JSON.stringify(context.MTSafeError.recentErrors())).length,before+1,'window-error теж чути');
  // ліміт 25
  for(let i=0;i<40;i++)context.MTSafeError.reportError(new Error(`noise ${i}`));
  assert.equal(JSON.parse(JSON.stringify(context.MTSafeError.recentErrors())).length,25,'кільцевий буфер обмежений');
  // відсутність addEventListener (node/vm) — не падаємо
  const bare={console:{error(){}}};
  vm.createContext(bare);
  vm.runInContext(fs.readFileSync(path.join(root,'js/safe-error.js'),'utf8'),bare);
  assert.equal(bare.MTSafeError.installGlobalHandlers(),false,'без браузерного контексту — просто false');
}

// ---- 2) запит persist ----
function runPersistence({initialFlag=null,withStorage=true}={}){
  const calls=[];
  const values=new Map(initialFlag?[['mtStoragePersistRequested',initialFlag]]:[]);
  const listeners={};
  const context={
    console:{log(){},warn(){},error(){}},
    navigator:withStorage?{storage:{persist:()=>{calls.push(Date.now());return Promise.resolve(true);}}}:{},
    document:{addEventListener:(n,f)=>{listeners[n]=f;},removeEventListener:n=>{delete listeners[n];}},
    localStorage:{getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
  };
  vm.createContext(context);
  const orchestration=fs.readFileSync(path.join(root,'js/storage-orchestration.js'),'utf8');
  vm.runInContext(orchestration,context);
  return {context,calls,values,listeners};
}
{
  const h=runPersistence({});
  assert.equal(h.context.mtRequestPersistentStorage(),true);
  assert.equal(h.calls.length,1,'persist() викликано на старті');
  assert.equal(h.values.get('mtStoragePersistRequested'),'startup');
  assert.ok(h.listeners.pointerdown,'другий запит заплановано на перший жест');
  h.listeners.pointerdown();
  assert.equal(h.calls.length,2,'жест теж скористано');
  assert.equal(h.values.get('mtStoragePersistRequested'),'post-gesture');
  assert.ok(!h.listeners.pointerdown,' слухач знято — не висить назавжди');
  // повторний застосунок: уже просили — не турбуємо
  const again=runPersistence({initialFlag:'post-gesture'});
  assert.equal(again.context.mtRequestPersistentStorage(),false);
  assert.equal(again.calls.length,0,'немає повторних запитів');
  // браузер без API — тихо no-op, без падіння
  const none=runPersistence({withStorage:false});
  assert.equal(none.context.mtRequestPersistentStorage(),false);
}

// ---- 3) init() викликає запит і не блокує старт ----
{
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(app,/if\(typeof mtRequestPersistentStorage==='function'\) mtRequestPersistentStorage\(\);/,'init() дбає про persist-режим');
}
console.log('PASS global error sink, bounded recent buffer and persistent storage request wired');

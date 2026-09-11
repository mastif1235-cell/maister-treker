'use strict';
// Смены живут в localStorage, где запись может упасть (квота/заблокированное
// хранилище). Проверяем: ошибка не проглатывается, данные не теряются молча,
// аварийная копия подхватывается на следующем старте, unhandled rejection нет.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const registrySource=fs.readFileSync(path.join(root,'js','storage-registry.js'),'utf8');
const localStateSource=fs.readFileSync(path.join(root,'js','local-state-storage.js'),'utf8');
const storageSource=fs.readFileSync(path.join(root,'js','storage-orchestration.js'),'utf8');

let unhandled=0;
process.on('unhandledRejection',()=>{unhandled++;});

function harness(options={}){
  const initial=new Map(Object.entries(options.initial||{}));
  const writes=[];
  const failKeys=new Set(options.failKeys||[]);
  const storage={
    values:initial,
    writes,
    getItem:key=>initial.has(key)?initial.get(key):null,
    setItem(key,value){writes.push(key);if(options.failAll||failKeys.has(key))throw Object.assign(new Error('QuotaExceededError'),{name:'QuotaExceededError'});initial.set(key,String(value));},
    removeItem:key=>{initial.delete(key);}
  };
  const toasts=[];
  const journal=[];
  const context={console,Date,JSON,Array,Object,Promise,Map,Set,Error,Math,Number,String,setTimeout,clearTimeout,
    localStorage:storage,settings:{theme:'dark'},showToast:message=>toasts.push(String(message))};
  context.window=context;
  context.shifts=[{id:'s1',date:'01.09.2026',hours:8,coworker:'Сам'}];
  context.shiftsRevision=0; // глобальный счётчик ревизий из app.js
  context.syncShiftsSnapshot=JSON.parse(JSON.stringify(context.shifts));
  const snapshotRef=context.syncShiftsSnapshot;
  context.syncEngine={recordDiff:(entity,before,after)=>{journal.push([entity,before.length,after.length]);return options.journalFails?Promise.reject(new Error('journal down')):Promise.resolve();}};
  if(options.lock!==undefined) context.MTSingleWriterLock={warn:()=>options.lock};
  vm.createContext(context);
  vm.runInContext(registrySource,context);
  vm.runInContext(localStateSource,context);
  vm.runInContext(storageSource,context);
  return {context,storage,toasts,journal,snapshotRef};
}

(async()=>{
  const normal=harness();
  assert.equal(await normal.context.saveShifts(),true,'normal save reports success');
  assert.deepEqual(normal.journal,[['shift',1,1]],'shift diff is journaled before persistence');
  assert.equal(JSON.parse(normal.storage.values.get('shifts')).length,1,'shifts are persisted');
  assert.notEqual(normal.context.syncShiftsSnapshot,normal.snapshotRef,'sync snapshot advances after a durable write');
  assert.equal(normal.toasts.length,0,'happy path stays silent');

  const quota=harness({failKeys:['shifts']});
  assert.equal(await quota.context.saveShifts(),true,'emergency copy counts as saved');
  assert.equal(JSON.parse(quota.storage.values.get('pendingShiftsFallback')).length,1,'emergency copy is written to localStorage');
  assert.match(quota.toasts[0],/аварійну копію/,'user is told the emergency copy was used');

  const dead=harness({failAll:true});
  assert.equal(await dead.context.saveShifts(),false,'complete storage failure is reported as a failure');
  assert.match(dead.toasts[0],/Не вдалося зберегти зміни/,'user is warned not to close the app');
  assert.notEqual(dead.context.syncShiftsSnapshot,dead.snapshotRef,'snapshot still advances when only local storage failed');

  const journalDown=harness({journalFails:true});
  assert.equal(await journalDown.context.saveShifts(),true,'local data is persisted even when the sync journal fails');
  assert.equal(journalDown.context.syncShiftsSnapshot,journalDown.snapshotRef,'snapshot does not advance when the diff was not journaled');
  assert.equal(journalDown.toasts.length,0,'journal failure is logged, not shown as a storage warning');

  const reader=harness({lock:false});
  assert.equal(await reader.context.saveShifts(),false,'read-only tab refuses to write');
  assert.equal(reader.storage.writes.length,0,'read-only tab performs no localStorage writes');

  const safe=harness();
  safe.context.saveShifts=()=>Promise.reject(new Error('boom'));
  assert.equal(await safe.context.saveShiftsSafely(),false,'saveShiftsSafely resolves false instead of rejecting');
  assert.match(safe.toasts[0],/Не вдалося зберегти зміни/,'saveShiftsSafely warns the user');

  const recovery=harness({initial:{pendingShiftsFallback:JSON.stringify([{id:'s9',date:'02.09.2026',hours:5,coworker:'Сам'}])}});
  assert.deepEqual(recovery.context.loadShiftsWithFallback().map(shift=>shift.id),['s9'],'emergency copy is adopted when the main key is empty');
  assert.equal(recovery.context.mtConsumeShiftsFallbackNotice(),true,'recovery notice is delivered once');
  assert.equal(recovery.context.mtConsumeShiftsFallbackNotice(),false,'recovery notice is not repeated');

  const mainWins=harness({initial:{shifts:JSON.stringify([{id:'main'}]),pendingShiftsFallback:JSON.stringify([{id:'old'}])}});
  assert.deepEqual(mainWins.context.loadShiftsWithFallback().map(shift=>shift.id),['main'],'main key wins over a stale emergency copy');
  assert.equal(mainWins.context.mtConsumeShiftsFallbackNotice(),false,'no recovery notice when the main key has data');

  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(unhandled,0,'no unhandled rejections from shift persistence');
  console.log('PASS shifts persistence survives quota failures, keeps an emergency copy and never leaks rejections');
})().catch(error=>{console.error(error);process.exitCode=1;});

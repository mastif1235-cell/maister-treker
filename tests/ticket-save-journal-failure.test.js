'use strict';
/* Регресія аудиту (P0 №2): saveTickets()/saveTicketsLocalOnly() викликаються ~12
   місцями як fire-and-forget (`saveTickets();` без обробника). Раніше відмова
   syncEngine.recordDiff або будь-який збій у ланцюжку давав необроблену
   реєкцію, а локальний запис узагалі пропускався (на відміну від saveShifts,
   який журнальний збій обробляв). Тепер:
     - збій журналу → дані все одно йдуть у IndexedDB, знімок sync НЕ рухається;
     - будь-який неочікуваний збій → аварійна копія + false, реєкцій немає;
     - проміс saveTickets() не може «зависнути» на необробленій помилці. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const stateSource=fs.readFileSync(path.join(root,'js','ticket-state-storage.js'),'utf8');

function createContext({recordDiff,dbPut,removeItemThrows=false}={}){
  const events=[];
  const values=new Map([['tickets','[]']]);
  const context={
    console:{log(){},warn(){},error(){}},
    tickets:[{id:'a',client:{name:'A'}},{id:'b',client:{name:'B'}}],
    ticketsRevision:0,
    syncTicketsSnapshot:[{id:'a',client:{name:'A'}}],
    syncEngine:recordDiff?{recordDiff}:null,
    ticketsDbPut:dbPut||(()=>{events.push('idb');return Promise.resolve(true);}),
    ticketsDbGet:async()=>[],
    loadJSON:()=>[],
    showToast:m=>events.push('toast:'+m),
    MTSafeError:{reportError:(error,meta)=>events.push('safe:'+meta.scope)},
    localStorage:{
      getItem:key=>values.has(key)?values.get(key):null,
      setItem:(key,value)=>{values.set(key,value);events.push('localStorage:set:'+key);},
      removeItem:key=>{
        if(removeItemThrows&&key==='pendingTicketsFallback') throw new Error('SecurityError');
        events.push('localStorage:remove:'+key);values.delete(key);
      }
    }
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(stateSource,context);
  return {context,events,values};
}

(async()=>{
  const unhandled=[];
  const watchdog=error=>unhandled.push(error);
  process.on('unhandledRejection',watchdog);

  // 1) Журнал відхилений: локальний запис обов'язковий, знімок — ні.
  {
    const h=createContext({recordDiff:()=>Promise.reject(new Error('journal full'))});
    const saved=await h.context.saveTickets();
    assert.equal(saved,true,'журнальний збій не вважається втратою даних');
    assert.ok(h.events.includes('idb'),'зміни записані в IndexedDB попри збій журналу');
    assert.ok(h.events.includes('safe:tickets-journal'),'помилка журналу підсвічена в діагностику');
    const snapshot=JSON.parse(JSON.stringify(h.context.syncTicketsSnapshot));
    assert.deepEqual(snapshot.map(t=>t.id),['a'],'sync-знімок НЕ рухається — diff не загубиться');
  }
  // 2) Журнал відхилений + IndexedDB не записав: аварійна копія приймає дані.
  {
    const h=createContext({
      recordDiff:()=>Promise.reject(new Error('journal full')),
      dbPut:()=>Promise.resolve(false)
    });
    const saved=await h.context.saveTickets();
    assert.equal(saved,true,'аварійна копія — валідна локальна сталість');
    assert.ok(h.events.some(e=>String(e).startsWith('localStorage:set:pendingTicketsFallback')),'резервний знімок створено');
    assert.ok(h.values.get('pendingTicketsFallback'),'його не видалено відразу');
  }
  // 3) Fire-and-forget без обробника не лишає необроблених реєкцій навіть коли
  //    падає й очищення localStorage.
  {
    const h=createContext({recordDiff:()=>Promise.resolve(),removeItemThrows:true});
    h.context.saveTickets();
    h.context.saveTicketsLocalOnly();
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(h.events.some(e=>String(e).startsWith('toast:')),'користувач бачить резервне попередження');
  }
  // 4) Успішний повний цикл: знімок рухається, резервний ключ закривається.
  {
    const h=createContext({recordDiff:()=>Promise.resolve()});
    h.values.set('pendingTicketsFallback','[{"id":"stale"}]');
    const saved=await h.context.saveTickets();
    assert.equal(saved,true);
    const snapshot=JSON.parse(JSON.stringify(h.context.syncTicketsSnapshot));
    assert.deepEqual(snapshot.map(t=>t.id),['a','b'],'за успішного журналу знімок синхронізовано');
    assert.ok(!h.values.has('pendingTicketsFallback'),'аварійну копію закрито');
  }
  await new Promise(resolve=>setTimeout(resolve,20));
  process.off('unhandledRejection',watchdog);
  assert.deepEqual(unhandled.map(String).join('|').slice(0,400),'','усе усередині модулів збереження: жодної unhandledRejection');
  console.log('PASS ticket saves are rejection-free: journal failures keep local durability and hold the sync snapshot');
})().catch(error=>{process.exitCode=1;console.error(error);});

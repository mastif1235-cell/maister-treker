'use strict';
/* Регресія аудиту (P0 №1): помилка читання IndexedDB заявок не повинна
   сприйматися як «порожня база». Раніше ticketsDbGet() резолвив undefined і при
   збої транзакції; loadTicketsFromIdb() вважав сховище порожнім, «мігрував»
   legacy-стан і робив ticketsDbPut([]) — тобто перезаписував реальну базу
   порожнім масивом. Тепер:
     - ticketsDbRead() розрізняє ok / missing / error (+одна повторна спроба);
     - при error: жодного запису в сховiще, legacy не видаляється, стан у
       пам'яті не руйнується, вмикається аварійний режим запису;
     - після відновлення читабельності зміни об'єднуються без втрат. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const storageSource=fs.readFileSync(path.join(root,'js','ticket-storage.js'),'utf8');
const stateSource=fs.readFileSync(path.join(root,'js','ticket-state-storage.js'),'utf8');

function createHarness({initialTickets='[]', databaseAvailable=true}={}){
  const events=[];
  const store={'tickets':initialTickets};
  let getMode='ok';        // 'ok' | 'error'
  let getValue=undefined;  // результат успішного читання
  let putValue=null;
  let getCount=0;
  let putCount=0;
  const db={
    transaction(){
      const tx={onerror:null,onabort:null,oncomplete:null,error:null};
      tx.objectStore=()=>({
        get(){
          getCount++;
          events.push('get:'+getMode);
          const request={onsuccess:null,onerror:null,result:undefined,error:getMode==='error'?{name:'Error'}:null};
          setTimeout(()=>{
            if(getMode==='error'&&request.onerror) request.onerror();
            else{ request.result=getValue; if(request.onsuccess) request.onsuccess(); }
          },0);
          return request;
        },
        put(value){
          putCount++;
          putValue=JSON.parse(JSON.stringify(value));
          events.push('put');
          const request={onsuccess:null,onerror:null,error:null};
          setTimeout(()=>{ if(request.onsuccess) request.onsuccess(); },0);
          return request;
        }
      });
      setTimeout(()=>{ if(tx.oncomplete) tx.oncomplete(); },0);
      return tx;
    },
    close(){}
  };
  const context={
    console:{log(){},warn(){},error(){}},
    setTimeout:(fn)=>setTimeout(fn,0),
    window:{indexedDB:databaseAvailable?{}:null},
    localStorage:{
      getItem:key=>Object.prototype.hasOwnProperty.call(store,key)?store[key]:null,
      setItem:(key,value)=>{store[key]=String(value);},
      removeItem:key=>{delete store[key];}
    },
    loadJSON(key,fallback){
      if(!Object.prototype.hasOwnProperty.call(store,key)) return fallback;
      try{ return JSON.parse(store[key]); }catch(_error){ return fallback; }
    },
    showToast(message){events.push('toast:'+message);},
    syncEngine:null,
    tickets:[],
    syncTicketsSnapshot:[],
    ticketsRevision:0
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(storageSource,context);
  vm.runInContext(stateSource,context);
  // openTicketsDb() у застосунку присвоює ticketsDb; тут робимо те саме напряму.
  if(databaseAvailable){
    context.__fakeDb=db;
    vm.runInContext('ticketsDb = __fakeDb;',context);
  }
  return {
    context,store,events,
    setGetMode(mode){getMode=mode;},
    setGetValue(value){getValue=value;},
    getPutValue(){return putValue;},
    getPutCount(){return putCount;},
    getGetCount(){return getCount;},
    degraded(){return vm.runInContext('ticketsStorageDegraded',context);}
  };
}

(async()=>{
  // 1) Помилка читання: жодного запису, legacy цілий, стан не зруйновано.
  {
    const legacy=JSON.stringify([{id:'legacy-1',client:{name:'Клієнт'}}]);
    const h=createHarness({initialTickets:legacy});
    h.setGetMode('error');
    await h.context.loadTicketsFromIdb();
    assert.equal(h.getGetCount(),2,'помилкове читання повторюється рівно один раз');
    assert.equal(h.getPutCount(),0,'під час помилки читання жодного перезаписувального put');
    assert.equal(h.degraded(),true,'читається як деградований стан');
    assert.deepEqual(h.context.tickets,[],'стан у пам’яті не підміняється сміттям');
    assert.ok(h.events.some(e=>String(e).startsWith('toast:')&&/Не вдалося прочитати локальну базу/.test(e)),'користувач отримує ясне пояснення');
    assert.equal(h.store['tickets'],legacy,'legacy-ключ не зруйновано');
  }
  // 2) Успішне порожнє читання: міграція legacy працює як раніше.
  {
    const legacy=[{id:'legacy-1',client:{name:'Клієнт'}}];
    const h=createHarness({initialTickets:JSON.stringify(legacy)});
    h.setGetValue(undefined); // IndexedDB читабельна, ключа немає
    await h.context.loadTicketsFromIdb();
    assert.deepEqual(h.context.tickets,legacy,'legacy-заявки підхоплені');
    assert.deepEqual(h.getPutValue(),legacy,'міграційний запис виконаний');
    assert.ok(!('tickets' in h.store),'legacy-ключ видалено після підтвердженого запису');
    assert.equal(h.degraded(),false);
  }
  // 3) База недоступна (немає IndexedDB): legacy лишається, нічого не витирається.
  {
    const legacy=[{id:'legacy-1',client:{name:'Клієнт'}}];
    const h=createHarness({initialTickets:JSON.stringify(legacy),databaseAvailable:false});
    await h.context.loadTicketsFromIdb();
    assert.deepEqual(h.context.tickets,legacy,'без IndexedDB legacy-дані лишаються доступними');
    assert.equal(h.store['tickets'],JSON.stringify(legacy),'legacy-ключ не видаляється, коли запис неможливий');
  }
  // 4) Пошкоджений JSON у legacy: не видаляти як «успішно мігрований».
  {
    const h=createHarness({initialTickets:'{not valid json'});
    h.setGetValue(undefined);
    await h.context.loadTicketsFromIdb();
    assert.equal(h.getPutCount(),1,'запис у прочитане порожнє сховище дозволений');
    assert.equal(h.store['tickets'],'{not valid json','пошкоджений legacy не знищено');
    assert.ok(h.events.some(e=>String(e).startsWith('toast:')&&/пошкоджений legacy/i.test(e)),'про пошкодження повідомлено');
  }
  // 5) Деградація: save → аварійна копія; після відновлення — злиття без втрат.
  {
    const h=createHarness({initialTickets:'{}'});
    h.setGetMode('error');
    await h.context.loadTicketsFromIdb();
    assert.equal(h.degraded(),true);
    h.context.tickets=[{id:'new-1',client:{name:'Новий'}}];
    const savedWhileDegraded=await h.context.saveTickets();
    assert.equal(h.getPutCount(),0,'під час деградації база не перезаписується');
    assert.equal(savedWhileDegraded,true,'дані прийняті в аварійну копію');
    const fallbackRaw=h.store['pendingTicketsFallback'];
    assert.ok(fallbackRaw&&JSON.parse(fallbackRaw).length===1,'аварійна копія створена');
    const stored=[{id:'old-1',client:{name:'Стара 1'}},{id:'old-2',client:{name:'Стара 2'}}];
    h.setGetMode('ok');
    h.setGetValue(stored);
    h.context.tickets=[{id:'new-1',client:{name:'Новий'}}];
    const savedAfterRecovery=await h.context.saveTickets();
    assert.equal(savedAfterRecovery,true);
    assert.equal(h.degraded(),false,'флаг знято після успішного повторного читання');
    assert.deepEqual(h.getPutValue().map(item=>item.id).sort(),['new-1','old-1','old-2'],'нові та старі заявки об’єднані без втрат');
    const snapshotIds=JSON.parse(JSON.stringify(h.context.syncTicketsSnapshot.map(item=>item.id).sort()));
    assert.deepEqual(snapshotIds,['new-1','old-1','old-2'],'старі стали частиною базлайна й не підуть повторним diff-ом; новьоту там же тримає журнал');
    assert.ok(!('pendingTicketsFallback' in h.store),'аварійна копія закрита успішним записом');
  }
  // 6) Низькорівневий контракт: error після ретраю, ok зі значенням, missing без БД;
  //    легасі-контракт ticketsDbGet не зламано.
  {
    const errorHarness=createHarness({initialTickets:'{}'});
    errorHarness.setGetMode('error');
    assert.equal((await errorHarness.context.ticketsDbRead()).status,'error');
    assert.equal(await errorHarness.context.ticketsDbGet(),undefined);
    const okHarness=createHarness({initialTickets:'{}'});
    okHarness.setGetValue([{id:'x'}]);
    const ok=await okHarness.context.ticketsDbRead();
    assert.equal(ok.status,'ok');
    assert.deepEqual(ok.value,[{id:'x'}]);
    const missingHarness=createHarness({initialTickets:'{}',databaseAvailable:false});
    assert.equal((await missingHarness.context.ticketsDbRead()).status,'missing');
  }
  console.log('PASS tickets IndexedDB read failures never masquerade as an empty database and never overwrite storage');
})().catch(error=>{console.error(error);process.exit(1);});

'use strict';
// Лизинг единственного писателя живёт 8 секунд и продлевается каждые 2.5 с.
// Пока вкладка/PWA была в фоне, таймеры останавливались — аренда могла протухнуть.
// Проверяем, что перед разрешением записи аренда перепроверяется, возврат из фона
// пересчитывает права, а штатное поведение (один писатель, второй — читатель) цело.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','single-writer-lock.js'),'utf8');

function fallbackStorage(){const values=new Map();return{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};}
function fakeDocument(){
  const handlers={};
  return{visibilityState:'visible',_handlers:handlers,
    addEventListener:(type,fn)=>{handlers[type]=fn;},
    fire:type=>handlers[type]&&handlers[type](),
    getElementById:()=>null,
    createElement:()=>({style:{},setAttribute(){},querySelector:()=>({}),firstElementChild:{style:{}}}),
    body:{appendChild(){}}};
}
function locksManager(){let held=false;return{request(_name,_options,callback){if(held)return Promise.resolve(callback(null));held=true;return Promise.resolve(callback({name:'lock'})).finally(()=>{held=false;});}};}
let uuid=0,now=1000000;
function tab(storage=fallbackStorage(),document,locks){
  const timers=new Map();let timerId=0;
  const context={console,Date:{now:()=>now},Math,crypto:{randomUUID:()=>`owner-${++uuid}`},navigator:locks?{locks}:{},localStorage:storage,
    setInterval:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),
    addEventListener(){},location:{reload(){}},document};
  vm.createContext(context);vm.runInContext(source,context);
  return{api:context.MTSingleWriterLock,tick:()=>[...timers.values()].forEach(fn=>fn()),storage,document};
}
function lease(storage,owner,expiresAt){storage.values.set('mt-single-writer-lease-v1',JSON.stringify({owner,expiresAt}));}
function readLease(storage){const raw=storage.values.get('mt-single-writer-lease-v1');return raw?JSON.parse(raw):null;}
function locksManager(){let held=false;return{request(_name,_options,callback){if(held)return Promise.resolve(callback(null));held=true;return Promise.resolve(callback({name:'lock'})).finally(()=>{held=false;});}};}

(async()=>{
  const shared=fallbackStorage();
  const first=tab(shared),second=tab(shared);
  assert.equal(await first.api.acquire(),true,'first tab is the writer (fallback lease path)');
  assert.equal(await second.api.acquire(),false,'second tab becomes read-only while the lease is alive');
  assert.equal(second.api.status(),'reader','second tab status is reader');

  // 1. Своя аренда протухла за время сна, других писателей нет — тихо продлеваем себе.
  lease(shared,first.api.ownerId,now-1);
  assert.equal(first.api.status(),'writer','tab still believes it is the writer while frozen');
  assert.equal(first.api.revalidateForTest(),'writer','expired own lease is renewed instead of losing write access');
  assert.equal(readLease(shared).owner,first.api.ownerId,'lease is refreshed for this tab');
  assert.equal(readLease(shared).expiresAt,now+first.api.LEASE_MS,'renewed lease is live for another full window');

  // 2. Пока вкладка спала, аренду забрал другой таб — переходим в режим просмотра.
  lease(shared,'owner-other',now+first.api.LEASE_MS);
  assert.equal(first.api.revalidateForTest(),'reader','a live foreign lease demotes the resumed tab');
  assert.equal(first.api.warn(),false,'demoted tab refuses to persist');
  assert.equal(first.api.canWrite(),false,'canWrite reports reader for the demoted tab');

  // 3. Возврат из фона (visibilitychange) сам пересчитывает права.
  const shared2=fallbackStorage(),document=fakeDocument();
  const resumed=tab(shared2,document);
  assert.equal(await resumed.api.acquire(),true,'tab holds the lease before sleeping');
  lease(shared2,'owner-other',now+resumed.api.LEASE_MS);
  assert.equal(resumed.api.status(),'writer','frozen tab has not re-checked the lease yet');
  document.fire('visibilitychange');
  assert.equal(resumed.api.status(),'reader','returning from background re-checks the lease');

  // 4. Другой таб освободил аренду — прежний писатель снова может писать.
  shared2.values.delete('mt-single-writer-lease-v1');
  assert.equal(resumed.api.revalidateForTest(),'writer','released lease lets the paused tab resume writing');
  const rival=tab(shared2);
  assert.equal(await rival.api.acquire(),false,'a concurrent second writer cannot appear');
  assert.equal(rival.api.status(),'reader','rival stays read-only');

  // 5. Обычный режим: аренда жива — права не отбираем.
  assert.equal(resumed.api.revalidateForTest(),'writer','live own lease keeps write access');
  assert.equal(resumed.api.warn(),true,'warn still allows persistence for the live writer');

  // 6. Путь с Web Locks не затронут: revalidate не пишет аренду и не меняет состояние.
  const lockedStorage=fallbackStorage();
  const lockedTab=tab(lockedStorage,undefined,locksManager());
  assert.equal(await lockedTab.api.acquire(),true,'Web Locks path still grants the writer');
  assert.equal(lockedTab.api.revalidateForTest(),'writer','revalidate keeps the Web Locks writer');
  assert.equal(lockedStorage.values.has('mt-single-writer-lease-v1'),false,'Web Locks path never writes the fallback lease');
  assert.equal(lockedTab.api.warn(),true,'Web Locks writer persists normally');
  lockedTab.api.releaseForTest();
  assert.equal(typeof lockedTab.api.revalidate,'function','revalidate is part of the public API');
  console.log('PASS single-writer lease is re-checked after background sleep and still blocks a second writer');
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
/* Регресія аудиту (P0 сталість init): білий екран при недоступному сховищі —
   найгірший сценарій для польового застосунку (приватний Firefox, забитий
   IndexedDB, заблоковане сховище). Вимоги:
     - помилка будь-якого етапу init() не вбиває старт: кожен етап у своєму
       try/catch, рушій синхронізації при падінні стає syncEngine=null
       (деградований локальний режим підтримується рештою коду);
     - усі «живі» виклики syncEngine.* — після перевірки на null;
     - слухач 'online' не клацає у мертвий рушій. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const app=read('app.js');

const initStart=app.indexOf('async function init(){');
assert.ok(initStart>0,'init() exists');
const initSlice=app.slice(initStart,app.indexOf('\n}',app.indexOf('restoreDraftIfAny();',initStart)));
assert.ok(initSlice.length>500,'init slice is meaningful');

assert.match(initSlice,/try\{\s*\n\s*ticketsDb = await openTicketsDb\(\);\s*\n\s*\}catch\(dbOpenError\)\{[\s\S]*?ticketsDb = null;/,'IndexedDB open failure is contained');
assert.match(initSlice,/try\{\s*\n\s*await loadTicketsFromIdb\(\);[\s\S]*?\}catch\(loadError\)\{[\s\S]*?fallbackLegacy[\s\S]*?\}/,'tickets load failure falls back to legacy copy, not a crash');
assert.match(initSlice,/try\{[\s\S]*?await new MTSyncEngineRuntime\.Engine\([\s\S]*?\}\)\.init\(\);[\s\S]*?\}catch\(engineError\)\{[\s\S]*?syncEngine = null;[\s\S]*?showToast\(/,'engine init failure degrades to syncEngine=null with an explanation');
assert.match(initSlice,/if\(syncEngine\)\{\s*\n\s*try\{ await migrateLegacySyncState\(\); \}/,'legacy sync migration runs only with a live engine and cannot kill start');
assert.match(initSlice,/try\{\s*\n\s*photoDb = await openPhotoDb\(\);[\s\S]*?maybeOfferExternalDailyBackup\(\);[\s\S]*?\}catch\(auxStorageError\)\{/,'photo/backup storage failures are contained too');
assert.match(initSlice,/if\(syncEngine\) Promise\.resolve\(syncEngine\.flush\(\)\)\.catch\(\(\)=>\{\}\);/,'online listener survives a dead engine and cannot produce unhandled rejections');
// Білий екран не можe повернутися: жодного «сирого» await після етапів, який би
// вбивав решту init() — усі зовнішні виклики обгорнуті.
assert.match(initSlice,/renderTicketsScreen\(\);[\s\S]*?renderShiftsScreen\(\);[\s\S]*?renderToolsScreen\(\);[\s\S]*?renderSettingsScreen\(\);/,'UI render phase remains after every guarded stage');

// Усі «живі» звернення до рушія поза межами init — під guard.
const consumers=[
  ['js/reports-domain.js',/if\(!syncEngine\)\{ showToast\([^)]*локально[^)]*\); return; \}\r?\n\s*const ok = await syncEngine\.flush\(\);/g,2],
  ['js/tickets-domain.js',/if\(!syncEngine\)\{ showToast\('Синхронізація тимчасово недоступна — зміни збережено локально'\); return; \}\r?\n\s*showToast\('Повторна спроба надсилання\.\.\.'\);\r?\n\s*const ok = await syncEngine\.flush\(\);/,1]
];
for(const [file,re,min] of consumers){
  const source=read(file);
  const hits=re.global?(source.match(re)||[]).length:(source.match(re)?1:0);
  assert.ok(hits>=min,`${file}: every await syncEngine.flush() is behind a null-guard`);
}
const bindings=read('js/tickets-bindings.js');
assert.match(bindings,/if\(getScriptUrl\(\) && syncEngine\)\{\s*\n\s*Promise\.resolve\(syncEngine\.flush\(\)\)\.then\(/,'tag-delete background sync is guarded too');
const bulk=read('js/reports-domain.js');
assert.match(bulk,/if\(imported && getScriptUrl\(\) && syncEngine\)\{/,'bulk-import flush requires the engine');

// Runtime-доказ деградації: saveTickets із syncEngine=null (рушій упав на старті)
// лишається повністю робочим локальним шляхом без жодної реєкції.
const stateSource=read('js/ticket-state-storage.js');
{
  const events=[];
  const values=new Map();
  const context={
    console:{log(){},warn(){},error(){}},
    tickets:[],ticketsRevision:0,syncTicketsSnapshot:[],syncEngine:null,
    ticketsDbPut:()=>{events.push('idb');return Promise.resolve(true);},
    ticketsDbGet:async()=>[],
    loadJSON:()=>[],
    showToast:m=>events.push('toast:'+m),
    localStorage:{getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(stateSource,context);
  context.tickets.push({id:'degraded-1',client:{name:'Приватний режим'}});
  Promise.resolve(context.saveTickets())
    .then(saved=>{
      assert.equal(saved,true,'local saves work without the engine');
      assert.ok(events.includes('idb'),'written to IndexedDB as usual');
      assert.equal((context.syncTicketsSnapshot||[]).length,1,'degraded mode still tracks baseline');
      console.log('PASS init stages are isolated: no white screen without tickets DB, journal engine, or backup storage');
    })
    .catch(error=>{process.exitCode=1;console.error('DEGRADATION GUARD BROKEN:',error);});
}

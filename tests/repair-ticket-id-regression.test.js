'use strict';
/* Регресія v91.65 (дві підтверджені знахідки аудиту — мінімальний maintenance):
   1) repairCorruptedTickets() видає відремонтованим legacy-записам сучасний
      СТРІНКОВИЙ id (MTSyncEngineRuntime.uuid(), як у runBulkImport) замість
      числового Date.now()+counter; коректні заявки НЕ перейменовуються;
      відремонтований запис знаходиться існуючими шляхами (String()-порівняння
      DOM-обробників + контракт syncValidId_ з Code.gs).
   2) tests/init-degradation.test.js переносимий між LF і CRLF: реальний прогон
      тесту на робочій копії (LF) і на CRLF-копії джерел (симуляція Windows
      checkout) — обидва зелені. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

const reports=read('js/reports-domain.js');
const runtimeSrc=read('js/sync-engine-runtime.js');

/* Реальний код repair у VM: реальний sync-engine-runtime (uuid), мінімальні
   заглушки UI-сусідів. getScriptUrl()='' → sync-гілка пропускається. */
function runRepair(list, withRuntime){
  const context={
    console:{log(){},warn(){},error(){}},
    crypto:require('node:crypto'), // в браузере это глобальный secure-context API (crypto.randomUUID)
    tickets:list,
    openConfirmModal:async()=>true,
    backupLocalData:()=>{},
    saveTickets:()=>{},
    renderTicketsScreen:()=>{},
    showToast:()=>{},
    getScriptUrl:()=>'',
    syncEngine:null,
    formatDate:d=>`${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`,
    formatTime:d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  };
  context.globalThis=context;
  vm.createContext(context);
  if(withRuntime!==false) vm.runInContext(runtimeSrc,context); // иначе сценарий «runtime недоступен»
  vm.runInContext(reports+'\n;this.__repair=repairCorruptedTickets;',context);
  return context.__repair();
}

(async()=>{
  const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SYNC_ID_RE=/^[A-Za-z0-9._:-]{1,128}$/; // контракт syncValidId_ (Code.gs) і TICKET_ID_RE (mcp)
  const LEGACY_ID='Fri Jul 10 2026 00:00:00 GMT+0300 (Eastern European Summer Time)';

  /* 1+2+3: реальний repair у VM */
  const broken={id:LEGACY_ID,date:'10.07.2026',time:'12:30',content:'легасі-запис',sum:0,type:'Інше'};
  const good={id:'3f2504e0-4f89-41d3-9a0c-0305e82c3301',date:'22.09.2026',time:'09:00',content:'коректна заявка',sum:100};
  await runRepair([broken,good],true);

  assert.equal(typeof broken.id,'string','repaired id is a STRING');
  assert.notEqual(broken.id,LEGACY_ID,'legacy id replaced');
  assert.match(broken.id,UUID_RE,'repaired id is UUID-style (real MTSyncEngineRuntime.uuid())');
  assert.match(broken.id,SYNC_ID_RE,'repaired id passes the syncValidId_ contract');
  assert.match(broken.date,/^\d{2}\.\d{2}\.\d{4}$/,'date is a valid dd.mm.yyyy (legacy instant rendered in device TZ)');
  assert.equal(good.id,'3f2504e0-4f89-41d3-9a0c-0305e82c3301','correct ticket keeps its id');

  /* Знайденість існуючими шляхами: JSON round-trip (IndexedDB/sync payload) +
     DOM-патерн рядкових порівнянь (tickets-bindings: String(item.id)===String(dataset.id)) */
  const stored=JSON.parse(JSON.stringify(broken));
  const datasetId=String(stored.id); // як у DOM: data-id="${t.id}" завжди рядок
  assert.ok([stored].find(item=>String(item.id)===datasetId),'found via the existing String()-lookup after round-trip');

  /* Fallback-гілка: без MTSyncEngineRuntime — безпечний РЯДКОВИЙ repair-*, той самий контракт */
  const fb={id:'Mon Aug 03 2026 10:00:00 GMT+0300 (Eastern European Summer Time)',date:'03.08.2026',time:'10:00'};
  await runRepair([fb],false);
  assert.match(fb.id,/^repair-[0-9a-z]+-[0-9a-z]+$/,'fallback id is a namespaced string');
  assert.match(fb.id,SYNC_ID_RE,'fallback id passes the syncValidId_ contract');
  assert.equal(typeof fb.id,'string','fallback id is not numeric');

  /* 4: реальний init-degradation тест на робочому дереві (LF) */
  execFileSync(process.execPath,[path.join(root,'tests','init-degradation.test.js')],{stdio:'pipe'});

  /* 5: той самий реальний тест на CRLF-копії джерел (симуляція Windows checkout) */
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mt-crlf-v9165-'));
  try{
    for(const f of ['app.js','js/reports-domain.js','js/tickets-domain.js','js/tickets-bindings.js','js/ticket-state-storage.js']){
      const src=read(f).replace(/\r\n/g,'\n').replace(/\n/g,'\r\n');
      fs.mkdirSync(path.dirname(path.join(tmp,f)),{recursive:true});
      fs.writeFileSync(path.join(tmp,f),src);
    }
    fs.mkdirSync(path.join(tmp,'tests'),{recursive:true});
    fs.writeFileSync(path.join(tmp,'tests','init-degradation.test.js'),read('tests/init-degradation.test.js'));
    execFileSync(process.execPath,[path.join(tmp,'tests','init-degradation.test.js')],{stdio:'pipe'});
  }finally{ fs.rmSync(tmp,{recursive:true,force:true}); }

  console.log('PASS v91.65: repair issues a modern string uuid (fallback included), correct ids untouched, existing lookups work, init-degradation is green on LF and CRLF');
})().catch(error=>{ console.error('FAIL:',error); process.exit(1); });

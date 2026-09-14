'use strict';
/* Регресія аудиту (P1 «мертві кнопки»): sendAllToCloud()/sendShiftsToCloud()
   раніше показували тост «вимкнено» й містили недосяжний код «повної заміни»
   листа. Кнопки лишалися в UI й плутали користувача. Тепер вони живі й чесні:
   надсилають усе невідправлене безпечним шляхом журналу (flush), не чіпаючи
   цілих таблиць; для відновлення всієї бази з хмари лишається окрема кнопка
   «Відновити…». */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

const ticketsBody=app.slice(app.indexOf('async function sendAllToCloud()'),app.indexOf('/* Окремі функції — працюють ТІЛЬКИ зі змінами'));
const shiftsBody=app.slice(app.indexOf('async function sendShiftsToCloud()'),app.indexOf('/* ---------- 3. Навігація між вкладками'));
for(const [name,body] of [['sendAllToCloud',ticketsBody],['sendShiftsToCloud',shiftsBody]]){
  assert.ok(body.length>100,name+' exists');
  assert.doesNotMatch(body,/Повна синхронізація.*вимкнена/,'no dead-end toast');
  assert.doesNotMatch(body,/ADMIN_RECOVERY_REQUIRED/,'no full-sheet replacement path');
  assert.doesNotMatch(body,/backupLocalData\(\);\s*\n\s*\/\*/,'unreachable legacy body removed');
  assert.match(body,/syncEngine\.flush\(\)/,name+' uses the safe journal flush');
  assert.match(body,/if\(!syncEngine\)/,name+' survives a degraded (engine-less) mode');
}
assert.match(html,/id="sendAllBtn"[^>]*>⬆️ Надіслати зміни до хмари</,'button label matches the new honest semantics');
assert.match(html,/id="sendShiftsAllBtn"[^>]*>⬆️ Надіслати всі зміни</,'shifts button label updated');

function loadHarness({scriptUrl='https://script.example',engine}={}){
  const toasts=[],flushCalls=[];
  const context={
    console,
    showToast:m=>toasts.push(m),
    getScriptUrl:()=>scriptUrl,
    settings:{shiftsScriptUrl:''},
    syncEngine:engine,
    tickets:[],shifts:[],
    renderSyncQueueBanner(){toasts.push('banner');},
    renderTicketsScreen(){toasts.push('tickets-render');},
    renderShiftsScreen(){toasts.push('shifts-render');},
    document:{getElementById:()=>null}
  };
  vm.createContext(context);
  vm.runInContext(ticketsBody+'\nglobalThis.sendAllToCloud=sendAllToCloud;',context);
  vm.runInContext(shiftsBody+'\nglobalThis.sendShiftsToCloud=sendShiftsToCloud;',context);
  return {context,toasts,flushCalls};
}
function engineWith({pending,flushResult}){
  const calls=[];
  return {calls,pendingCount:()=>pending,flush:()=>{calls.push('flush');return Promise.resolve(flushResult);}};
}

(async()=>{
  {
    const h=loadHarness({scriptUrl:'',engine:engineWith({pending:1,flushResult:true})});
    await h.context.sendAllToCloud();
    assert.deepEqual(h.toasts,['Спочатку вкажіть URL Apps Script у налаштуваннях']);
    assert.equal(h.context.syncEngine.calls.length,0);
  }
  {
    const h=loadHarness({engine:null});
    await h.context.sendAllToCloud();
    await h.context.sendShiftsToCloud();
    assert.deepEqual(h.toasts,['Синхронізація тимчасово недоступна — зміни збережено локально',
                             'Синхронізація тимчасово недоступна — зміни збережено локально'],'degraded mode: honest message, no crash');
  }
  {
    const h=loadHarness({engine:engineWith({pending:0,flushResult:true})});
    await h.context.sendAllToCloud();
    assert.deepEqual(h.toasts,['Уже синхронізовано ✅','banner']);
    assert.equal(h.context.syncEngine.calls.length,0,'idle queue does not hit the network');
  }
  {
    const h=loadHarness({engine:engineWith({pending:3,flushResult:true})});
    await h.context.sendAllToCloud();
    assert.deepEqual(h.toasts,['Надсилаю 3 несинхронізованих змін…','Усі зміни надіслано ✅']);
    assert.deepEqual(h.context.syncEngine.calls,['flush']);
  }
  {
    const h=loadHarness({engine:engineWith({pending:2,flushResult:false})});
    await h.context.sendShiftsToCloud();
    assert.match(h.toasts[0],/Надсилаю 2/);
    assert.match(h.toasts[h.toasts.length-1],/Не все надіслано/,'partial failure is reported honestly');
  }
  console.log('PASS cloud send buttons are live, safe and honest about degraded/queue states');
})().catch(error=>{process.exitCode=1;console.error(error);});

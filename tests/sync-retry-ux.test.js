'use strict';

// Ручний повтор синхронізації має бути помітним і безпечним: кнопка показує
// стан, повтор під час уже активного flush не запускає другий flush, а
// результат завжди озвучується користувачу.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../js/sync-engine-core.js');
const {Engine} = require('../js/sync-engine-runtime.js');
const {functions} = require('./helpers/tools-source');

const ticketsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'tickets-domain.js'), 'utf8');
const bodies = Object.fromEntries(functions(ticketsSource).filter(fn=>['retrySyncQueue','renderSyncQueueBanner'].includes(fn.name)).map(fn=>[fn.name, fn.body]));
assert.ok(bodies.retrySyncQueue && bodies.renderSyncQueueBanner, 'обидві функції знайдено в tickets-domain.js');

function storage(seed){let value=JSON.parse(JSON.stringify(seed||{records:{}}));return{load:async()=>JSON.parse(JSON.stringify(value)),save:async next=>{value=JSON.parse(JSON.stringify(next));},value:()=>value};}
const ticketPayload = id=>({id,date:'05.09.2026',time:'12:00',content:'x',sum:1,tags:[]});

function harness(options){
  options = options || {};
  const sent = [];
  const engine = new Engine({
    core, storage:storage(options.state), payload:(_entity,item)=>item,
    online:()=>options.online !== false,
    transport:{send:async message=>{ sent.push(message); if(options.onSend) return options.onSend(message); return {ok:true, state:{revision:message.revision, tombstone:false}}; }}
  });
  const nodes = {
    syncQueueRetryBtn:{disabled:false, textContent:'Повторити'},
    syncQueueBannerText:{textContent:''},
    syncQueueBanner:{classList:{hidden:undefined, add(name){ if(name === 'hidden') this.hidden = true; }, remove(name){ if(name === 'hidden') this.hidden = false; }}}
  };
  const context = {
    console, Date, JSON, Array, Object, Promise, Error, String, Number, Math, Boolean, setTimeout, clearTimeout,
    syncEngine:engine, navigator:{onLine:options.online !== false},
    getScriptUrl:()=>'https://example.test/exec',
    document:{getElementById:id=>nodes[id]||null},
    renderTicketsScreen(){ context.rendered = (context.rendered || 0) + 1; },
    showToast(message){ context.toasts.push(message); },
    resetShiftsSyncConfigProbe(){}, shiftsOnlyPending:()=>false,
    toasts:[]
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(bodies.renderSyncQueueBanner, context, {filename:'renderSyncQueueBanner'});
  vm.runInContext(bodies.retrySyncQueue, context, {filename:'retrySyncQueue'});
  return {context, engine, sent, nodes};
}
const queued = (id, content='x')=>core.enqueue({records:{}}, {entity:'ticket', id, payload:ticketPayload(id)}, ()=>'request_' + id + '_abcdefghijkl');

(async()=>{
  /* 1. повтор у стані очікування: кнопка показує стан і повертається назад */

  const idle = harness({state:queued('t1')});
  await idle.engine.init();
  idle.nodes.syncQueueBannerText.textContent = '⏳ Не синхронізовано: 1 — спробувати ще раз?';
  const idleRetry = idle.context.retrySyncQueue();
  assert.equal(idle.nodes.syncQueueRetryBtn.disabled, true, 'кнопка блокується на час синхронізації');
  assert.equal(idle.nodes.syncQueueRetryBtn.textContent, 'Синхронізація…', 'кнопка показує стан');
  assert.match(idle.nodes.syncQueueBannerText.textContent, /⏳ Синхронізація/, 'банер показує, що синхронізація йде');
  await idleRetry;
  assert.equal(idle.nodes.syncQueueRetryBtn.disabled, false, 'після завершення кнопка знову активна');
  assert.equal(idle.nodes.syncQueueRetryBtn.textContent, 'Повторити', 'підпис кнопки повертається');
  assert.equal(idle.sent.length, 1, 'елемент надіслано рівно один раз');
  assert.equal(idle.engine.pendingCount(), 0);
  assert.match(idle.context.toasts.join(' | '), /Усе синхронізовано ✅/, 'користувач бачить результат');

  /* 2. повтор під час активного flush: другий flush не запускається */

  let releaseSend = null;
  const busy = harness({
    state:queued('t2'),
    onSend:message=>new Promise(resolve=>{ releaseSend = ()=>resolve({ok:true, state:{revision:message.revision, tombstone:false}}); })
  });
  await busy.engine.init();
  const running = busy.engine.flush(); // фоновa синхронізація вже почалась
  await new Promise(resolve=>setTimeout(resolve, 0));
  const manual = busy.context.retrySyncQueue();
  assert.equal(busy.nodes.syncQueueRetryBtn.disabled, true);
  assert.match(busy.nodes.syncQueueBannerText.textContent, /Синхронізація вже виконується/, 'видно, що чекаємо вже запущену синхронізацію');
  assert.equal(busy.sent.length, 1, 'другий flush не запускається');
  releaseSend();
  await Promise.all([running, manual]);
  assert.equal(busy.sent.length, 1, 'елемент не відправлено двічі');
  assert.equal(busy.engine.pendingCount(), 0);
  assert.match(busy.context.toasts.join(' | '), /Усе синхронізовано ✅/);

  /* 3. офлайн: нічого не відправляється, користувач бачить залишок */

  const offline = harness({state:queued('t3'), online:false});
  await offline.engine.init();
  await offline.context.retrySyncQueue();
  assert.equal(offline.sent.length, 0, 'в офлайні запити не йдуть');
  assert.equal(offline.engine.pendingCount(), 1, 'черга лишається');
  assert.match(offline.context.toasts.join(' | '), /Залишилось не синхронізовано: 1/, 'користувач бачить, скільки лишилось');
  assert.equal(offline.nodes.syncQueueRetryBtn.disabled, false, 'кнопка не залишається заблокованою');

  /* 4. конфлікт не відправляється повторно і не створює нескінченний цикл */

  const conflictedState = {records:{'ticket:t4':{
    entity:'ticket', id:'t4', committedRevision:2, tombstone:false,
    head:{entity:'ticket', id:'t4', action:'updateTicket', revision:3, requestId:'request_t4_abcdefghijkl', attempted:true, body:ticketPayload('t4')},
    tail:null,
    conflict:{code:'CONFLICT', requestId:'request_t4_abcdefghijkl', server:{revision:2, tombstone:false}}
  }}};
  const conflict = harness({state:conflictedState});
  await conflict.engine.init();
  await conflict.context.retrySyncQueue();
  assert.equal(conflict.sent.length, 0, 'конфліктний елемент не надсилається автоматично');
  assert.ok(conflict.engine.conflictFor('ticket','t4'), 'конфлікт лишається для рішення користувача');
  assert.equal(conflict.engine.pendingCount(), 1, 'запис не зникає з черги');

  /* 5. банер не показується без Script URL (наявна семантика) */

  const noScript = harness({state:queued('t5')});
  await noScript.engine.init();
  noScript.context.getScriptUrl = ()=>'';
  noScript.context.renderSyncQueueBanner();
  assert.equal(noScript.nodes.syncQueueBanner.classList.hidden, true, 'без налаштованої синхронізації банер прихований');
  await noScript.context.retrySyncQueue();
  assert.equal(noScript.sent.length, 0, 'без Script URL повтор нічого не робить');

  console.log('PASS sync retry UX: visible progress, no duplicate flush, honest result and untouched conflict semantics');
})().catch(error=>{console.error(error); process.exitCode = 1;});

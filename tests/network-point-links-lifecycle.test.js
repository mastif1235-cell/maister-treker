'use strict';

// Привʼязки заявок до мережевих точок: нормалізація id, збереження звʼязків,
// коректна поведінка старих заявок без поля та видалення точки разом із
// очищенням відкритої чернетки заявки.

const assert = require('node:assert/strict');
const vm = require('node:vm');
const {loadRuntime, verifyExtraction} = require('./helpers/tools-source');
const core = require('../js/tools-core.js');

verifyExtraction();

/* ---------- чиста логіка звʼязків ---------- */

assert.deepEqual(core.networkPointIds(['np-1', ' np-1 ', '', null, 'np-2', 'np-2']), ['np-1', 'np-2'],
  'id точок нормалізуються, дублікати й порожні значення прибираються');
assert.deepEqual(core.linkNetworkPoint(['np-1'], 'np-1'), ['np-1'], 'повторна привʼязка тієї самої точки не дублюється');
assert.deepEqual(core.linkNetworkPoint(['np-1'], 'np-2'), ['np-1', 'np-2'], 'можна привʼязати кілька точок');
assert.deepEqual(core.unlinkNetworkPoint(['np-1', 'np-2', 'np-2'], 'np-2'), ['np-1'], 'відвʼязка прибирає всі дублікати id');
assert.deepEqual(core.unlinkNetworkPoint(['np-1'], 'absent'), ['np-1'], 'відвʼязка невідомої точки нічого не ламає');

const legacyTicket = {id:'t-legacy'};
const linkedTickets = [
  {id:'t1', networkPointIds:['np-1', 'np-2']},
  {id:'t2', networkPointIds:['np-2']},
  legacyTicket
];
assert.equal(core.ticketsForNetworkPoint(linkedTickets, 'np-1').length, 1, 'пошук заявок за точкою знаходить звʼязану заявку');
assert.equal(core.ticketsForNetworkPoint(linkedTickets, 'absent').length, 0, 'невідома точка не має заявок');
assert.equal(core.ticketsForNetworkPoint([legacyTicket], 'np-1').length, 0, 'стара заявка без поля не рахується звʼязаною');
const changed = core.removeNetworkPointLinks(linkedTickets, 'np-1');
assert.equal(changed.length, 1, 'очищення звʼязків повертає лише змінені заявки');
assert.deepEqual(linkedTickets[0].networkPointIds, ['np-2'], 'звʼязок видаленої точки прибрано, інші лишились');
assert.deepEqual(linkedTickets[1].networkPointIds, ['np-2'], 'заявка без цієї точки не змінюється');
assert.equal(legacyTicket.networkPointIds, undefined, 'стара заявка без поля не отримує нове поле');

const points = [core.normalizeNetworkPoint({id:'np-1', type:'FOB', lat:50.45, lng:30.52}), core.normalizeNetworkPoint({id:'np-2', type:'Муфта', lat:50.46, lng:30.53})];
const removed = core.removeNetworkPoint(points, 'np-1');
assert.equal(removed.removed.id, 'np-1', 'видалення точки повертає саму точку');
assert.deepEqual(removed.points.map(point=>point.id), ['np-2'], 'інші точки лишаються');
assert.equal(core.removeNetworkPoint(points, 'absent').removed, null, 'повторне видалення нічого не робить');

/* ---------- видалення точки з відкритою чернеткою заявки ---------- */

let nodes = {}, modal = null, renders = 0, deletedPhotos = [];
const store = new Map();
function element(id){
  return nodes[id] || (nodes[id] = {
    value:'', files:[], disabled:false, innerHTML:'', textContent:'',
    classList:{add(){}, remove(){}, toggle(){}},
    querySelectorAll:()=>[], scrollIntoView(){}, addEventListener(){}
  });
}
const ctx = {
  MTToolsCore:core,
  loadJSON:(key, fallback)=>store.has(key) ? JSON.parse(store.get(key)) : fallback,
  localStorage:{setItem(key, value){store.set(key, value);}, getItem:key=>store.has(key) ? store.get(key) : null, removeItem(key){store.delete(key);}},
  settings:{cities:[], streets:{}},
  tickets:[
    {id:'t1', city:'Київ', street:'Хрещатик', networkPointIds:['np-1', 'np-2']},
    {id:'t2', city:'Київ', street:'Хрещатик'},
    {id:'t3', city:'Київ', street:'Хрещатик', networkPointIds:['np-2']}
  ],
  document:{getElementById:element, querySelectorAll:()=>[], querySelector:()=>null},
  window:{addEventListener(){}},
  escapeHtml:value=>String(value ?? ''),
  showToast(){}, confirm:()=>true, closeModal(){modal = null;},
  openModal(){}, deletePhotoKey:async key=>{deletedPhotos.push(key);}, saveTickets:async()=>true,
  resolvePhotoAsync:async()=>null, telegramNetworkMessageLink:()=>'',
  MTToolsMap:{destroyPicker(){}, focusPoint(){}}
};
loadRuntime(ctx);
ctx.renderToolsScreen = ()=>{renders++;};
const pointList = ()=>vm.runInContext('toolsNetworkPoints', ctx);
pointList().push(core.normalizeNetworkPoint({id:'np-1', type:'FOB', lat:50.45, lng:30.52}));
pointList().push(core.normalizeNetworkPoint({id:'np-2', type:'Муфта', lat:50.46, lng:30.53}));

// Відкрита заявка в редакторі та збережена чернетка обидві тримають id точки.
const draftKey = vm.runInContext('MT_TOOLS_DRAFT_KEY', ctx);
vm.runInContext('calcState={id:"t1",networkPointIds:["np-1","np-2"]}', ctx);
vm.runInContext('toolsCalculatorDraft={state:{id:"t1",networkPointIds:["np-1","np-2"]},editingTicketId:"t1",originalPhotoKeys:[]}', ctx);
store.set(draftKey, JSON.stringify({state:{id:'t1', networkPointIds:['np-1', 'np-2']}, editingTicketId:'t1', originalPhotoKeys:[]}));

(async()=>{
  const rendersBefore = renders;
  assert.equal(await ctx.toolsDeleteNetworkPoint('np-1'), true, 'точка видаляється');
  assert.deepEqual(Array.from(pointList(), point=>point.id), ['np-2'], 'точка зникає зі списку');
  assert.ok(renders > rendersBefore, 'карта й список оновлюються після видалення');

  assert.deepEqual(Array.from(ctx.tickets[0].networkPointIds), ['np-2'], 'звʼязок із видаленою точкою прибрано із заявки');
  assert.equal(ctx.tickets[1].networkPointIds, undefined, 'заявка без поля лишається без поля');
  assert.deepEqual(Array.from(ctx.tickets[2].networkPointIds), ['np-2'], 'інші звʼязки не зачеплені');

  const calcState = vm.runInContext('calcState', ctx);
  assert.deepEqual(Array.from(calcState.networkPointIds), ['np-2'], 'відкритий редактор заявки втрачає id видаленої точки');
  const draft = vm.runInContext('toolsCalculatorDraft', ctx);
  assert.deepEqual(Array.from(draft.state.networkPointIds), ['np-2'], 'чернетка заявки втрачає id видаленої точки');
  const savedDraft = JSON.parse(store.get(draftKey));
  assert.deepEqual(Array.from(savedDraft.state.networkPointIds), ['np-2'], 'оновлена чернетка записана в локальне сховище');

  console.log('PASS network point links stay normalized, persist, and never survive a deleted point');
})().catch(error=>{console.error(error); process.exitCode = 1;});

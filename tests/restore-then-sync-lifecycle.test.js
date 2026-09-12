'use strict';

// Живий сценарій: заявка прийшла з Google Sheets, користувач її відредагував.
// Після відновлення локальний baseline має дорівнювати серверній ревізії,
// інакше правка піде як «нова заявка» й створить дубль у таблиці.

const assert = require('node:assert/strict');
const core = require('../js/sync-engine-core.js');
const {Engine} = require('../js/sync-engine-runtime.js');
const restore = require('../js/restore-from-sheets.js');

function storage(seed){
  let value = JSON.parse(JSON.stringify(seed || {records:{}}));
  return {load:async()=>JSON.parse(JSON.stringify(value)), save:async next=>{value = JSON.parse(JSON.stringify(next));}, value:()=>value};
}

const ticket = (id, content)=>({id, date:'01.09.2026', time:'10:00', content, sum:0, tags:[]});

const deps = {
  blankTicketObject:()=>({photos:[], tags:[], networkPointIds:[], diagnosticHistory:[]}),
  parseBackupNote:()=>({geoLink:'', masterNote:'', login:'', password:'', fullData:null}),
  ticketToSyncPayload:t=>({
    id:String(t.id || ''), date:String(t.date || ''), time:String(t.time || ''),
    content:String(t.content || ''), sum:Number(t.sum) || 0,
    tags:Array.isArray(t.tags) ? t.tags.slice() : [], backupNote:'',
    fullDataJson:JSON.stringify({city:t.city || ''})
  })
};

const localTickets = [ticket('local-1', 'локальна заявка')];
const cloudRows = [{
  id:'cloud-1', date:'01.09.2026', time:'11:00', content:'заявка з таблиці', sum:0,
  tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Київ'})
}];

(async()=>{
  const plan = restore.buildTicketPlan(localTickets, cloudRows, deps);
  assert.equal(plan.stats.newCount, 1, 'нова заявка з таблиці потрапляє в план відновлення');
  assert.equal(plan.stats.localOnlyCount, 1, 'локальна заявка поза таблицею лишається локальною');

  const restoredTickets = restore.applyTicketPlan(localTickets, cloudRows, {}, deps);
  assert.deepEqual(restoredTickets.map(item=>String(item.id)), ['cloud-1', 'local-1'], 'відновлення додає хмарну заявку й не втрачає локальну');
  assert.ok(!localTickets.some(item=>String(item.id) === 'cloud-1'), 'відновлення не мутує вхідний масив');

  // 1) Відновлення без baseline: правка виглядає як створення нової заявки.
  const naiveStorage = storage();
  const naiveSends = [];
  const naive = new Engine({
    core, storage:naiveStorage, payload:(_entity,item)=>item, online:()=>true,
    transport:{send:async message=>{naiveSends.push(message.action); return {ok:true, state:{revision:message.revision, tombstone:false}};}}
  });
  await naive.init();
  const edited = restoredTickets.map(item=>String(item.id) === 'cloud-1' ? Object.assign({}, item, {content:'заявка з таблиці (правка)'}) : item);
  await naive.recordDiff('ticket', restoredTickets, edited);
  await naive.flush();
  assert.deepEqual(naiveSends, ['addTicket'], 'без baseline навіть правка хмарної заявки їде як створення');

  // 2) Відновлення з вирівняним baseline: правка їде як update тієї самої заявки.
  const alignedStorage = storage();
  const alignedSends = [];
  const aligned = new Engine({
    core, storage:alignedStorage, payload:(_entity,item)=>item, online:()=>true,
    transport:{send:async message=>{alignedSends.push(message); return {ok:true, state:{revision:message.revision, tombstone:false}};}}
  });
  await aligned.init();
  await aligned.seedBaselines([{entity:'ticket', id:'cloud-1', revision:7, tombstone:false}]);
  assert.equal(aligned.pendingCount(), 0, 'вирівнювання baseline не створює черги відправки');
  await aligned.recordDiff('ticket', restoredTickets, edited);
  assert.equal(aligned.pendingCount(), 1, 'після відновлення фіксується лише реальна правка');
  await aligned.flush();

  assert.equal(alignedSends.length, 1, 'локальна заявка не відправляється повторно');
  assert.equal(alignedSends[0].action, 'updateTicket', 'правка відновленої заявки їде як оновлення, а не як нова заявка');
  assert.equal(String(alignedSends[0].body.id), 'cloud-1', 'оновлення стосується тієї самої заявки з таблиці');
  assert.equal(Number(alignedSends[0].revision), 8, 'оновлення йде на наступну серверну ревізію');
  assert.equal(aligned.pendingCount(), 0, 'після відправки черга порожня');

  console.log('PASS restored cloud ticket edits become updates, never duplicate tickets');
})().catch(error=>{console.error(error); process.exitCode = 1;});

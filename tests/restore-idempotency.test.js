'use strict';
/* Ідемпотентний restore з кошика (fix v91.30, MEDIUM).
   Виконує РЕАЛЬНИЙ код restoreDeletedTicket() з js/tickets-domain.js (vm):
   маркер зв'язку «запис кошика ↔ відновлена заявка» переживає збій сховища
   і reload, повторний restore не створює другий UUID, а лише повторює
   cleanup; порядок «спочатку durable save живої заявки, потім metadata
   кошика» не змінено. Кейси 1–10 із постановки задачі. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js','tickets-domain.js'),'utf8');
const appSource=fs.readFileSync(path.join(root,'app.js'),'utf8');
const start=source.indexOf('async function deleteTicket('),end=source.indexOf('\nfunction renderDeletedTicketsList(){',start);
assert.ok(start>=0&&end>start,'restore helpers have one bounded source block');
const now=Date.UTC(2026,8,14),day=24*60*60*1000;let uuidIndex=0; // монотонний на весь ран: uuid не повторюється

const deep=value=>JSON.parse(JSON.stringify(value));

/* Коміт-стан імітує durable storage: saveTickets()/saveDeletedTickets()
   змінюють його лише при успіху. «Reload» = новий харнест на коміті. */
function harness({initialTickets=[],initialDeletedTickets=[],ticketPersistFails=false,trashPersistFails=false,photoFailure=false}={}){
  const physicalDeletes=[],toasts=[],events=[];let ticketWrites=0,trashWrites=0;
  const committed={tickets:deep(initialTickets),deletedTickets:deep(initialDeletedTickets)};
  const context={
    DELETED_TICKET_RETENTION_DAYS:30,
    deletedTickets:deep(initialDeletedTickets),tickets:deep(initialTickets),
    Date:{now:()=>now},Promise,Set,Array,JSON,String,Number,globalThis:null,
    localStorage:{setItem(key,value){events.push('trash-save');trashWrites++;if(trashPersistFails)throw new Error('quota');committed.deletedTickets=JSON.parse(value);},getItem:()=>null,removeItem:()=>{}},
    showToast:message=>toasts.push(message),renderTicketsScreen(){},renderDeletedTicketsList(){},
    openConfirmModal:async()=>true,MTSyncEngineRuntime:{uuid:()=>'uuid-'+(++uuidIndex)},
    currentTicketDate:'14.09.2026',
    saveTickets:async()=>{ticketWrites++;events.push('ticket-save');if(ticketPersistFails)return false;committed.tickets=deep(context.tickets);return true;},
    deletePhotoKey:async key=>{events.push(`photo:${key}`);if(photoFailure)throw new Error('photo storage unavailable');physicalDeletes.push(key);return true;},
  };
  context.globalThis=context;
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  return {context,committed,physicalDeletes,toasts,events,
    get ticketWrites(){return ticketWrites;},get trashWrites(){return trashWrites;},
    reload(){return harness({initialTickets:committed.tickets,initialDeletedTickets:committed.deletedTickets,ticketPersistFails,trashPersistFails,photoFailure});},
  };
}
const TICKET={id:'orig-1',date:'14.09.2026',time:'10:00',type:'Інтернет',clientName:'Тест',sum:300,photos:['idb:ph1'],content:'заявка'};

(async()=>{
  /* 1. Звичайний restore: одна жива заявка, запис кошика видалено. */
  {
    const h=harness({initialDeletedTickets:[{...TICKET,deletedAt:now-2*day}]});
    assert.equal(await h.context.restoreDeletedTicket(now-2*day),true,'1: restore успішний');
    assert.equal(h.context.tickets.length,1,'1: рівно одна жива заявка');
    assert.equal(h.context.tickets[0].id,'uuid-1','1: жива заявка має новий UUID');
    assert.equal(h.context.deletedTickets.length,0,'1: запис кошика видалено');
    assert.equal(h.context.tickets[0].restoredFromDeletedAt,now-2*day,'1: маркер зв\'язку збережено на заявці');
    assert.deepEqual(h.events,['ticket-save','trash-save'],'1: порядок незмінний — спочатку durable save заявки, потім metadata кошика');
    assert.deepEqual(h.physicalDeletes,[],'1: restore не чіпає фото');
  }

  /* 2. saveTickets() FAIL: живої заявки немає, запис кошика і фото на місці. */
  {
    const h=harness({initialDeletedTickets:[{...TICKET,deletedAt:now-2*day}],ticketPersistFails:true});
    assert.equal(await h.context.restoreDeletedTicket(now-2*day),false,'2: restore чесно звітує про невдачу');
    assert.equal(h.context.tickets.length,0,'2: живої заявки не залишилось');
    assert.equal(h.context.deletedTickets.length,1,'2: запис кошика залишився');
    assert.deepEqual(h.physicalDeletes,[],'2: фото не знищені');
    assert.deepEqual(h.committed.tickets,[],'2: коміт живої заявки не відбувся');
  }

  /* 3. saveTickets() PASS, saveDeletedTickets() FAIL: жива заявка + запис
     кошика (pending cleanup) + зрозуміле попередження. */
  let pendingState;
  {
    const h=harness({initialDeletedTickets:[{...TICKET,deletedAt:now-2*day}],trashPersistFails:true});
    assert.equal(await h.context.restoreDeletedTicket(now-2*day),false,'3: cleanup не вдався — restore не успішний');
    assert.equal(h.context.tickets.length,1,'3: жива заявка створена і залишиться');
    assert.equal(h.context.deletedTickets.length,1,'3: запис кошика залишився як pending cleanup');
    assert.ok(h.toasts.some(message=>/відновлено/.test(message)&&/Відновити/.test(message)),'3: користувач отримує зрозуміле попередження');
    assert.equal(h.committed.tickets[0].restoredFromDeletedAt,now-2*day,'3: маркер durably збережений разом із заявкою');
    pendingState=h.committed;
  }

  /* 4. Повторний Restore після №3: НЕ другий UUID, а повторення лише cleanup. */
  {
    const h=harness({initialTickets:pendingState.tickets,initialDeletedTickets:pendingState.deletedTickets});
    assert.equal(await h.context.restoreDeletedTicket(now-2*day),true,'4: повторний restore успішний');
    assert.equal(h.context.tickets.length,1,'4: дубліката немає');
    assert.equal(h.context.tickets[0].id,pendingState.tickets[0].id,'4: використано вже відновлену заявку (той самий id, без нового UUID)');
    assert.equal(h.context.deletedTickets.length,0,'4: metadata кошика тепер очищено');
    assert.deepEqual(h.events,['trash-save'],'4: повторено ЛИШЕ cleanup кошика, збереження заявки не повторюється');
    assert.ok(h.toasts.some(message=>/дубліката не створило|не створило дублікат/.test(message)),'4: користувач бачить, що дублікат не створено');
  }

  /* 5. Reload між №3 і повторним Restore: дублікат так само не створюється. */
  {
    const h=harness({initialTickets:pendingState.tickets,initialDeletedTickets:pendingState.deletedTickets});
    const reloaded=h.reload(); // повний reload: стан лише з durable-комітів
    assert.notEqual(reloaded,h,'5: після reload це новий стан застосунку');
    assert.equal(await reloaded.context.restoreDeletedTicket(now-2*day),true,'5: restore після reload успішний');
    assert.equal(reloaded.context.tickets.length,1,'5: після reload дубліката немає');
    assert.equal(reloaded.context.tickets[0].id,pendingState.tickets[0].id,'5: маркер пережив reload → та сама заявка');
    assert.equal(reloaded.context.deletedTickets.length,0,'5: кошик очищено');
  }

  /* 6. Подвійний тап Restore: рівно одна відновлена заявка. */
  {
    const h=harness({initialDeletedTickets:[{...TICKET,deletedAt:now-2*day}]});
    const results=await Promise.all([
      h.context.restoreDeletedTicket(now-2*day),
      h.context.restoreDeletedTicket(now-2*day),
      h.context.restoreDeletedTicket(now-2*day),
    ]);
    assert.deepEqual(results,[true,false,false],'6: перший тап виконується, повторні ігноруються');
    assert.equal(h.context.tickets.length,1,'6: рівно одна відновлена заявка');
    assert.equal(h.context.deletedTickets.length,0,'6: кошик очищено один раз');
    assert.deepEqual(h.physicalDeletes,[],'6: фото не зачеплені');
  }

  /* 7. Спільні фото-ключі: виправлення не видаляє фото, на які ще є посилання. */
  {
    const h=harness({initialTickets:[{id:'live-other',photos:['idb:shared']}],initialDeletedTickets:[{...TICKET,photos:['idb:shared','idb:own'],deletedAt:now-2*day}]});
    assert.equal(await h.context.restoreDeletedTicket(now-2*day),true);
    // Постійне очищення запису кошика після успішного restore:
    assert.equal(await h.context.purgeDeletedTicket(now-2*day),false,'7: запис уже не в кошику — purge нічого не видаляє');
    assert.deepEqual(h.physicalDeletes,[],'7: спільне фото, на яке посилається жива заявка, не видалене');
    // Purge ІНШОГО (щойно відновленого повторно доданого) запису теж не чіпає спільне фото:
    const h2=harness({initialTickets:[{id:'live-other',photos:['idb:shared']}],initialDeletedTickets:[{...TICKET,photos:['idb:shared'],deletedAt:now-2*day}]});
    await h2.context.restoreDeletedTicket(now-2*day);
    const copy={...TICKET,photos:['idb:shared'],deletedAt:now-day};
    h2.context.deletedTickets.push(copy);
    await h2.context.purgeDeletedTicket(now-day);
    assert.deepEqual(h2.physicalDeletes,[],'7: purge запису не видаляє фото, referenced живою заявкою');
  }

  /* 8. Старий запис кошика (v91.29) без нових metadata: відновлюється як раніше. */
  {
    const legacy=JSON.parse(JSON.stringify({...TICKET,deletedAt:now-2*day}));
    assert.ok(!('restoredFromDeletedAt' in legacy),'8: фікстура без нових metadata');
    const h=harness({initialDeletedTickets:[legacy]});
    assert.equal(await h.context.restoreDeletedTicket(now-2*day),true,'8: старий запис відновлюється');
    assert.equal(h.context.tickets.length,1);assert.equal(h.context.deletedTickets.length,0);
  }

  /* 9. Permanent purge pending-restored запису не видаляє фото живої заявки. */
  {
    const h=harness({initialTickets:pendingState.tickets,initialDeletedTickets:pendingState.deletedTickets});
    assert.equal(await h.context.purgeDeletedTicket(now-2*day),true,'9: purge pending-запису проходить');
    assert.deepEqual(h.physicalDeletes,[],'9: фото активної відновленої заявки не видалені');
    assert.equal(h.context.tickets.length,1,'9: відновлена заявка жива');
    assert.equal(h.context.deletedTickets.length,0,'9: кошик порожній');
  }

  /* 10. Backup/export/import: нові optional metadata не ламають формати;
     sync payload (ticketToSyncPayload) не змінюється від маркера. */
  {
    // Витягуємо РЕАЛЬНУ функцію payload'а з app.js (обмежений блок).
    const pStart=appSource.indexOf('function ticketToSyncPayload('),pEnd=appSource.indexOf('function shiftToSyncPayload(',pStart);
    assert.ok(pStart>=0&&pEnd>pStart,'ticketToSyncPayload has a bounded block');
    const context={formatDate:()=>'14.09.2026',formatTime:()=>'12:00',MTToolsCore:{googleMapsUrl:()=>'',networkPointIds:value=>Array.isArray(value)?value:[],sanitizeDiagnostics:value=>value}};
    context.globalThis=context;vm.createContext(context);
    vm.runInContext(appSource.slice(pStart,pEnd),context);
    const withMarker={...TICKET,restoredFromDeletedAt:now-2*day,diagnosticHistory:[]};
    const withoutMarker={...TICKET,diagnosticHistory:[]};
    const a=context.ticketToSyncPayload(withMarker),b=context.ticketToSyncPayload(withoutMarker);
    assert.deepEqual(a,b,'10: sync payload (Sheets/GAS contract) не змінюється від restore-маркера');
    assert.equal(a.id,withMarker.id,'10: id у payload незмінний');
    // JSON round-trip (експорт → імпорт) зберігає маркер і не ламається:
    const roundTrip=JSON.parse(JSON.stringify(withMarker));
    assert.equal(roundTrip.restoredFromDeletedAt,now-2*day,'10: optional metadata переживають export/import JSON');
    // Object.assign(blank, source) — семантика mtBackupCleanTicket імпорту:
    const imported=Object.assign({id:'',date:'',time:''},roundTrip);
    assert.equal(imported.restoredFromDeletedAt,now-2*day,'10: імпорт бекапу (merge у blank ticket) толерантний до маркера');
  }

  /* Бонус-інваріант: restore ІНШОГО запису за наявності pending не хибно
     збігається з чужим маркером і створює окрему заявку. */
  {
    const h=harness({initialTickets:pendingState.tickets,initialDeletedTickets:[...pendingState.deletedTickets,{...TICKET,id:'orig-2',deletedAt:now-day}]});
    assert.equal(await h.context.restoreDeletedTicket(now-day),true,'інваріант: інший запис відновлюється звичайним шляхом');
    assert.equal(h.context.tickets.length,2,'інваріант: друга заявка — окрема, без конфлікту маркерів');
    assert.deepEqual(new Set(h.context.tickets.map(ticket=>ticket.id)).size,2,'інваріант: id унікальні');
  }
  console.log('PASS restore is idempotent: durable marker survives storage failure and reload, retry never duplicates, old records stay compatible');
})().catch(error=>{console.error(error);process.exitCode=1;});

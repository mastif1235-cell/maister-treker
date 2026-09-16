'use strict';
/* v91.34: аварійне відновлення з Telegram-бекапа (повний снапшот).
   Харнест виконує РЕАЛЬНИЙ js/telegram-full-snapshot.js (vm) + РЕАЛЬНИЙ
   security-hardening.js (стрикти секретів). Telegram симулюється каналом із
   порядком документів і станом закріплення; жодного звернення до
   sendMessage/sendPhoto/sendMediaGroup/deleteMessage/edit* під час restore
   немає — це фіксується окремими тестами. Покриває T1–T24 з ТЗ. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const REPO=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(REPO,'js','telegram-full-snapshot.js'),'utf8');
const securitySource=fs.readFileSync(path.join(REPO,'js','security-hardening.js'),'utf8');
const response=data=>({status:200,headers:{get:()=>null},json:async()=>data});
const TICKET_BASE={type:'РЕМОНТ',date:'16.09.2026',time:'07:20',content:'ЗАЯВКА: РЕМОНТ',city:'Таромское',street:'Академіка Плавова',house:'3',sum:800,payment:'Готівка'};

function makeWorld(opts){
  opts=opts||{};
  const world={
    tickets:(opts.tickets||[]).map(t=>JSON.parse(JSON.stringify(t))),
    deletedTickets:(opts.deleted||[]).map(t=>JSON.parse(JSON.stringify(t))),
    photos:opts.photos||new Map(),           // IndexedDB photos: key → dataURL
    channel:[],                              // усі надіслані документи-снапшоти (НЕ видаляються)
    pinFileId:opts.pinnedFileId||null,       // поточне закріплення
    files:new Map(),                         // file_id → текст файлу
    nextFileId:opts.nextFileId||900,
    downloadFailFileIds:new Set(),           // фото, яке не скачається
    failSendOnce:!!opts.failSendOnce,        // T16
    failPinOnce:!!opts.failPinOnce,          // T17
    persistedSnapshots:[],sheetsCalls:0,syncFlushCalls:0,telegramMutationCalls:[],photoFetchCalls:[],toasts:[],
  };
  const context={
    AbortController,Blob,FormData,clearTimeout,setTimeout,
    console:{error(){},warn(){},log(){}},
    navigator:{onLine:true},
    APP_VERSION:'v91.34-test',
    settings:{tgBotToken:'token',tgBackupChatId:'chat'},
    tickets:world.tickets,
    deletedTickets:world.deletedTickets,
    document:{addEventListener(){},getElementById:()=>null},
    saveTicketsLocalOnly:async function(){world.persistedSnapshots.push(JSON.parse(JSON.stringify(world.tickets)));return true;},
    photoDbGet:async key=>world.photos.get(key)||null,
    photoDbPut:async (key,val)=>{world.photos.set(key,val);return true;},
    fetchPhotoFromTelegram:async fileId=>{
      world.photoFetchCalls.push(fileId);
      if(world.downloadFailFileIds.has(fileId))return null;
      return 'data:image/jpeg;base64,UEhPVE8='+Buffer.from(String(fileId)).toString('base64');
    },
    fetch:async url=>{
      url=String(url);
      if(/\/file\/bot/.test(url)){
        const fileId=url.split('/').pop();
        if(world.downloadFailFileIds.has('file:'+fileId))throw new Error('download failed');
        return{text:async()=>world.files.get(fileId)||''};
      }
      throw new Error('unexpected direct fetch: '+url);
    },
    getScriptUrl:()=>{world.sheetsCalls++;return 'https://script.example';},
    syncEngine:{flush:async()=>{world.syncFlushCalls++;return true;}},
    showToast:m=>world.toasts.push(String(m)),
    openModal(){},closeModal(){},
    renderTicketsScreen(){},
    blankTicketObject(){return {id:null,date:'',time:'',content:'',sum:0,tags:[],photo:null,photos:[],type:'Підключення',city:'',address:'',clientName:'',phone:'',signal:'',baseCallFee:0,callFee:0,tariff:0,equipment:[],cables:[],presetWorks:[],additionalWork:[],payment:'',cashAmount:0,cardAmount:0,itemPayments:{},note:'',geoLink:'',geoLat:null,geoLng:null,masterNote:'',otherNote:'',macAddress:'',street:'',house:'',apartment:'',login:'',password:'',connectMasters:[],contractNumber:'',contractNumberDate:'',contractNumberMastersKey:'',abonentNote:'',extraPhones:[],tgBackedUp:false,tgBackupPending:false,tgPhotoFileId:null,tgSepMsgId:null,tgTextMsgId:null,tgPhotoMsgId:null,tgJsonMsgId:null,tgPhotoFileIds:[],tgPhotoMsgIds:[],tgPhotoKeys:[],tgBackupCleanupMsgIds:[],tgBackupCleanupAttempts:{},tgBackupStaleMsgIds:[],tgBackupAmbiguous:false,networkPointIds:[],diagnosticHistory:[],cloudImported:false};},
  };
  vm.createContext(context);
  vm.runInContext(securitySource,context,{filename:'js/security-hardening.js'});
  vm.runInContext(source,context,{filename:'js/telegram-full-snapshot.js'});
  // Підміни СТРОГО після runInContext
  context.fetchWithRetry=async(url,opts)=>{
    url=String(url);
    if(/\/sendDocument$/.test(url)){
      world.telegramMutationCalls.push('sendDocument');
      if(world.failSendOnce){world.failSendOnce=false;return response({ok:false,error_code:500,description:'Internal Server Error'});}
      const blob=opts.body.get('document');
      const text=await blob.text(); // справжній Blob у харнесті
      const id=++world.nextFileId,fileId='snap-'+id;
      world.channel.push({fileId,text});
      world.files.set(fileId,text);
      return response({ok:true,result:{message_id:id,document:{file_id:fileId,file_name:'master-tracker-full-backup.json'}}});
    }
    if(/\/pinChatMessage$/.test(url)){
      world.telegramMutationCalls.push('pinChatMessage');
      if(world.failPinOnce){world.failPinOnce=false;return response({ok:false,error_code:400,description:'Bad Request: not enough rights'});}
      const body=JSON.parse(opts.body);
      // message_id → file_id: sendDocument дав message_id = id, file_id = 'snap-'+id
      world.pinFileId='snap-'+body.message_id;
      return response({ok:true,result:true});
    }
    if(/\/getChat$/.test(url)){
      world.telegramMutationCalls.push('getChat');
      const pinned=world.pinFileId?{document:{file_id:world.pinFileId,file_name:'master-tracker-full-backup.json'}}:null;
      return response({ok:true,result:{id:-100,pinned_message:pinned}});
    }
    if(/\/getFile\?/.test(url)){
      world.telegramMutationCalls.push('getFile');
      const fileId=decodeURIComponent(String(url).split('file_id=')[1]||'');
      return response({ok:true,result:{file_id:fileId,file_path:'tf/'+fileId}});
    }
    world.telegramMutationCalls.push(url.replace(/https:\/\/api\.telegram\.org\/bot[^/]+\//,''));
    return response({ok:false,description:'unexpected endpoint in test: '+url});
  };
  return {context,world};
}
const mkTicket=(id,extra)=>Object.assign({},TICKET_BASE,{id},extra||{});
function snapshotOf(tickets,deleted,savedAt){
  return {MT_FULL_SNAPSHOT:1,schema:1,savedAt:savedAt||'2026-09-16T08:00:00.000Z',savedAtMs:1737000000000,appVersion:'v91.34-test',tickets,deleted:deleted||[]};
}

(async()=>{
  /* T1. Порожня база → повне відновлення заявок (+фото). */
  {
    const {context,world}=makeWorld();
    const snap=snapshotOf([mkTicket('a1'),mkTicket('a2',{photos:['idb:p1','idb:p2'],tgPhotoFileIds:['f1','f2'],tgPhotoMsgIds:[11,12]})]);
    const res=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(res.ok,true,'T1: restore succeeds');
    assert.equal(res.restored,2,'T1: both tickets restored');
    assert.equal(world.tickets.length,2,'T1: exactly two local tickets');
    assert.equal(world.photos.get('idb:p1'),'data:image/jpeg;base64,UEhPVE8='+Buffer.from('f1').toString('base64'),'T1: photo 1 restored into IndexedDB');
    assert.equal(world.photos.size,2,'T1: both photos restored');
    assert.ok(world.persistedSnapshots.length>=1,'T1: tickets persisted durably');
    const restored=world.tickets.find(t=>t.id==='a1');
    assert.equal(restored.type,'РЕМОНТ','T1: full ticket fields preserved');
    assert.equal(restored.date,'16.09.2026','T1: date preserved');
    assert.equal(restored.sum,800,'T1: sum preserved');
  }

  /* T2. Частина заявок уже існує → без дублів, без перезапису. */
  {
    const local=mkTicket('a1',{content:'локальна свіжа правка'});
    const {context,world}=makeWorld({tickets:[local]});
    const snap=snapshotOf([mkTicket('a1'),mkTicket('a2')]);
    const res=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(res.restored,1,'T2: only the missing ticket restored');
    assert.equal(res.skippedExisting,1,'T2: existing ticket skipped');
    assert.equal(world.tickets.length,2,'T2: no duplicates');
    assert.equal(world.tickets.find(t=>t.id==='a1').content,'локальна свіжа правка','T2: existing local ticket NOT overwritten');
  }

  /* T3. Повторний restore → результат той самий (ідемпотентність). */
  {
    const {context,world}=makeWorld();
    const snap=snapshotOf([mkTicket('a1',{photos:['idb:p1'],tgPhotoFileIds:['f1']})]);
    await context.restoreFromTelegramFullSnapshot(snap);
    const count1=world.tickets.length,photoCalls1=world.photoFetchCalls.length;
    const res2=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(res2.restored,0,'T3: second restore adds nothing');
    assert.equal(res2.skippedExisting,1,'T3: ticket skipped as existing');
    assert.equal(world.tickets.length,count1,'T3: still one ticket');
    assert.equal(world.photoFetchCalls.length,photoCalls1,'T3: photos not re-fetched (already in IndexedDB)');
  }

  /* T4. Кілька версій однієї заявки в снапшоті → детерміновано остання. */
  {
    const {context,world}=makeWorld();
    const snap=snapshotOf([mkTicket('a1',{content:'СТАРА версія',sum:100}),mkTicket('a1',{content:'НОВА версія',sum:999}),mkTicket('b2')]);
    const analysis=await context.analyzeSnapshotForRestore(snap);
    assert.equal(analysis.unique,2,'T4: versions deduped by ticket.id');
    assert.equal(analysis.duplicateVersions,1,'T4: duplicate version counted');
    const res=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(res.restored,2,'T4: two unique tickets restored');
    const restored=world.tickets.find(t=>t.id==='a1');
    assert.equal(restored.content,'НОВА версія','T4: the LATEST version wins (deterministic)');
    assert.equal(restored.sum,999,'T4: latest sum');
  }

  /* T5. Заявка з 0 фото. */
  {
    const {context,world}=makeWorld();
    const res=await context.restoreFromTelegramFullSnapshot(snapshotOf([mkTicket('a0')]));
    assert.equal(res.restored,1,'T5: zero-photo ticket restored');
    assert.equal(res.photos.need,0,'T5: no photo jobs');
    assert.equal(world.photos.size,0,'T5: no photos touched');
  }

  /* T6. Заявка з 1 фото (legacy tgPhotoFileId без масиву). */
  {
    const {context,world}=makeWorld();
    const snap=snapshotOf([mkTicket('a1',{photo:'idb:legacy',tgPhotoFileId:'legacy-fid'})]);
    const res=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(res.restored,1,'T6: single-photo (legacy field) ticket restored');
    assert.equal(res.photos.restored,1,'T6: photo fetched via legacy tgPhotoFileId');
    assert.ok(world.photos.has('idb:legacy'),'T6: legacy photo key populated in IndexedDB');
  }

  /* T7. Заявка з 3 фото (альбом). */
  {
    const {context,world}=makeWorld();
    const snap=snapshotOf([mkTicket('a3',{photos:['idb:k1','idb:k2','idb:k3'],tgPhotoFileIds:['f1','f2','f3'],tgPhotoMsgIds:[11,12,13]})]);
    const res=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(res.photos.need,3,'T7: three photo jobs');
    assert.equal(res.photos.restored,3,'T7: all three restored');
    assert.deepEqual([...world.photos.keys()].sort(),['idb:k1','idb:k2','idb:k3'],'T7: keys preserved');
  }

  /* T8. Фото недоступне → заявка все одно відновлена + чесний лічильник. */
  {
    const {context,world}=makeWorld();
    world.downloadFailFileIds.add('f2');
    const snap=snapshotOf([mkTicket('a2',{photos:['idb:p1','idb:p2'],tgPhotoFileIds:['f1','f2']})]);
    const res=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(res.restored,1,'T8: ticket restored despite photo failure');
    assert.equal(res.photos.restored,1,'T8: the good photo restored');
    assert.equal(res.photos.failed,1,'T8: the failed photo honestly counted');
    assert.equal(world.tickets.length,1,'T8: nothing lost');
  }

  /* T9. Збій мережі посередині restore → повторний запуск дозавантажує без дублів. */
  {
    const {context,world}=makeWorld();
    world.downloadFailFileIds.add('f1');
    const snap=snapshotOf([mkTicket('a1',{photos:['idb:p1'],tgPhotoFileIds:['f1']}),mkTicket('a2')]);
    const first=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(first.restored,2,'T9: tickets restored on the first run');
    assert.equal(first.photos.failed,1,'T9: one photo failed');
    world.downloadFailFileIds.delete('f1'); // мережа відновилась
    const second=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(second.restored,0,'T9: no ticket duplicates on the second run');
    assert.equal(second.photos.restored,1,'T9: the missing photo was backfilled');
    assert.equal(second.photos.skippedExisting,0,'T9: nothing re-downloaded for intact keys');
    assert.equal(world.tickets.length,2,'T9: still exactly two tickets');
  }

  /* T10. Існуючі локальні заявки НЕ видаляються і не перезаписуються. */
  {
    const keep1=mkTicket('mine1',{content:'моя локальна 1'}),keep2=mkTicket('mine2',{content:'моя локальна 2'});
    const {context,world}=makeWorld({tickets:[keep1,keep2]});
    const snap=snapshotOf([mkTicket('x1'),mkTicket('mine1')]);
    await context.restoreFromTelegramFullSnapshot(snap);
    assert.deepEqual(world.tickets.map(t=>t.id).sort(),['mine1','mine2','x1'],'T10: local tickets intact, missing added');
    assert.equal(world.tickets.find(t=>t.id==='mine2').content,'моя локальна 2','T10: untouched');
  }

  /* T11+T22. Під час restore — НУЛЬ нових повідомлень звичайного бекапу. */
  {
    const {context,world}=makeWorld();
    const snap=snapshotOf([mkTicket('a1',{photos:['idb:p1'],tgPhotoFileIds:['f1']}),mkTicket('a2')]);
    await context.restoreFromTelegramFullSnapshot(snap);
    const mutationEndpoints=world.telegramMutationCalls.filter(ep=>/send(Message|Photo|MediaGroup|Document)|deleteMessage|edit(Message|Media)/.test(ep));
    assert.deepEqual(mutationEndpoints,[],'T11/T22: restore issued ZERO Telegram backup mutations');
    assert.ok(world.telegramMutationCalls.every(ep=>ep==='getChat'||ep==='getFile'),'T11: only read-only endpoints were used');
  }

  /* T23. Restore НЕ запускає Google Sheets sync/write. */
  {
    const {context,world}=makeWorld();
    await context.restoreFromTelegramFullSnapshot(snapshotOf([mkTicket('a1')]));
    assert.equal(world.sheetsCalls,0,'T23: no Sheets calls');
    assert.equal(world.syncFlushCalls,0,'T23: no sync flush');
  }

  /* T13. Старий/неповний запис → дефолти з blankTicketObject, без пошкоджень. */
  {
    const {context,world}=makeWorld();
    const snap=snapshotOf([{id:'old1',date:'01.01.2025',type:'Імпорт',content:'тільки базові поля',photos:['idb:old'],tgPhotoFileIds:[],tgJsonMsgId:77}]);
    const res=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(res.restored,1,'T13: legacy record restored');
    const t=world.tickets[0];
    assert.deepEqual(t.tags,[],'T13: missing arrays defaulted');
    assert.equal(t.tgBackupPending,false,'T13: transient state clean');
    assert.equal(t.tgBackedUp,true,'T13: confirmed copy flag set (json id present) — no re-send later');
    assert.equal(t.sum,0,'T13: sum defaulted');
  }

  /* T14. Некоректний JSON → пропуск + звіт, без пошкодження даних. */
  {
    const {context,world}=makeWorld();
    const snap=snapshotOf([{date:'не дата',type:'X',content:'?'},{id:'ok1',date:'02.02.2025',type:'Імпорт'}]);
    const res=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(res.restored,1,'T14: only the valid record restored');
    assert.equal(res.errors.length,1,'T14: the invalid record reported');
    assert.match(res.errors[0].reason,/некоректний/,'T14: understandable reason');
    assert.equal(world.tickets[0].id,'ok1','T14: nothing broken');
  }

  /* T15. Два записи з однаковим ticket.id → детермінований вибір актуальної. */
  {
    const {context,world}=makeWorld();
    const res=await context.restoreFromTelegramFullSnapshot(snapshotOf([mkTicket('dup',{content:'перша копія'}),mkTicket('dup',{content:'друга копія'})]));
    assert.equal(res.restored,1,'T15: exactly one restored');
    assert.equal(world.tickets.length,1,'T15: no copies');
    assert.equal(world.tickets[0].content,'друга копія','T15: the LAST version wins deterministically');
  }

  /* T16. Новий снапшот НЕ завантажився → старий закріплений лишається робочим. */
  {
    const {context,world}=makeWorld();
    const first=await context.createTelegramFullSnapshot();
    assert.equal(first.ok,true,'T16: first snapshot created+');
    const oldPin=world.pinFileId,oldText=world.channel[0].text;
    world.failSendOnce=true;
    const second=await context.createTelegramFullSnapshot();
    assert.equal(second.ok,false,'T16: failed send is honestly reported');
    assert.equal(second.stage,'send','T16: failure stage = send');
    assert.equal(world.pinFileId,oldPin,'T16: the pinned anchor unchanged');
    assert.equal(world.channel.length,1,'T16: no partial new snapshot in the channel');
    const read=await context.fetchTelegramFullSnapshot();
    assert.equal(read.ok,true,'T16: the OLD snapshot is still readable');
    assert.equal(read.snapshot.tickets.length,JSON.parse(oldText).tickets.length,'T16: old snapshot content intact');
  }

  /* T17. send вдалось, pin — ні → попередня точка відновлення не втрачена. */
  {
    const {context,world}=makeWorld();
    await context.createTelegramFullSnapshot();
    const oldPin=world.pinFileId;
    world.failPinOnce=true;
    const second=await context.createTelegramFullSnapshot();
    assert.equal(second.ok,false,'T17: pin failure reported');
    assert.equal(second.stage,'pin','T17: stage = pin');
    assert.ok(second.messageId,'T17: the sent file id is returned (kept as a backup copy)');
    assert.equal(world.pinFileId,oldPin,'T17: previous restore point still pinned');
    assert.equal(world.channel.length,2,'T17: the new file remains in the channel as a spare copy (no delete-first)');
  }

  /* T18. Повторне створення → новий снапшот стає чинним, попередній — резервний. */
  {
    const {context,world}=makeWorld();
    const first=await context.createTelegramFullSnapshot();
    world.tickets.push(mkTicket('new-ticket'));
    const second=await context.createTelegramFullSnapshot();
    assert.equal(first.ok&&second.ok,true,'T18: both creations succeed');
    assert.notEqual(world.pinFileId,'snap-'+first.messageId,'T18: the pin moved to the NEW snapshot');
    assert.equal(world.pinFileId,'snap-'+second.messageId,'T18: pinned = the latest');
    assert.equal(world.channel.length,2,'T18: the previous snapshot NOT deleted (2 restore points)');
    const deletes=world.telegramMutationCalls.filter(ep=>ep==='deleteMessage');
    assert.deepEqual(deletes,[],'T18: zero deleteMessage — never delete-first');
    const read=await context.fetchTelegramFullSnapshot();
    assert.equal(read.snapshot.tickets.length,1,'T18: the fresh snapshot (with the new ticket) is what restore would read');
  }

  /* T19. Пошкоджена/непідтримувана схема → жодних змін локальних даних. */
  {
    const {context,world}=makeWorld();
    const before=JSON.stringify(world.tickets);
    const bad1=await context.restoreFromTelegramFullSnapshot({MT_FULL_SNAPSHOT:1,schema:99,tickets:[]});
    const bad2=await context.restoreFromTelegramFullSnapshot({hello:'world'});
    const bad3=await context.restoreFromTelegramFullSnapshot(null);
    assert.equal(bad1.ok&&bad2.ok&&bad3.ok,false,'T19: all unsupported schemas rejected');
    assert.match(bad1.reason,/Непідтримувана схема/,'T19: clear reason');
    assert.equal(JSON.stringify(world.tickets),before,'T19: local data untouched');
    assert.equal(world.persistedSnapshots.length,0,'T19: nothing persisted');
  }

  /* T20. Частина фото впала → повторний запуск НЕ створює заявки повторно
     і дозавантажує відсутні фото. */
  {
    const {context,world}=makeWorld();
    world.downloadFailFileIds.add('f1');
    const snap=snapshotOf([mkTicket('a1',{photos:['idb:p1','idb:p2'],tgPhotoFileIds:['f1','f2']})]);
    const first=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(first.restored,1&&first.photos.failed,1,'T20: one photo failed on the first run');
    world.downloadFailFileIds.delete('f1');
    const second=await context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(second.restored,0,'T20: the ticket NOT recreated');
    assert.equal(second.photos.restored,1,'T20: the missing photo backfilled');
    assert.equal(second.photos.skippedExisting,1,'T20: the already-present photo skipped');
    assert.equal(world.photos.size,2,'T20: both photos finally present');
  }

  /* T21. Kill/reload під час відновлення фото → заявки не пошкоджені,
     повторний запуск сходиться. */
  {
    const w1=makeWorld();
    w1.world.downloadFailFileIds.add('f2');
    const snap=snapshotOf([mkTicket('a1',{photos:['idb:p1','idb:p2'],tgPhotoFileIds:['f1','f2']}),mkTicket('a2')]);
    const first=await w1.context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(first.restored,2,'T21: tickets restored before the «kill»');
    // «Застосунок убито»: новий контекст, tickets із durable-знімка
    const persisted=w1.world.persistedSnapshots[w1.world.persistedSnapshots.length-1];
    assert.equal(persisted.length,2,'T21: durable snapshot holds both tickets');
    const w2=makeWorld({tickets:persisted,photos:w1.world.photos});
    w2.world.downloadFailFileIds.add('f2'); // одразу після reload мережа доси збійна
    const second=await w2.context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(second.restored,0,'T21: no duplicates after reload');
    assert.equal(second.skippedExisting,2,'T21: both tickets recognized as existing');
    assert.equal(second.photos.failed,1,'T21: the flaky photo still fails while network is bad');
    w2.world.downloadFailFileIds.delete('f2'); // мережа відновилась
    const third=await w2.context.restoreFromTelegramFullSnapshot(snap);
    assert.equal(third.photos.restored,1,'T21: the interrupted photo backfilled after reload');
    assert.equal(third.photos.skippedExisting,1,'T21: the good photo was not re-downloaded');
    assert.equal(w2.world.photos.size,2,'T21: converged — all photos present');
    assert.equal(w2.world.tickets.length,2,'T21: converged — exactly two tickets');
  }

  /* T24. У снапшоті НЕМАЄ системних секретів (спільний securityStrip). */
  {
    const {context,world}=makeWorld();
    world.tickets.push(mkTicket('sec1',{login:'client-login',password:'client-pass',apiToken:'SUPER-SECRET-TOKEN',syncHmacSecret:'SECRET'}));
    const snapshot=context.buildFullSnapshotObject();
    const text=JSON.stringify(snapshot);
    assert.equal(/SUPER-SECRET-TOKEN/.test(text),false,'T24: stripped secret key values absent');
    assert.equal(/SECRET\b/.test(text.replace(/syncHmacSecret/g,'')),false,'T24: no secret values');
    assert.equal(text.includes('"syncHmacSecret"'),false,'T24: secret keys stripped');
    assert.ok(text.includes('"login":"client-login"'),'T24: CLIENT credentials (the archive\'s purpose) preserved');
    assert.equal(text.includes('"tgBackupPending"'),false,'T24: transient fields not stored');
  }

  /* Додатково: analyze — чесний предпросмотр (нові/існуючі/видалені/фото). */
  {
    const {context}=makeWorld({tickets:[mkTicket('ex1')]});
    const snap=snapshotOf([mkTicket('ex1'),mkTicket('n1',{photos:['idb:a'],tgPhotoFileIds:['f1']}),mkTicket('gone1')],[{id:'gone1',deletedAt:1737000000000}]);
    const a=await context.analyzeSnapshotForRestore(snap);
    assert.equal(a.ok&&a.total===3&&a.newCount===1&&a.existingCount===1&&a.deletedCount===1&&a.photoJobs===1,true,'analyze: preview counts are exact');
  }

  console.log('PASS telegram full-snapshot restore: T1–T24 (merge by original id, idempotent, tombstones-aware, secrets-free, zero Telegram mutations, zero Sheets calls, pin-anchored snapshots with delete-first never used)');
})().catch(error=>{console.error(error);process.exitCode=1;});

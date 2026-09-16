'use strict';
/* Регресія v91.31 (розширена v91.32): дедуплікація Telegram-фотографій заявки.
   Харнест виконує РЕАЛЬНИЙ js/photo-telegram-domain.js (vm) і рахує всі
   виклики Telegram API (sendMessage/sendPhoto/sendMediaGroup/sendDocument/
   deleteMessage/editMessageText). З v91.32 2–10 фото летять ОДНИМ sendMediaGroup
   (альбом), >10 — chunks по 10; гарантії дедуплікації незмінні. Група-архів —
   спільна Map, «reload» — новий контекст на останньому durable-знімку
   (saveTicketsLocalOnly) з тією самою групою.
   Гарантії, які фіксує файл:
     - кожна фотографія заявки доставляється в групу рівно один раз
       (поза «подвійними ключами», які задані у самій заявці навмисно);
     - частковий збій + retry не залишає сиріт і не повторює надіслане;
     - kill/reload посередині спроби сходиться до однієї копії кожного фото;
     - неоднозначна доставка (втрачена відповідь) паркується без авто-retry;
     - заявки без фото та легасі-заявки без tgPhotoFileIds бекапляться. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','photo-telegram-domain.js'),'utf8');
const response=(data,status=200)=>({status,headers:{get:()=>null},json:async()=>data});
const TICKET_BASE={type:'Інтернет',date:'15.09.2026',time:'10:00',content:'Виклик 300 грн',city:'Дніпро',street:'Слобожанський',house:'1'};

function makeWorld({ticket,live,startId=100}){
  let nextId=startId;
  const world={apiLog:[],live:live||new Map(),deleted:[],persistedSnapshots:[],failDeletes:false,sendPhotoFailOnce:new Set(),sendPhotoNetworkFailOnce:new Set(),hangPhotoIndex:null};
  const context={
    AbortController,Blob,FormData,atob:globalThis.atob,clearTimeout,setTimeout,
    console:{error(){},warn(){},log(){}},navigator:{onLine:true},
    settings:{tgBotToken:'token',tgBackupChatId:'chat'},
    tickets:[ticket],
    refreshTicketCardDom(){},
    saveTicketsLocalOnly:async function(){world.persistedSnapshots.push(JSON.parse(JSON.stringify(ticket)));return true;},
    fetch:async function(url,opts){
      url=String(url);
      if(url.startsWith('data:'))return{blob:async()=>new Blob(['photo-bytes'],{type:'image/jpeg'})};
      if(/deleteMessage$/.test(url)){
        const id=JSON.parse(opts.body).message_id;
        world.apiLog.push({endpoint:'deleteMessage',id});
        if(world.failDeletes)return response({ok:false,error_code:429,description:'Too Many Requests: retry after 1'},429);
        world.deleted.push(id);world.live.delete(id);return response({ok:true});
      }
      if(/\/sendMessage$/.test(url)){
        const text=String(JSON.parse(opts.body).text);
        const id=++nextId,kind=/➖/.test(text)?'sep':'text';
        world.live.set(id,{kind});world.apiLog.push({endpoint:'sendMessage',kind});
        return response({ok:true,result:{message_id:id}});
      }
      if(/\/editMessageText$/.test(url)){
        const body=JSON.parse(opts.body);
        world.apiLog.push({endpoint:'editMessageText',id:body.message_id});
        if(!world.live.has(body.message_id))return response({ok:false,description:'message to edit not found'},400);
        return response({ok:true,result:{message_id:body.message_id}});
      }
      if(/\/editMessageMedia$/.test(url)){
        // v91.33: JSON редагується НА МІСЦІ (in-place блок без переносу)
        const id=Number(opts.body.get('message_id'));
        world.apiLog.push({endpoint:'editMessageMedia',id});
        if(!world.live.has(id))return response({ok:false,description:'message to edit not found'},400);
        world.live.set(id,{kind:'json'});
        return response({ok:true,result:{message_id:id}});
      }
      if(/\/sendMediaGroup$/.test(url)){
        // v91.32: альбом = одна відповідь-МАСИВ Message; індекси фото беруться
        // з полів attach://photo<глобальний індекс> (їх виставляє production).
        const media=JSON.parse(opts.body.get('media'));
        const idxs=media.map(item=>Number(String(item.media).replace('attach://photo','')));
        world.apiLog.push({endpoint:'sendMediaGroup',photoIndexes:idxs});
        if(idxs.some(i=>world.hangPhotoIndex===i+1))return new Promise(()=>{}); // «застосунок убито» під час відправки альбому
        if(idxs.some(i=>world.sendPhotoNetworkFailOnce.has(i+1))){idxs.forEach(i=>world.sendPhotoNetworkFailOnce.delete(i+1));throw new Error('fetch failed');}
        if(idxs.some(i=>world.sendPhotoFailOnce.has(i+1))){idxs.forEach(i=>world.sendPhotoFailOnce.delete(i+1));return response({ok:false,error_code:500,description:'Internal Server Error'},500);}
        const msgs=idxs.map(idx=>{
          const id=++nextId;world.live.set(id,{kind:'photo',photoIndex:idx+1,caption:idxs[0]===idx?String(media[0].caption||''):''});
          return{message_id:id,photo:[{file_id:'fid-'+id}]};
        });
        return response({ok:true,result:msgs});
      }
      if(/\/sendPhoto$/.test(url)){
        const caption=String(opts.body.get('caption')||'');
        const m=caption.match(/\((\d+)\/(\d+)\)/),idx=m?Number(m[1]):1,total=m?Number(m[2]):1;
        world.apiLog.push({endpoint:'sendPhoto',photoIndex:idx});
        if(world.hangPhotoIndex===idx)return new Promise(()=>{}); // «застосунок убито» під час відправки
        if(world.sendPhotoNetworkFailOnce.has(idx)){world.sendPhotoNetworkFailOnce.delete(idx);throw new Error('fetch failed');}
        if(world.sendPhotoFailOnce.has(idx)){world.sendPhotoFailOnce.delete(idx);return response({ok:false,error_code:500,description:'Internal Server Error'},500);}
        const id=++nextId;world.live.set(id,{kind:'photo',photoIndex:idx,total,caption});
        return response({ok:true,result:{message_id:id,photo:[{file_id:'fid-'+id}]}});
      }
      if(/\/sendDocument$/.test(url)){
        const id=++nextId;world.live.set(id,{kind:'json'});
        world.apiLog.push({endpoint:'sendDocument'});
        return response({ok:true,result:{message_id:id}});
      }
      throw new Error('unexpected fetch: '+url);
    },
  };
  vm.createContext(context);vm.runInContext(source,context);
  // Підміни СТРОГО після runInContext (hoisting джерела перетирає попередні).
  context.resolvePhotoAsync=async()=>'data:image/jpeg;base64,AA==';
  return {context,world,ticket};
}
const photoCount=live=>[...live.values()].filter(info=>info.kind==='photo').length;
function summarize(live){
  const kinds={};
  for(const [,info] of live){const k=info.kind+(info.photoIndex?(':'+info.photoIndex):'');kinds[k]=(kinds[k]||0)+1;}
  return kinds;
}
const sends=(world,endpoint)=>world.apiLog.filter(call=>call.endpoint===endpoint);
const photosOf=(world,idx)=>[...world.live.entries()].filter(([,info])=>info.kind==='photo'&&info.photoIndex===idx);

(async()=>{
  /* 1. Одне фото: рівно один sendPhoto, одна копія. */
  {
    const ticket={...TICKET_BASE,id:'p1',photos:['idb:only']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'1: one-photo backup succeeds');
    assert.equal(sends(world,'sendPhoto').length,1,'1: exactly one sendPhoto call');
    assert.equal(photoCount(world.live),1,'1: exactly one photo in the archive');
    assert.equal(sends(world,'sendPhoto')[0].photoIndex,1,'1: single photo has no (i/n) split caption');
  }

  /* 2. Кілька фото (3): ОДИН sendMediaGroup-альбом, порядок 1→2→3, по одній
        копії; підпис із датою/адресою лише на першому елементі, без (i/n). */
  {
    const ticket={...TICKET_BASE,id:'p3',photos:['idb:a','idb:b','idb:c']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'2: three-photo backup succeeds');
    assert.equal(sends(world,'sendPhoto').length,0,'2: no per-photo sendPhoto for an album');
    assert.deepEqual(sends(world,'sendMediaGroup').map(call=>call.photoIndexes),[[0,1,2]],'2: one media group, photos in ticket order');
    assert.deepEqual(summarize(world.live),{sep:1,text:1,'photo:1':1,'photo:2':1,'photo:3':1,json:1},'2: single copy of every message');
    const infos=[...world.live.values()].filter(info=>info.kind==='photo');
    assert.ok(/15\.09\.2026.*Слобожанський/.test(infos[0].caption)&&!/\(\d\/\d\)/.test(infos[0].caption),'2: album caption is the date/address line, no (i/n) split');
    assert.ok(infos.slice(1).every(info=>!info.caption),'2: caption only on the first album element');
  }

  /* 3. Рівно 10 фото: межа sendMediaGroup — все ще ОДИН альбом, без sendPhoto. */
  {
    const ticket={...TICKET_BASE,id:'p10',photos:Array.from({length:10},(_,i)=>'idb:m'+i)};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'3: 10-photo backup succeeds');
    assert.equal(sends(world,'sendMediaGroup').length,1,'3: ten photos fit in ONE media group (Telegram limit)');
    assert.deepEqual(sends(world,'sendMediaGroup')[0].photoIndexes,Array.from({length:10},(_,i)=>i),'3: all ten photos in ticket order');
    assert.equal(sends(world,'sendPhoto').length,0,'3: no sendPhoto fallback at the exact limit');
    assert.equal(photoCount(world.live),10,'3: ten photo messages, each once');
  }

  /* 4. Дублікати photo key у самій заявці: надсилаються навмисно (як локально),
        retry НЕ множить їх. */
  {
    const ticket={...TICKET_BASE,id:'dup',photos:['idb:same','idb:same']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'4: duplicate-key backup succeeds');
    assert.equal(sends(world,'sendMediaGroup').length,1,'4: both entries sent deliberately (mirrors the ticket)');
    await context.backupTicketToTelegramNow(ticket);
    assert.equal(sends(world,'sendMediaGroup').length,1,'4: retry reuses the confirmed copy — no multiplication');
  }

  /* 5. Double tap: два паралельні виклиКИ через реальний шлях UI
        (backupTicketToTelegram — серіалізація per-id + глобальна черга).
        Друга спроба лише редагує/перевикористовує — нових фото немає. */
  {
    const ticket={...TICKET_BASE,id:'tap',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    const results=await Promise.all([context.backupTicketToTelegram(ticket),context.backupTicketToTelegram(ticket)]);
    assert.deepEqual(results,[true,true],'5: double tap — both queued runs settle');
    assert.equal(sends(world,'sendMediaGroup').length,1,'5: double tap sends each photo exactly once (one album)');
    assert.deepEqual(summarize(world.live),{sep:1,text:1,'photo:1':1,'photo:2':1,json:1},'5: single set remains');
  }

  /* 6. Паралельні виклики для РІЗНИХ заявок — глобальна черга, без перехрещень. */
  {
    const ta={...TICKET_BASE,id:'pa',photos:['idb:a']},tb={...TICKET_BASE,id:'pb',photos:['idb:b']};
    const {context:ca,world:wa}=makeWorld({ticket:ta});
    ca.tickets.push(tb);
    const results=await Promise.all([ca.backupTicketToTelegram(ta),ca.backupTicketToTelegram(tb)]);
    assert.deepEqual(results,[true,true],'6: both parallel tickets succeed');
    assert.equal(photoCount(wa.live),2,'6: one photo per ticket');
  }

  /* 7. Збій ПЕРШОГО фото: спроба чесно невдала, відомі повідомлення прибрані,
        стара копія неушкоджена, retry успішний. */
  {
    const ticket={...TICKET_BASE,id:'f1',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    world.sendPhotoFailOnce.add(1);
    assert.equal(await context.backupTicketToTelegramNow(ticket),false,'7: first-photo failure is not acknowledged');
    assert.equal(world.live.size,0,'7: partial attempt is fully cleaned up');
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'7: retry succeeds');
    assert.deepEqual(summarize(world.live),{sep:1,text:1,'photo:1':1,'photo:2':1,json:1},'7: single set after retry');
  }

  /* 8/10. ROOT CAUSE (v91.30 дефект): збій СЕРЕДИННОГО фото + невдалі
     deleteMessage тієї ж флапнутої мережі. Раніше результат cleanup
     викидався → сироти назавжди + дублі після retry. Тепер: невдалі
     видалення трекаються в tgBackupCleanupMsgIds, наступна спроба спершу
     прибирає сиріт, потім одразу надсилає повний набір. */
  {
    const ticket={...TICKET_BASE,id:'mid',photos:['idb:a','idb:b','idb:c']};
    const {context,world}=makeWorld({ticket});
    world.sendPhotoFailOnce.add(2);
    world.failDeletes=true; // та сама флапнувша мережа ламає і deleteMessage
    assert.equal(await context.backupTicketToTelegramNow(ticket),false,'8: partial attempt is not acknowledged');
    assert.ok(ticket.tgBackupCleanupMsgIds.length>0,'8: failed cleanups are durably tracked (was silently discarded in v91.30)');
    const orphans=world.live.size; // невдалі видалення лишили sep/текст у групі
    assert.equal(await context.backupTicketToTelegramNow(ticket),false,'8: still-failing network keeps the attempt unacknowledged');
    world.failDeletes=false;
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'8: converges after the network recovers');
    assert.equal(photoCount(world.live),3,'8: exactly three photos remain — orphans were cleaned, not duplicated');
    assert.deepEqual(summarize(world.live),{sep:1,text:1,'photo:1':1,'photo:2':1,'photo:3':1,json:1},'8: single set of every message');
    assert.ok(orphans>=1,'8: the scenario really produced orphans before recovery (guard against harness rot)');
  }

  /* 9. Retry після часткового success: підтверджена стара копія не
        перевертається і не видаляється до підтвердження нової. */
  {
    const ticket={...TICKET_BASE,id:'ps',photos:['idb:a','idb:b'],tgBackedUp:true,tgBackupPending:true,tgSepMsgId:11,tgTextMsgId:12,tgPhotoMsgId:13,tgPhotoMsgIds:[13],tgPhotoFileIds:['old'],tgJsonMsgId:14,tgPhotoKeys:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    world.live.set(11,{kind:'sep'});world.live.set(12,{kind:'text'});world.live.set(13,{kind:'photo',photoIndex:1});world.live.set(14,{kind:'json'});
    world.sendPhotoFailOnce.add(2); // фото 2 змінилося/не підтвердилось
    assert.equal(await context.backupTicketToTelegramNow(ticket),false,'9: failed refresh keeps the previous confirmed copy');
    assert.equal(photoCount(world.live),1,'9: old confirmed photo survives the failed refresh');
    assert.equal(ticket.tgBackedUp,true,'9: previous backup state is restored');
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'9: second refresh succeeds');
    assert.equal(photoCount(world.live),2,'9: refreshed set has both photos exactly once');
  }

  /* 10. Kill/reload посередині відправки: прогрес durably зберігається після
     кожного підтвердженого повідомлення; наступний запуск з persistent-
     знімка і ТАЄЇ Ж групи сходиться до одної копії кожного фото. */
  {
    const live=new Map(); // та сама Telegram-група для обох «запусків»
    const before={...TICKET_BASE,id:'kill',photos:Array.from({length:11},(_,i)=>'idb:m'+i)};
    const w1=makeWorld({ticket:before,live});
    w1.world.hangPhotoIndex=11; // «застосунок вбито» під час відправки другого chunkа (10+1)
    const attempt=w1.context.backupTicketToTelegramNow(before); // не await
    for(let i=0;i<3000&&!(w1.world.apiLog.some(call=>call.endpoint==='sendMediaGroup'&&call.photoIndexes.includes(10)));i++)await new Promise(r=>setTimeout(r,1));
    assert.equal(photoCount(live),10,'10: the first album (10 photos) was delivered before the kill');
    const persisted=w1.world.persistedSnapshots[w1.world.persistedSnapshots.length-1];
    /* Контракт v91.31 (після амендменту): підтверджений tgPhotoMsgIds НЕ
       рухається недоставленою спробою; доставлене фото durably лежить у
       черзі очищення як НЕПІДТВЕРДЖЕНЕ. Це все, що потрібно наступному
       запуску, щоб прибрати сироту перед повторною відправкою. */
    assert.ok((persisted.tgPhotoMsgIds||[]).length===0,'10: confirmed photo state is never overwritten by an unfinished attempt');
    assert.ok(Array.isArray(persisted.tgBackupCleanupMsgIds)&&persisted.tgBackupCleanupMsgIds.length===10,'10: delivered album ids are durably parked in the cleanup queue');
    assert.ok(persisted.tgSepMsgId&&persisted.tgTextMsgId,'10: separator/text progress is durably persisted');
    const restored=JSON.parse(JSON.stringify(persisted));
    const w2=makeWorld({ticket:restored,live,startId:1000}); // reload: новий контекст, та сама група
    assert.equal(await w2.context.backupTicketToTelegramNow(restored),true,'10: post-reload retry succeeds');
    const expected={sep:1,text:1,json:1};for(let i=1;i<=11;i++)expected['photo:'+i]=1;
    assert.deepEqual(summarize(live),expected,'10: reload+retry converges to a single copy of everything');
  }

  /* 11. Таймаут/обрив із втраченою відповіддю: неоднозначна доставка —
     паркується, авто-retry вимкнено, відомі повідомлення спроби прибрано. */
  {
    const ticket={...TICKET_BASE,id:'amb',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    world.sendPhotoNetworkFailOnce.add(2); // мережева помилка на sendPhoto → telegramAmbiguous
    assert.equal(await context.backupTicketToTelegramNow(ticket),false,'11: ambiguous delivery is not acknowledged');
    assert.equal(ticket.tgBackupAmbiguous,true,'11: ambiguous state parked for manual review');
    assert.equal(ticket.tgBackupPending,false,'11: ambiguous ticket excluded from automatic retry');
    const callsBefore=world.apiLog.length;
    assert.equal(await context.backupTicketToTelegramNow(ticket),false,'11: automatic retry is blocked');
    assert.equal(world.apiLog.length,callsBefore,'11: blocked retry issues zero Telegram calls');
  }

  /* 12. Заявка БЕЗ фото (і без tg-полів): бекап успішний — регресія TypeError
     `t.tgPhotoFileIds[0]` із v91.30. */
  {
    const ticket={...TICKET_BASE,id:'nophoto'};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'12: no-photo ticket backup succeeds (v91.30 TypeError regression)');
    assert.deepEqual(summarize(world.live),{sep:1,text:1,json:1},'12: text+JSON backed up, zero sendPhoto');
  }

  /* 13. Легасі-заявка без tgPhotoFileIds/tgPhotoMsgIds, але з фото. */
  {
    const ticket={...TICKET_BASE,id:'legacy',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'13: legacy ticket without array fields backs up');
    assert.deepEqual(ticket.tgPhotoFileIds.length,2,'13: array fields initialized from the loop');
  }

  /* 14. Telegram backup/archive не робить другої відправки тих самих фото:
     повторний виклик по незміненій підтвердженій заявці — жодного альбому. */
  {
    const ticket={...TICKET_BASE,id:'idem',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    await context.backupTicketToTelegramNow(ticket);
    const afterFirst=sends(world,'sendMediaGroup').length;
    await context.backupTicketToTelegramNow(ticket); // повторний backup/archive
    assert.equal(sends(world,'sendMediaGroup').length,afterFirst,'14: idempotent re-archive never re-sends confirmed photos');
    assert.deepEqual(summarize(world.live),{sep:1,text:1,'photo:1':1,'photo:2':1,json:1},'14: archive still holds a single set');
  }
  console.log('PASS telegram photo dedup: single delivery per photo across partial failure, cleanup-failure, retry, kill/reload, ambiguous parking and idempotent re-archive');
})().catch(error=>{console.error(error);process.exitCode=1;});

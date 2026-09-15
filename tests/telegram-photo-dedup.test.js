'use strict';
/* Регресія v91.31: дедуплікація Telegram-фотографій заявки.
   Харнест виконує РЕАЛЬНИЙ js/photo-telegram-domain.js (vm) і рахує всі
   виклики Telegram API (sendMessage/sendPhoto/sendDocument/deleteMessage/
   editMessageText). Група-архів — спільна Map, «reload» — новий контекст на
   останньому durable-знімку (saveTicketsLocalOnly) з тією самою групою.
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

  /* 2. Кілька фото (3): три sendPhoto, підписи 1/3..3/3, по одній копії. */
  {
    const ticket={...TICKET_BASE,id:'p3',photos:['idb:a','idb:b','idb:c']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'2: three-photo backup succeeds');
    assert.deepEqual(sends(world,'sendPhoto').map(call=>call.photoIndex),[1,2,3],'2: sequential sendPhoto 1..3');
    assert.deepEqual(summarize(world.live),{sep:1,text:1,'photo:1':1,'photo:2':1,'photo:3':1,json:1},'2: single copy of every message');
    assert.ok([...world.live.values()].every(info=>info.kind!=='photo'||/\(1\/3\)|\(2\/3\)|\(3\/3\)/.test(info.caption)),'2: split captions present');
  }

  /* 3. Понад ліміт media group (10 фото): sendMediaGroup не існує, 10 sendPhoto, жодних дублів. */
  {
    const ticket={...TICKET_BASE,id:'p10',photos:Array.from({length:10},(_,i)=>'idb:m'+i)};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'3: 10-photo backup succeeds');
    assert.equal(sends(world,'sendPhoto').length,10,'3: ten sendPhoto calls, one per photo');
    assert.equal(photoCount(world.live),10,'3: ten photo messages, each once');
    assert.equal(sends(world,'sendMediaGroup').length,0,'3: no media-group batching exists to miscount chunks');
  }

  /* 4. Дублікати photo key у самій заявці: надсилаються навмисно (як локально),
        retry НЕ множить їх. */
  {
    const ticket={...TICKET_BASE,id:'dup',photos:['idb:same','idb:same']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'4: duplicate-key backup succeeds');
    assert.equal(sends(world,'sendPhoto').length,2,'4: both entries sent deliberately (mirrors the ticket)');
    await context.backupTicketToTelegramNow(ticket);
    assert.equal(sends(world,'sendPhoto').length,2,'4: retry reuses the confirmed copy — no multiplication');
  }

  /* 5. Double tap: два паралельні виклиКИ через реальний шлях UI
        (backupTicketToTelegram — серіалізація per-id + глобальна черга).
        Друга спроба лише редагує/перевикористовує — нових фото немає. */
  {
    const ticket={...TICKET_BASE,id:'tap',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    const results=await Promise.all([context.backupTicketToTelegram(ticket),context.backupTicketToTelegram(ticket)]);
    assert.deepEqual(results,[true,true],'5: double tap — both queued runs settle');
    assert.equal(sends(world,'sendPhoto').length,2,'5: double tap sends each photo exactly once');
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
    const orphans=photoCount(world.live);
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
    const before={...TICKET_BASE,id:'kill',photos:['idb:a','idb:b','idb:c']};
    const w1=makeWorld({ticket:before,live});
    w1.world.hangPhotoIndex=2;
    const attempt=w1.context.backupTicketToTelegramNow(before); // «застосунок вбито» — не await
    for(let i=0;i<2000&&!(w1.world.apiLog.some(call=>call.endpoint==='sendPhoto'&&call.photoIndex===2));i++)await new Promise(r=>setTimeout(r,1));
    assert.equal(photoCount(live),1,'10: first photo delivered before the kill');
    const persisted=w1.world.persistedSnapshots[w1.world.persistedSnapshots.length-1];
    assert.ok(persisted.tgPhotoMsgIds.length===1&&persisted.tgSepMsgId,'10: attempt progress is durably persisted (v91.30 lost it)');
    const restored=JSON.parse(JSON.stringify(persisted));
    const w2=makeWorld({ticket:restored,live,startId:1000}); // reload: новий контекст, та сама група
    assert.equal(await w2.context.backupTicketToTelegramNow(restored),true,'10: post-reload retry succeeds');
    assert.deepEqual(summarize(live),{sep:1,text:1,'photo:1':1,'photo:2':1,'photo:3':1,json:1},'10: reload+retry converges to a single copy of everything');
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
     повторний виклик по незміненій підтвердженій заявці — жодного sendPhoto. */
  {
    const ticket={...TICKET_BASE,id:'idem',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    await context.backupTicketToTelegramNow(ticket);
    const afterFirst=sends(world,'sendPhoto').length;
    await context.backupTicketToTelegramNow(ticket); // повторний backup/archive
    assert.equal(sends(world,'sendPhoto').length,afterFirst,'14: idempotent re-archive never re-sends confirmed photos');
    assert.deepEqual(summarize(world.live),{sep:1,text:1,'photo:1':1,'photo:2':1,json:1},'14: archive still holds a single set');
  }
  console.log('PASS telegram photo dedup: single delivery per photo across partial failure, cleanup-failure, retry, kill/reload, ambiguous parking and idempotent re-archive');
})().catch(error=>{console.error(error);process.exitCode=1;});

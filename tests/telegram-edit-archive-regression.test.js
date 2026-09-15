'use strict';
/* Регресія РЕАЛЬНОГО кейсу (скриншоти «Таромское, Золотоосіння 64», v≤v91.30):
   стара заявка ПОВНІСТЮ лежить у Telegram-групі (sep+текст+фото (1/2)(2/2)+JSON)
   → майстер редагує її та зберігає → у групі З'ЯВЛЯЛИСЯ другі копії тих самих
   фото з тими самими підписами, без нового тексту поруч, а стара копія
   залишалася. Причини (обидві закриті в v91.31):
     R1) невдалі deleteMessage часткової спроби викидалися → сироти назавжди;
     R2) wipe підтверджених tgPhotoMsgIds на старті спроби + kill/reload →
         втрата зв'язку зі старими фото (вічні сироти) і змішування прогресу
         з підтвердженим станом.
   Харнест рахує реальні виклики Telegram API; «reload» — новий контекст на
   останньому durable-знімку з ТІЄЮ САМОЮ групою. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','photo-telegram-domain.js'),'utf8');
const response=(data,status=200)=>({status,headers:{get:()=>null},json:async()=>data});
const TICKET={type:'ПІДКЛЮЧЕННЯ',date:'13.08.2026',time:'16:14',content:'ЗАЯВКА: ПІДКЛЮЧЕННЯ … Таромское Вул Золотоосіння 64',city:'Таромское',street:'Золотоосіння',house:'64'};

function makeWorld({ticket,live,startId=100}){
  let nextId=startId;
  const world={apiLog:[],live:live||new Map(),persistedSnapshots:[],failDeletes:false,sendPhotoFailOnce:new Set(),jsonSoftFail:false,hangPhotoIndex:null};
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
        world.live.delete(id);return response({ok:true});
      }
      throw new Error('unexpected fetch: '+url);
    },
  };
  vm.createContext(context);vm.runInContext(source,context);
  // Підміни СТРОГО після runInContext (hoisting джерела перетирає попередні).
  context.resolvePhotoAsync=async()=>'data:image/jpeg;base64,AA==';
  context.fetchWithRetry=async function(url,opts){
    const endpoint=String(url).match(/\/(sendMessage|sendPhoto|sendDocument|editMessageText)$/)?.[1];
    if(endpoint==='sendMessage'){
      const text=String(JSON.parse(opts.body).text);
      const id=++nextId,kind=/➖/.test(text)?'sep':'text';
      world.live.set(id,{kind});world.apiLog.push({endpoint:'sendMessage',kind});
      return response({ok:true,result:{message_id:id}});
    }
    if(endpoint==='editMessageText'){
      const body=JSON.parse(opts.body);
      world.apiLog.push({endpoint:'editMessageText',id:body.message_id});
      if(world.editFailsOnce&&world.live.has(body.message_id)){world.editFailsOnce=false;return response({ok:false,description:'Bad Request: chat not found'},400);}
      if(!world.live.has(body.message_id))return response({ok:false,description:'message to edit not found'},400);
      return response({ok:true,result:{message_id:body.message_id}});
    }
    if(endpoint==='sendDocument'){
      world.apiLog.push({endpoint:'sendDocument'});
      if(world.jsonSoftFail)return response({ok:false,error_code:400,description:'Bad Request'},400);
      const id=++nextId;world.live.set(id,{kind:'json'});
      return response({ok:true,result:{message_id:id}});
    }
    if(endpoint==='sendPhoto'){
      const caption=String(opts.body.get('caption')||'');
      const m=caption.match(/\((\d+)\/(\d+)\)/),idx=m?Number(m[1]):1,total=m?Number(m[2]):1;
      world.apiLog.push({endpoint:'sendPhoto',photoIndex:idx});
      if(world.hangPhotoIndex===idx)return new Promise(()=>{});
      if(world.sendPhotoFailOnce.has(idx)){world.sendPhotoFailOnce.delete(idx);return response({ok:false,error_code:500,description:'Internal Server Error'},500);}
      const id=++nextId;world.live.set(id,{kind:'photo',photoIndex:idx,total,caption});
      return response({ok:true,result:{message_id:id,photo:[{file_id:'fid-'+id}]}});
    }
  };
  return {context,world,ticket};
}
function summarize(live){
  const kinds={};
  for(const [,info] of live){const k=info.kind+(info.photoIndex?(':'+info.photoIndex):'');kinds[k]=(kinds[k]||0)+1;}
  return kinds;
}
const photoCopies=(live,idx)=>[...live.values()].filter(info=>info.kind==='photo'&&info.photoIndex===idx).length;
const sendPhotoCalls=world=>world.apiLog.filter(call=>call.endpoint==='sendPhoto');
const newSendMessages=world=>world.apiLog.filter(call=>call.endpoint==='sendMessage').length;
function archivedTicket(id){
  return {...TICKET,id,photos:['idb:a','idb:b'],tgBackedUp:true,tgBackupPending:false,
    tgSepMsgId:11,tgTextMsgId:12,tgPhotoMsgId:13,tgPhotoMsgIds:[13,14],tgPhotoFileIds:['f1','f2'],
    tgJsonMsgId:15,tgPhotoKeys:['idb:a','idb:b']};
}
function seedArchived(live){
  live.set(11,{kind:'sep'});
  live.set(12,{kind:'text'});
  live.set(13,{kind:'photo',photoIndex:1,caption:'13.08.2026 16:14 Таромское Вул Золотоосіння 64 (1/2)'});
  live.set(14,{kind:'photo',photoIndex:2,caption:'13.08.2026 16:14 Таромское Вул Золотоосіння 64 (2/2)'});
  live.set(15,{kind:'json'});
}
const SINGLE_SET={sep:1,text:1,'photo:1':1,'photo:2':1,json:1};

(async()=>{
  /* E1 (A/B/F/L): змінено лише текст/поля; фото не чіпалися.
     Повинно: жодного sendPhoto, sep/текст відредаговані НА МІСЦІ (жодних нових
     повідомлень), оновлений JSON; повторне збереження — ідемпотентне. */
  {
    const live=new Map();seedArchived(live);
    const t=archivedTicket('e1');
    const {context,world}=makeWorld({ticket:t,live});
    t.content+=' (відредаговано)';
    assert.equal(await context.backupTicketToTelegramNow(t),true,'E1: text-only edit succeeds');
    assert.equal(sendPhotoCalls(world).length,0,'E1: unchanged photos are never re-sent');
    assert.equal(newSendMessages(world),0,'E1: sep/text are edited in place — no second text copy appears');
    assert.deepEqual(summarize(live),SINGLE_SET,'E1: archive still holds a single set');
    t.content+=' + ще правка';
    assert.equal(await context.backupTicketToTelegramNow(t),true,'E1: repeated save succeeds');
    assert.deepEqual(summarize(live),SINGLE_SET,'E1: repeated saves stay idempotent (L)');
  }

  /* E2 (C/E + J + I) — ТОЧНО СЦЕНАРІЙ СКРИНШОТІВ: замінено фото2 → спроба
     надсилає обидва фото з підписами (1/2)(2/2), JSON падає м'яко (ok:false),
     cleanup-видалення свіжих фото ловить 429 тієї ж флапнутої мережі.
     v≤v91.30: результат cleanup викидався → вічні сироти (фото ×2).
     v91.31: id у черзі очищення → наступна спроба СПЕРШУ прибирає сиріт і
     лише потім продовжує; фінал — один набір. */
  {
    const live=new Map();seedArchived(live);
    const t=archivedTicket('e2');
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:new']; // заміна другого фото
    world.jsonSoftFail=true;world.failDeletes=true;
    assert.equal(await context.backupTicketToTelegramNow(t),false,'E2: partial attempt is not acknowledged');
    assert.equal(photoCopies(live,1),2,'E2: reproduced the screenshot state — a second (1/2) copy appeared');
    assert.equal(photoCopies(live,2),2,'E2: …and a second (2/2) copy');
    assert.ok([...live.values()].some(info=>info.kind==='photo'&&info.photoIndex===2&&/\(2\/2\)/.test(info.caption)),'E2: copies carry the same (i/n) captions as reported');
    assert.ok(t.tgBackupCleanupMsgIds.length>=2,'E2: orphan ids are durably tracked (R1 fix — was discarded before)');
    const oldSetIds=[11,12,13,14,15];
    assert.ok(oldSetIds.every(id=>live.has(id)),'E2: previous confirmed copy remains intact');
    world.failDeletes=false;world.jsonSoftFail=false;
    const sendPhotoBefore=sendPhotoCalls(world).length;
    assert.equal(await context.backupTicketToTelegramNow(t),true,'E2: recovery attempt succeeds');
    assert.equal(sendPhotoCalls(world).length,sendPhotoBefore,'E2: the cleanup-first pass does NOT re-send photos');
    assert.deepEqual(summarize(live),SINGLE_SET,'E2: archive converges to a single set — duplicates removed, none added');
    assert.equal(photoCopies(live,1),1,'E2: exactly one (1/2) remains');
    assert.equal(photoCopies(live,2),1,'E2: exactly one (2/2) remains');
  }

  /* E3 (K) — kill/reload посередині EDIT-збереження із заміною фото.
     R2-фікс: підтверджені tgPhotoMsgIds переживають kill у durable-стані,
     недоставлене фото — у черзі очищення; reload+retry сходиться до одного
     набору (на коді до амендменту тут залишалось photo ×2). */
  {
    const live=new Map();seedArchived(live);
    const t=archivedTicket('e3');
    const w1=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:new'];
    w1.world.hangPhotoIndex=2;
    const attempt=w1.context.backupTicketToTelegramNow(t); // «застосунок вбито» — не await
    for(let i=0;i<3000&&!(w1.world.apiLog.some(call=>call.endpoint==='sendPhoto'&&call.photoIndex===2));i++)await new Promise(r=>setTimeout(r,1));
    assert.equal(photoCopies(live,2),1,'E3: kill happened before photo 2 was delivered');
    assert.equal(photoCopies(live,1),2,'E3: fresh (1/2) was delivered by the killed attempt');
    const persisted=w1.world.persistedSnapshots[w1.world.persistedSnapshots.length-1];
    assert.deepEqual((persisted.tgPhotoMsgIds||[]).sort(),[13,14],'E3: confirmed old photo ids survive the kill (R2 fix — were wiped before)');
    assert.equal((persisted.tgBackupCleanupMsgIds||[]).length,1,'E3: the unfinished attempt photo is durably parked for cleanup');
    const restored=JSON.parse(JSON.stringify(persisted));
    const w2=makeWorld({ticket:restored,live,startId:1000}); // reload: новий контекст, та сама група
    assert.equal(await w2.context.backupTicketToTelegramNow(restored),true,'E3: first post-reload attempt succeeds');
    assert.deepEqual(summarize(live),SINGLE_SET,'E3: reload converges to a single set — no photo ×2');
    assert.equal(await w2.context.backupTicketToTelegramNow(restored),true,'E3: subsequent save stays idempotent');
    assert.deepEqual(summarize(live),SINGLE_SET,'E3: single set after repeated saves');
  }

  /* E4 (H): editMessageText падає → спроба чесно невдала, стара копія ціла,
     нічого нового в групі; retry після відновлення мережі успішний. */
  {
    const live=new Map();seedArchived(live);
    const t=archivedTicket('e4');
    const {context,world}=makeWorld({ticket:t,live});
    world.editFailsOnce=true;
    t.content+=' (правка)';
    assert.equal(await context.backupTicketToTelegramNow(t),false,'E4: failed separator edit is not acknowledged');
    assert.deepEqual([...live.keys()].sort((a,b)=>a-b),[11,12,13,14,15],'E4: nothing new was posted, old set untouched');
    assert.equal(await context.backupTicketToTelegramNow(t),true,'E4: retry succeeds');
    assert.deepEqual(summarize(live),SINGLE_SET,'E4: single set after retry');
  }
  console.log('PASS telegram edit-archive regression: the real duplicated-photos case (screenshots) is impossible — orphans are tracked and cleaned, confirmed state survives kills, edits stay idempotent');
})().catch(error=>{console.error(error);process.exitCode=1;});

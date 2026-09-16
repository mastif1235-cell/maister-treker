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
  const world={apiLog:[],live:live||new Map(),persistedSnapshots:[],failDeletes:false,sendPhotoFailOnce:new Set(),sendPhotoNetworkFailOnce:new Set(),jsonSoftFail:false,jsonInPlaceFailPerm:false,hangPhotoIndex:null};
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
    const endpoint=String(url).match(/\/(sendMessage|sendPhoto|sendMediaGroup|sendDocument|editMessageText|editMessageMedia)$/)?.[1];
    if(endpoint==='sendMessage'){
      const text=String(JSON.parse(opts.body).text);
      const id=++nextId,kind=/➖/.test(text)?'sep':'text';
      world.live.set(id,{kind});world.apiLog.push({endpoint:'sendMessage',kind});
      return response({ok:true,result:{message_id:id}});
    }
    if(endpoint==='editMessageMedia'){
      // v91.33: JSON редагується НА МІСЦІ (in-place блок без переносу)
      const id=Number(opts.body.get('message_id'));
      world.apiLog.push({endpoint:'editMessageMedia',id});
      if(world.jsonInPlaceFailPerm)return response({ok:false,error_code:400,description:'Bad Request: there is no document in the message'},400);
      if(!world.live.has(id))return response({ok:false,description:'message to edit not found'},400);
      world.live.set(id,{kind:'json'});
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
    if(endpoint==='sendMediaGroup'){
      // v91.32: альбом — одна відповідь-масив; індекси — з attach://photo<K>.
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
const sendPhotoCalls=world=>world.apiLog.filter(call=>call.endpoint==='sendPhoto'||call.endpoint==='sendMediaGroup');
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

  /* E2 (C/E + J + I) — РОЗВИТОК СЦЕНАРІЮ СКРИНШОТІВ для v91.33: замінено фото →
     блок ПЕРЕНОСИТЬСЯ в кінець ЦІЛИКОМ (старий не редагується на місці — інакше
     блок розривався: текст зверху, нові фото після наступних заявок).
     Невдала спроба (JSON падає м'яко + deleteMessage 429 тієї ж мережі):
     СТАРА копія ціла, недобудований новий блок durably у черзі очищення (R1);
     retry прибирає сироти, будує повний новий блок і лише потім видаляє старий. */
  {
    const live=new Map();seedArchived(live);
    const t=archivedTicket('e2');
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:new']; // заміна другого фото
    world.jsonSoftFail=true;world.failDeletes=true;
    assert.equal(await context.backupTicketToTelegramNow(t),false,'E2: partial attempt is not acknowledged');
    assert.equal(photoCopies(live,1),2,'E2: the delivered fresh album sits beside the old one — BUT it is parked, not lost (screenshot state)');
    assert.equal(photoCopies(live,2),2,'E2: …for both photos of the album');
    assert.ok([11,12,13,14,15].every(id=>live.has(id)),'E2: the whole previous copy remains while the new one is unfinished');
    assert.equal(t.tgBackupCleanupMsgIds.length,4,'E2: the partial NEW block (sep+text+album×2) is durably parked for cleanup (R1 fix — was discarded in v91.30)');
    world.failDeletes=false;world.jsonSoftFail=false;
    assert.equal(await context.backupTicketToTelegramNow(t),true,'E2: recovery attempt succeeds');
    assert.deepEqual([...live.keys()].sort((a,b)=>a-b).length,5,'E2: exactly five messages remain — one full block');
    assert.ok(!live.has(11)&&!live.has(12)&&!live.has(13)&&!live.has(14)&&!live.has(15),'E2: the OLD block was fully deleted only after the new one was confirmed');
    assert.deepEqual(summarize(live),SINGLE_SET,'E2: single consistent set (new sep/text/album/json)');
  }

  /* E3 (K) — kill/reload посередині ПЕРЕНОСУ блоку (EDIT із заміною фото).
     v91.33: стара копія неушкоджена і durably знята у tgBackupMoveOldMsgIds;
     недобудований новий блок (sep/текст) — у черзі очищення; підтверджені
     tgPhotoMsgIds не перевертаються (R2). Reload+retry: cleanup-first прибирає
     недобудований блок, будується повний новий, стара копія видаляється —
     рівно один блок, порядок збережено. */
  {
    const live=new Map();seedArchived(live);
    const t=archivedTicket('e3');
    const w1=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:new'];
    w1.world.hangPhotoIndex=2; // обидва фото летять ОДИМ sendMediaGroup — kill під час його відповіді
    const attempt=w1.context.backupTicketToTelegramNow(t); // «застосунок вбито» — не await
    for(let i=0;i<3000&&!(w1.world.apiLog.some(call=>call.endpoint==='sendMediaGroup'));i++)await new Promise(r=>setTimeout(r,1));
    assert.equal(photoCopies(live,1),1,'E3: kill happened before the fresh album was confirmed — no second copy');
    assert.equal(photoCopies(live,2),1,'E3: …for neither of the two photos');
    const persisted=w1.world.persistedSnapshots[w1.world.persistedSnapshots.length-1];
    assert.deepEqual((persisted.tgPhotoMsgIds||[]).sort(),[13,14],'E3: confirmed old photo ids survive the kill (R2 fix — were wiped before)');
    assert.equal((persisted.tgBackupCleanupMsgIds||[]).length,2,'E3: the unfinished new block (fresh sep+text) is durably parked for cleanup');
    const mv=persisted.tgBackupMoveOldMsgIds;
    assert.ok(mv&&[mv.tgSepMsgId,mv.tgTextMsgId].join()==='11,12'&&JSON.stringify([...(mv.tgPhotoMsgIds||[])].sort())==='[13,14]'&&mv.tgJsonMsgId===15,'E3: the TRUE old block is durably snapshotted (survives the reload, deleted only after success)');
    const restored=JSON.parse(JSON.stringify(persisted));
    const w2=makeWorld({ticket:restored,live,startId:1000}); // reload: новий контекст, та сама група
    assert.equal(await w2.context.backupTicketToTelegramNow(restored),true,'E3: first post-reload attempt succeeds');
    assert.deepEqual(summarize(live),SINGLE_SET,'E3: reload converges to a single set — no photo ×2, no double block');
    assert.ok(!live.has(11)&&!live.has(12)&&!live.has(13)&&!live.has(14)&&!live.has(15),'E3: old block removed after the moved block was confirmed');
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

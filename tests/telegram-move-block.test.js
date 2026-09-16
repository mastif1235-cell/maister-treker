'use strict';
/* v91.33: ПОРЯДОК повідомлень Telegram-копії заявки (реальний UX-кейс
   «Бахан Завоз LNET», 16.09.2026). Telegram не вміє переміщувати повідомлення:
   раніше EDIT змінених фото робився «гибридно» — старі sep/текст редагувались
   на старому місці, а новий альбом/JSON з'являлись у САМОМУ КІНЦІ каналу ПІСЛЯ
   наступних заявок — блок заявки розривався. Тепер: якщо хоча б одну частину
   треба створювати заново — ВСЯ копія переноситься в кінець одним блоком;
   редагування лише тексту (фото не змінені) лишається на місці (JSON — через
   editMessageMedia). Харнест зберігає ПОРЯДОК вставки повідомлень у «канал» —
   ассерти перевіряють саме ЛОГІЧНИЙ ПОРЯДОК, а не лише кількість. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','photo-telegram-domain.js'),'utf8');
const response=(data,status=200)=>({status,headers:{get:()=>null},json:async()=>data});
const TICKET={type:'РЕМОНТ',date:'16.09.2026',time:'07:20',content:'ЗАЯВКА: РЕМОНТ … Таромское Вул Академіка Плавова 3',city:'Таромское',street:'Академіка Плавова',house:'3'};

function makeWorld({ticket,live,startId=100}){
  let nextId=startId;
  const world={apiLog:[],live:live||new Map(),deleted:[],persistedSnapshots:[],failDeletes:false,sendPhotoFailOnce:new Set(),sendPhotoNetworkFailOnce:new Set(),group429Once:false,jsonSoftFail:false,jsonInPlaceFailPerm:false,hangPhotoIndex:null};
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
      throw new Error('unexpected fetch: '+url);
    },
  };
  vm.createContext(context);vm.runInContext(source,context);
  context.resolvePhotoAsync=async()=>'data:image/jpeg;base64,AA==';
  context.fetchWithRetry=async function(url,opts){
    const endpoint=String(url).match(/\/(sendMessage|sendPhoto|sendMediaGroup|sendDocument|editMessageText|editMessageMedia)$/)?.[1];
    if(endpoint==='sendMessage'){
      const text=String(JSON.parse(opts.body).text);
      const id=++nextId,kind=/➖/.test(text)?'sep':'text';
      world.live.set(id,{kind});world.apiLog.push({endpoint:'sendMessage',kind});
      return response({ok:true,result:{message_id:id}});
    }
    if(endpoint==='editMessageText'){
      const body=JSON.parse(opts.body);
      world.apiLog.push({endpoint:'editMessageText',id:body.message_id});
      if(!world.live.has(body.message_id))return response({ok:false,description:'message to edit not found'},400);
      return response({ok:true,result:{message_id:body.message_id}});
    }
    if(endpoint==='editMessageMedia'){
      const id=Number(opts.body.get('message_id'));
      world.apiLog.push({endpoint:'editMessageMedia',id});
      if(world.jsonInPlaceFailPerm)return response({ok:false,error_code:400,description:'Bad Request: there is no document in the message'},400);
      if(!world.live.has(id))return response({ok:false,description:'message to edit not found'},400);
      world.live.set(id,{kind:'json'});
      return response({ok:true,result:{message_id:id}});
    }
    if(endpoint==='sendDocument'){
      world.apiLog.push({endpoint:'sendDocument'});
      if(world.jsonSoftFail)return response({ok:false,error_code:400,description:'Bad Request'},400);
      const id=++nextId;world.live.set(id,{kind:'json'});
      return response({ok:true,result:{message_id:id}});
    }
    if(endpoint==='sendMediaGroup'){
      const media=JSON.parse(opts.body.get('media'));
      const idxs=media.map(item=>Number(String(item.media).replace('attach://photo','')));
      world.apiLog.push({endpoint:'sendMediaGroup',photoIndexes:idxs});
      if(idxs.some(i=>world.hangPhotoIndex===i+1))return new Promise(()=>{});
      if(world.group429Once){world.group429Once=false;return response({ok:false,error_code:429,description:'Too Many Requests: retry after 1',parameters:{retry_after:1}},429);}
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
      if(world.sendPhotoNetworkFailOnce.has(idx)){world.sendPhotoNetworkFailOnce.delete(idx);throw new Error('fetch failed');}
      if(world.sendPhotoFailOnce.has(idx)){world.sendPhotoFailOnce.delete(idx);return response({ok:false,error_code:500,description:'Internal Server Error'},500);}
      const id=++nextId;world.live.set(id,{kind:'photo',photoIndex:idx,total,caption});
      return response({ok:true,result:{message_id:id,photo:[{file_id:'fid-'+id}]}});
    }
  };
  return {context,world,ticket};
}
/* «Канал» зберігає порядок вставки — логічний порядок повідомлень */
const orderKinds=live=>[...live.entries()].map(([id,info])=>info.kind+(info.photoIndex?':'+info.photoIndex:''));
const orderIds=live=>[...live.keys()];
const sendsOf=(world,endpoint)=>world.apiLog.filter(call=>call.endpoint===endpoint);
function summarize(live){
  const kinds={};
  for(const [,info] of live){const k=info.kind+(info.photoIndex?(':'+info.photoIndex):'');kinds[k]=(kinds[k]||0)+1;}
  return kinds;
}
/* Після переносу в каналі: блок B (sep/text/json) + блок A (sep/text/[album],json) */
function expectABlock(n){const s={sep:2,text:2,json:2};for(let i=1;i<=n;i++)s['photo:'+i]=1;return s;}
/* Канал: A(sep,text[,album],json) → B(sep,text,json) — A ВИЩЕ, B нижче */
function seedChannel(live,albumIds){
  live.set(11,{kind:'sep'});live.set(12,{kind:'text'});
  (albumIds||[]).forEach((id,i)=>live.set(id,{kind:'photo',photoIndex:i+1,caption:i===0?'16.09.2026 07:20 Таромское Академіка Плавова 3':''}));
  live.set(albumIds?16:15,{kind:'json'});
  live.set(21,{kind:'sep'});live.set(22,{kind:'text'});live.set(23,{kind:'json'});
}
function archivedA(id,photos,albumIds){
  const t={...TICKET,id,photos:photos.slice(),tgBackedUp:true,tgBackupPending:false,
    tgSepMsgId:11,tgTextMsgId:12,tgPhotoMsgId:albumIds?albumIds[0]:null,
    tgPhotoMsgIds:albumIds?albumIds.slice():[],tgPhotoFileIds:albumIds?albumIds.map((_,i)=>'f'+(i+1)):[],
    tgJsonMsgId:albumIds?16:15,tgPhotoKeys:photos.slice()};
  return t;
}
const B_ORDER=['sep','text','json'];
const B_IDS=[21,22,23];

(async()=>{
  /* O1 — ТОЧНО СЦЕНАРІЙ КОРИСТУВАЧА: заміна фото старої заявки A (3 фото),
     під нею живе заявка B → A ПОВИННА переїхати в кінець ЄДИНИМ блоком. */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:x','idb:c']; // замінено фото 2
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O1: replace-photo edit succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','photo:3','json'],'O1: MESSAGE ORDER — B stays, then A as ONE new block');
    assert.ok(B_IDS.every(id=>live.has(id)),'O1: ticket B untouched');
    assert.ok([11,12,13,14,15,16].every(id=>!live.has(id)),'O1: the ENTIRE old copy of A is deleted');
    assert.deepEqual(summarize(live),expectABlock(3),'O1: single consistent set — no duplicates');
  }

  /* O2 (A) — змінено лише текст: блок лишається НА МІСЦІ, нуль нових
     повідомлень (sep/текст — editMessageText, JSON — editMessageMedia). */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    t.content+=' (відредаговано)';
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O2: text-only edit succeeds');
    assert.deepEqual(orderIds(live),[11,12,13,14,15,16,21,22,23],'O2: A stays on top — the block is NOT moved down');
    assert.equal(sendsOf(world,'sendMessage').length,0,'O2: zero new messages (only in-place edits)');
    assert.equal(sendsOf(world,'sendMediaGroup').length+sendPhotoCount(world),0,'O2: album untouched');
    assert.equal(sendsOf(world,'sendDocument').length,0,'O2: JSON not re-sent to the bottom — edited in place');
    assert.equal(sendsOf(world,'editMessageMedia').length,1,'O2: JSON updated via editMessageMedia in place');
  }
  function sendPhotoCount(world){return sendsOf(world,'sendPhoto').length;}

  /* O3 (B) — фото не змінені, текст не змінений (повторне збереження):
     жодних нових повідомлень і жодного переносу. */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O3: idempotent re-save succeeds');
    assert.deepEqual(orderIds(live),[11,12,13,14,15,16,21,22,23],'O3: order unchanged — no move');
    assert.equal(sendsOf(world,'sendMediaGroup').length+sendPhotoCount(world)+sendsOf(world,'sendDocument').length+sendsOf(world,'sendMessage').length,0,'O3: zero sends of any kind');
  }

  /* O4 (C) — додано фото (3→4): повний перенос. */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:b','idb:c','idb:new'];
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O4: add-photo edit succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','photo:3','photo:4','json'],'O4: whole A moved below B as one block');
    assert.ok([11,12,13,14,15,16].every(id=>!live.has(id)),'O4: old copy fully removed');
  }

  /* O5 (D) — видалено фото (3→2): повний перенос. */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:c'];
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O5: remove-photo edit succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','json'],'O5: moved as one block, two photos');
    assert.ok([11,12,13,14,15,16].every(id=>!live.has(id)),'O5: old copy fully removed');
  }

  /* O6 (F) — змінено ПОРЯДОК фото (ті самі ключі): moveBlock. */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:c','idb:a','idb:b'];
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O6: reorder-photo edit succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','photo:3','json'],'O6: reorder requires a fresh album → whole block moved');
    assert.ok([11,12,13,14,15,16].every(id=>!live.has(id)),'O6: old copy fully removed');
  }

  /* O7 (G) — 1 фото → 2 (sendPhoto стає sendMediaGroup): повний перенос. */
  {
    const live=new Map();seedChannel(live,[13]);
    const t=archivedA('ticketA',['idb:a'],[13]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:b'];
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O7: 1→2 photos edit succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','json'],'O7: moved as one block with a fresh album');
    assert.ok([11,12,13,15].every(id=>!live.has(id)),'O7: old copy (single-photo) fully removed');
  }

  /* O8 (H) — 2 фото → 1 (альбом стає sendPhoto): повний перенос. */
  {
    const live=new Map();seedChannel(live,[13,14]);
    const t=archivedA('ticketA',['idb:a','idb:b'],[13,14]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a'];
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O8: 2→1 photos edit succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','json'],'O8: moved as one block, single photo');
    assert.ok([11,12,13,14,15].every(id=>!live.has(id)),'O8: old copy fully removed');
  }

  /* O9 (I) — 0 фото → 1: повний перенос. */
  {
    const live=new Map();seedChannel(live,null);
    const t=archivedA('ticketA',[],null);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:new'];
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O9: 0→1 photos edit succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','json'],'O9: moved as one block with the new photo');
    assert.ok([11,12,15].every(id=>!live.has(id)),'O9: old copy fully removed');
  }

  /* O10 (I) — 1 фото → 0: повний перенос. */
  {
    const live=new Map();seedChannel(live,[13]);
    const t=archivedA('ticketA',['idb:a'],[13]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=[];
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O10: 1→0 photos edit succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','json'],'O10: moved as one block, photos removed');
    assert.ok([11,12,13,15].every(id=>!live.has(id)),'O10: old copy fully removed');
  }

  /* O11 — НЕВДАЛА СПРОБА переносу (JSON падає м'яко): стара копія ціла,
     недобудований новий блок durably у черзі очищення; retry зводиться
     до одного перенесеного блоку. */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:x','idb:c'];
    world.jsonSoftFail=true;
    assert.equal(await context.backupTicketToTelegramNow(t),false,'O11: failed move is not acknowledged');
    assert.ok([11,12,13,14,15,16].every(id=>live.has(id)),'O11: old copy fully intact');
    assert.ok(orderIds(live).slice(0,6).join()==='11,12,13,14,15,16','O11: old copy keeps its position');
    assert.deepEqual(orderIds(live),[11,12,13,14,15,16,21,22,23],'O11: the partial NEW block was cleaned up — nothing partial remains in the channel');
    world.jsonSoftFail=false;
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O11: retry succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','photo:3','json'],'O11: converged — single moved block');
    assert.ok([11,12,13,14,15,16].every(id=>!live.has(id)),'O11: old copy deleted after convergence');
  }

  /* O12 — ЗБІЙ ПОСЕРЕДИНІ нового блоку (альбом 500): свіжі sep/текст прибрані,
     стара копія ціла; retry — один перенесений блок. */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:x','idb:c'];
    world.sendPhotoFailOnce.add(2);
    assert.equal(await context.backupTicketToTelegramNow(t),false,'O12: failed album is not acknowledged');
    assert.equal(sendsOf(world,'deleteMessage').length>=2,true,'O12: the partial new block (fresh sep/text) is cleaned up');
    assert.ok([11,12,13,14,15,16].every(id=>live.has(id)),'O12: old copy fully intact');
    assert.deepEqual(orderIds(live),[11,12,13,14,15,16,21,22,23],'O12: order unchanged after the failed attempt');
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O12: retry succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','photo:3','json'],'O12: single moved block after retry');
  }

  /* O13 — kill/reload посередині переносу (сценарій A+B): сироти нового блоку
     у черзі очищення, стара копія durably знята; reload+retry сходиться. */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const w1=makeWorld({ticket:t,live});
    const world=w1.world;
    t.photos=['idb:a','idb:x','idb:c'];
    world.hangPhotoIndex=2; // kill під час відповіді альбому
    const attempt=w1.context.backupTicketToTelegramNow(t); // не await
    for(let i=0;i<3000&&!(world.apiLog.some(call=>call.endpoint==='sendMediaGroup'));i++)await new Promise(r=>setTimeout(r,1));
    const persisted=w1.world.persistedSnapshots[w1.world.persistedSnapshots.length-1];
    assert.ok([11,12,13,14,15,16].every(id=>live.has(id)),'O13: old copy intact after the kill');
    assert.ok((persisted.tgBackupCleanupMsgIds||[]).length===2,'O13: fresh sep+text parked durably');
    const mv=persisted.tgBackupMoveOldMsgIds;
    assert.ok(mv&&mv.tgSepMsgId===11&&mv.tgJsonMsgId===16,'O13: the true old block is durably snapshotted');
    const restored=JSON.parse(JSON.stringify(persisted));
    const w2=makeWorld({ticket:restored,live,startId:1000});
    assert.equal(await w2.context.backupTicketToTelegramNow(restored),true,'O13: post-reload retry succeeds');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','photo:3','json'],'O13: converged to a single moved block');
    assert.ok([11,12,13,14,15,16].every(id=>!live.has(id)),'O13: old copy removed');
  }

  /* O14 — cleanup СТАРОГО блоку впіймав 429: новий блок уже підтверджений,
     старі id у черзі очищення; retry дочьищує СТАРИЙ блок і НЕ створює
     другий новий (фото вже підтверджені). */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:x','idb:c'];
    world.failDeletes=true;
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O14: new block confirmed even when old-block cleanup fails');
    assert.equal(t.tgBackupCleanupMsgIds.length,6,'O14: ALL six old-block ids durably tracked for cleanup');
    assert.deepEqual(orderKinds(live).length,15,'O14: B(3) + new A block(6) + old A block(6) awaiting cleanup');
    world.failDeletes=false;
    const sendsBefore=sendsOf(world,'sendMediaGroup').length+sendPhotoCount(world)+sendsOf(world,'sendDocument').length+sendsOf(world,'sendMessage').length;
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O14: cleanup-only retry succeeds');
    assert.equal(sendsOf(world,'sendMediaGroup').length+sendPhotoCount(world)+sendsOf(world,'sendDocument').length+sendsOf(world,'sendMessage').length,sendsBefore,'O14: the retry created NO second new copy');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','photo:3','json'],'O14: final order — B then the single A block');
    assert.equal(t.tgBackupCleanupMsgIds.length,0,'O14: cleanup queue drained');
  }

  /* O15 — те саме, але cleanup старого блоку ловить 500 (постійніша відмова
     тієї ж природи): поведінка ідентична 429 — черга, дочищення, без другого
     блоку. Скорочено: одна спроба з failDeletes, потім дочищення. */
  {
    const live=new Map();seedChannel(live,[13,14]);
    const t=archivedA('ticketA',['idb:a','idb:b'],[13,14]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:x'];
    world.failDeletes=true;
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O15: new block confirmed (cleanup 500)');
    assert.equal(t.tgBackupCleanupMsgIds.length,5,'O15: whole old block tracked');
    world.failDeletes=false;
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O15: retry cleans the old block');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','json'],'O15: single A block remains (1 photo)');
  }

  /* O16 — double tap (реальний UI-шлях) після заміни фото: рівно один
     перенесений блок, обидва запити сходяться. */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:x','idb:c'];
    const results=await Promise.all([context.backupTicketToTelegram(t),context.backupTicketToTelegram(t)]);
    assert.deepEqual(results,[true,true],'O16: both queued runs settle');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','photo:3','json'],'O16: exactly one moved block across the double tap');
  }

  /* O17 — editMessageMedia ПОВІЛЬНО/постійно недоступний: перша text-only
     спроба чесно невдала (прапорець durably), повторна — ПОВНИМ переносом:
     блок ніколи не лишається розірваним, вічних невдалих спроб нема. */
  {
    const live=new Map();seedChannel(live,[13,14,15]);
    const t=archivedA('ticketA',['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    world.jsonInPlaceFailPerm=true;
    t.content+=' (відредаговано)';
    assert.equal(await context.backupTicketToTelegramNow(t),false,'O17: in-place JSON edit permanent failure is not acknowledged');
    assert.equal(t.tgJsonInPlaceUnsupported,true,'O17: learned durably — no endless failing attempts');
    assert.deepEqual(orderIds(live),[11,12,13,14,15,16,21,22,23],'O17: nothing new was created — no split block');
    assert.equal(await context.backupTicketToTelegramNow(t),true,'O17: next attempt moves the whole block');
    assert.deepEqual(orderKinds(live),[...B_ORDER,'sep','text','photo:1','photo:2','photo:3','json'],'O17: single moved block (text edits eventually move instead of splitting)');
    assert.ok([11,12,13,14,15,16].every(id=>!live.has(id)),'O17: old copy fully removed');
  }

  console.log('PASS telegram move-block: the whole ticket copy moves as ONE block below newer tickets whenever any part must be recreated; text-only edits stay in place; message ORDER is asserted');
})().catch(error=>{console.error(error);process.exitCode=1;});

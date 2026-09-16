'use strict';
/* v91.32: Telegram sendMediaGroup (альбом) для 2–10 фото заявки.
   Харнест виконує РЕАЛЬНИЙ js/photo-telegram-domain.js (vm) з моком Telegram
   API, що повертає для sendMediaGroup МАСИВ Message (як у реальному API).
   Фіксує матрицю релізу:
     - 1 фото → sendPhoto без (i/n); 2..10 → ОДИН альбом; 11/21 → chunks 10+1/10+10+1;
     - порядок елементів альбома = порядок фото у заявці;
     - підпис (дата/адреса) лише на першому елементі, без дублювання (i/n);
     - 429 → retry за retry_after; 500 → чесно невдала спроба + cleanup;
     - мережевий обрив із втраченою відповіддю → ambiguous-паркування;
     - kill/reload МІЖ chunkами → сироти першого альбому дочищуються;
     - невдале видалення СТАРОГО альбому після успіху → tracked у черзі очищення;
     - EDIT (без змін / додавання / видалення / заміна фото) → рівно один
       консистентний набір, жодного «другого альбому»;
     - легасі-заявка без tg-масивів; double key; double tap; паралельні заявки. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','photo-telegram-domain.js'),'utf8');
const response=(data,status=200)=>({status,headers:{get:()=>null},json:async()=>data});
const TICKET_BASE={type:'Інтернет',date:'15.09.2026',time:'10:00',content:'Виклик 300 грн',city:'Дніпро',street:'Слобожанський',house:'1'};

function makeWorld({ticket,live,startId=100}){
  let nextId=startId;
  const world={apiLog:[],live:live||new Map(),deleted:[],persistedSnapshots:[],failDeletes:false,sendPhotoFailOnce:new Set(),sendPhotoNetworkFailOnce:new Set(),group429Once:false,hangPhotoIndex:null};
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
      if(/\/sendMediaGroup$/.test(url)){
        const media=JSON.parse(opts.body.get('media'));
        const idxs=media.map(item=>Number(String(item.media).replace('attach://photo','')));
        world.apiLog.push({endpoint:'sendMediaGroup',photoIndexes:idxs});
        if(idxs.some(i=>world.hangPhotoIndex===i+1))return new Promise(()=>{}); // «застосунок убито»
        if(world.group429Once){world.group429Once=false;return response({ok:false,error_code:429,description:'Too Many Requests: retry after 1',parameters:{retry_after:1}},429);}
        if(idxs.some(i=>world.sendPhotoNetworkFailOnce.has(i+1))){idxs.forEach(i=>world.sendPhotoNetworkFailOnce.delete(i+1));throw new Error('fetch failed');}
        if(idxs.some(i=>world.sendPhotoFailOnce.has(i+1))){idxs.forEach(i=>world.sendPhotoFailOnce.delete(i+1));return response({ok:false,error_code:500,description:'Internal Server Error'},500);}
        const msgs=idxs.map(idx=>{
          const id=++nextId;
          world.live.set(id,{kind:'photo',photoIndex:idx+1,caption:idxs[0]===idx?String(media[0].caption||''):''});
          return{message_id:id,photo:[{file_id:'fid-'+id}]};
        });
        return response({ok:true,result:msgs});
      }
      if(/\/sendPhoto$/.test(url)){
        const caption=String(opts.body.get('caption')||'');
        const m=caption.match(/\((\d+)\/(\d+)\)/),idx=m?Number(m[1]):1,total=m?Number(m[2]):1;
        world.apiLog.push({endpoint:'sendPhoto',photoIndex:idx,caption});
        if(world.hangPhotoIndex===idx)return new Promise(()=>{});
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
const mgCalls=(world)=>world.apiLog.filter(call=>call.endpoint==='sendMediaGroup');
const spCalls=(world)=>world.apiLog.filter(call=>call.endpoint==='sendPhoto');
function summarize(live){
  const kinds={};
  for(const [,info] of live){const k=info.kind+(info.photoIndex?(':'+info.photoIndex):'');kinds[k]=(kinds[k]||0)+1;}
  return kinds;
}
function expectSet(n){const s={sep:1,text:1,json:1};for(let i=1;i<=n;i++)s['photo:'+i]=1;return s;}
function archived(id,keys,msgIds){
  return {...TICKET_BASE,id,photos:keys.slice(),tgBackedUp:true,tgBackupPending:false,
    tgSepMsgId:11,tgTextMsgId:12,tgPhotoMsgId:msgIds[0],tgPhotoMsgIds:msgIds.slice(),
    tgPhotoFileIds:msgIds.map((_,i)=>'f'+(i+1)),tgJsonMsgId:10+msgIds.length+3,
    tgPhotoKeys:keys.slice()};
}
function seedArchived(live,keys,msgIds){
  live.set(11,{kind:'sep'});live.set(12,{kind:'text'});
  keys.forEach((k,i)=>live.set(msgIds[i],{kind:'photo',photoIndex:i+1,caption:i===0?'13.08.2026 16:14 Таромское Вул Золотоосіння 64 (1/'+keys.length+')':''}));
  live.set(10+keys.length+3,{kind:'json'});
}

(async()=>{
  /* M1. Рівно 1 фото: звичайний sendPhoto, підпис БЕЗ (i/n), жодного альбому. */
  {
    const ticket={...TICKET_BASE,id:'m1',photos:['idb:only']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'M1: single-photo backup succeeds');
    assert.equal(mgCalls(world).length,0,'M1: no media group for a single photo');
    assert.equal(spCalls(world).length,1,'M1: exactly one sendPhoto');
    assert.ok(!/\(\d\/\d\)/.test(spCalls(world)[0].caption),'M1: single photo caption has no (i/n) split');
  }

  /* M2. 2 фото: ОДИН альбом; порядок = порядок у заявці; підпис лише на першому. */
  {
    const ticket={...TICKET_BASE,id:'m2',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'M2: two-photo backup succeeds');
    assert.deepEqual(mgCalls(world).map(c=>c.photoIndexes),[[0,1]],'M2: one album in ticket order');
    const infos=[...world.live.values()].filter(i=>i.kind==='photo');
    assert.ok(/15\.09\.2026.*Слобожанський/.test(infos[0].caption)&&!/\(\d\/\d\)/.test(infos[0].caption),'M2: caption = date/address line on the first element only');
    assert.equal(infos[1].caption,'','M2: second element has no caption');
    const confirmed=Array.from(ticket.tgPhotoMsgIds);
    assert.deepEqual(confirmed,[...confirmed].sort((a,b)=>a-b),'M2: confirmed album message ids in delivery order');
    assert.equal(ticket.tgPhotoFileIds.length,2,'M2: every album element file_id is stored');
  }

  /* M3. 3 фото: один альбом, порядок 1→2→3, підтверджені id за порядком. */
  {
    const ticket={...TICKET_BASE,id:'m3',photos:['idb:a','idb:b','idb:c']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'M3: three-photo backup succeeds');
    assert.deepEqual(mgCalls(world).map(c=>c.photoIndexes),[[0,1,2]],'M3: album order 1→2→3');
    assert.deepEqual(summarize(world.live),expectSet(3),'M3: single copy of every message');
  }

  /* M4. 10 фото: ліміт Telegram — все ще ОДИН альбом. */
  {
    const ticket={...TICKET_BASE,id:'m4',photos:Array.from({length:10},(_,i)=>'idb:m'+i)};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'M4: 10-photo backup succeeds');
    assert.deepEqual(mgCalls(world).map(c=>c.photoIndexes),[Array.from({length:10},(_,i)=>i)],'M4: one 10-item album');
    assert.equal(spCalls(world).length,0,'M4: no sendPhoto fallback');
  }

  /* M5. 11 фото: альбом 10 + звичайний sendPhoto «хвоста» (11/11). */
  {
    const ticket={...TICKET_BASE,id:'m5',photos:Array.from({length:11},(_,i)=>'idb:m'+i)};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'M5: 11-photo backup succeeds');
    assert.deepEqual(mgCalls(world).map(c=>c.photoIndexes),[Array.from({length:10},(_,i)=>i)],'M5: first chunk = album of 10');
    assert.deepEqual(spCalls(world).map(c=>c.photoIndex),[11],'M5: leftover photo goes as sendPhoto (11/11)');
    assert.ok(/\(11\/11\)/.test(spCalls(world)[0].caption),'M5: leftover keeps global (i/n) numbering');
    assert.deepEqual(summarize(world.live),expectSet(11),'M5: 11 photos, each exactly once');
  }

  /* M6. 21 фото: 10 + 10 + 1 — без втрат і без дублікатів. */
  {
    const ticket={...TICKET_BASE,id:'m6',photos:Array.from({length:21},(_,i)=>'idb:m'+i)};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'M6: 21-photo backup succeeds');
    assert.deepEqual(mgCalls(world).map(c=>c.photoIndexes.length),[10,10],'M6: two full albums');
    assert.deepEqual(spCalls(world).map(c=>c.photoIndex),[21],'M6: leftover (21/21)');
    assert.equal(photoCount(world.live),21,'M6: all 21 delivered once');
    assert.equal(ticket.tgPhotoMsgIds.length,21,'M6: confirmed ids for every photo');
  }

  /* M7. Дублікати photo key у заявці: обидва елементи альбома (як у заявці). */
  {
    const ticket={...TICKET_BASE,id:'m7',photos:['idb:same','idb:same']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'M7: duplicate-key backup succeeds');
    assert.deepEqual(mgCalls(world)[0].photoIndexes,[0,1],'M7: both entries in one album');
    assert.equal(photoCount(world.live),2,'M7: two distinct messages, one each');
  }

  /* M8. Double tap через реальний UI-шлях (backupTicketToTelegram): один альбом. */
  {
    const ticket={...TICKET_BASE,id:'m8',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    const results=await Promise.all([context.backupTicketToTelegram(ticket),context.backupTicketToTelegram(ticket)]);
    assert.deepEqual(results,[true,true],'M8: both queued runs settle');
    assert.equal(mgCalls(world).length,1,'M8: exactly one album across the double tap');
  }

  /* M9. Паралельні заявки: альбом + одне фото, глобальна черга без перехрещень. */
  {
    const ta={...TICKET_BASE,id:'pa',photos:['idb:a','idb:b']},tb={...TICKET_BASE,id:'pb',photos:['idb:c','idb:d','idb:e']};
    const {context,world}=makeWorld({ticket:ta});
    context.tickets.push(tb);
    const results=await Promise.all([context.backupTicketToTelegram(ta),context.backupTicketToTelegram(tb)]);
    assert.deepEqual(results,[true,true],'M9: both parallel tickets succeed');
    assert.equal(photoCount(world.live),5,'M9: album of 2 + album of 3, no cross-talk');
    assert.equal(mgCalls(world).length,2,'M9: one album per ticket');
  }

  /* M10. 429 на альбом: retry за retry_after тим самим запитом → один альбом. */
  {
    const ticket={...TICKET_BASE,id:'m10',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    world.group429Once=true;
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'M10: backup succeeds through 429 retry');
    assert.equal(mgCalls(world).length,2,'M10: first request got 429, the retry_after retry delivered — only ONE album in the archive');
    assert.deepEqual(summarize(world.live),expectSet(2),'M10: single set after rate-limit retry');
  }

  /* M11. 500 на альбом: спроба чесно невдала, доставлене прибрано, retry — один набір. */
  {
    const ticket={...TICKET_BASE,id:'m11',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    world.sendPhotoFailOnce.add(1);
    assert.equal(await context.backupTicketToTelegramNow(ticket),false,'M11: failed album is not acknowledged');
    assert.equal(world.live.size,0,'M11: partial attempt fully cleaned up');
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'M11: retry succeeds');
    assert.deepEqual(summarize(world.live),expectSet(2),'M11: single set after retry');
  }

  /* M12. Мережевий обрив із втраченою відповіддю: ambiguous-паркування. */
  {
    const ticket={...TICKET_BASE,id:'m12',photos:['idb:a','idb:b']};
    const {context,world}=makeWorld({ticket});
    world.sendPhotoNetworkFailOnce.add(2);
    assert.equal(await context.backupTicketToTelegramNow(ticket),false,'M12: ambiguous delivery is not acknowledged');
    assert.equal(ticket.tgBackupAmbiguous,true,'M12: ambiguous album parked for manual review');
    assert.equal(ticket.tgBackupPending,false,'M12: excluded from automatic retry');
    const before=world.apiLog.length;
    assert.equal(await context.backupTicketToTelegramNow(ticket),false,'M12: automatic retry blocked');
    assert.equal(world.apiLog.length,before,'M12: blocked retry issues zero Telegram calls');
  }

  /* M13. Kill/reload МІЖ chunkами (11 фото): сироти першого альбому durably
     у черзі очищення; наступний запуск прибирає їх і сходиться до одного набору. */
  {
    const live=new Map();
    const before={...TICKET_BASE,id:'m13',photos:Array.from({length:11},(_,i)=>'idb:m'+i)};
    const w1=makeWorld({ticket:before,live});
    w1.world.hangPhotoIndex=11;
    const attempt=w1.context.backupTicketToTelegramNow(before); // не await
    for(let i=0;i<3000&&!(w1.world.apiLog.some(call=>call.endpoint==='sendPhoto'&&call.photoIndex===11));i++)await new Promise(r=>setTimeout(r,1));
    assert.equal(photoCount(live),10,'M13: first album delivered before the kill');
    const persisted=w1.world.persistedSnapshots[w1.world.persistedSnapshots.length-1];
    assert.equal((persisted.tgPhotoMsgIds||[]).length,0,'M13: confirmed state untouched by the unfinished attempt');
    assert.equal((persisted.tgBackupCleanupMsgIds||[]).length,10,'M13: 10 delivered album ids durably parked');
    const restored=JSON.parse(JSON.stringify(persisted));
    const w2=makeWorld({ticket:restored,live,startId:1000});
    assert.equal(await w2.context.backupTicketToTelegramNow(restored),true,'M13: post-reload retry succeeds');
    assert.deepEqual(summarize(live),expectSet(11),'M13: converges to a single set — no second album');
  }

  /* M14. EDIT: повторний backup по незміненій заявці — жодного нового альбому. */
  {
    const live=new Map();
    const keys=['idb:a','idb:b'];
    const t=archived('m14',keys,[13,14]);
    seedArchived(live,keys,[13,14]);
    const {context,world}=makeWorld({ticket:t,live});
    assert.equal(await context.backupTicketToTelegramNow(t),true,'M14: unchanged re-archive succeeds');
    assert.equal(mgCalls(world).length,0,'M14: unchanged photos are never re-sent as a second album');
    assert.deepEqual(summarize(live),expectSet(2),'M14: archive still holds a single set');
  }

  /* M15. EDIT + додавання фото (2→3): новий альбом 3, старий альбом видалено. */
  {
    const live=new Map();
    const t=archived('m15',['idb:a','idb:b'],[13,14]);
    seedArchived(live,['idb:a','idb:b'],[13,14]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:b','idb:new'];
    assert.equal(await context.backupTicketToTelegramNow(t),true,'M15: add-photo edit succeeds');
    assert.deepEqual(mgCalls(world).map(c=>c.photoIndexes),[[0,1,2]],'M15: one fresh album of 3');
    assert.deepEqual(summarize(live),expectSet(3),'M15: old album removed — exactly one set');
    assert.deepEqual(t.tgPhotoMsgIds.length,3,'M15: confirmed state = the new album');
  }

  /* M16. EDIT + видалення фото (3→2): альбом 2, старі прибрані. */
  {
    const live=new Map();
    const t=archived('m16',['idb:a','idb:b','idb:c'],[13,14,15]);
    seedArchived(live,['idb:a','idb:b','idb:c'],[13,14,15]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:c'];
    assert.equal(await context.backupTicketToTelegramNow(t),true,'M16: remove-photo edit succeeds');
    assert.deepEqual(mgCalls(world).map(c=>c.photoIndexes),[[0,1]],'M16: one fresh album of 2');
    assert.deepEqual(summarize(live),expectSet(2),'M16: single set after removal');
  }

  /* M17. EDIT + заміна фото + НЕВДАЛЕ видалення старого альбому (429):
     старий альбом ЗАЛИШАЄТЬСЯ в групі, але durably tracked у черзі очищення —
     наступна спроба дочищує його; «підтверджених» альбомів ніколи не два. */
  {
    const live=new Map();
    const t=archived('m17',['idb:a','idb:b'],[13,14]);
    seedArchived(live,['idb:a','idb:b'],[13,14]);
    const {context,world}=makeWorld({ticket:t,live});
    t.photos=['idb:a','idb:new'];
    world.failDeletes=true;
    assert.equal(await context.backupTicketToTelegramNow(t),true,'M17: backup succeeds even when old-album cleanup fails');
    assert.deepEqual(mgCalls(world).length,1,'M17: exactly one fresh album');
    assert.deepEqual(t.tgPhotoMsgIds.length,2,'M17: confirmed state = the fresh album only');
    assert.deepEqual([...t.tgBackupCleanupMsgIds].sort((a,b)=>a-b),[13,14,15],'M17: stale old album + old json durably tracked for cleanup (not silently lost)');
    world.failDeletes=false;
    assert.equal(await context.backupTicketToTelegramNow(t),true,'M17: next run cleans the stale album');
    assert.equal(photoCopiesOf(live,1),1,'M17: exactly one photo-1 remains');
    assert.equal(photoCopiesOf(live,2),1,'M17: exactly one photo-2 remains');
  }
  function photoCopiesOf(liveMap,idx){return [...liveMap.values()].filter(info=>info.kind==='photo'&&info.photoIndex===idx).length;}

  /* M18. Легасі-заявка (без tg-масивів) із 3 фото: альбом, масиви ініційовані. */
  {
    const ticket={...TICKET_BASE,id:'m18',photos:['idb:a','idb:b','idb:c']};
    const {context,world}=makeWorld({ticket});
    assert.equal(await context.backupTicketToTelegramNow(ticket),true,'M18: legacy ticket backs up');
    assert.deepEqual(mgCalls(world).length,1,'M18: album for a legacy ticket');
    assert.equal(ticket.tgPhotoMsgIds.length,3,'M18: tg arrays initialized from the album');
    assert.equal(ticket.tgPhotoFileIds.length,3,'M18: file ids for restore stored');
  }

  console.log('PASS telegram media-group: albums (2-10), chunking (>10), order, captions, rate-limit/server/ambiguous/kill-reload and EDIT matrix keep exactly-one-consistent-set');
})().catch(error=>{console.error(error);process.exitCode=1;});

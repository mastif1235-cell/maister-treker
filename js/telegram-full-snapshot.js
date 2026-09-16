/* v91.34: ПОВНИЙ Telegram-снапшот (аварійне відновлення / disaster recovery).
   Telegram Bot API не вміє читати історію каналу (getUpdates тримає апдейти
   до 24 год, методів типу getHistory немає), тому «дочитати» старі поодинокі
   ticket-*.json після чистого встановлення НЕМОЖЛИВО. Натомість getChat
   повертає pinned_message ЦІЛКОМ (з document.file_id) — закріплений файл
   доступний боту на чистій установці без читання історії. На цьому будовано:
     1) «Створити повний снапшот» — ОДИН sendDocument із усіма заявками
        (без фото-бінарників і системних секретів), потім pinChatMessage.
        Надійність: спершу файл повністю надіслано й підтверджено, і ЛИШЕ
        потім закріплено; delete-first НЕМАЄ, попередні снапшоти НЕ видаляються
        (мінімум 2 останні залишаються точками відновлення). Якщо новий
        снапшот не створено/не закріплено — попередній закріплений лишається
        робочим якорем.
     2) «Відновити з Telegram» — getChat → pinned document → getFile →
        завантажити → предпросмотр (скільки нових/існуючих/видалених/фото) →
        merge за ОРИГІНАЛЬНИМ ticket.id: наявні локальні заявки НЕ
        перезаписуються, відсутні додаються зі своїм id і tgBackedUp=true
        (копія вже в каналі → повторної відправки немає). Фото доз завантажуються
        через tgPhotoFileIds/legacy tgPhotoFileId обмеженим паралелізмом;
        недоступне фото НЕ валить заявку — рахується у «фото недоступні».
   Restore НЕ чіпає: IndexedDB (не очищає), налаштування, Google Sheets
   (жодних sync-викликів), звичайний бекап v91.33 (жодних нових send/delete/edit).
   У снапшоті немає системних секретів (tgBotToken, syncHmacSecret тощо —
   спільний securityStripSystemSecrets) і самих фото (лише file_id). */

const MT_FULL_SNAPSHOT_SCHEMA = 1;
const MT_FULL_SNAPSHOT_NAME = 'master-tracker-full-backup.json';
const MT_PHOTO_RESTORE_CONCURRENCY = 2; // делікатно до Telegram rate limits

/* ---- Побудова об'єкта снапшота (чиста функція) ---- */
function mtFullSnapshotStripTicket(t){
  const clean=typeof securityStripSystemSecrets==='function'
    ?securityStripSystemSecrets(t)
    :JSON.parse(JSON.stringify(t||{}));
  // Службовий runtime-стан у снапшоті не потрібен
  delete clean.tgBackupPending;
  delete clean.tgBackupCleanupMsgIds;
  delete clean.tgBackupCleanupAttempts;
  delete clean.tgBackupStaleMsgIds;
  delete clean.tgBackupMoveOldMsgIds;
  delete clean.tgBackupAmbiguous;
  return clean;
}
function buildFullSnapshotObject(nowMs){
  const ts=Number(nowMs)||Date.now();
  return {
    MT_FULL_SNAPSHOT:1,
    schema:MT_FULL_SNAPSHOT_SCHEMA,
    savedAtMs:ts,
    savedAt:new Date(ts).toISOString(),
    appVersion:typeof APP_VERSION!=='undefined'?String(APP_VERSION):'',
    tickets:(tickets||[]).map(mtFullSnapshotStripTicket),
    deleted:(deletedTickets||[]).map(t=>({id:t&&t.id,deletedAt:t&&t.deletedAt||null,date:(t&&t.date)||'',time:(t&&t.time)||'',type:(t&&t.type)||''}))
  };
}

/* ---- Створення: sendDocument → pinChatMessage (без delete-first) ---- */
async function createTelegramFullSnapshot(){
  const token=(settings.tgBotToken||'').trim(),chatId=(settings.tgBackupChatId||'').trim();
  if(!token||!chatId)return{ok:false,stage:'config',reason:'Не налаштовано токен бота або Chat ID архіву'};
  const snapshot=buildFullSnapshotObject();
  try{
    const blob=new Blob([JSON.stringify(snapshot,null,1)],{type:'application/json'});
    const form=new FormData();
    form.append('chat_id',chatId);
    form.append('document',blob,MT_FULL_SNAPSHOT_NAME);
    // sendDocument входить в ambiguous-список fetchWithRetry: обрив із втраченою
    // відповіддю чесно кидається далі — файл міг доїхати, але МИ ЙОГО НЕ ПІНИМО
    // (не знаємо message_id), тож старий закріплений снапшот лишається якорем.
    const response=await fetchWithRetry(`https://api.telegram.org/bot${token}/sendDocument`,{method:'POST',body:form});
    const data=await response.json();
    if(!(data&&data.ok&&data.result&&data.result.message_id)){
      return{ok:false,stage:'send',reason:(data&&data.description)||'sendDocument failed'};
    }
    const messageId=data.result.message_id;
    const pinResponse=await fetchWithRetry(`https://api.telegram.org/bot${token}/pinChatMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,message_id:messageId})});
    const pin=await pinResponse.json();
    if(!(pin&&pin.ok)){
      // T17: файл у каналі є (залишиться резервною копією), але якір не змінено —
      // попередній закріплений снапшот робочий.
      return{ok:false,stage:'pin',messageId,reason:(pin&&pin.description)||'pinChatMessage failed'};
    }
    return{ok:true,messageId,count:snapshot.tickets.length,savedAt:snapshot.savedAt};
  }catch(e){
    globalThis.MTSafeError?.reportError?.(e,{scope:'telegram-full-snapshot-create'});
    return{ok:false,stage:'network',reason:String((e&&e.message)||e)};
  }
}

/* ---- Читання якоря: getChat → pinned document → завантаження ---- */
function validateFullSnapshot(s){
  if(!s||typeof s!=='object'||Array.isArray(s))return{ok:false,reason:'Структура снапшота некоректна'};
  if(s.MT_FULL_SNAPSHOT!==1||Number(s.schema)!==MT_FULL_SNAPSHOT_SCHEMA)return{ok:false,reason:'Непідтримувана схема снапшота (schema='+String(s&&s.schema)+')'};
  if(!Array.isArray(s.tickets))return{ok:false,reason:'У снапшоті немає списку заявок'};
  return{ok:true};
}
async function fetchTelegramFullSnapshot(){
  const token=(settings.tgBotToken||'').trim(),chatId=(settings.tgBackupChatId||'').trim();
  if(!token||!chatId)return{ok:false,reason:'Не налаштовано токен бота або Chat ID архіву'};
  try{
    const chatResponse=await fetchWithRetry(`https://api.telegram.org/bot${token}/getChat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId})});
    const chat=await chatResponse.json();
    const pinned=chat&&chat.result&&chat.result.pinned_message;
    const doc=pinned&&pinned.document;
    if(!doc||!doc.file_id)return{ok:false,reason:'У каналі-архіві немає закріпленого повного снапшота'};
    const name=String(doc.file_name||'');
    if(name&&name!==MT_FULL_SNAPSHOT_NAME)return{ok:false,reason:'Закріплений файл — не повний снапшот ('+name+')'};
    const fileResponse=await fetchWithRetry(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(doc.file_id)}`);
    const fileInfo=await fileResponse.json();
    if(!(fileInfo&&fileInfo.ok&&fileInfo.result&&fileInfo.result.file_path))return{ok:false,reason:'Telegram не віддав метадані файлу снапшота'};
    const download=await fetch(`https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`);
    const text=await download.text();
    let parsed;
    try{parsed=JSON.parse(text);}catch(_e){return{ok:false,reason:'Снапшот не є коректним JSON'};}
    const check=validateFullSnapshot(parsed);
    if(!check.ok)return{ok:false,reason:check.reason};
    return{ok:true,snapshot:parsed,savedAt:parsed.savedAt||''};
  }catch(e){
    globalThis.MTSafeError?.reportError?.(e,{scope:'telegram-full-snapshot-fetch'});
    return{ok:false,reason:'Мережева помилка під час читання снапшота'};
  }
}

/* ---- Дедуплікація версій: останній запис по ticket.id перемагає ---- */
function dedupeSnapshotTickets(list){
  const byId=new Map(),invalid=[];
  (list||[]).forEach(t=>{
    if(!t||typeof t!=='object'||t.id===undefined||t.id===null||String(t.id).trim()===''){invalid.push(t);return;}
    byId.set(String(t.id),t); // детерміновано: остання версія в масиві — актуальна
  });
  return{tickets:[...byId.values()],invalid};
}

/* ---- Пари «локальний ключ фото → Telegram file_id» (з легасі) ---- */
function mtSnapshotPhotoKeyPairs(t){
  const keys=(t.photos&&t.photos.length)?t.photos:(t.photo?[t.photo]:[]);
  return keys.map((key,i)=>({
    key:String(key||''),
    fileId:(t.tgPhotoFileIds&&t.tgPhotoFileIds[i])||(i===0&&t.tgPhotoFileId)||null
  }));
}

/* ---- Аналіз для предпросмотра (чиста функція, без змін даних) ---- */
function analyzeSnapshotForRestore(snapshot){
  const check=validateFullSnapshot(snapshot);
  if(!check.ok)return{ok:false,reason:check.reason};
  const {tickets:uniq,invalid}=dedupeSnapshotTickets(snapshot.tickets);
  const deletedMap=new Map();
  (Array.isArray(snapshot.deleted)?snapshot.deleted:[]).forEach(d=>{if(d&&d.id!==undefined&&d.id!==null)deletedMap.set(String(d.id),d);});
  let newCount=0,existingCount=0,deletedCount=0,photoJobs=0;
  const rows=[];
  uniq.forEach(t=>{
    const id=String(t.id);
    let status='new';
    if((tickets||[]).some(x=>x&&String(x.id)===id)){status='existing';existingCount++;}
    else if(deletedMap.has(id)){status='deleted';deletedCount++;}
    else{newCount++;photoJobs+=mtSnapshotPhotoKeyPairs(t).filter(p=>p.fileId).length;}
    rows.push({id,type:t.type||'',date:t.date||'',time:t.time||'',sum:Number(t.sum)||0,status});
  });
  return{ok:true,total:(snapshot.tickets||[]).length,unique:uniq.length,
    duplicateVersions:((snapshot.tickets||[]).length-uniq.length),invalid:invalid.length,
    newCount,existingCount,deletedCount,photoJobs,
    tombstones:deletedMap.size,savedAt:snapshot.savedAt||'',rows};
}

/* ---- Нормалізація відновленої заявки (без пошкоджень, з дефолтами) ---- */
function mtNormalizeRestoredTicket(s){
  if(typeof s.date!=='string'||!/^\d{2}\.\d{2}\.\d{4}$/.test(s.date.trim()))return null;
  if(typeof s.type!=='string'||!s.type.trim())return null;
  if(s.content!==undefined&&s.content!==null&&typeof s.content!=='string')return null;
  if(s.sum!==undefined&&s.sum!==null&&typeof s.sum!=='number'&&isNaN(Number(s.sum)))return null;
  const t=Object.assign(blankTicketObject(),s);
  t.id=String(s.id); // ОРИГІНАЛЬНИЙ id — ключ дедуплікації (не новий UUID)
  t.sum=(s.sum===undefined||s.sum===null)?0:(Number(s.sum)||0);
  if(!Array.isArray(t.photos))t.photos=t.photo?[t.photo]:[];
  if(!Array.isArray(t.tags))t.tags=[];
  if(!Array.isArray(t.tgPhotoFileIds))t.tgPhotoFileIds=[];
  if(!Array.isArray(t.tgPhotoMsgIds))t.tgPhotoMsgIds=[];
  // transient Telegram-стан — чистий: restore не повинен нікого видаляти/пересилати
  t.tgBackupPending=false;
  t.tgBackupCleanupMsgIds=[];
  t.tgBackupCleanupAttempts={};
  t.tgBackupStaleMsgIds=[];
  t.tgBackupAmbiguous=false;
  t.tgBackupMoveOldMsgIds=null;
  // Повна копія вже лежить у каналі → звичайний re-archive НЕ шле повторно
  if(t.tgJsonMsgId)t.tgBackedUp=true;
  return t;
}

/* ---- Restore: merge за ticket.id, без синків і без Telegram-відправки ---- */
async function restoreFromTelegramFullSnapshot(snapshot,onProgress){
  const check=validateFullSnapshot(snapshot);
  if(!check.ok)return{ok:false,reason:check.reason};
  const deletedMap=new Map();
  (Array.isArray(snapshot.deleted)?snapshot.deleted:[]).forEach(d=>{if(d&&d.id!==undefined&&d.id!==null)deletedMap.set(String(d.id),d);});
  const {tickets:uniq,invalid}=dedupeSnapshotTickets(snapshot.tickets);
  const restored=[],errors=[];
  invalid.forEach(()=>errors.push({id:'(без id)',reason:'некоректний запис у снапшоті (відсутній коректний id)'}));
  let skippedExisting=0,skippedDeleted=0;
  for(const s of uniq){
    const id=String(s.id);
    if((tickets||[]).some(x=>x&&String(x.id)===id)){skippedExisting++;continue;} // T2/T3: ідемпотентно
    if(deletedMap.has(id)){skippedDeleted++;continue;} // видалені не воскресаємо
    const t=mtNormalizeRestoredTicket(s);
    if(!t){errors.push({id,reason:'некоректний запис заявки у снапшоті'});continue;} // T13/T14
    tickets.push(t);
    restored.push(t);
    if(onProgress)onProgress({stage:'ticket',id,done:restored.length});
  }
  if(restored.length)await saveTicketsLocalOnly(); // durable локально; БЕЗ sync/Sheets (T23)
  // Фото: для ВСІХ заявок снапшота, які є локально (щойно відновлені І вже
  // існуючі — повторний запуск дозавантажує пропущене), гейт photoDbGet робить
  // це ідемпотентним; обмежений паралелізм; fail ≠ fail заявки
  const jobs=[];
  uniq.forEach(s=>{
    const id=String(s.id);
    if(!(tickets||[]).some(x=>x&&String(x.id)===id))return;
    mtSnapshotPhotoKeyPairs(s).forEach(p=>{if(p.fileId)jobs.push({key:p.key,fileId:p.fileId});});
  });
  const photos={need:jobs.length,restored:0,failed:0,skippedExisting:0};
  let cursor=0;
  async function mtPhotoWorker(){
    while(cursor<jobs.length){
      const job=jobs[cursor++];
      try{
        if(await photoDbGet(job.key)){photos.skippedExisting++;} // T20: вже завантажене раніше
        else{
          const dataUrl=await fetchPhotoFromTelegram(job.fileId);
          if(typeof dataUrl==='string'&&dataUrl.startsWith('data:')&&await photoDbPut(job.key,dataUrl)){photos.restored++;}
          else photos.failed++;
        }
      }catch(_e){photos.failed++;}
      if(onProgress)onProgress({stage:'photo',restored:photos.restored,failed:photos.failed,left:jobs.length-cursor});
    }
  }
  if(jobs.length){
    const workers=[];
    for(let i=0;i<Math.min(MT_PHOTO_RESTORE_CONCURRENCY,jobs.length);i++)workers.push(mtPhotoWorker());
    await Promise.all(workers);
  }
  return{ok:true,restored:restored.length,skippedExisting,skippedDeleted,errors,photos,
    restoredIds:restored.map(t=>t.id)};
}

/* ---- UI-обгортки (тости/модалки; жодної логіки даних) ---- */
function mtFullSnapshotGuardsConfigured(){
  if(!(settings.tgBotToken||'').trim()||!(settings.tgBackupChatId||'').trim()){
    showToast('Спочатку вкажіть токен бота і Chat ID архіву в Налаштуваннях');
    return false;
  }
  return true;
}
async function createFullSnapshotWithUi(){
  if(!mtFullSnapshotGuardsConfigured())return;
  showToast('Створюю повний снапшот…');
  const res=await createTelegramFullSnapshot();
  if(res.ok)showToast('✅ Повний снапшот створено та закріплено в каналі ('+res.count+' заявок)');
  else if(res.stage==='pin')showToast('⚠️ Снапшот надіслано, але закріпити не вдалося: '+(res.reason||'')+' — попередній снапшот лишається чинним');
  else showToast('❌ Снапшот не створено: '+(res.reason||'невідома помилка'));
}
async function openTelegramRestorePreviewModal(){
  if(!mtFullSnapshotGuardsConfigured())return;
  showToast('Шукаю закріплений повний снапшот…');
  const found=await fetchTelegramFullSnapshot();
  if(!found.ok){showToast('❌ '+(found.reason||'снапшот недоступний'));return;}
  const a=analyzeSnapshotForRestore(found.snapshot);
  if(!a.ok){showToast('❌ '+a.reason);return;}
  const extra=[
    a.duplicateVersions?`<div style="font-size:12px;color:var(--text-dim);">Версій-дублів (береться остання): ${a.duplicateVersions}</div>`:'',
    a.invalid?`<div style="font-size:12px;color:var(--text-dim);">Пошкоджених записів пропущено: ${a.invalid}</div>`:''
  ].join('');
  openModal('Telegram-бекап знайдено',`
    <div style="font-size:13.5px; line-height:1.7; margin-bottom:10px;">
      Дата снапшота: <b>${escapeHtml(a.savedAt||'—')}</b><br>
      Заявок: <b>${a.total}</b><br>
      Нових: <b>${a.newCount}</b><br>
      Уже существуют: <b>${a.existingCount}</b><br>
      Удалённых/tombstones: <b>${a.deletedCount}</b><br>
      Фото к восстановлению: <b>${a.photoJobs}</b>
    </div>
    ${extra}
    <div style="font-size:11.5px; color:var(--text-dim); line-height:1.5; margin:8px 0;">
      Наявні локальні заявки не перезаписуються. Відновлення не надсилає нічого
      в Telegram і не запускає синхронізацію. Фото доливаються з каналу (частина
      може бути недоступна — заявки все одно відновляться).
    </div>
    <div class="row wrap" style="margin-top:10px;">
      <button class="btn btn-accent" id="mtRestoreConfirmBtn" style="flex:1 1 45%;">Відновити</button>
      <button class="btn" id="mtRestoreCancelBtn" style="flex:1 1 45%;">Скасувати</button>
    </div>
  `,{onOpen:(root)=>{
    root.querySelector('#mtRestoreCancelBtn').addEventListener('click',()=>closeModal());
    root.querySelector('#mtRestoreConfirmBtn').addEventListener('click',async()=>{
      const confirmBtn=root.querySelector('#mtRestoreConfirmBtn');
      confirmBtn.disabled=true;
      confirmBtn.textContent='Відновлюю…';
      const res=await restoreFromTelegramFullSnapshot(found.snapshot);
      closeModal();
      if(typeof renderTicketsScreen==='function')renderTicketsScreen();
      if(!res.ok){showToast('❌ '+(res.reason||'помилка відновлення'));return;}
      openModal('Відновлення завершено',`
        <div style="font-size:13.5px; line-height:1.8;">
          Відновлено заявок: <b>${res.restored}</b><br>
          Пропущено існуючих: <b>${res.skippedExisting}</b><br>
          Пропущено видалених (tombstones): <b>${res.skippedDeleted}</b><br>
          Відновлено фото: <b>${res.photos.restored}</b><br>
          Фото недоступні: <b>${res.photos.failed}</b><br>
          Помилок: <b>${res.errors.length}</b>
        </div>
        <button class="btn btn-accent btn-block" id="mtRestoreDoneBtn" style="margin-top:12px;">Готово</button>
      `,{onOpen:(doneRoot)=>{doneRoot.querySelector('#mtRestoreDoneBtn').addEventListener('click',()=>closeModal());}});
    });
  }});
}
// Делегований прив'язування: кнопки можуть перемальовуватись разом із налаштуваннями
document.addEventListener('click',(e)=>{
  const target=e.target;
  if(target&&target.closest){
    if(target.closest('#mtFullSnapshotCreateBtn')){e.preventDefault();createFullSnapshotWithUi();return;}
    if(target.closest('#mtFullSnapshotRestoreBtn')){e.preventDefault();openTelegramRestorePreviewModal();return;}
  }
});

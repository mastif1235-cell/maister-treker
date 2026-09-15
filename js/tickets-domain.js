/* Canonical ticket list, trash, calendar and mutation workflows. */

function ticketsForDate(dateStr){
  return tickets.filter(t=>t.date===dateStr).sort((a,b)=> (a.time||'').localeCompare(b.time||''));
}
// NEW: порядковий номер заявки за день (1, 2, 3...) — рахуємо за хронологією
// (час створення в межах дня), незалежно від того, як зараз відсортований/
// відфільтрований список на екрані (пошук, теги тощо).
function getDailyTicketNumber(t){
  const sameDay = ticketsForDate(t.date); // вже відсортовано за часом зростаючо
  const idx = sameDay.findIndex(x=>String(x.id)===String(t.id));
  return idx>-1 ? idx+1 : null;
}
// NEW: точково перемальовує ОДНУ картку заявки (за id) там, де вона зараз є на
// екрані — без повного renderMainTicketList(), щоб не збивати позицію скролу
// й стан "розгорнуто/згорнуто" інших карток. Картка може одночасно бути в
// декількох місцях (список + модалка адресної навігації) — оновлюємо всі.
function refreshTicketCardDom(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  document.querySelectorAll(`.ticket-card[data-id="${id}"]`).forEach(el=>{
    const workOnly = el.dataset.workonly === '1'; // NEW: не втрачаємо режим "тільки робота" (профіль абонента) при фоновому оновленні
    el.outerHTML = renderTicketCard(t, {workOnly});
  });
}
/* Ключ для сортування заявок за датою+часом (а не за порядком створення) —
   потрібен у пошуку й фільтрі за тегами, де на екрані одразу заявки з
   різних дат: заявка, створена заднім чи майбутнім числом, має ставати на
   своє місце серед дат, а не вилазити нагору лише тому, що її щойно
   створили. */
function renderTicketsScreen(){
  document.getElementById('currentDateDisplay').textContent = currentTicketDate;
  updateNaryadQueueBtn(); // NEW: підпис кнопки залежить від поточної дати — оновлюємо разом з нею
  renderDateNavVisibility();
  renderDaySummary();
  renderMainTicketList();
  renderSyncQueueBanner();
  renderQuickDialButtons();
}

function renderSyncQueueBanner(){
  const banner = document.getElementById('syncQueueBanner');
  if(!getScriptUrl()){ banner.classList.add('hidden'); return; }
  const total = syncEngine ? syncEngine.pendingCount() : 0;
  if(total === 0){ banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  const text = document.getElementById('syncQueueBannerText');
  text.textContent = navigator.onLine
    ? `⏳ Не синхронізовано: ${total} — спробувати ще раз?`
    : `📴 Немає інтернету — ${total} заявок надішлю, коли з'явиться зв'язок`;
}

async function retrySyncQueue(){
  const retryBtn = document.getElementById('syncQueueRetryBtn');
  if(!syncEngine || !getScriptUrl()) return;
  const bannerText = document.getElementById('syncQueueBannerText');
  // Ручний повтор має бути видимим: показуємо стан одразу, а якщо flush уже
  // виконується — чекаємо саме його, не запускаючи другий паралельний.
  const runningLoop = syncEngine.loop || null;
  const previousLabel = retryBtn.textContent;
  retryBtn.disabled = true;
  retryBtn.textContent = 'Синхронізація…';
  if(bannerText) bannerText.textContent = runningLoop ? '⏳ Синхронізація вже виконується — чекаємо завершення' : '⏳ Синхронізація…';
  let ok=false;
  try{
    ok=await (runningLoop || syncEngine.flush());
  } finally {
    retryBtn.disabled = false;
    retryBtn.textContent = previousLabel || 'Повторити';
  }
  // NEW: якщо не пройшли саме зміни — робимо безпечну read-only пробу й
  // показуємо підказку замість загального «залишилось не синхронізовано».
  // Проба лише пояснює ситуацію: вона НЕ керує retry і не може вимкнути
  // синхронізацію; будь-який її збій просто лишає звичайне повідомлення.
  let reason='';
  if(ok && typeof resetShiftsSyncConfigProbe==='function') resetShiftsSyncConfigProbe();
  if(!ok){
    try{
      const pending=syncEngine.core.pending(syncEngine.state);
      if(typeof shiftsOnlyPending==='function' && shiftsOnlyPending(pending) && typeof probeShiftsSyncConfig==='function'){
        const probe=await probeShiftsSyncConfig({force:true});
        reason=typeof shiftsSyncConfigUserMessage==='function' ? shiftsSyncConfigUserMessage(probe.status) : '';
      }
    }catch(error){
      globalThis.MTSafeError?.reportError?.(error,{scope:'shifts-config-probe-ui'});
      reason='';
    }
  }
  renderTicketsScreen();
  showToast(ok ? 'Усе синхронізовано ✅' : (reason || `Залишилось не синхронізовано: ${syncEngine.pendingCount()}`), reason ? 6000 : 2200);
}

function ticketFromConflictServer(serverTicket, current){
  const next = Object.assign({}, current || blankTicketObject());
  let fullData = null;
  if(serverTicket && serverTicket.fullDataJson){
    try{ fullData=JSON.parse(serverTicket.fullDataJson); }catch(_e){}
  }
  const extra = parseBackupNote(serverTicket && serverTicket.backupNote);
  if(!fullData && extra.fullData) fullData=extra.fullData;
  if(fullData) Object.assign(next, fullData);
  const structuredMasterNote=fullData&&Object.prototype.hasOwnProperty.call(fullData,'masterNote');
  Object.assign(next, {
    id:String(serverTicket.id), date:serverTicket.date, time:serverTicket.time,
    content:serverTicket.content || '', sum:Number(serverTicket.sum)||0,
    tags:Array.isArray(serverTicket.tags) ? serverTicket.tags.slice() : [],
    geoLink:extra.geoLink || next.geoLink || '', masterNote:structuredMasterNote ? String(fullData.masterNote||'') : (extra.masterNote || ''),
    login:extra.login || next.login || '', password:extra.password || next.password || ''
  });
  return next;
}

async function readCurrentTicketConflict(id){
  const transport=syncEngine && syncEngine.transport;
  if(!transport || !transport.getEntityState || !transport.getTicket) throw new Error('TRANSPORT_UNAVAILABLE');
  const stateResponse=await transport.getEntityState('ticket',id);
  if(!stateResponse.ok || !stateResponse.result || !stateResponse.result.state) throw new Error(stateResponse.result?.code || 'STATE_READ_FAILED');
  const state=stateResponse.result.state;
  if(state.tombstone) return {state,ticket:null};
  const ticketResponse=await transport.getTicket(id);
  if(!ticketResponse.ok || !ticketResponse.result || !ticketResponse.result.ticket) throw new Error(ticketResponse.result?.code || 'TICKET_READ_FAILED');
  const confirmedStateResponse=await transport.getEntityState('ticket',id);
  if(!confirmedStateResponse.ok || !confirmedStateResponse.result || !confirmedStateResponse.result.state) throw new Error(confirmedStateResponse.result?.code || 'STATE_READ_FAILED');
  const confirmed=confirmedStateResponse.result.state;
  if(Number(confirmed.revision)!==Number(state.revision) || !!confirmed.tombstone!==!!state.tombstone || String(confirmed.fingerprint||'')!==String(state.fingerprint||'')) throw new Error('SERVER_CHANGED_RETRY');
  return {state,ticket:ticketResponse.result.ticket};
}

async function acceptServerTicketConflict(id){
  const current=tickets.find(t=>String(t.id)===String(id));
  if(!current || !getEntityConflict('ticket',id)) return;
  const remote=await readCurrentTicketConflict(id);
  if(remote.state.tombstone) tickets=tickets.filter(t=>String(t.id)!==String(id));
  else tickets[tickets.indexOf(current)]=ticketFromConflictServer(remote.ticket,current);
  const saved=((typeof ticketsStoreWritable!=='function')||ticketsStoreWritable())?await ticketsDbPut(tickets):false;
  if(!saved) throw new Error('LOCAL_WRITE_FAILED');
  syncTicketsSnapshot=JSON.parse(JSON.stringify(tickets));
  await syncEngine.acceptServerConflict('ticket',id,remote.state);
  closeModal(); renderTicketsScreen(); showToast('Прийнято серверну версію ✅');
}

async function keepLocalTicketConflict(id){
  const local=tickets.find(t=>String(t.id)===String(id));
  if(!local || !getEntityConflict('ticket',id)) return;
  const remote=await readCurrentTicketConflict(id);
  if(remote.state.tombstone) throw new Error('TOMBSTONED');
  await syncEngine.keepLocalConflict('ticket',id,remote.state,ticketToSyncPayload(local));
  closeModal(); renderTicketsScreen();
  showToast(isEntitySynced('ticket',id) ? 'Локальну версію збережено ✅' : 'Версію поставлено в чергу');
}

function showTicketConflictResolution(id){
  if(!getEntityConflict('ticket',id)) return;
  openModal('⚠️ Конфлікт заявки', `
    <div style="font-size:14px; line-height:1.5; margin-bottom:12px;">Цю заявку змінили на іншому пристрої. Оберіть версію — автоматично дані не перезаписуються.</div>
    <button type="button" class="btn btn-block" id="acceptServerConflictBtn">Прийняти версію з Таблиці</button>
    <button type="button" class="btn btn-accent btn-block" id="keepLocalConflictBtn" style="margin-top:8px;">Залишити цю локальну версію</button>`, {
    onOpen:()=>{
      const run=async(button,action)=>{button.disabled=true;try{await action();}catch(error){button.disabled=false;showToast(error.message==='TOMBSTONED'?'Заявку вже видалено на іншому пристрої — прийміть серверну версію':`Не вдалося вирішити конфлікт: ${error.message}`);}};
      const accept=document.getElementById('acceptServerConflictBtn');
      const keep=document.getElementById('keepLocalConflictBtn');
      accept.onclick=()=>run(accept,()=>acceptServerTicketConflict(id));
      keep.onclick=()=>run(keep,()=>keepLocalTicketConflict(id));
    }
  });
}

function renderMainTicketList(){
  const listEl = document.getElementById('ticketList');
  let list;
  const q = searchQuery.trim().toLowerCase();

  if(q){
    const qDigits = q.replace(/\D/g,''); // NEW: пошук за цифрами телефону — окремо від тексту нижче
    list = tickets.filter(t =>
      (t.content||'').toLowerCase().includes(q) ||
      (t.date||'').includes(q) ||
      (t.tags||[]).some(tag=>tag.toLowerCase().includes(q)) ||
      (t.city||'').toLowerCase().includes(q) ||
      (t.address||'').toLowerCase().includes(q) ||
      (t.clientName||'').toLowerCase().includes(q) ||
      ticketSignalMatchesQuery(t,q) ||
      // NEW: раніше пошук телефону тут не спрацьовував — t.content містить
      // номер УЖЕ ЗІ СКОБКАМИ/ДЕФІСАМИ ("(067)123-45-67"), а простий пошук
      // цифр ("067123") не збігається як підрядок такого форматованого
      // тексту. Порівнюємо цифри з цифрами, як і в навігаторі адрес.
      (qDigits.length>=3 && String(t.phone||'').replace(/\D/g,'').includes(qDigits)) ||
      (qDigits.length>=3 && (t.extraPhones||[]).some(p=>String(p||'').replace(/\D/g,'').includes(qDigits)))
    ).sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
    document.getElementById('modeSummaryText').textContent = `Знайдено: ${list.length} заявок`;
  } else if(activeFilterTags.size>0){
    list = tickets.filter(t => (t.tags||[]).some(tag=>activeFilterTags.has(tag)))
      .sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
    document.getElementById('modeSummaryText').textContent = `За тегами (${[...activeFilterTags].join(', ')}): ${list.length}`;
  } else {
    list = ticketsForDate(currentTicketDate);
  }

  if(list.length===0){
    renderEmptyTicketList(listEl);
    return;
  }

  // Якщо змінився пошук/фільтр/день — це новий список, скидаємо ліміт показу на 100.
  const signature = q + '|' + [...activeFilterTags].sort().join(',') + '|' + currentTicketDate;
  if(signature !== ticketListRenderSignature){
    ticketListRenderSignature = signature;
    ticketListRenderLimit = TICKET_LIST_PAGE_SIZE;
  }

  const visible = list.slice(0, ticketListRenderLimit);
  let html = visible.map(renderTicketCard).join('');
  if(list.length > visible.length){
    const remaining = list.length - visible.length;
    html += buildShowMoreTicketsButton(remaining);
  }
  listEl.innerHTML = html;
}

// NEW: 📷-бейдж на картці заявки тепер можна натиснути, щоб показати фото
// (підвантажується лише за тапом, як і фото абонента) та натиснути ще раз,
// щоб знову сховати. scopeEl — корінь пошуку елементів (щоб не сплутати з
// однаковим id тієї самої заявки, відрендереної одночасно і в модалці, і
// позаду на екрані).
// NEW: "👤 В профіль" на картці заявки — веде одразу до профілю абонента
// (навігатор адрес, той самий екран, де видно повну історію заявок за цією
// адресою) замість колишньої кнопки "На дату". В профілі кнопки самих
// заявок лишились із "На дату" — там вона й досі корисна.
function goToTicketProfile(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  const city = (t.city||'').trim(), street = (t.street||'').trim();
  if(!city || !street){ showToast('У цієї заявки немає структурованої адреси — профіль зібрати нема з чого'); return; }
  addrNavSearchQuery = '';
  addrNavState = {level:'tickets', city, street, house: (t.house||'').trim() || '(без номера)', apartment: ticketApartmentKey(t)};
  renderAddressNav();
}
function toggleTicketCardPhoto(btn, scopeEl){
  const root = scopeEl || document;
  const id = btn.dataset.id;
  const wrap = root.querySelector('[id="tcp-'+id+'"]');
  if(!wrap) return;
  if(!wrap.classList.contains('hidden')){
    wrap.classList.add('hidden');
    btn.textContent = btn.dataset.origLabel || '📷 Фото';
    return;
  }
  if(wrap.dataset.loaded === '1'){
    wrap.classList.remove('hidden');
    btn.textContent = '🔼 Сховати фото';
    return;
  }
  let keys = [];
  try{ keys = JSON.parse(btn.dataset.photoKeys || '[]'); }catch(err){ keys = []; }
  keys = keys.filter(Boolean);
  if(!keys.length) return;
  // NEW: раніше запасний Telegram file_id (на випадок відсутності локальної
  // копії фото) брався лише для ПЕРШОГО фото (data-tg-file-id, одиничне
  // поле) — для другого й третього завжди null, тож вони не могли
  // відновитись із Telegram. Тепер читаємо масив (data-tg-file-ids) — по
  // одному id на кожне фото, як і в профілі абонента.
  let fileIds = [];
  try{ fileIds = JSON.parse(btn.dataset.tgFileIds || '[]'); }catch(err){ fileIds = []; }
  btn.dataset.origLabel = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Завантаження…';
  // NEW: до 3 фото на заявку — вантажимо всі паралельно, кожне у своєму
  // мініатюрному блоці (тап по мініатюрі відкриває фото на весь екран)
  Promise.all(keys.map((key, i)=> resolvePhotoAsync(key, fileIds[i] || null))).then(values=>{
    btn.disabled = false;
    const loadedAny = values.some(Boolean);
    if(!loadedAny){ btn.textContent = '📷 Не вдалося завантажити'; return; }
    wrap.innerHTML = values.map((val,i)=> val ? `<img src="${val}" class="tc-photo-thumb" data-full="${val}" alt="фото ${i+1}" style="width:96px; height:96px; object-fit:cover; border-radius:10px; cursor:pointer;">` : '').join('');
    wrap.dataset.loaded = '1';
    wrap.classList.remove('hidden');
    btn.textContent = '🔼 Сховати фото';
  });
}
// NEW: тап по мініатюрі в розгорнутому списку фото заявки — показує це фото
// на весь екран (просте модальне вікно, без зайвих кнопок)
function openTicketPhotoFullscreen(src){
  openModal('Фото', `<img src="${src}" style="width:100%; border-radius:10px;">`, {});
}
async function deleteTicket(id){
  if(!await openConfirmModal({title:'Видалити цю заявку?',message:'Заявку буде прибрано зі списку та з Google-таблиці. Відновити її можна буде з кошика (Налаштування → Кошик).',confirmLabel:'Видалити',danger:true})) return false;
  const idx=tickets.findIndex(ticket=>String(ticket.id)===String(id));
  if(idx===-1)return false;
  const ticket=tickets[idx];
  // Commit the recovery metadata before changing the live list. If the basket
  // cannot be persisted, the active ticket and every photo reference stay put.
  const moved=await moveTicketToTrash(ticket);
  if(!moved.ok){
    showToast('Не вдалося безпечно зберегти заявку в кошику. Заявка та її фото не видалені.');
    return false;
  }
  tickets.splice(idx,1);
  const localSaved=await saveTickets();
  if(!localSaved){
    // Копія вже зафіксована в кошику: не видаємо помилку локального запису
    // за успішне видалення і не прибираємо жодних фото.
    showToast('Не вдалося надійно зберегти видалення. Заявка збережена в кошику разом із фото; не закривайте застосунок.');
    renderTicketsScreen();
    return false;
  }
  renderTicketsScreen();
  showToast('Заявку видалено — відновити можна в Налаштуваннях → Кошик');
  return true;
}

/* ---- Кошик видалених заявок ------------------------------------------------
   Кількість записів НЕ є приводом назавжди видалити 31-шу заявку чи її фото.
   Кожен запис зберігається 30 днів від свого deletedAt; після цього строку він
   і пов'язані локальні фото очищуються. Таке правило видно в інтерфейсі і не
   залежить від того, скільки заявок майстер видалив за день.

   Важливий порядок: спершу зберігаємо наступний стан кошика, і лише після
   підтвердженого запису прибираємо фізичні байти фото. Помилка localStorage
   або lock ніколи не є дозволом знищити фото. */
function deletedTicketExpiryMs(ticket){
  const deletedAt=Number(ticket&&ticket.deletedAt);
  if(!Number.isFinite(deletedAt)||deletedAt<=0)return null; // старі пошкоджені записи не стираємо навмання
  return deletedAt+DELETED_TICKET_RETENTION_DAYS*24*60*60*1000;
}
function ticketPhotoKeys(ticket){
  const photos=(ticket&&Array.isArray(ticket.photos)&&ticket.photos.length)?ticket.photos:(ticket&&ticket.photo?[ticket.photo]:[]);
  return [...new Set(photos.filter(key=>String(key||'').startsWith('idb:')))];
}
function referencedTicketPhotoKeys(records){
  const keys=new Set();
  (records||[]).forEach(ticket=>ticketPhotoKeys(ticket).forEach(key=>keys.add(key)));
  return keys;
}
async function deleteUnreferencedTicketPhotos(expiredTickets,retainedTrash){
  // A photo key can be shared by legacy records. Keep it while any live ticket
  // or retained trash item still refers to it.
  const liveRecords=(typeof tickets!=='undefined'&&Array.isArray(tickets)?tickets:[]).concat(retainedTrash||[]);
  const retainedKeys=referencedTicketPhotoKeys(liveRecords);
  const candidates=[...new Set((expiredTickets||[]).flatMap(ticketPhotoKeys))].filter(key=>!retainedKeys.has(key));
  const results=await Promise.all(candidates.map(async key=>{
    try{
      const deleted=await deletePhotoKey(key);
      return deleted===false?{key,ok:false}:{key,ok:true};
    }catch(error){
      globalThis.MTSafeError?.reportError?.(error,{scope:'trash-photo-cleanup'});
      return {key,ok:false};
    }
  }));
  const failedKeys=results.filter(result=>!result.ok).map(result=>result.key);
  return {ok:failedKeys.length===0,failedKeys};
}
async function deleteAllTicketPhotos(ticket,retainedTrash=deletedTickets){
  return deleteUnreferencedTicketPhotos([ticket],retainedTrash);
}
function splitExpiredDeletedTickets(now=Date.now()){
  const expired=[],retained=[];
  for(const ticket of deletedTickets){
    const expiry=deletedTicketExpiryMs(ticket);
    if(expiry!==null&&expiry<=now)expired.push(ticket);else retained.push(ticket);
  }
  return {expired,retained};
}
async function cleanupExpiredDeletedTickets(now=Date.now()){
  const {expired,retained}=splitExpiredDeletedTickets(now);
  if(!expired.length)return {ok:true,removed:0,cleanupFailed:false};
  // Durable metadata transition is the commit point. No photo deletion before it.
  if(!saveDeletedTickets(retained)){
    showToast('⚠️ Не вдалося зберегти очищення кошика. Фото не видалені; спробуємо пізніше.');
    return {ok:false,removed:0,cleanupFailed:false};
  }
  deletedTickets=retained;
  const cleanup=await deleteUnreferencedTicketPhotos(expired,retained);
  if(!cleanup.ok)showToast('⚠️ Кошик очищено, але частину старих фото не вдалося прибрати. Фото збережені на пристрої.');
  return {ok:true,removed:expired.length,cleanupFailed:!cleanup.ok};
}
async function moveTicketToTrash(ticket){
  const copy=JSON.parse(JSON.stringify(ticket));
  copy.deletedAt=Date.now();
  const {expired,retained}=splitExpiredDeletedTickets(copy.deletedAt);
  const next=[copy,...retained];
  if(!saveDeletedTickets(next))return {ok:false,copy:null,cleanupFailed:false};
  deletedTickets=next;
  const cleanup=await deleteUnreferencedTicketPhotos(expired,next);
  if(!cleanup.ok)showToast('⚠️ Заявку збережено в кошику, але частину прострочених фото не вдалося прибрати. Фото лишились на пристрої.');
  return {ok:true,copy,cleanupFailed:!cleanup.ok};
}

function saveDeletedTickets(nextTickets=deletedTickets){
  if(typeof MTSingleWriterLock!=='undefined'&&!MTSingleWriterLock.warn())return false;
  try{localStorage.setItem('deletedTickets',JSON.stringify(nextTickets));return true;}
  catch(error){
    globalThis.MTSafeError?.reportError?.(error,{scope:'deleted-tickets-persist'});
    if(typeof showToast==='function')showToast('⚠️ Не вдалося зберегти кошик. Не закривайте застосунок і звільніть місце.');
    return false;
  }
}

/* Ідемпотентний restore (fix v91.30, MEDIUM). Маркер зв'язку «запис кошика ↔
   відновлена жива заявка» зберігається НА САМІЙ заявці (restoredFromDeletedAt)
   тим самим durable-збереженням, що й вона, тому не може відстати від неї.
   Якщо попередній restore durably зберіг живу заявку, але не встиг прибрати
   запис кошика (збій сховища, reload), повторний restore того самого запису
   НЕ створює другий UUID, а лише повторює безпечне очищення кошика. Маркер —
   optional: старі записи v91.29 і старі живі заявки без нього працюють як
   раніше; в sync payload (ticketToSyncPayload) він не входить. Подвійний тап
   / паралельні виклики на той самий запис ігноруємо до завершення першої
   операції. */
const MT_RESTORE_IN_FLIGHT=new Set();
async function restoreDeletedTicket(deletedAt){
  const restoreKey=String(deletedAt);
  if(MT_RESTORE_IN_FLIGHT.has(restoreKey))return false;
  MT_RESTORE_IN_FLIGHT.add(restoreKey);
  try{
    const index=deletedTickets.findIndex(ticket=>String(ticket.deletedAt)===String(deletedAt));
    if(index===-1)return false;
    const source=deletedTickets[index];
    // Повторний restore після збійного cleanup: жива заявка з цим маркером
    // уже існує — використовуємо її, новий UUID не створюємо.
    const pending=tickets.find(ticket=>ticket&&ticket.restoredFromDeletedAt!=null&&String(ticket.restoredFromDeletedAt)===restoreKey);
    let restored;
    if(pending){
      restored=pending;
    }else{
      restored=JSON.parse(JSON.stringify(source));
      delete restored.deletedAt;
      // Tombstone старого ID необоротний: restore завжди є новим create.
      restored.id=MTSyncEngineRuntime.uuid();
      delete restored.synced;
      delete restored.syncAction;
      delete restored.pendingCloudDelete;
      restored.restoredFromDeletedAt=source.deletedAt;
      // First make the restored record durable. A failure leaves the basket entry
      // untouched, so its photos and a complete recovery path remain available.
      tickets.push(restored);
      if(!await saveTickets()){
        tickets.pop();
        showToast('Не вдалося надійно відновити заявку. Запис і фото лишились у кошику.');
        return false;
      }
    }
    const next=deletedTickets.filter((_,itemIndex)=>itemIndex!==index);
    if(!saveDeletedTickets(next)){
      // Жива заявка durably збережена (маркер усередині неї), запис кошика
      // лишається: повторний «Відновити» безпечно повторить лише cleanup.
      showToast(pending
        ?'⚠️ Цю заявку вже відновлено, але запис у кошику не вдалося оновити. Натисніть «Відновити» ще раз — дубліката не буде.'
        :'⚠️ Заявку відновлено у списку, але запис у кошику не вдалося оновити. Натисніть «Відновити» ще раз — дубліката не буде.');
      renderTicketsScreen();
      return false;
    }
    deletedTickets=next;
    currentTicketDate=restored.date||currentTicketDate;
    renderTicketsScreen();
    renderDeletedTicketsList();
    showToast(pending?'Заявку вже було відновлено раніше — повторне відновлення не створило дублікат':'Заявку відновлено');
    return true;
  }finally{
    MT_RESTORE_IN_FLIGHT.delete(restoreKey);
  }
}

async function purgeDeletedTicket(deletedAt){
  const index=deletedTickets.findIndex(ticket=>String(ticket.deletedAt)===String(deletedAt));
  if(index===-1)return false;
  if(!await openConfirmModal({title:'Видалити заявку з кошика остаточно?',message:'Відновити після цього буде неможливо; фото цієї заявки також буде видалено з пристрою.',confirmLabel:'Видалити назавжди',danger:true}))return false;
  const ticket=deletedTickets[index];
  const next=deletedTickets.filter((_,itemIndex)=>itemIndex!==index);
  if(!saveDeletedTickets(next)){
    showToast('Не вдалося зберегти кошик. Фото не видалені, заявку можна відновити.');
    return false;
  }
  deletedTickets=next;
  const cleanup=await deleteAllTicketPhotos(ticket,next);
  if(!cleanup.ok)showToast('⚠️ Запис прибрано з кошика, але фото не вдалося видалити. Воно лишилось на пристрої.');
  renderDeletedTicketsList();
  return cleanup.ok;
}

function renderDeletedTicketsList(){
  const wrap = document.getElementById('deletedTicketsList');
  if(!wrap) return;
  if(deletedTickets.length===0){
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:13px;">Кошик порожній</div>`;
    return;
  }
  wrap.innerHTML = deletedTickets.map(t=>{
    const d = new Date(t.deletedAt);
    const sub = [t.clientName, [t.city, t.address].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    return `<div class="settings-row" style="align-items:flex-start; gap:8px;">
      <div style="min-width:0; flex:1;">
        <div class="sr-title">${escapeHtml(t.date||'')} ${escapeHtml(t.time||'')} — ${escapeHtml(t.type||'')}</div>
        <div style="font-size:12px; color:var(--text-dim); overflow-wrap:anywhere;">${escapeHtml(sub)}${t.sum?(' · '+fmtMoney(t.sum)):''}</div>
        <div style="font-size:12px; color:var(--text-faint);">Видалено: ${formatDate(d)} ${formatTime(d)}</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
        <button type="button" class="btn btn-sm restore-trash-btn" data-deleted-at="${t.deletedAt}">↩️ Відновити</button>
        <button type="button" class="btn btn-icon btn-sm btn-ghost purge-trash-btn" data-deleted-at="${t.deletedAt}">✕</button>
      </div>
    </div>`;
  }).join('');
}

function leaveTicketEditorGuard(){
  syncFormToState();
  const message=editingTicketId?'Скасувати редагування? Незбережені зміни буде втрачено.':'Повернутись назад? Введені у заявку дані буде втрачено.';
  if(hasUnsavedChanges()&&!confirm(message))return false;
  cleanupUnsavedNewPhotos();clearDraft();resetCalcForm(currentTicketDate);return true;
}
function openTicketEditorFromList(id){
  const listState={date:currentTicketDate,query:searchQuery,tags:[...activeFilterTags],limit:ticketListRenderLimit,scrollTop:document.querySelector('main.screens')?.scrollTop||0};
  appNavigationPush('ticket-editor',state=>{
    currentTicketDate=state.date;searchQuery=state.query||'';activeFilterTags=new Set(state.tags||[]);ticketListRenderLimit=Number(state.limit)||100;
    switchTab('tickets');renderTicketsScreen();
    const input=document.getElementById('searchInput');if(input)input.value=searchQuery;
    requestAnimationFrame(()=>{const scroller=document.querySelector('main.screens');if(scroller)scroller.scrollTop=Number(state.scrollTop)||0;});
  },listState,leaveTicketEditorGuard);
  editReturnAddrState=null;editTicket(id);
}
function editTicket(id){
  const t = tickets.find(x=>String(x.id)===String(id)); // NEW
  if(!t) return;
  loadTicketIntoForm(t);
  switchTab('calculator');
}

async function retrySyncTicket(id){
  const t = tickets.find(x=>String(x.id)===String(id)); // NEW
  if(!t) return;
  if(!getScriptUrl()){ showToast('Синхронізація не налаштована'); return; }
  if(!syncEngine){ showToast('Синхронізація тимчасово недоступна — зміни збережено локально'); return; }
  showToast('Повторна спроба надсилання...');
  const ok = await syncEngine.flush();
  renderTicketsScreen();
  showToast(ok ? 'Надіслано' : 'Не вдалося — перевірте інтернет-з’єднання');
}

async function copyTicketCardText(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return; // NEW
  try{ await navigator.clipboard.writeText(t.content); showToast('Текст заявки скопійовано'); }
  catch(e){
    const ta = document.createElement('textarea');
    ta.value = t.content; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); showToast('Текст заявки скопійовано'); }
    catch(e2){ showToast('Не вдалося скопіювати текст'); }
    ta.remove();
  }
}

/* ---- "Знайти в Telegram" — відкриває саме повідомлення цієї заявки в групі ----
   Працює за прямим посиланням виду https://t.me/c/<internal_id>/<message_id>,
   де internal_id — це chat_id групи без префіксу "-100" (Telegram так формує
   посилання на приватні супергрупи/канали). Спрацьовує лише для тих, хто вже
   є учасником групи — саме тому доступно тільки вам, а не будь-кому з посиланням. */
/* ---- Календар ---- */
const MONTH_NAMES = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const DOW_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
function renderCalendar(){
  document.getElementById('calMonthLabel').textContent = `${MONTH_NAMES[calendarViewDate.getMonth()]} ${calendarViewDate.getFullYear()}`;
  const grid = document.getElementById('calGrid');
  const year = calendarViewDate.getFullYear(), month = calendarViewDate.getMonth();
  const todayStr = formatDate(new Date());
  grid.innerHTML = buildCalendarGridHtml({year, month, tickets, selectedDate:currentTicketDate, todayStr, formatDateValue:formatDate});
}

/* Календар для екрана «Зміни» — той же принцип, що й у «Заявках»:
   крапка під днем означає, що в цей день була зміна, клік переносить
   на цей день у щоденній навігації, а заголовок показує загальні
   години за цей день (якщо змін кілька — суму). */

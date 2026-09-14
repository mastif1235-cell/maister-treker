/* ---- Адаптер збереження масиву заявок і legacy-міграція ---- */
const PENDING_TICKETS_FALLBACK_KEY = 'pendingTicketsFallback';
let pendingTicketsFallbackWarningShown = false;

function loadPendingTicketsFallback(){
  try{
    const fallback = JSON.parse(localStorage.getItem(PENDING_TICKETS_FALLBACK_KEY));
    return Array.isArray(fallback) ? fallback : null;
  }catch(e){ return null; }
}
function showPendingTicketsFallbackWarning(message){
  if(pendingTicketsFallbackWarningShown) return;
  pendingTicketsFallbackWarningShown = true;
  showToast(message);
}
function savePendingTicketsFallback(){
  try{
    localStorage.setItem(PENDING_TICKETS_FALLBACK_KEY, JSON.stringify(tickets));
    showPendingTicketsFallbackWarning('⚠️ Локальна база не записалася в IndexedDB. Дані тимчасово збережено в аварійній копії.');
    return true;
  }catch(e){
    showPendingTicketsFallbackWarning('⚠️ Локальна база не записалася в IndexedDB, а аварійну копію теж не вдалося зберегти. Не закривайте застосунок.');
    return false;
  }
}

async function loadTicketsFromIdb(){
  /* Чітко розрізняємо: дані прочитано / запису немає / сталась помилка читання.
     При помилці — жодного запису в сховище (навіть "міграційного" []),
     існуючий в пам'яті стан не руйнується, користувач бачить пояснення.
     Це закриває знайдену аудитом стежку: відкрита БД + помилка get() →
     прийняття помилки за порожню базу → ticketsDbPut([]) → втрата всієї бази. */
  const read = (typeof ticketsDbRead==='function')
    ? await ticketsDbRead()
    : {status:'ok', value:(typeof ticketsDbGet==='function' ? await ticketsDbGet() : undefined)};
  if(read && read.status==='error'){
    ticketsStorageDegraded = true;
    globalThis.MTSafeError?.reportError?.(new Error(read.message||'TICKETS_DB_READ_FAILED'),{scope:'tickets-idb-read',userMessage:'Не вдалося прочитати локальну базу заявок.'});
    showPendingTicketsFallbackWarning('⚠️ Не вдалося прочитати локальну базу заявок. Дані НЕ перезаписувались. Перезавантажте застосунок; доки читання недоступне, зміни йтимуть в аварійну копію.');
    return;
  }
  const stored = read && read.status==='ok' ? read.value : undefined;
  const pendingFallback = loadPendingTicketsFallback();
  const hasPendingFallbackTickets = Array.isArray(pendingFallback) && pendingFallback.length > 0;
  if(Array.isArray(stored) && stored.length > 0){
    tickets = stored;
    if(hasPendingFallbackTickets) showPendingTicketsFallbackWarning('⚠️ Є аварійна копія заявок, але основна база також містить дані. Автоматичне відновлення не виконано, щоб не перезаписати новіші зміни.');
    return;
  }
  if(Array.isArray(stored) && hasPendingFallbackTickets){
    tickets = pendingFallback;
    if(await ticketsDbPut(tickets)){
      localStorage.removeItem(PENDING_TICKETS_FALLBACK_KEY);
      pendingTicketsFallbackWarningShown = false;
    }else{
      showPendingTicketsFallbackWarning('⚠️ Не вдалося відновити аварійну копію в IndexedDB. Дані лишаються в пам’яті — не закривайте застосунок.');
    }
    return;
  }
  const legacy = loadJSON('tickets', []);
  // Не порівнюємо legacy і fallback автоматично: заявки не мають надійної
  // позначки часу останнього редагування. Старий сценарій міграції лишається
  // пріоритетним, а аварійна копія зберігається для ручного розбору конфлікту.
  if(hasPendingFallbackTickets && Array.isArray(legacy) && legacy.length){
    tickets = legacy;
    if(await ticketsDbPut(tickets)) localStorage.removeItem('tickets');
    showPendingTicketsFallbackWarning('⚠️ Є аварійна копія і legacy-база заявок. Автоматичне об’єднання не виконано, щоб не втратити новіші зміни.');
    return;
  }
  if(hasPendingFallbackTickets){
    tickets = pendingFallback;
    if(await ticketsDbPut(tickets)){
      localStorage.removeItem(PENDING_TICKETS_FALLBACK_KEY);
      pendingTicketsFallbackWarningShown = false;
    }else{
      showPendingTicketsFallbackWarning('⚠️ Не вдалося відновити аварійну копію в IndexedDB. Дані лишаються в пам’яті — не закривайте застосунок.');
    }
    return;
  }
  tickets = Array.isArray(legacy) ? legacy : [];
  // Legacy-копію можна прибрати лише після підтвердженого запису в IndexedDB.
  // Якщо сховище недоступне або заповнене, вона лишається страховкою на
  // наступний запуск замість безповоротної втрати всієї старої бази.
  if(await ticketsDbPut(tickets)){
    // Пошкоджений (нерозбірний) legacy-ключ не видаляємо: це останній шматок
    // даних, і його слід залишити для ручного відновлення, а не знищувати
    // «успішною міграцією» порожнього стану.
    let legacyReadable=true;
    try{ const raw=localStorage.getItem('tickets'); if(raw!=null) JSON.parse(raw); }
    catch(parseError){ legacyReadable=false; }
    if(legacyReadable) localStorage.removeItem('tickets');
    else showPendingTicketsFallbackWarning('⚠️ Знайдено пошкоджений legacy-запис «tickets» (не розбирається як JSON). Його збережено для ручного відновлення; поточний стан — з основної бази.');
  }
}
function saveTickets(){
  /* Гарантія контракту: saveTickets() викликають без await (~12 місць), тому
     він ніколи не кидає синхронно і ніколи не повертає відхилений проміс.
     Синхронний збій (наприклад, MTSingleWriterLock у приватному режимі) іде
     тим самим шляхом: аварійна копія + false. */
  try{
  if(typeof MTSingleWriterLock!=='undefined'&&!MTSingleWriterLock.warn()) return Promise.resolve(false);
  ticketsRevision++;
  const before=syncTicketsSnapshot;
  const after=JSON.parse(JSON.stringify(tickets));
  const journalPersist=syncEngine ? syncEngine.recordDiff('ticket',before,after) : Promise.resolve();
  // Журнал не записався: локальні дані все одно зберігаємо, але знімок
  // синхронізації НЕ рухаємо — інакше різниця загубилась би назавжди.
  // Семантика ідентична saveShifts(); наступний diff повторно покладе ці ж
  // зміни в журнал, а ядро синхронізації дедуплікує за entity/id.
  // Обидва обробники в одному .then — щоб не зсувати глибину ланцюжка
  // (таймінг «журнал → потім IndexedDB» закріплено регресійним тестом).
  return journalPersist.then(()=>{
    syncTicketsSnapshot=after;
    return ticketsStorePersistSafely();
  },error=>{
    try{ globalThis.MTSafeError?.reportError?.(error,{scope:'tickets-journal'}); }catch(_reportError){}
    return ticketsStorePersistSafely();
  }).then(ok=>{
    if(!ok) return savePendingTicketsFallback();
    localStorage.removeItem(PENDING_TICKETS_FALLBACK_KEY);
    pendingTicketsFallbackWarningShown = false;
    return true;
  }).catch(error=>{
    // saveTickets викликають ~12 місцями як fire-and-forget. будь-який
    // неочікуваний збій (наприклад, localStorage.removeItem у приватному
    // режимі) має лишатись усередині: дані в аварійну копію, false — викликану
    // стороні, необроблених реєкцій по сторінці більше немає.
    globalThis.MTSafeError?.reportError?.(error,{scope:'tickets-save'});
    try{ savePendingTicketsFallback(); }catch(_fallbackError){}
    return false;
  });
  }catch(syncError){
    try{ globalThis.MTSafeError?.reportError?.(syncError,{scope:'tickets-save-sync'}); }catch(_reportError){}
    try{ savePendingTicketsFallback(); }catch(_fallbackError){}
    return Promise.resolve(false);
  }
}
function saveTicketsLocalOnly(){
  try{
  if(typeof MTSingleWriterLock!=='undefined'&&!MTSingleWriterLock.warn()) return Promise.resolve(false);
  const persist=ticketsStorePersistSafely();
  return persist.then(ok=>{
    if(!ok) return savePendingTicketsFallback();
    localStorage.removeItem(PENDING_TICKETS_FALLBACK_KEY);
    pendingTicketsFallbackWarningShown = false;
    return true;
  }).catch(error=>{
    // Та сама гарантія «без необроблених реєкцій», що й у saveTickets().
    globalThis.MTSafeError?.reportError?.(error,{scope:'tickets-save-local'});
    try{ savePendingTicketsFallback(); }catch(_fallbackError){}
    return false;
  });
  }catch(syncError){
    try{ globalThis.MTSafeError?.reportError?.(syncError,{scope:'tickets-save-local-sync'}); }catch(_reportError){}
    try{ savePendingTicketsFallback(); }catch(_fallbackError){}
    return Promise.resolve(false);
  }
}
/* Єдиний безпечний шлях повного перезапису бази заявок. Якщо останнє читання
   падало (degraded), спершу намагаємось перечитати сховище й об'єднати зміни;
   лише підтверджене читання відкриває запис. Інакше — аварійна копія. */
function ticketsStorePersistSafely(){
  const gateAvailable=(typeof isTicketsStorageDegraded==='function' && typeof ticketsStorageRecoverRead==='function');
  if(!gateAvailable || !isTicketsStorageDegraded()) return ticketsDbPut(tickets);
  // false → викликнач обробить це як звичайну невдачу запису: збереже аварійну
  // копію НЕ тут, а у своєму `.then(ok)`, і не видалить її тим самим одразу.
  return ticketsStorageRecoverRead().then(recovered=> recovered ? ticketsDbPut(tickets) : Promise.resolve(false));
}

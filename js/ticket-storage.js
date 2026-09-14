/* ---- Низькорівневий доступ до IndexedDB заявок ---- */
const TICKETS_DB_NAME = 'masterTrackerTickets';
const TICKETS_STORE = 'tickets';
const TICKETS_KEY = 'all';
let ticketsDb = null;

/* Стан «читання не вдалося»: поки він активний, будь-який перезапис сховища
   блокується — інакше помилкове [] у пам'яті затерло б реальні дані
   (сценарій, який знайшов аудит: відкрита БД + помилка get()). */
let ticketsStorageDegraded = false;
function isTicketsStorageDegraded(){ return ticketsStorageDegraded; }
/* Повторне читання під час запису: якщо воно тепер успішне, підлучуємо
   прочитані з сховища заявки до пам'яті (пам'ять має пріоритет за id) і
   додаємо їх у sync-базлайн, щоб журнальний diff не вважа їх новими. */
function ticketsStorageRecoverRead(){
  if(!ticketsStorageDegraded) return Promise.resolve(true);
  if(typeof ticketsDbRead!=='function') return Promise.resolve(true);
  return ticketsDbRead().then((read)=>{
    if(!read || read.status==='error') return false;
    const stored = Array.isArray(read.value) ? read.value : [];
    if(read.status==='ok' && stored.length){
      const memoryIds = new Set(tickets.map(t=>String(t&&t.id)));
      for(const item of stored){ if(!memoryIds.has(String(item&&item.id))) tickets.push(item); }
      const knownIds = new Set((syncTicketsSnapshot||[]).map(t=>String(t&&t.id)));
      for(const item of stored){ if(!knownIds.has(String(item&&item.id))) syncTicketsSnapshot.push(JSON.parse(JSON.stringify(item))); }
    }
    ticketsStorageDegraded = false;
    return true;
  }).catch(()=> false);
}
/* Єдині ворота для всіх, хто пише весь масив заявок: під час деградації
   даємо шанс на відновлення, але не пишемо, поки не впевнились. */
function ticketsStoreWritable(){
  if(!ticketsStorageDegraded) return true;
  void ticketsStorageRecoverRead();
  return false;
}

function openTicketsDb(){
  return new Promise((resolve)=>{
    if(!window.indexedDB){ resolve(null); return; }
    const req = indexedDB.open(TICKETS_DB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(TICKETS_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=>{ console.error('IndexedDB заявок: помилка відкриття', req.error); resolve(null); };
  });
}

/* ---- Контракт читання бази заявок ----
   Помилка читання НЕ повинна виглядати як «порожня база». Історія: `ticketsDbGet()`
   резолвив `undefined` і в разі помилки транзакції, через що `loadTicketsFromIdb()`
   приймав збій за відсутність даних і міг перезаписати сховище порожнім масивом.
   Нижче — розділені стани:
     {status:'ok',      value}  — читання успішне (value може бути undefined: ключа немає);
     {status:'missing', value:undefined} — бази немає взагалі (відкриття не вдалось) —
        запис усе одно буде no-op, мігрувати з legacy можна;
     {status:'error'}   — читання впало (одна повторна спроба теж впала) — ЗАБОРОНЕНО
        будь-які перезаписувальні операції, доки стан не з'ясовано. */
function ticketsDbReadOnce(){
  return new Promise((resolve)=>{
    if(!ticketsDb){ resolve({status:'missing', value:undefined}); return; }
    let settled=false;
    const done=(result)=>{ if(settled) return; settled=true; resolve(result); };
    try{
      const tx = ticketsDb.transaction(TICKETS_STORE, 'readonly');
      const req = tx.objectStore(TICKETS_STORE).get(TICKETS_KEY);
      req.onsuccess = ()=> done({status:'ok', value:req.result});
      req.onerror = ()=>{ console.error('IndexedDB заявок: помилка читання', req.error); done({status:'error', message:'GET_FAILED'}); };
      tx.onerror = ()=>{ console.error('IndexedDB заявок: помилка транзакції читання', tx.error); done({status:'error', message:'TX_FAILED'}); };
      tx.onabort = ()=> done({status:'error', message:'TX_ABORTED'});
    }catch(e){ console.error('IndexedDB заявок: читання викинуло виняток', e); done({status:'error', message:'TX_THROW'}); }
  });
}
function ticketsDbRead(){
  return ticketsDbReadOnce().then((result)=>{
    if(result && result.status==='error'){
      // одноразовий повтор ловить короткі транзакційні збої (навантаження/конкурентна транзакція)
      return ticketsDbReadOnce().then((retry)=> (retry && retry.status!=='error') ? retry : result);
    }
    return result;
  });
}
/* Легасі-контракт: лише значення або undefined. Залишений сумісності ради;
   новий код читання має використовувати ticketsDbRead(). */
function ticketsDbGet(){
  return ticketsDbRead().then((result)=> result && result.status==='ok' ? result.value : undefined);
}
function ticketsDbPut(value){
  return new Promise((resolve)=>{
    if(!ticketsDb){ resolve(false); return; }
    try{
      const tx = ticketsDb.transaction(TICKETS_STORE, 'readwrite');
      tx.objectStore(TICKETS_STORE).put(value, TICKETS_KEY);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=>{ console.error('IndexedDB заявок: помилка запису', tx.error); resolve(false); };
    }catch(e){ console.error(e); resolve(false); }
  });
}

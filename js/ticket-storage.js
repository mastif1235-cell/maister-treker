/* ---- Низькорівневий доступ до IndexedDB заявок ---- */
const TICKETS_DB_NAME = 'masterTrackerTickets';
const TICKETS_STORE = 'tickets';
const TICKETS_KEY = 'all';
let ticketsDb = null;

function openTicketsDb(){
  return new Promise((resolve)=>{
    if(!window.indexedDB){ resolve(null); return; }
    const req = indexedDB.open(TICKETS_DB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(TICKETS_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=>{ console.error('IndexedDB заявок: помилка відкриття', req.error); resolve(null); };
  });
}
function ticketsDbGet(){
  return new Promise((resolve)=>{
    if(!ticketsDb){ resolve(undefined); return; }
    try{
      const tx = ticketsDb.transaction(TICKETS_STORE, 'readonly');
      const req = tx.objectStore(TICKETS_STORE).get(TICKETS_KEY);
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=>{ console.error('IndexedDB заявок: помилка читання', req.error); resolve(undefined); };
    }catch(e){ console.error(e); resolve(undefined); }
  });
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

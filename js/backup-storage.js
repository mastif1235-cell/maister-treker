/* ---- Низькорівневий доступ до IndexedDB щоденних бекапів ---- */
const BACKUP_DB_NAME = 'masterTrackerBackups';
const BACKUP_STORE = 'daily';
let backupDb = null;

function openBackupDb(){
  return new Promise((resolve)=>{
    if(!window.indexedDB){ resolve(null); return; }
    const req = indexedDB.open(BACKUP_DB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(BACKUP_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=>{ console.error('IndexedDB бекапів: помилка відкриття', req.error); resolve(null); };
  });
}
function backupDbPut(key, value){
  return new Promise((resolve)=>{
    if(!backupDb){ resolve(false); return; }
    try{
      const tx = backupDb.transaction(BACKUP_STORE, 'readwrite');
      tx.objectStore(BACKUP_STORE).put(value, key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> resolve(false);
    }catch(e){ resolve(false); }
  });
}
function backupDbGet(key){
  return new Promise((resolve)=>{
    if(!backupDb){ resolve(null); return; }
    try{
      const tx = backupDb.transaction(BACKUP_STORE, 'readonly');
      const req = tx.objectStore(BACKUP_STORE).get(key);
      req.onsuccess = ()=> resolve(req.result || null);
      req.onerror = ()=> resolve(null);
    }catch(e){ resolve(null); }
  });
}
function backupDbDelete(key){
  return new Promise((resolve)=>{
    if(!backupDb){ resolve(false); return; }
    try{
      const tx = backupDb.transaction(BACKUP_STORE, 'readwrite');
      tx.objectStore(BACKUP_STORE).delete(key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> resolve(false);
    }catch(e){ resolve(false); }
  });
}

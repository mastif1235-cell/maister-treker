/* ---- Низькорівневий доступ до IndexedDB фото та пам'ятковий кеш ---- */
const PHOTO_DB_NAME = 'masterTrackerPhotos';
const PHOTO_STORE = 'photos';
let photoDb = null;
const photoCache = new Map();
const PHOTO_CACHE_MAX = 40;

function photoCacheSet(key, value){
  if(photoCache.has(key)) photoCache.delete(key);
  photoCache.set(key, value);
  while(photoCache.size > PHOTO_CACHE_MAX){
    const oldestKey = photoCache.keys().next().value;
    photoCache.delete(oldestKey);
  }
}

function openPhotoDb(){
  return new Promise((resolve)=>{
    if(!window.indexedDB){ resolve(null); return; }
    const req = indexedDB.open(PHOTO_DB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(PHOTO_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=>{ console.error('IndexedDB помилка відкриття', req.error); resolve(null); };
  });
}
function photoDbPut(key, dataUrl){
  return new Promise((resolve)=>{
    if(!photoDb){ resolve(false); return; }
    try{
      const tx = photoDb.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).put(dataUrl, key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=>{ console.error('IndexedDB помилка запису', tx.error); resolve(false); };
    }catch(e){ console.error(e); resolve(false); }
  });
}
function photoDbDelete(key){
  return new Promise((resolve)=>{
    if(!photoDb){ resolve(false); return; }
    try{
      const tx = photoDb.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).delete(key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> resolve(false);
    }catch(e){ resolve(false); }
  });
}
function photoDbGet(key){
  return new Promise((resolve)=>{
    if(!photoDb){ resolve(null); return; }
    try{
      const tx = photoDb.transaction(PHOTO_STORE, 'readonly');
      const req = tx.objectStore(PHOTO_STORE).get(key);
      req.onsuccess = ()=> resolve(req.result || null);
      req.onerror = ()=> resolve(null);
    }catch(e){ resolve(null); }
  });
}

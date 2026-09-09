/* ---- Нейтральні операції localStorage для локального стану ---- */
function loadJSON(key, fallback){
  return MTStorageRegistry.safeJsonGet(localStorage,key,fallback,value=>value!==null&&value!==undefined);
}

function loadDailyBackupIndex(){
  return MTStorageRegistry.safeJsonGet(localStorage,MTStorageRegistry.key('dailyBackupIndex'),[],Array.isArray);
}
function saveDailyBackupIndex(index){
  try{ localStorage.setItem(MTStorageRegistry.key('dailyBackupIndex'), JSON.stringify(index)); }catch(e){ /* сховище повне — не критично */ }
}

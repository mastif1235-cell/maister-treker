/* ---- Нейтральні операції localStorage для локального стану ---- */
function loadJSON(key, fallback){
  return MTStorageRegistry.safeJsonGet(localStorage,key,fallback,value=>value!==null&&value!==undefined);
}

/* ---- Аварійна копія змін ----
   Запис змін у localStorage може впасти (переповнена квота, заблоковане
   сховище, приватний режим). У такому разі storage-orchestration кладе копію
   в окремий ключ, а цей завантажувач підхоплює її на наступному старті —
   щоб зміна не зникла безслідно. Основне сховище має пріоритет. */
const PENDING_SHIFTS_FALLBACK_KEY = 'pendingShiftsFallback';
let mtShiftsFallbackAdopted = false;

function loadShiftsWithFallback(){
  const stored = MTStorageRegistry.safeJsonGet(localStorage,'shifts',null,Array.isArray);
  let pending = null;
  try{
    const raw = localStorage.getItem(PENDING_SHIFTS_FALLBACK_KEY);
    const parsed = raw === null ? null : JSON.parse(raw);
    if(Array.isArray(parsed) && parsed.length) pending = parsed;
  }catch(_error){ pending = null; }
  if(Array.isArray(stored) && stored.length) return stored;
  if(pending){ mtShiftsFallbackAdopted = true; return pending; }
  return Array.isArray(stored) ? stored : [];
}

// Одноразове повідомлення користувачу (показується вже після init, коли DOM готовий).
function mtConsumeShiftsFallbackNotice(){
  if(!mtShiftsFallbackAdopted) return false;
  mtShiftsFallbackAdopted = false;
  return true;
}

function loadDailyBackupIndex(){
  return MTStorageRegistry.safeJsonGet(localStorage,MTStorageRegistry.key('dailyBackupIndex'),[],Array.isArray);
}
function saveDailyBackupIndex(index){
  try{ localStorage.setItem(MTStorageRegistry.key('dailyBackupIndex'), JSON.stringify(index)); }catch(e){ /* сховище повне — не критично */ }
}

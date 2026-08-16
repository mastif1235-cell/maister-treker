/* ---- Нейтральні операції localStorage для локального стану ---- */
function loadJSON(key, fallback){
  try{ const v = JSON.parse(localStorage.getItem(key)); return (v===null||v===undefined) ? fallback : v; }
  catch(e){ return fallback; }
}

function loadDailyBackupIndex(){
  try{ return JSON.parse(localStorage.getItem('dailyBackupIndex')) || []; }catch(e){ return []; }
}
function saveDailyBackupIndex(index){
  try{ localStorage.setItem('dailyBackupIndex', JSON.stringify(index)); }catch(e){ /* сховище повне — не критично */ }
}

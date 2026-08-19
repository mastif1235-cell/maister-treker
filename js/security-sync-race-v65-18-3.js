/* Майстер-Трекер — security.18.3 sync ordering / delete-wins hardening
   Причина патчу: фоновий add/update та ручне delete могли летіти паралельно.
   Якщо delete завершувався раніше за старий add/update, стара операція могла
   знову створити рядок у Google. Також retryQueue раніше обробляв add/update
   ПЕРЕД pending delete.

   Правила security.18.3:
   1) усі ticket mutation одного id виконуються послідовно;
   2) pending delete у retry має пріоритет;
   3) add/update перед відправкою повторно перевіряє, що заявка досі існує
      локально і для цього id немає tombstone pendingCloudDelete;
   4) результат старої in-flight операції не може "оживити" вже видалену
      локально заявку.
*/

const SECURITY_SYNC_RACE_RELEASE_LABEL = 'v65.0-security.18.3 · 2026-08-19';

/* ---------- 1. Серіалізація хмарних mutation за ticket id ---------- */
const securitySyncMutationChains = new Map();
const securitySyncPreviousPostToUrl = postToUrl;

function securitySyncIsTicketMutation(action, payload){
  return ['addTicket','updateTicket','deleteTicket'].includes(String(action||'')) &&
    payload && payload.id !== undefined && payload.id !== null && String(payload.id) !== '';
}

postToUrl = function(url, action, payload){
  if(!securitySyncIsTicketMutation(action,payload)){
    return securitySyncPreviousPostToUrl(url,action,payload);
  }

  const key = String(payload.id);
  const prev = securitySyncMutationChains.get(key) || Promise.resolve();
  const job = prev
    .catch(()=>false)
    .then(()=>securitySyncPreviousPostToUrl(url,action,payload));

  const tracked = job.finally(()=>{
    if(securitySyncMutationChains.get(key) === tracked){
      securitySyncMutationChains.delete(key);
    }
  });
  securitySyncMutationChains.set(key,tracked);
  return tracked;
};

/* ---------- 2. Delete завжди перемагає stale add/update у retry ---------- */
function securitySyncHasPendingDelete(id){
  const key=String(id);
  return deletedTickets.some(t=>t && t.pendingCloudDelete && String(t.id)===key);
}

function securitySyncLiveTicket(id){
  const key=String(id);
  return tickets.find(t=>String(t.id)===key) || null;
}

retrySyncQueue = async function(){
  if(syncQueueBusy) return;
  if(!getScriptUrl()) return;

  /* Знімок delete робимо першим. Для add/update список формуємо без id,
     які вже мають pending delete. */
  const pendingDeletes = deletedTickets.filter(t=>t && t.pendingCloudDelete);
  const deleteIds = new Set(pendingDeletes.map(t=>String(t.id)));
  const pending = tickets.filter(t=>!t.synced && !deleteIds.has(String(t.id)));

  if(pending.length===0 && pendingDeletes.length===0) return;

  syncQueueBusy=true;
  const bannerText=document.getElementById('syncQueueBannerText');
  const retryBtn=document.getElementById('syncQueueRetryBtn');
  if(retryBtn) retryBtn.disabled=true;
  const total=pendingDeletes.length+pending.length;
  let done=0;

  try{
    /* ВАЖЛИВО: delete ПЕРЕД add/update. Це ремонтує вже накопичену чергу. */
    for(const trashed of pendingDeletes){
      if(bannerText) bannerText.innerHTML=`<span class="mini-spinner"></span>Синхронізую ${done+1} із ${total}...`;
      await syncPendingCloudDelete(trashed);
      done++;
      saveDeletedTickets();
    }

    for(const snapshot of pending){
      const id=String(snapshot.id);

      /* Користувач міг видалити заявку, поки ми чекали попередню мережеву
         операцію. У такому разі stale add/update взагалі не відправляємо. */
      const current=securitySyncLiveTicket(id);
      if(!current || securitySyncHasPendingDelete(id)){
        done++;
        continue;
      }

      if(bannerText) bannerText.innerHTML=`<span class="mini-spinner"></span>Синхронізую ${done+1} із ${total}...`;
      const action=current.syncAction==='updateTicket' ? 'updateTicket' : 'addTicket';
      const ok=await syncPost(action,ticketToSyncPayload(current));

      /* Після await ще раз перевіряємо, що це все ще жива заявка. Якщо її
         вже видалили, delete стоїть у тому ж per-id chain після цієї операції. */
      const after=securitySyncLiveTicket(id);
      if(after && !securitySyncHasPendingDelete(id)){
        after.synced=ok;
        if(ok) delete after.syncAction;
      }
      done++;
      saveTickets();
    }
  } finally {
    if(retryBtn) retryBtn.disabled=false;
    syncQueueBusy=false;
  }

  renderTicketsScreen();
  const stillPending=tickets.filter(t=>!t.synced).length + deletedTickets.filter(t=>t.pendingCloudDelete).length;
  showToast(stillPending ? `Залишилось не синхронізовано: ${stillPending}` : 'Усе синхронізовано ✅');
};

/* ---------- 3. Версія ---------- */
if(typeof renderSettingsScreen==='function'){
  const securitySyncRacePreviousRenderSettings=renderSettingsScreen;
  renderSettingsScreen=function(){
    const result=securitySyncRacePreviousRenderSettings.apply(this,arguments);
    const label=document.getElementById('appVersionLabel');
    if(label) label.textContent=`Версія застосунку: ${SECURITY_SYNC_RACE_RELEASE_LABEL}`;
    return result;
  };
}

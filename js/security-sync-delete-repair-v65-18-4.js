/* Майстер-Трекер — security.18.4 stale delete repair
   Лікує завислі pendingCloudDelete, коли рядка вже немає у Google,
   але локальна tombstone лишилась у черзі через невдале підтвердження.

   Принцип:
   1) перед delete робимо signed GET checkTicketExists;
   2) якщо id вже відсутній — delete вважається завершеним без повторного POST;
   3) якщо POST повернув false, повторно перевіряємо фактичний стан сервера;
   4) tombstone очищається лише коли Google підтвердив, що id відсутній.
*/

const SECURITY_SYNC_DELETE_REPAIR_RELEASE_LABEL = 'v65.0-security.18.4 · 2026-08-19';

async function securitySyncDeleteRepairExists(id){
  const url=getScriptUrl();
  if(!url) return null;
  const params=new URLSearchParams();
  params.set('action','checkTicketExists');
  params.set('id',String(id));
  // legacy secret тут навмисно додаємо: HMAC transport сам прибере його
  // і замінить ts/nonce/signature для security.18.
  params.set('secret',settings.syncSecret||'');
  const controller=new AbortController();
  const timeoutId=setTimeout(()=>controller.abort(),15000);
  try{
    const res=await fetch(`${url}?${params.toString()}`,{
      method:'GET', mode:'cors', cache:'no-store', signal:controller.signal
    });
    if(!res.ok) return null;
    const data=await res.json();
    if(!data || data.status==='error' || typeof data.exists!=='boolean') return null;
    return data.exists;
  }catch(e){
    return null;
  }finally{
    clearTimeout(timeoutId);
  }
}

function securitySyncDeleteRepairResolve(trashed){
  if(!trashed) return;
  if(deletedTickets.includes(trashed)){
    delete trashed.pendingCloudDelete;
    saveDeletedTickets();
    if(typeof renderSyncQueueBanner==='function') renderSyncQueueBanner();
  }
}

const securitySyncDeleteRepairPrevious = syncPendingCloudDelete;
syncPendingCloudDelete = function(trashed){
  if(!trashed || !trashed.pendingCloudDelete || !deletedTickets.includes(trashed)){
    return Promise.resolve(false);
  }
  const key=String(trashed.id);
  if(cloudDeleteInFlight.has(key)) return cloudDeleteInFlight.get(key);

  const job=(async()=>{
    // Найважливіше для старих завислих хвостів: якщо рядка вже немає,
    // серверний стан уже правильний — просто прибираємо tombstone з черги.
    const before=await securitySyncDeleteRepairExists(trashed.id);
    if(before===false){
      securitySyncDeleteRepairResolve(trashed);
      return true;
    }

    // Якщо рядок є або preflight тимчасово не прочитався — пробуємо delete.
    const posted=await syncPost('deleteTicket',{id:trashed.id});
    if(posted){
      securitySyncDeleteRepairResolve(trashed);
      return true;
    }

    // POST no-cors міг реально спрацювати, навіть якщо штатний verify дав false.
    // Тому істина — фінальний read-only стан Google.
    const delays=[500,1200,2200];
    for(const delay of delays){
      await new Promise(r=>setTimeout(r,delay));
      const exists=await securitySyncDeleteRepairExists(trashed.id);
      if(exists===false){
        securitySyncDeleteRepairResolve(trashed);
        return true;
      }
      if(exists===true) continue;
    }
    return false;
  })().finally(()=>{
    if(cloudDeleteInFlight.get(key)===job) cloudDeleteInFlight.delete(key);
  });

  cloudDeleteInFlight.set(key,job);
  return job;
};

if(typeof renderSettingsScreen==='function'){
  const securitySyncDeleteRepairPrevRender=renderSettingsScreen;
  renderSettingsScreen=function(){
    const result=securitySyncDeleteRepairPrevRender.apply(this,arguments);
    const label=document.getElementById('appVersionLabel');
    if(label) label.textContent=`Версія застосунку: ${SECURITY_SYNC_DELETE_REPAIR_RELEASE_LABEL}`;
    return result;
  };
}

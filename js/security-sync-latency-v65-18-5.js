/* Майстер-Трекер — security.18.5 sync latency / automatic delete retry
   Мета: прибрати довгі 30–120 с підтвердження та ручний повтор після delete,
   не послаблюючи HMAC і не вважаючи запис успішним без read-only перевірки Google.
*/

const SECURITY_SYNC_LATENCY_RELEASE_LABEL = 'v65.0-security.18.5 · 2026-08-19';
const SECURITY_SYNC_FAST_READ_TIMEOUT_MS = 8000;

async function securitySyncFastReadJson(url, params){
  const controller = new AbortController();
  const timeoutId = setTimeout(()=>controller.abort(), SECURITY_SYNC_FAST_READ_TIMEOUT_MS);
  try{
    const res = await fetch(`${url}?${params.toString()}`, {
      method:'GET', mode:'cors', cache:'no-store', signal:controller.signal
    });
    if(!res.ok) return {ok:false, reason:'http-'+res.status};
    const data = await res.json();
    if(!data || data.status==='error') return {ok:false, reason:data?.message || 'bad-response'};
    return {ok:true, data};
  }catch(err){
    return {ok:false, reason:err?.name || String(err)};
  }finally{
    clearTimeout(timeoutId);
  }
}

function securitySyncFastParams(action,id){
  const p = new URLSearchParams();
  p.set('action', action);
  if(id !== undefined && id !== null) p.set('id', String(id));
  // HMAC transport видаляє legacy secret і підставляє v/ts/nonce/sig.
  p.set('secret', settings.syncSecret || '');
  return p;
}

/* Швидше підтвердження POST: максимум 3 read-only спроби замість довгого каскаду. */
if(typeof verifyTicketSyncedOnServer === 'function'){
  verifyTicketSyncedOnServer = async function(url, action, payload){
    const delays = [0, 500, 1400];
    let lastReason = 'unknown';

    for(let i=0; i<delays.length; i++){
      if(delays[i]) await new Promise(r=>setTimeout(r, delays[i]));

      if(action === 'addTicket'){
        const result = await securitySyncFastReadJson(url, securitySyncFastParams('checkTicketExists', payload?.id));
        if(result.ok && result.data?.exists === true) return true;
        lastReason = result.ok ? 'id-not-found' : result.reason;
        continue;
      }

      if(action === 'deleteTicket'){
        // Для delete дешевше і надійніше перевіряти лише існування stable id.
        const result = await securitySyncFastReadJson(url, securitySyncFastParams('checkTicketExists', payload?.id));
        if(result.ok && result.data?.exists === false) return true;
        lastReason = result.ok ? 'delete-still-present' : result.reason;
        continue;
      }

      const result = await securitySyncFastReadJson(url, securitySyncFastParams('getTicketById', payload?.id));
      if(!result.ok){ lastReason = result.reason; continue; }
      const ticket = result.data?.ticket;
      const matcher = (typeof securitySyncVerifyStateMatches === 'function')
        ? securitySyncVerifyStateMatches
        : (typeof ticketStateMatchesPayload === 'function' ? ticketStateMatchesPayload : null);
      if(matcher && matcher(ticket, payload)) return true;
      lastReason = ticket ? 'state-mismatch' : 'ticket-missing';
    }

    console.warn('security.18.5 sync verify failed', {action, id:payload?.id, reason:lastReason});
    return false;
  };
}

/* Прискорюємо preflight/final check із security.18.4 тим самим 8-секундним reader. */
if(typeof securitySyncDeleteRepairExists === 'function'){
  securitySyncDeleteRepairExists = async function(id){
    const url = getScriptUrl();
    if(!url) return null;
    const result = await securitySyncFastReadJson(url, securitySyncFastParams('checkTicketExists', id));
    if(!result.ok || typeof result.data?.exists !== 'boolean') return null;
    return result.data.exists;
  };
}

/*
  Delete більше не вимагає ручного «Повторити» після одиничного тимчасового збою.
  Робимо одну автоматичну другу спробу. Tombstone очищається тільки після
  фактичного підтвердження, що id у Google відсутній.
*/
if(typeof syncPendingCloudDelete === 'function'){
  const securitySyncLatencyPreviousDelete = syncPendingCloudDelete;
  syncPendingCloudDelete = async function(trashed){
    const first = await securitySyncLatencyPreviousDelete(trashed);
    if(first) return true;
    if(!trashed || !trashed.pendingCloudDelete || !deletedTickets.includes(trashed)) return first;

    await new Promise(r=>setTimeout(r, 1200));
    const exists = (typeof securitySyncDeleteRepairExists === 'function')
      ? await securitySyncDeleteRepairExists(trashed.id)
      : null;
    if(exists === false){
      if(typeof securitySyncDeleteRepairResolve === 'function') securitySyncDeleteRepairResolve(trashed);
      return true;
    }

    // Одна автоматична повторна спроба. Далі черга лишається видимою — без нескінченного циклу.
    return securitySyncLatencyPreviousDelete(trashed);
  };
}

if(typeof renderSettingsScreen === 'function'){
  const securitySyncLatencyPrevRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = securitySyncLatencyPrevRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_SYNC_LATENCY_RELEASE_LABEL}`;
    return result;
  };
}

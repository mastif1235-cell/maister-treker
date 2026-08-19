/* Майстер-Трекер — security.18.8 fast verify client
   Сервер 18.8 зробив checkTicketExists/getTicketById справді read-only,
   тому більше не потрібна штучна 1.2–4.2 с пауза перед першою перевіркою.
*/

const SECURITY_SYNC_188_RELEASE_LABEL = 'v65.0-security.18.8 · 2026-08-19';
const SECURITY_SYNC_188_SETTLE_MS = 250;
const SECURITY_SYNC_188_TIMEOUT_MS = 5000;

async function securitySync188Read(url, action, id){
  const p = new URLSearchParams();
  p.set('action', action);
  if(id !== undefined && id !== null) p.set('id', String(id));
  // security.18 transport прибере legacy secret і підпише GET HMAC.
  p.set('secret', settings.syncSecret || '');

  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), SECURITY_SYNC_188_TIMEOUT_MS);
  try{
    const res = await fetch(`${url}?${p.toString()}`, {
      method:'GET', mode:'cors', cache:'no-store', signal:controller.signal
    });
    if(!res.ok) return {ok:false, reason:'http-'+res.status};
    const data = await res.json();
    if(!data || data.status==='error') return {ok:false, reason:data?.message || 'bad-response'};
    return {ok:true, data};
  }catch(err){
    return {ok:false, reason:err?.name || String(err)};
  }finally{
    clearTimeout(timer);
  }
}

verifyTicketSyncedOnServer = async function(url, action, payload){
  // Невеликий yield потрібен лише щоб POST-виконання встигло стартувати.
  await new Promise(r=>setTimeout(r, SECURITY_SYNC_188_SETTLE_MS));
  const delays = [0, 450, 1100];
  let lastReason = 'unknown';

  for(const delay of delays){
    if(delay) await new Promise(r=>setTimeout(r, delay));

    if(action==='addTicket' || action==='deleteTicket'){
      const result = await securitySync188Read(url, 'checkTicketExists', payload?.id);
      if(result.ok && typeof result.data?.exists === 'boolean'){
        if(action==='addTicket' && result.data.exists===true) return true;
        if(action==='deleteTicket' && result.data.exists===false) return true;
        lastReason = action==='addTicket' ? 'id-not-found' : 'delete-still-present';
      }else{
        lastReason = result.reason;
      }
      continue;
    }

    const result = await securitySync188Read(url, 'getTicketById', payload?.id);
    if(!result.ok){ lastReason=result.reason; continue; }
    const matcher = (typeof securitySyncVerifyStateMatches === 'function')
      ? securitySyncVerifyStateMatches
      : (typeof ticketStateMatchesPayload === 'function' ? ticketStateMatchesPayload : null);
    if(matcher && matcher(result.data?.ticket, payload)) return true;
    lastReason = result.data?.ticket ? 'state-mismatch' : 'ticket-missing';
  }

  console.warn('security.18.8 sync verify failed', {action,id:payload?.id,reason:lastReason});
  return false;
};

// 18.4 delete repair теж переводимо на той самий короткий справді read-only GET.
if(typeof securitySyncDeleteRepairExists === 'function'){
  securitySyncDeleteRepairExists = async function(id){
    const url = getScriptUrl();
    if(!url) return null;
    const result = await securitySync188Read(url, 'checkTicketExists', id);
    if(!result.ok || typeof result.data?.exists !== 'boolean') return null;
    return result.data.exists;
  };
}

if(typeof renderSettingsScreen==='function'){
  const prev188RenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = prev188RenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_SYNC_188_RELEASE_LABEL}`;
    return result;
  };
}

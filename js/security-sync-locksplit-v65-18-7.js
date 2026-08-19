/* Майстер-Трекер — security.18.7 client verify timing after server lock split */

const SECURITY_SYNC_187_RELEASE_LABEL = 'v65.0-security.18.7 · 2026-08-19';
const SECURITY_SYNC_187_SETTLE_MS = 1200;
const SECURITY_SYNC_187_TIMEOUT_MS = 6500;

async function securitySync187Read(url, action, id){
  const p = new URLSearchParams();
  p.set('action', action);
  if(id !== undefined && id !== null) p.set('id', String(id));
  p.set('secret', settings.syncSecret || '');
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), SECURITY_SYNC_187_TIMEOUT_MS);
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
  await new Promise(r=>setTimeout(r, SECURITY_SYNC_187_SETTLE_MS));
  const delays = [0, 900, 1800];
  let lastReason='unknown';

  for(const delay of delays){
    if(delay) await new Promise(r=>setTimeout(r, delay));

    if(action==='addTicket' || action==='deleteTicket'){
      const result = await securitySync187Read(url, 'checkTicketExists', payload?.id);
      if(result.ok && typeof result.data?.exists === 'boolean'){
        if(action==='addTicket' && result.data.exists===true) return true;
        if(action==='deleteTicket' && result.data.exists===false) return true;
        lastReason = action==='addTicket' ? 'id-not-found' : 'delete-still-present';
      } else {
        lastReason = result.reason;
      }
      continue;
    }

    const result = await securitySync187Read(url, 'getTicketById', payload?.id);
    if(!result.ok){ lastReason=result.reason; continue; }
    const matcher = (typeof securitySyncVerifyStateMatches === 'function')
      ? securitySyncVerifyStateMatches
      : (typeof ticketStateMatchesPayload === 'function' ? ticketStateMatchesPayload : null);
    if(matcher && matcher(result.data?.ticket, payload)) return true;
    lastReason = result.data?.ticket ? 'state-mismatch' : 'ticket-missing';
  }

  console.warn('security.18.7 sync verify failed', {action,id:payload?.id,reason:lastReason});
  return false;
};

if(typeof renderSettingsScreen==='function'){
  const prev187RenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = prev187RenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_SYNC_187_RELEASE_LABEL}`;
    return result;
  };
}

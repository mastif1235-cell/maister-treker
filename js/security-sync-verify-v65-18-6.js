/* Майстер-Трекер — security.18.6 verify-after-write settle fix
   Причина: HMAC GET-підтвердження могло стартувати одразу після no-cors POST,
   поки Apps Script ще тримав ScriptLock у legacyDoPostV65. У цей момент
   secureAuthConsumeNonce_ теж намагався взяти той самий ScriptLock і GET
   отримував auth failed/forbidden, хоча запис у таблиці вже фактично виконувався.

   Клієнтський захист:
   - даємо POST короткий час завершити бізнес-операцію;
   - потім робимо до 3 signed GET-перевірок;
   - не вважаємо операцію успішною без read-only підтвердження Google.
*/

const SECURITY_SYNC_SETTLE_RELEASE_LABEL = 'v65.0-security.18.6 · 2026-08-19';
const SECURITY_SYNC_POST_SETTLE_MS = 4200;
const SECURITY_SYNC_VERIFY_TIMEOUT_MS = 7000;

async function securitySync186Read(url, action, id){
  const p = new URLSearchParams();
  p.set('action', action);
  if(id !== undefined && id !== null) p.set('id', String(id));
  p.set('secret', settings.syncSecret || '');

  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), SECURITY_SYNC_VERIFY_TIMEOUT_MS);
  try{
    const res = await fetch(`${url}?${p.toString()}`, {
      method:'GET', mode:'cors', cache:'no-store', signal:controller.signal
    });
    if(!res.ok) return {ok:false, reason:'http-'+res.status};
    const data = await res.json();
    if(!data || data.status === 'error') return {ok:false, reason:data?.message || 'bad-response'};
    return {ok:true, data};
  }catch(err){
    return {ok:false, reason:err?.name || String(err)};
  }finally{
    clearTimeout(timer);
  }
}

verifyTicketSyncedOnServer = async function(url, action, payload){
  /* no-cors POST може повернути керування клієнту раніше, ніж Apps Script
     повністю звільнить свій business ScriptLock. Не запускаємо verify в ту ж мить. */
  await new Promise(r=>setTimeout(r, SECURITY_SYNC_POST_SETTLE_MS));

  const delays = [0, 1400, 3000];
  let lastReason = 'unknown';

  for(let i=0; i<delays.length; i++){
    if(delays[i]) await new Promise(r=>setTimeout(r, delays[i]));

    if(action === 'addTicket' || action === 'deleteTicket'){
      const result = await securitySync186Read(url, 'checkTicketExists', payload?.id);
      if(result.ok && typeof result.data?.exists === 'boolean'){
        if(action === 'addTicket' && result.data.exists === true) return true;
        if(action === 'deleteTicket' && result.data.exists === false) return true;
        lastReason = action === 'addTicket' ? 'id-not-found' : 'delete-still-present';
      }else{
        lastReason = result.reason;
      }
      continue;
    }

    const result = await securitySync186Read(url, 'getTicketById', payload?.id);
    if(!result.ok){
      lastReason = result.reason;
      continue;
    }
    const ticket = result.data?.ticket;
    const matcher = (typeof securitySyncVerifyStateMatches === 'function')
      ? securitySyncVerifyStateMatches
      : (typeof ticketStateMatchesPayload === 'function' ? ticketStateMatchesPayload : null);
    if(matcher && matcher(ticket, payload)) return true;
    lastReason = ticket ? 'state-mismatch' : 'ticket-missing';
  }

  console.warn('security.18.6 sync verify failed', {action, id:payload?.id, reason:lastReason});
  return false;
};

if(typeof renderSettingsScreen === 'function'){
  const securitySync186PrevRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = securitySync186PrevRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_SYNC_SETTLE_RELEASE_LABEL}`;
    return result;
  };
}

/* Майстер-Трекер — security.18.1 sync verification hardening
   POST до Apps Script іде як no-cors, тому успіх запису підтверджується
   окремим signed GET getTicketById. Цей модуль робить підтвердження стійким
   до короткої затримки Google Sheets та нешкідливих відмінностей серіалізації
   (CRLF/LF, порядок тегів, JSON як структурні дані), не послаблюючи HMAC.
*/

const SECURITY_SYNC_VERIFY_RELEASE_LABEL = 'v65.0-security.18.1 · 2026-08-19';

function securitySyncVerifyNormText(v){
  return String(v ?? '').replace(/\r\n?/g,'\n');
}
function securitySyncVerifyNormTags(v){
  return (Array.isArray(v) ? v : [])
    .map(x=>String(x).trim())
    .filter(Boolean)
    .sort();
}
function securitySyncVerifyStableJsonValue(v){
  if(Array.isArray(v)) return v.map(securitySyncVerifyStableJsonValue);
  if(v && typeof v==='object'){
    const out={};
    Object.keys(v).sort().forEach(k=>{ out[k]=securitySyncVerifyStableJsonValue(v[k]); });
    return out;
  }
  return v;
}
function securitySyncVerifyNormJson(v){
  const raw=String(v ?? '');
  if(!raw) return '';
  try{ return JSON.stringify(securitySyncVerifyStableJsonValue(JSON.parse(raw))); }
  catch(e){ return securitySyncVerifyNormText(raw); }
}
function securitySyncVerifyStateMatches(serverTicket,payload){
  if(!serverTicket || !payload) return false;
  return String(serverTicket.id)===String(payload.id) &&
    securitySyncVerifyNormText(serverTicket.date)===securitySyncVerifyNormText(payload.date) &&
    securitySyncVerifyNormText(serverTicket.time)===securitySyncVerifyNormText(payload.time) &&
    securitySyncVerifyNormText(serverTicket.content)===securitySyncVerifyNormText(payload.content) &&
    Number(serverTicket.sum||0)===Number(payload.sum||0) &&
    JSON.stringify(securitySyncVerifyNormTags(serverTicket.tags))===JSON.stringify(securitySyncVerifyNormTags(payload.tags)) &&
    securitySyncVerifyNormText(serverTicket.backupNote)===securitySyncVerifyNormText(payload.backupNote) &&
    securitySyncVerifyNormJson(serverTicket.fullDataJson)===securitySyncVerifyNormJson(payload.fullDataJson);
}

if(typeof ticketStateMatchesPayload==='function'){
  ticketStateMatchesPayload=securitySyncVerifyStateMatches;
}

if(typeof verifyTicketSyncedOnServer==='function'){
  verifyTicketSyncedOnServer=async function(url,action,payload){
    const delays=[250,700,1400];
    let lastReason='unknown';
    for(let attempt=0; attempt<delays.length; attempt++){
      if(attempt>0) await new Promise(r=>setTimeout(r,delays[attempt]));
      try{
        const params=new URLSearchParams();
        params.set('action','getTicketById');
        params.set('id',payload.id);
        params.set('secret',settings.syncSecret||'');
        const controller=new AbortController();
        const timeoutId=setTimeout(()=>controller.abort(),15000);
        let res;
        try{
          res=await fetch(`${url}?${params.toString()}`,{method:'GET',mode:'cors',cache:'no-store',signal:controller.signal});
        } finally { clearTimeout(timeoutId); }
        if(!res.ok){ lastReason='http-'+res.status; continue; }
        const data=await res.json();
        if(!data || data.status==='error' || !Object.prototype.hasOwnProperty.call(data,'ticket')){
          lastReason=data?.message || 'bad-response';
          continue;
        }
        if(action==='deleteTicket'){
          if(data.ticket===null) return true;
          lastReason='delete-still-present';
          continue;
        }
        if(securitySyncVerifyStateMatches(data.ticket,payload)) return true;
        lastReason='state-mismatch';
      }catch(err){
        lastReason=err?.name || String(err);
      }
    }
    console.warn('security.18.1 sync verify failed', {action,id:payload?.id,reason:lastReason});
    return false;
  };
}

if(typeof renderSettingsScreen==='function'){
  const securitySyncVerifyPreviousRenderSettings=renderSettingsScreen;
  renderSettingsScreen=function(){
    const result=securitySyncVerifyPreviousRenderSettings.apply(this,arguments);
    const label=document.getElementById('appVersionLabel');
    if(label) label.textContent=`Версія застосунку: ${SECURITY_SYNC_VERIFY_RELEASE_LABEL}`;
    return result;
  };
}

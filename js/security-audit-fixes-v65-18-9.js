/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — security audit hardening (v65 security.18.9)

   Defense-in-depth for photo rendering. Legacy app.js still renders resolved
   photo values into HTML attributes, so only allow URL forms that the app
   actually needs for photos. Unexpected Telegram/IndexedDB text is rejected
   before it can reach an HTML attribute.
   ===================================================================== */

  const SECURITY_AUDIT_RELEASE_LABEL = 'v87 · 2026-09-05';

function securityAuditSafePhotoUrl(value){
  if(typeof value !== 'string') return null;
  const v = value.trim();
  if(!v) return null;

  // Local photos are data:image/* or blob: URLs. Remote Telegram fallback is
  // fetched by resolvePhotoAsync and converted to a local representation; do
  // not allow arbitrary http(s), javascript:, malformed text, quotes, etc.
  if(/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(v)) return v;
  if(/^blob:https?:\/\/[^\s"'<>]+$/i.test(v)) return v;
  return null;
}

if(typeof resolvePhotoAsync === 'function'){
  const securityAuditOriginalResolvePhotoAsync = resolvePhotoAsync;
  resolvePhotoAsync = async function(){
    const value = await securityAuditOriginalResolvePhotoAsync.apply(this, arguments);
    return securityAuditSafePhotoUrl(value);
  };
}

if(typeof openTicketPhotoFullscreen === 'function'){
  const securityAuditOriginalOpenTicketPhotoFullscreen = openTicketPhotoFullscreen;
  openTicketPhotoFullscreen = function(src){
    const safe = securityAuditSafePhotoUrl(src);
    if(!safe) return;
    return securityAuditOriginalOpenTicketPhotoFullscreen.call(this, safe);
  };
}

if(typeof renderSettingsScreen === 'function'){
  const securityAuditOriginalRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = securityAuditOriginalRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_AUDIT_RELEASE_LABEL}`;
    return result;
  };
}

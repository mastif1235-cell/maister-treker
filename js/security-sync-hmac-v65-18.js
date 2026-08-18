/* Майстер-Трекер — Google Apps Script HMAC transport v65.0-security.18
   УВАГА: цей файл підготовлений, але НЕ ПІДКЛЮЧАТИ, доки server patch
   apps-script-security-v65-18-patch.gs не вставлений і не задеплоєний.

   Старий клієнт передавав syncSecret у GET query (?secret=...), тому секрет
   потрапляв у URL. Цей transport прозоро перетворює ТІЛЬКИ запити до
   основного Apps Script заявок (settings.scriptUrl):
   - GET заявок: secret прибирається, додаються ts/nonce/HMAC-SHA256;
   - POST заявок: secret прибирається з JSON, payload підписується як точний body;
   - решта fetch у застосунку не змінюється.

   ВАЖЛИВО: окремий shiftsScriptUrl навмисно НЕ мігруємо цим протоколом.
   GET із параметрами date/hours/coworker не підписується навіть якщо URL
   випадково збігається з tickets endpoint — це захищає legacy sync змін від
   випадкового перехоплення security.18 transport.
*/

const SECURITY_SYNC_HMAC_RELEASE_LABEL = 'v65.0-security.18 · 2026-08-18';
const SECURITY_SYNC_MIN_SECRET_LENGTH = 32;
const SECURITY_SYNC_TICKET_GET_ACTIONS = new Set(['list','checkTicketExists','getTicketById']);

function securitySyncUtf8(s){ return new TextEncoder().encode(String(s)); }
function securitySyncB64Url(bytes){
  let bin='';
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for(let i=0;i<a.length;i++) bin += String.fromCharCode(a[i]);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
function securitySyncNonce(){
  return securitySyncB64Url(crypto.getRandomValues(new Uint8Array(18)));
}
function securitySyncSecret(){ return String(settings?.syncSecret || '').trim(); }
function securitySyncSecretStrongEnough(){ return securitySyncSecret().length >= SECURITY_SYNC_MIN_SECRET_LENGTH; }

async function securitySyncHmac(canonical){
  const secret=securitySyncSecret();
  if(secret.length < SECURITY_SYNC_MIN_SECRET_LENGTH) throw new Error('SYNC_SECRET_TOO_SHORT');
  const key=await crypto.subtle.importKey(
    'raw', securitySyncUtf8(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']
  );
  return securitySyncB64Url(await crypto.subtle.sign('HMAC',key,securitySyncUtf8(canonical)));
}

function securitySyncNormalizeEndpoint(raw){
  try{
    const u=new URL(String(raw||''),location.href);
    if(u.protocol!=='https:') return '';
    u.search='';
    u.hash='';
    return u.href.replace(/\/$/,'');
  }catch(e){ return ''; }
}
function securitySyncTicketsEndpoint(){
  try{ return securitySyncNormalizeEndpoint(getScriptUrl()); }
  catch(e){ return ''; }
}
function securitySyncIsTargetUrl(raw){
  const target=securitySyncTicketsEndpoint();
  return !!target && securitySyncNormalizeEndpoint(raw)===target;
}
function securitySyncIsTicketGetUrl(raw){
  try{
    const url=new URL(String(raw||''),location.href);
    const action=url.searchParams.get('action') || 'list';
    if(!SECURITY_SYNC_TICKET_GET_ACTIONS.has(action)) return false;
    // Legacy shifts protocol uses these parameters. Never reinterpret it as
    // ticket HMAC, even if the configured endpoint is accidentally identical.
    if(url.searchParams.has('date') || url.searchParams.has('hours') || url.searchParams.has('coworker')) return false;
    return true;
  }catch(e){ return false; }
}

try{
  const securitySyncPreviousFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const rawUrl=typeof input==='string' ? input : (input && input.url) || '';
    if(!securitySyncIsTargetUrl(rawUrl)) return securitySyncPreviousFetch(input,init);
    if(!securitySyncSecret()) return securitySyncPreviousFetch(input,init);
    if(!securitySyncSecretStrongEnough()){
      if(typeof showToast==='function') showToast('🔐 Секрет Google Sync має бути не коротшим за 32 символи');
      throw new Error('SYNC_SECRET_TOO_SHORT');
    }

    const method=String(init?.method || (input && input.method) || 'GET').toUpperCase();

    if(method==='GET'){
      if(!securitySyncIsTicketGetUrl(rawUrl)) return securitySyncPreviousFetch(input,init);
      const url=new URL(rawUrl,location.href);
      // Старі функції могли вже додати ?secret=. Видаляємо його ДО мережі.
      url.searchParams.delete('secret');
      const action=url.searchParams.get('action') || 'list';
      const id=url.searchParams.get('id') || '';
      const ts=String(Date.now());
      const nonce=securitySyncNonce();
      const canonical=ts+'\n'+nonce+'\nGET\n'+action+'\n'+id;
      const sig=await securitySyncHmac(canonical);
      url.searchParams.set('v','2');
      url.searchParams.set('ts',ts);
      url.searchParams.set('nonce',nonce);
      url.searchParams.set('sig',sig);
      return securitySyncPreviousFetch(url.href,init);
    }

    if(method==='POST' && typeof init?.body==='string'){
      let data;
      try{ data=JSON.parse(init.body); }catch(e){ return securitySyncPreviousFetch(input,init); }
      if(data && typeof data==='object' && !Array.isArray(data)){
        // Не відправляємо syncSecret у body навіть якщо старий postToUrl його додав.
        if(Object.prototype.hasOwnProperty.call(data,'secret')) delete data.secret;
        const body=JSON.stringify(data);
        const ts=String(Date.now());
        const nonce=securitySyncNonce();
        const canonical=ts+'\n'+nonce+'\nPOST\n'+body;
        const sig=await securitySyncHmac(canonical);
        const envelope=JSON.stringify({v:2,ts,nonce,body,sig});
        const nextInit=Object.assign({},init,{body:envelope});
        return securitySyncPreviousFetch(input,nextInit);
      }
    }

    return securitySyncPreviousFetch(input,init);
  };
}catch(e){
  console.error('HMAC sync transport init failed:',e);
}

if(typeof renderSettingsScreen==='function'){
  const securitySyncPreviousRenderSettings=renderSettingsScreen;
  renderSettingsScreen=function(){
    const result=securitySyncPreviousRenderSettings.apply(this,arguments);
    const label=document.getElementById('appVersionLabel');
    if(label) label.textContent=`Версія застосунку: ${SECURITY_SYNC_HMAC_RELEASE_LABEL}`;
    return result;
  };
}

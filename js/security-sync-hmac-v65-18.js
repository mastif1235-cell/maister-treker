/* Майстер-Трекер — Google Apps Script HMAC transport v65.0-security.18
   УВАГА: цей файл підготовлений, але НЕ ПІДКЛЮЧАТИ, доки server patch
   apps-script-security-v65-18-patch.gs не вставлений і не задеплоєний.

   Старий клієнт передавав syncSecret у GET query (?secret=...), тому секрет
   потрапляв у URL. Цей transport прозоро перетворює тільки запити до
   налаштованих Apps Script URL:
   - GET: secret прибирається, додаються ts/nonce/HMAC-SHA256;
   - POST: secret прибирається з JSON, payload підписується як точний body;
   - решта fetch у застосунку не змінюється.
*/

const SECURITY_SYNC_HMAC_RELEASE_LABEL = 'v65.0-security.18 · 2026-08-18';

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
async function securitySyncHmac(canonical){
  const secret=String(settings?.syncSecret || '');
  if(!secret) throw new Error('SYNC_SECRET_MISSING');
  const key=await crypto.subtle.importKey('raw',securitySyncUtf8(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return securitySyncB64Url(await crypto.subtle.sign('HMAC',key,securitySyncUtf8(canonical)));
}
function securitySyncConfiguredUrls(){
  const set=new Set();
  try{ const u=getScriptUrl(); if(u) set.add(String(u)); }catch(e){}
  try{ const u=getShiftsScriptUrl(); if(u) set.add(String(u)); }catch(e){}
  return [...set];
}
function securitySyncIsTargetUrl(raw){
  const value=String(raw||'');
  return securitySyncConfiguredUrls().some(base=> value.startsWith(base));
}

try{
  const securitySyncPreviousFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const rawUrl=typeof input==='string' ? input : (input && input.url) || '';
    if(!securitySyncIsTargetUrl(rawUrl)) return securitySyncPreviousFetch(input,init);
    if(!settings?.syncSecret) return securitySyncPreviousFetch(input,init);

    const method=String(init?.method || (input && input.method) || 'GET').toUpperCase();

    if(method==='GET'){
      const url=new URL(rawUrl,location.href);
      // Міг бути сформований старою функцією з ?secret=. Видаляємо його ДО мережі.
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
      if(data && typeof data==='object' && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data,'secret')){
        delete data.secret;
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

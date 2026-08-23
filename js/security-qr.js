/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — secure contract QR transport (v65 security.5)
   Прибирає логін/пароль з query string. Дані лишаються тільки у URL fragment,
   який браузер НЕ надсилає серверу, CDN, Netlify logs чи Referer.

   v2: компактний payload + короткий d.html. Це помітно зменшує кількість
   модулів QR, тому його легше сканувати старішими/слабшими камерами.
   ===================================================================== */

const SECURITY_QR_RELEASE_LABEL = 'v65.0-security.5 · 2026-08-18';

function securityQrBase64UrlEncode(text){
  const bytes = new TextEncoder().encode(String(text));
  let binary = '';
  bytes.forEach(b=>{ binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function securityQrBuildContractUrl(data){
  const compact=[data?.address||'',data?.login||'',data?.password||'',data?.number||'',data?.date||''].map(v=>String(v).slice(0,1000)).join('\x1f');
  const viewer=new URL('d.html',location.href);
  viewer.search='';viewer.hash='2.'+securityQrBase64UrlEncode(compact);
  return viewer.href;
}

if(typeof renderSettingsScreen === 'function'){
  const securityQrOriginalRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = securityQrOriginalRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_QR_RELEASE_LABEL}`;
    return result;
  };
}

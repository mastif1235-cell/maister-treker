/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — secure contract QR transport (v65 security.3)
   Прибирає логін/пароль з query string. Дані лишаються тільки у URL fragment,
   який браузер НЕ надсилає серверу, CDN, Netlify logs чи Referer.
   ===================================================================== */

const SECURITY_QR_RELEASE_LABEL = 'v65.0-security.3 · 2026-08-18';

function securityQrBase64UrlEncode(text){
  const bytes = new TextEncoder().encode(String(text));
  let binary = '';
  bytes.forEach(b=>{ binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function securityQrRewriteContractUrl(raw){
  try{
    const input = new URL(String(raw), location.href);
    const hasContractFields = ['a','l','p','n','d'].some(k=>input.searchParams.has(k));
    if(!hasContractFields) return raw;

    const payload = {
      v: 1,
      a: input.searchParams.get('a') || '',
      l: input.searchParams.get('l') || '',
      p: input.searchParams.get('p') || '',
      n: input.searchParams.get('n') || '',
      d: input.searchParams.get('d') || ''
    };

    // Використовуємо власну same-origin сторінку. Секретні поля не потрапляють
    // ні в query string, ні на зовнішній договірний хост.
    const viewer = new URL('dogovor-secure.html', location.href);
    viewer.hash = 'v1.' + securityQrBase64UrlEncode(JSON.stringify(payload));
    return viewer.href;
  }catch(e){
    return raw;
  }
}

// Не переписуємо великий showDogovor(): перехоплюємо тільки дані, які він
// передає QR-генератору. Інші QR (візитка тощо) лишаються без змін.
if(typeof qrcode === 'function'){
  const securityQrOriginalFactory = qrcode;
  qrcode = function(){
    const qr = securityQrOriginalFactory.apply(this, arguments);
    if(!qr || typeof qr.addData !== 'function') return qr;
    const originalAddData = qr.addData.bind(qr);
    qr.addData = function(data){
      return originalAddData(securityQrRewriteContractUrl(data));
    };
    return qr;
  };
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

/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — secure contract QR transport (v65 security.4)
   Прибирає логін/пароль з query string. Дані лишаються тільки у URL fragment,
   який браузер НЕ надсилає серверу, CDN, Netlify logs чи Referer.

   v2: компактний payload + короткий d.html. Це помітно зменшує кількість
   модулів QR, тому його легше сканувати старішими/слабшими камерами.
   ===================================================================== */

const SECURITY_QR_RELEASE_LABEL = 'v65.0-security.4 · 2026-08-18';

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

    // Без JSON-ключів та службових пробілів: тільки 5 значень у стабільному
    // порядку, розділених ASCII Unit Separator (майже ніколи не трапляється
    // у звичайних адресах/логінах/паролях). Base64url лишається безпечним для URL.
    const compact = [
      input.searchParams.get('a') || '',
      input.searchParams.get('l') || '',
      input.searchParams.get('p') || '',
      input.searchParams.get('n') || '',
      input.searchParams.get('d') || ''
    ].join('\x1f');

    // Коротке ім'я сторінки теж зменшує QR. Дані йдуть тільки після #.
    const viewer = new URL('d.html', location.href);
    viewer.hash = '2.' + securityQrBase64UrlEncode(compact);
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

/* Майстер-Трекер — photo data transport fix v65.0-security.16
   CSP у security.9 навмисно не дозволяє fetch() до data: URL через connect-src.
   Фото при цьому нормально показуються (<img> має img-src data:), але старий код
   Telegram/share перетворював локальний data:image/... у Blob саме через fetch().

   Цей вузький shim обробляє data: URL локально, БЕЗ мережевого запиту і без
   розширення CSP. Усі звичайні http/https запити й попередні security wrappers
   проходять без змін.

   Daily backup навмисно НЕ дублює байти фото щодня. Фото лишаються в Telegram-
   архіві та можуть підтягуватись назад через збережені tgPhotoFileId/tgPhotoFileIds.
*/

const PHOTO_DATA_FETCH_RELEASE_LABEL = 'v65.0-security.16 · 2026-08-18';

function photoDataUrlToResponse(dataUrl){
  const source = String(dataUrl || '');
  const comma = source.indexOf(',');
  if(!source.startsWith('data:') || comma < 0) throw new TypeError('Invalid data URL');

  const meta = source.slice(5, comma);
  const payload = source.slice(comma + 1);
  const parts = meta.split(';');
  const mime = parts[0] || 'text/plain;charset=US-ASCII';
  const isBase64 = parts.some(p => p.toLowerCase() === 'base64');

  let bytes;
  if(isBase64){
    const binary = atob(payload.replace(/\s/g, ''));
    bytes = new Uint8Array(binary.length);
    for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
  }else{
    const decoded = decodeURIComponent(payload.replace(/\+/g, '%20'));
    bytes = new TextEncoder().encode(decoded);
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(bytes.byteLength)
    }
  });
}

try{
  const photoDataPreviousFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if(/^data:/i.test(url)){
      try{
        return Promise.resolve(photoDataUrlToResponse(url));
      }catch(err){
        return Promise.reject(err);
      }
    }
    return photoDataPreviousFetch(input, init);
  };
}catch(e){ /* старий WebView — не втручаємось */ }

if(typeof renderSettingsScreen === 'function'){
  const photoDataPreviousRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = photoDataPreviousRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${PHOTO_DATA_FETCH_RELEASE_LABEL}`;
    return result;
  };
}

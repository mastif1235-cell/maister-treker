/* Майстер-Трекер — photo data transport fix v65.0-security.16
   CSP у security.9 навмисно не дозволяє fetch() до data: URL через connect-src.
   Фото при цьому нормально показуються (<img> має img-src data:), але старий код
   Telegram/share перетворював локальний data:image/... у Blob саме через fetch().

   Цей вузький shim обробляє ЛИШЕ локальні raster data:image/...;base64 URL
   (JPEG/PNG/WebP/GIF), без мережевого запиту і без розширення CSP. Довільні
   data:text/html, data:image/svg+xml тощо навмисно НЕ пропускаємо.

   Daily backup навмисно НЕ дублює байти фото щодня. Фото лишаються в Telegram-
   архіві та можуть підтягуватись назад через збережені tgPhotoFileId/tgPhotoFileIds.
*/

const PHOTO_DATA_FETCH_RELEASE_LABEL = 'v65.0-security.16 · 2026-08-18';
const PHOTO_DATA_MAX_URL_CHARS = 16 * 1024 * 1024;
const PHOTO_DATA_ALLOWED_RE = /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i;

function photoDataUrlToResponse(dataUrl){
  const source = String(dataUrl || '');
  if(source.length > PHOTO_DATA_MAX_URL_CHARS) throw new TypeError('Photo data URL too large');
  const match = source.match(PHOTO_DATA_ALLOWED_RE);
  if(!match) throw new TypeError('Only safe raster image data URLs are supported');

  const mimeMatch = source.match(/^data:([^;,]+);base64,/i);
  const mime = mimeMatch ? mimeMatch[1].toLowerCase() : 'image/jpeg';
  const cleanPayload = match[1].replace(/\s/g, '');
  if(!cleanPayload) throw new TypeError('Empty photo data URL');

  let binary;
  try{ binary = atob(cleanPayload); }
  catch(e){ throw new TypeError('Invalid base64 photo data URL'); }

  const bytes = new Uint8Array(binary.length);
  for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);

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

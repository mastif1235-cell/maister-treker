/* Майстер-Трекер — photo transport + complete physical backup v65.0-security.15
   1) CSP у security.9 навмисно не дозволяє fetch() до data: URL через connect-src.
      Фото при цьому нормально показуються (<img> має img-src data:), але старий код
      Telegram/share перетворював локальний data:image/... у Blob саме через fetch().
      Цей shim обробляє data: URL локально, без мережевого запиту і без ослаблення CSP.

   2) Регрес-аудит виявив важливий нюанс: автоматичний фізичний encrypted daily backup
      містив tickets/shifts/settings, але НЕ самі байти фото (лише idb: посилання).
      Після очищення даних браузера такий файл не міг самостійно повернути фото.
      Тепер перед шифруванням фізичного daily-файла додаємо photoData поточних заявок.
*/

const PHOTO_DATA_FETCH_RELEASE_LABEL = 'v65.0-security.15 · 2026-08-18';

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

/* Повний фізичний daily backup має пережити очищення браузера самостійно.
   Не змінюємо легкий IndexedDB snapshot (щоб не множити великі фото щодня
   всередині браузера), а додаємо photoData саме у ФІЗИЧНИЙ encrypted файл. */
if(typeof securityRuntimeBuildDailyEnvelope === 'function' && typeof collectLocalPhotoData === 'function'){
  securityRuntimeBuildDailyEnvelope = async function(dateKey, payload, saved){
    const {photoData, missingPhotos} = await collectLocalPhotoData(Array.isArray(payload?.tickets) ? payload.tickets : tickets);
    const clean = {
      app:'master-tracker',
      backupVersion:6,
      encryptedSource:true,
      physicalDailyComplete:true,
      exportedAt:payload?.exportedAt || new Date().toISOString(),
      tickets:Array.isArray(payload?.tickets) ? payload.tickets : [],
      shifts:Array.isArray(payload?.shifts) ? payload.shifts : [],
      settings:typeof securitySanitizeSettingsForBackup==='function'
        ? securitySanitizeSettingsForBackup(payload?.settings||{})
        : (payload?.settings||{}),
      photoData,
      missingPhotos:Number(missingPhotos)||0
    };
    const envelope = await securityBackupEncryptObject(clean, saved.password);
    securityBackupDownloadEnvelope(envelope, `master-tracker-backup-${dateKey}-encrypted.json`);
  };
}

/* Ручное скачивание конкретного daily snapshot тоже делаем полноценным:
   берём снимок заявок за выбранную дату и прикладываем доступные сейчас фото
   по тем же idb: ключам. Если старое фото уже физически отсутствует, restore
   всё равно честно покажет отсутствие вместо притворства "полный backup". */
if(typeof downloadDailyBackup === 'function' && typeof collectLocalPhotoData === 'function'){
  downloadDailyBackup = async function(dateKey, opts={}){
    const payload = await backupDbGet(dateKey);
    if(!payload){ if(!opts.silent) showToast('Не вдалося знайти цей бекап'); return; }
    if(opts.silent) return;
    const creds = await securityBackupGetOrCreateCredentials();
    if(!creds) return;
    try{
      showToast('🔐 Готую фото та шифрую щоденний бекап…');
      const snapshotTickets = Array.isArray(payload.tickets) ? payload.tickets : [];
      const {photoData, missingPhotos} = await collectLocalPhotoData(snapshotTickets);
      const clean = {
        app:'master-tracker', backupVersion:6, encryptedSource:true, physicalDailyComplete:true,
        exportedAt:payload.exportedAt,
        tickets:snapshotTickets,
        shifts:payload.shifts||[],
        settings:typeof securitySanitizeSettingsForBackup==='function'
          ? securitySanitizeSettingsForBackup(payload.settings||{})
          : (payload.settings||{}),
        photoData,
        missingPhotos:Number(missingPhotos)||0
      };
      const envelope = await securityBackupEncryptObject(clean, creds.password);
      securityBackupDownloadEnvelope(envelope, `master-tracker-backup-${dateKey}-encrypted.json`);
      showToast(missingPhotos
        ? `🔐 Бекап зашифровано, але ${missingPhotos} фото вже немає локально`
        : '🔐 Повний щоденний бекап з фото зашифровано');
    }catch(err){
      console.error('Complete daily backup export failed:',err);
      showToast('Не вдалося створити повний щоденний бекап');
    }
  };
}

if(typeof renderSettingsScreen === 'function'){
  const photoDataPreviousRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = photoDataPreviousRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${PHOTO_DATA_FETCH_RELEASE_LABEL}`;
    return result;
  };
}

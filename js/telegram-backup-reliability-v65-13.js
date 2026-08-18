/* Майстер-Трекер — Telegram backup reliability v65.0-security.13
   Якщо sendPhoto падає саме мережевою помилкою, старий backupTicketToTelegramNow
   раніше виходив з усього блоку ДО відправки ticket-*.json. Тут робимо вузький
   транспортний hotfix: Telegram sendPhoto отримує до 3 спроб, а після повного
   мережевого провалу повертаємо контрольовану Telegram-помилку замість throw.
   Тоді штатний код продовжує цикл, доходить до JSON-бекапу і НЕ видаляє стару
   повну копію, бо photosOk лишається false.
*/

const TELEGRAM_BACKUP_RELIABILITY_LABEL = 'v65.0-security.13 · 2026-08-18';

try{
  const telegramReliabilityFetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isTelegramPhoto = /https:\/\/api\.telegram\.org\/bot[^/]+\/sendPhoto(?:\?|$)/i.test(url);
    if(!isTelegramPhoto) return telegramReliabilityFetch(input, init);

    let lastError = null;
    for(let attempt=1; attempt<=3; attempt++){
      try{
        const response = await telegramReliabilityFetch(input, init);
        // HTTP-відповідь від Telegram (навіть ok:false у JSON) — це вже не
        // мережевий обрив, тому віддаємо її штатному коду без дублювання фото.
        return response;
      }catch(err){
        lastError = err;
        if(attempt < 3) await new Promise(resolve=>setTimeout(resolve, 450 * attempt));
      }
    }

    console.error('Telegram sendPhoto: мережевий збій після 3 спроб', lastError);
    // Важливо: не кидаємо помилку далі. Інакше backupTicketToTelegramNow
    // перерветься до sendDocument і JSON-знімок знову не збережеться.
    return new Response(JSON.stringify({ok:false, description:'sendPhoto network failure after retries'}), {
      status: 599,
      headers: {'Content-Type':'application/json'}
    });
  };
}catch(e){ /* старий WebView — не ламаємо штатний fetch */ }

if(typeof renderSettingsScreen === 'function'){
  const telegramReliabilityPreviousRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = telegramReliabilityPreviousRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${TELEGRAM_BACKUP_RELIABILITY_LABEL}`;
    return result;
  };
}

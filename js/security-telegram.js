/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — Telegram archive hardening (v65 security.6)
   Локальна заявка лишається повною. Перед відправкою в Telegram-архів
   прибираємо пароль абонента з тексту та JSON-файлу, не чіпаючи фото,
   адресу, логін, договір, нотатки, geo та службові Telegram id.
   ===================================================================== */

const SECURITY_TELEGRAM_RELEASE_LABEL = 'v65.0-security.6 · 2026-08-18';

function securityTelegramRedactPasswordLines(text){
  return String(text || '')
    .split(/\r?\n/)
    .filter(line => !/^\s*(?:🔑\s*)?(?:парол(?:ь|я)|password|pass)\s*[:：=]/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function securityTelegramSanitizeTicketForArchive(source){
  const clean = JSON.parse(JSON.stringify(source || {}));

  // Головний секрет абонента не повинен жити у Telegram навіть у закритій
  // групі. Локально поле не змінюємо — воно як і раніше доступне в застосунку
  // та договорі/QR.
  delete clean.password;

  // У cloud/raw заявках пароль інколи може бути вписаний прямо у content.
  // Прибираємо лише явно підписані рядки, не намагаючись вгадувати числа.
  if(typeof clean.content === 'string') clean.content = securityTelegramRedactPasswordLines(clean.content);

  // Тимчасові поля редактора не мають цінності для відновлення заявки.
  delete clean._origContent;
  delete clean._origSum;

  clean.telegramArchiveFormat = 2;
  clean.telegramSecretsExcluded = ['password'];
  return clean;
}

// Текст у приватній групі лишається корисним для пошуку: заявка, адреса,
// приватна примітка, геолокація та логін. Пароль сюди більше не додаємо.
if(typeof buildTelegramBackupText === 'function'){
  buildTelegramBackupText = function(t){
    const base = securityTelegramRedactPasswordLines(t?.content || '');
    const extra = [];
    if(t?.masterNote) extra.push(`🔒 Тільки для вас: ${t.masterNote}`);
    if(t?.geoLink) extra.push(`📍 Геолокація: ${t.geoLink}`);
    if(t?.login) extra.push(`👤 Логін: ${t.login}`);
    if(!extra.length) return base;
    return `${base}${base ? '\n------------------\n' : ''}${extra.join('\n')}`;
  };
}

// app.js формує ticket-<id>.json без окремого hook. Щоб не переписувати
// великий backupTicketToTelegramNow(), перехоплюємо ТІЛЬКИ Telegram sendDocument
// з ticket-*.json і підміняємо вкладення санітизованою копією. Інші fetch,
// документи, фото, Google sync та dispatcher-повідомлення проходять без змін.
try{
  const securityTelegramNativeFetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    try{
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const body = init && init.body;
      if(/https:\/\/api\.telegram\.org\/bot[^/]+\/sendDocument(?:\?|$)/i.test(url) && body instanceof FormData){
        const doc = body.get('document');
        const fileName = doc && typeof doc.name === 'string' ? doc.name : '';
        if(doc instanceof Blob && /^ticket-.+\.json$/i.test(fileName)){
          const parsed = JSON.parse(await doc.text());
          const safe = securityTelegramSanitizeTicketForArchive(parsed);
          const safeBody = new FormData();
          for(const [key, value] of body.entries()){
            if(key === 'document') continue;
            safeBody.append(key, value);
          }
          safeBody.append('document', new Blob([JSON.stringify(safe, null, 2)], {type:'application/json'}), fileName);
          return securityTelegramNativeFetch(input, {...init, body:safeBody});
        }
      }
    }catch(err){
      console.error('Telegram security sanitizer fallback:', err);
    }
    return securityTelegramNativeFetch(input, init);
  };
}catch(e){ /* старий WebView: не ламаємо штатну мережеву поведінку */ }

if(typeof renderSettingsScreen === 'function'){
  const securityTelegramOriginalRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = securityTelegramOriginalRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_TELEGRAM_RELEASE_LABEL}`;
    return result;
  };
}

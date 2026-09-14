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
    const geoUrl=typeof MTToolsCore!=='undefined' ? MTToolsCore.googleMapsUrl(t) : (t?.geoLink||'');
    if(geoUrl && !base.includes(geoUrl)) extra.push(`📍 Геолокація: ${geoUrl}`);
    if(t?.login) extra.push(`👤 Логін: ${t.login}`);
    if(!extra.length) return base;
    return `${base}${base ? '\n------------------\n' : ''}${extra.join('\n')}`;
  };
}

// app.js формує ticket-<id>.json без окремого hook. Єдиний реальний
// consumer sendDocument — telegramBackupFetchJson() з photo-telegram-domain.
// Загальний window.fetch не змінюємо: санітизуємо лише його точку відправки.
const SECURITY_TELEGRAM_ARCHIVE_DOCUMENT_RE=/^https:\/\/api\.telegram\.org\/bot[^/]+\/sendDocument(?:\?|$)/i;
async function securityTelegramArchiveRequestOptions(url,options){
  const body=options&&options.body;
  if(!SECURITY_TELEGRAM_ARCHIVE_DOCUMENT_RE.test(String(url||''))||typeof FormData==='undefined'||!(body instanceof FormData))return options;
  const documentFile=body.get('document');
  const fileName=documentFile&&typeof documentFile.name==='string'?documentFile.name:'';
  if(typeof Blob==='undefined'||!(documentFile instanceof Blob)||!/^ticket-.+\.json$/i.test(fileName))return options;
  let parsed;
  try{parsed=JSON.parse(await documentFile.text());}
  catch(error){
    globalThis.MTSafeError?.reportError?.(error,{scope:'telegram-archive-sanitize'});
    // Не пропускаємо неперевірений archive JSON далі: помилка означає retry,
    // а не відправку потенційного пароля у приватну групу.
    throw new Error('TELEGRAM_ARCHIVE_SANITIZE_FAILED');
  }
  const safeBody=new FormData();
  for(const [key,value] of body.entries())if(key!=='document')safeBody.append(key,value);
  safeBody.append('document',new Blob([JSON.stringify(securityTelegramSanitizeTicketForArchive(parsed),null,2)],{type:'application/json'}),fileName);
  return {...options,body:safeBody};
}
function securityTelegramWrapArchiveFetch(originalFetch){
  return async function(url,options,ticket,rateRetries){
    const safeOptions=await securityTelegramArchiveRequestOptions(url,options);
    return originalFetch.call(this,url,safeOptions,ticket,rateRetries);
  };
}
if(typeof telegramBackupFetchJson==='function'){
  telegramBackupFetchJson=securityTelegramWrapArchiveFetch(telegramBackupFetchJson);
}

if(typeof renderSettingsScreen === 'function'){
  const securityTelegramOriginalRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = securityTelegramOriginalRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_TELEGRAM_RELEASE_LABEL}`;
    return result;
  };
}

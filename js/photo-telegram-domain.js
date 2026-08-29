/* Canonical local-photo lifecycle and direct Telegram workflows. */

async function fetchPhotoFromTelegram(fileId){
  const token = (settings.tgBotToken||'').trim();
  if(!fileId || !token) return null;
  try{
    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const info = await infoRes.json();
    if(!info.ok) return null;
    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`);
    const blob = await fileRes.blob();
    return await new Promise(resolve=>{
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = ()=> resolve(null);
      reader.readAsDataURL(blob);
    });
  }catch(e){ console.error('Telegram photo backup request failed'); return null; }
}
async function collectLocalPhotoData(ticketList){
  const photoData = {};
  const photoKeys = new Set();
  (ticketList||[]).forEach(t=>{
    const keys = (t.photos && t.photos.length) ? t.photos : (t.photo ? [t.photo] : []);
    keys.forEach(key=>{ if(String(key||'').startsWith('idb:')) photoKeys.add(key); });
  });
  let missingPhotos = 0;
  for(const key of photoKeys){
    const dataUrl = await photoDbGet(key);
    if(dataUrl) photoData[key] = dataUrl;
    else missingPhotos++;
  }
  return {photoData, missingPhotos};
}
/* Повертає base64 фото за ключем заявки/калькулятора (синхронно, з кешу,
   або асинхронно довантажує з IndexedDB та перемальовує callback-ом).
   tgFallbackFileId — необов'язковий: якщо локально нічого не знайшлось,
   пробуємо дотягнути з Telegram-бекапу (див. fetchPhotoFromTelegram вище). */
function getPhotoCached(photoKey, onLoaded, tgFallbackFileId){
  if(!photoKey) return null;
  if(!String(photoKey).startsWith('idb:')) return photoKey; // старі дані (base64 напряму) — сумісність
  if(photoCache.has(photoKey)) return photoCache.get(photoKey);
  photoDbGet(photoKey).then(async val=>{
    if(!val && tgFallbackFileId){
      val = await fetchPhotoFromTelegram(tgFallbackFileId);
      if(val) await photoDbPut(photoKey, val); // лікуємо локальне сховище під тим самим ключем
    }
    if(val){ photoCacheSet(photoKey, val); if(onLoaded) onLoaded(val); }
  });
  return null;
}
/* Зберігає нове фото (data URL) в IndexedDB, повертає ключ для запису в заявку */
/* Те саме, що getPhotoCached, але як Promise — для місць, де потрібно дочекатись результату (поділитися, тощо) */
async function resolvePhotoAsync(photoKey, tgFallbackFileId){
  if(!photoKey) return null;
  if(!String(photoKey).startsWith('idb:')) return photoKey; // старі дані — сумісність
  if(photoCache.has(photoKey)) return photoCache.get(photoKey);
  let val = await photoDbGet(photoKey);
  if(!val && tgFallbackFileId){
    val = await fetchPhotoFromTelegram(tgFallbackFileId);
    if(val) await photoDbPut(photoKey, val); // лікуємо локальне сховище під тим самим ключем
  }
  if(val) photoCacheSet(photoKey, val);
  return val;
}
async function storePhoto(dataUrl){
  const key = 'idb:' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  photoCacheSet(key, dataUrl);
  // Якщо IndexedDB відмовив (наприклад, закінчилось місце), ключ не можна
  // лишати в заявці: прев'ю з пам'яткового кешу зникло б після перезапуску.
  const ok = await photoDbPut(key, dataUrl);
  if(!ok){
    photoCache.delete(key);
    showToast('⚠️ Не вдалося зберегти фото на телефон — не закривайте застосунок, спробуйте ще раз');
    return null;
  }
  return key;
}
async function deletePhotoKey(key){
  if(!key || !String(key).startsWith('idb:')) return;
  photoCache.delete(key);
  await photoDbDelete(key);
}
function clearAllPhotos(){
  photoCache.clear();
  if(!photoDb) return;
  try{
    const tx = photoDb.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).clear();
  }catch(e){ console.error(e); }
}
/* ---- Щоденні автобекапи — самі знімки (важкі, tickets+shifts) лежать в
   IndexedDB (окрема база, як і фото), а легкий список по датах — у
   localStorage (dailyBackupIndex), щоб швидко малювати список у Налаштуваннях
   без походу в IndexedDB. ---- */

async function migrateLegacyPhotosToIdb(){
  if(!photoDb) return;
  let changed = false;
  for(const t of tickets){
    const sourcePhotos = (t.photos && t.photos.length) ? t.photos : (t.photo ? [t.photo] : []);
    if(!sourcePhotos.length) continue;
    const migratedPhotos = [];
    for(const photo of sourcePhotos){
      if(typeof photo==='string' && photo.startsWith('data:')){
        const key = await storePhoto(photo);
        migratedPhotos.push(key || photo); // якщо IndexedDB недоступний, не губимо старе base64-фото
        if(key) changed = true;
      }else if(photo){
        migratedPhotos.push(photo);
      }
    }
    t.photos = migratedPhotos;
    t.photo = migratedPhotos[0] || null;
  }
  if(changed) saveTickets();
}

function telegramMessageLink(msgId){
  const chatId = (settings.tgBackupChatId||'').trim();
  if(!chatId || !msgId) return null;
  const internalId = chatId.replace(/^-100/, '').replace(/^-/, '');
  return `https://t.me/c/${internalId}/${msgId}`;
}
function openTicketInTelegram(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return;
  // беремо перше з наявних — розділювач (початок "картки" заявки) як пріоритет,
  // інакше текст, інакше фото чи json — щоб хоч якесь повідомлення знайшлось
  const msgId = t.tgSepMsgId || t.tgTextMsgId || t.tgPhotoMsgId || t.tgJsonMsgId;
  const link = telegramMessageLink(msgId);
  if(!link){ showToast('Цю заявку ще не надіслано в Telegram-групу'); return; }
  window.open(link, '_blank');
}
// NEW: ручний повтор бекапу в Telegram прямо з картки заявки (кнопка ☁️⏳) —
// на випадок, коли автоматична відправка (при збереженні) не долетіла.
function retryTelegramBackup(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return;
  showToast('Повторно надсилаю в Telegram…');
  backupTicketToTelegram(t);
}

/* ---- Надіслати заявку диспетчеру через бота (за вимогою, з кнопки) ----
   На відміну від резервного копіювання нижче — це не тихий фон, а явна дія
   майстра: показуємо тост про успіх/помилку. Використовує той самий бот
   (tgBotToken), але окремий chat_id — особистий чат диспетчера. */
async function sendToTelegramChat(chatId, text, photoKey, tgFileId){
  const token = (settings.tgBotToken||'').trim();
  if(!token || !chatId) return {ok:false, reason:'не налаштовано токен/chat_id'};
  try{
    const msgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: chatId, text: (text||'').slice(0,4000)})
    });
    const msgData = await msgRes.json();
    if(!msgData.ok) return {ok:false, reason: msgData.description || 'sendMessage failed'};
    if(photoKey){
      const photoData = await resolvePhotoAsync(photoKey, tgFileId);
      if(photoData){
        const blob = await (await fetch(photoData)).blob();
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('photo', blob, 'foto.jpg');
        await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {method:'POST', body: form});
      }
    }
    return {ok:true};
  }catch(e){ return {ok:false, reason:String(e)}; }
}
// NEW: список налаштованих диспетчерів — {name, chatId}, тільки ті, де chatId заповнено
function getConfiguredDispatchers(){
  return (settings.tgDispatchers||[]).filter(d=>d.chatId && d.chatId.trim());
}
// Якщо диспетчер один — шле одразу йому. Якщо два — питає, кому саме
// (конкретному або обом), через маленьку модалку з кнопками-іменами.
function chooseDispatcherAndSend(sendFn){
  const list = getConfiguredDispatchers();
  if(!settings.tgBotToken || !list.length){ showToast('Спочатку вкажіть токен бота і Chat ID хоча б одного диспетчера в Налаштуваннях'); return; }
  if(list.length===1){ sendFn([list[0].chatId]); return; }
  openModal('Кому надіслати?', `
    <div class="row wrap" style="gap:8px; flex-direction:column;">
      ${list.map((d,i)=>`<button type="button" class="btn btn-block dispatcher-choice-btn" data-idx="${i}">✈️ ${escapeHtml(d.name || ('Диспетчер '+(i+1)))}</button>`).join('')}
      <button type="button" class="btn btn-accent btn-block" id="dispatcherChoiceAllBtn">✈️ Обом одразу</button>
    </div>
  `, {onOpen: (root)=>{
    root.querySelectorAll('.dispatcher-choice-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ closeModal(); sendFn([list[Number(btn.dataset.idx)].chatId]); });
    });
    document.getElementById('dispatcherChoiceAllBtn').addEventListener('click', ()=>{ closeModal(); sendFn(list.map(d=>d.chatId)); });
  }});
}
async function sendTicketToDispatcher(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return;
  chooseDispatcherAndSend(async (chatIds)=>{
    showToast('Надсилаю диспетчеру…');
    // NEW: диспетчеру шлемо лише текст, без фото — воно й так є в бекап-групі
    const results = await Promise.all(chatIds.map(id2 => sendToTelegramChat(id2, t.content, null, null)));
    const okCount = results.filter(r=>r.ok).length;
    showToast(okCount===chatIds.length ? '✅ Надіслано диспетчеру!' : `Надіслано ${okCount} з ${chatIds.length}: ${results.find(r=>!r.ok)?.reason||''}`);
  });
}
async function sendCurrentTicketToDispatcher(){
  // працює навіть якщо заявку ще не збережено — рахуємо текст прямо з форми
  syncFormToState();
  const text = getCurrentTicketText();
  if(!text){ showToast('Немає що надсилати — заповніть заявку'); return; }
  chooseDispatcherAndSend(async (chatIds)=>{
    showToast('Надсилаю диспетчеру…');
    const results = await Promise.all(chatIds.map(id2 => sendToTelegramChat(id2, text, null, null)));
    const okCount = results.filter(r=>r.ok).length;
    showToast(okCount===chatIds.length ? '✅ Надіслано диспетчеру!' : `Надіслано ${okCount} з ${chatIds.length}: ${results.find(r=>!r.ok)?.reason||''}`);
  });
}

/* ---- Резервне копіювання заявок у закриту Telegram-групу ----
   Не замінює локальне зберігання (фото й далі лежать в IndexedDB як завжди),
   а лише додатково дублює ПОВНІ дані заявки в групу. На кожне збереження
   (і нової заявки, і редагування вже наявної) — спочатку видаляє попередні
   повідомлення цієї заявки в групі (якщо вони були), потім надсилає свіжі:
   текст, фото (якщо є) і повний JSON-знімок усіх полів заявки окремим
   файлом — так група завжди показує АКТУАЛЬНИЙ стан, а не застарілу версію
   після редагування, і жодне поле не губиться (навіть те, чого нема в тексті:
   логін/пароль, вулиця/будинок/квартира, теги, geo-посилання тощо).
   Спрацьовує лише якщо в Налаштуваннях заповнені tgBotToken і tgBackupChatId,
   інакше нічого не робить. Не блокує збереження заявки — викликається без await. */
async function deleteTicketTelegramMessages(t, token, chatId){
  // NEW: tgPhotoMsgIds — усі повідомлення з фото (до 3), tgPhotoMsgId лишається
  // як дублікат першого для сумісності зі старими заявками, тож не дублюємо його
  // в списку, якщо він вже є в масиві.
  const photoIds = (t.tgPhotoMsgIds && t.tgPhotoMsgIds.length) ? t.tgPhotoMsgIds : [t.tgPhotoMsgId].filter(Boolean);
  const ids = [t.tgSepMsgId, t.tgTextMsgId, ...photoIds, t.tgJsonMsgId].filter(Boolean);
  for(const msgId of ids){
    try{
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, message_id: msgId})
      });
    }catch(e){ /* повідомлення могло вже бути видалене вручну — не критично */ }
  }
  t.tgSepMsgId = null; t.tgTextMsgId = null; t.tgPhotoMsgId = null; t.tgJsonMsgId = null; t.tgPhotoMsgIds = []; t.tgPhotoFileIds = [];
}
/* NEW: для бекапу в групу текст має бути ПОВНИМ — на відміну від t.content
   (який навмисно без приватної примітки/геолокації/логіна-пароля, бо саме
   t.content летить диспетчеру при "Поділитися"/"Диспетчеру"). Тут же це ваш
   особистий архів, тож дописуємо все, чого не вистачає в звичайному тексті. */
function buildTelegramBackupText(t){
  const extra = [];
  if(t.masterNote) extra.push(`🔒 Тільки для вас: ${t.masterNote}`);
  if(t.geoLink) extra.push(`📍 Геолокація: ${t.geoLink}`);
  if(t.login) extra.push(`👤 Логін: ${t.login}`);
  if(t.password) extra.push(`🔑 Пароль: ${t.password}`);
  if(!extra.length) return t.content || '';
  return `${t.content||''}\n------------------\n${extra.join('\n')}`;
}
// NEW: на мобільній мережі (перемикання 4G/3G, слабкий сигнал) fetch до Telegram
// інколи обривається саме в очікуванні відповіді — хоча повідомлення вже дійшло
// й показалось у групі. Одна швидка повторна спроба закриває більшість таких
// випадків, не роблячи бекап відчутно повільнішим.
async function fetchWithRetry(url, opts, retries=1){
  // NEW: без таймауту цей fetch міг висіти нескінченно довго на поганому
  // зв'язку — Telegram-бекап відбувається у фоні (не блокує збереження
  // заявки), але без ліміту такі "зависші" запити накопичувались би без
  // кінця. 15с — цього достатньо навіть для повільного 3G, але не дає
  // запиту висіти вічно на мертвому з'єднанні.
  const controller = new AbortController();
  const timeoutId = setTimeout(()=> controller.abort(), 15000);
  try{
    return await fetch(url, {...opts, signal: controller.signal});
  }catch(e){
    if(retries<=0) throw e;
    await new Promise(r=>setTimeout(r, 800));
    return fetchWithRetry(url, opts, retries-1);
  } finally { clearTimeout(timeoutId); }
}
// Серіалізуємо backup по stable id. Наступний запит завжди дістає заявку
// наново з tickets уже після попереднього завершення: save/edit може замінити
// tickets[idx] новим об'єктом, тож старе async-посилання не можна продовжувати.
const telegramBackupQueues = new Map();
function backupTicketToTelegram(ticket, options){
  const id = ticket && ticket.id;
  if(id === undefined || id === null) return Promise.resolve(false);
  const key = String(id);
  const pendingOnly = !!(options && options.pendingOnly);
  const previous = telegramBackupQueues.get(key) || Promise.resolve();
  const job = previous.catch(()=>{}).then(()=>{
    const current = tickets.find(x=>String(x.id)===key);
    if(pendingOnly && (!current || current.tgBackupPending !== true)) return false;
    return current ? backupTicketToTelegramNow(current) : false;
  });
  let tracked;
  tracked = job.finally(()=>{
    if(telegramBackupQueues.get(key) === tracked) telegramBackupQueues.delete(key);
  });
  telegramBackupQueues.set(key, tracked);
  return tracked;
}
async function retryPendingTelegramBackups(){
  if(!navigator.onLine) return;
  const pendingIds = tickets
    .filter(t=>t && t.tgBackupPending === true && t.content)
    .map(t=>String(t.id));
  for(const id of pendingIds){
    if(!navigator.onLine) break;
    const current = tickets.find(t=>String(t.id)===id);
    if(!current || current.tgBackupPending !== true) continue;
    try{ await backupTicketToTelegram(current, {pendingOnly:true}); }catch(_e){}
  }
}
async function backupTicketToTelegramNow(t){
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgBackupChatId||'').trim();
  if(!token || !chatId || !t) return false;
  t.tgBackupPending = true;
  await saveTicketsLocalOnly();
  // NEW: раніше СПОЧАТКУ видаляли стару копію заявки в групі, а вже ПОТІМ
  // відправляли нову — якщо зв'язок обривався саме між цими двома кроками
  // (найімовірніше на поганому інтернеті — а це якраз умови, для яких
  // застосунок і робився), стара копія вже видалена, нова не встигла
  // відправитись — заявка лишалась ЗОВСІМ без бекапу в Telegram. Тепер
  // спочатку зберігаємо id старих повідомлень окремо (не чіпаючи їх),
  // відправляємо нову версію, і лише ПІСЛЯ підтвердженого успіху видаляємо
  // стару — якщо новий бекап не пройшов, стара копія лишається недоторканою
  // як резервний варіант.
  const oldMsgIds = {
    tgSepMsgId: t.tgSepMsgId, tgTextMsgId: t.tgTextMsgId,
    tgPhotoMsgId: t.tgPhotoMsgId, tgPhotoMsgIds: (t.tgPhotoMsgIds||[]).slice(),
    tgJsonMsgId: t.tgJsonMsgId
  };
  // Поки новий текст, усі фото й JSON не підтверджені, стара повна копія
  // лишається робочою. Тому запам'ятовуємо також file_id та статус: при
  // частковій помилці повторна спроба не повинна втратити шлях до старих фото.
  const previousBackupState = {
    tgBackedUp: t.tgBackedUp,
    tgPhotoFileId: t.tgPhotoFileId,
    tgPhotoFileIds: (t.tgPhotoFileIds||[]).slice(),
    tgSepMsgId: t.tgSepMsgId,
    tgTextMsgId: t.tgTextMsgId,
    tgPhotoMsgId: t.tgPhotoMsgId,
    tgPhotoMsgIds: (t.tgPhotoMsgIds||[]).slice(),
    tgJsonMsgId: t.tgJsonMsgId
  };
  let backupSucceeded = false;
  try{
    const previousPrimaryPhotoFileId = t.tgPhotoFileId;
    t.tgPhotoFileId = null;
    t.tgBackedUp = false;
    let textOk = false;

    // 0) розділювач-заголовок — щоб у стрічці групи було одразу видно, де
    // закінчується одна заявка (2-3 повідомлення) і починається наступна
    if(t.content){
      const addr = [t.city, t.street, t.house].filter(Boolean).join(', ');
      const sepText = `➖➖➖➖➖➖➖➖➖➖\n🧾 ${(t.type||'ЗАЯВКА').toUpperCase()}${t.date? ' · '+t.date:''}${t.time? ' '+t.time:''}${addr? ' · '+addr:''}`;
      const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, text: sepText})
      });
      const data = await res.json();
      if(data.ok) t.tgSepMsgId = data.result.message_id;
    }
    // 1) текст — повна версія, включно з приватною міткою/геолокацією/логіном-паролем
    if(t.content){
      const text = buildTelegramBackupText(t).slice(0, 4000); // ліміт Telegram на текст повідомлення
      const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, text})
      });
      const data = await res.json();
      if(data.ok){ textOk = true; t.tgTextMsgId = data.result.message_id; }
    }
    // 2) фото — NEW: усі фото заявки (до 3), а не лише перше. Шлемо по черзі
    // окремими повідомленнями (Telegram sendPhoto — одне фото за раз), кожне
    // з підписом і номером (1/3, 2/3...), щоб було видно, що це саме ця заявка.
    const photosToSend = (t.photos && t.photos.length) ? t.photos : (t.photo ? [t.photo] : []);
    // NEW: раніше запасний Telegram file_id (на випадок, якщо локальної копії
    // фото в IndexedDB вже немає) передавався ЛИШЕ для першого фото
    // (t.tgPhotoFileId — старе одиничне поле), а для другого й третього —
    // завжди null, хоча правильні id для КОЖНОГО фото вже лежать у масиві
    // t.tgPhotoFileIds (заповнюється нижче ж таки після кожної успішної
    // відправки). Через це повторний бекап/відновлення другого-третього фото
    // мовчки не спрацьовував би, якщо локальна копія загубилась.
    const prevTgPhotoFileIds = t.tgPhotoFileIds || [];
    t.tgPhotoFileIds = []; t.tgPhotoMsgIds = [];
    let photoSendAttempts = 0; // NEW: скільки фото реально намагались відправити (є локальна копія/fallback)
    for(let pi=0; pi<photosToSend.length; pi++){
      const fallbackId = prevTgPhotoFileIds[pi] || (pi===0 ? previousPrimaryPhotoFileId : null);
      const photoData = await resolvePhotoAsync(photosToSend[pi], fallbackId);
      if(!photoData) continue;
      photoSendAttempts++;
      const blob = await (await fetch(photoData)).blob();
      const form = new FormData();
      form.append('chat_id', chatId);
      const caption = `${t.date||''} ${t.time||''} ${t.city||''} ${t.street||''} ${t.house||''}`.trim();
      form.append('caption', (photosToSend.length>1 ? `${caption} (${pi+1}/${photosToSend.length})` : caption).slice(0,1020));
      form.append('photo', blob, 'foto.jpg');
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {method:'POST', body: form});
      const data = await res.json();
      if(data.ok){
        const sizes = data.result.photo || [];
        const fileId = sizes.length ? sizes[sizes.length-1].file_id : null; // найбільший варіант — для повноцінного відновлення
        t.tgPhotoFileIds.push(fileId);
        t.tgPhotoMsgIds.push(data.result.message_id);
      }
    }
    // NEW: раніше стару копію видаляли, щойно проходив ТЕКСТ (t.tgBackedUp),
    // навіть якщо ВСІ фото не відправились (наприклад, короткий збій саме
    // sendPhoto) — нова версія лишалась без фото, а стара (де фото ще були)
    // вже видалена. Тепер видаляємо стару копію лише якщо текст пройшов І
    // (фото в заявці не було, або всі спроби відправки фото, які реально
    // відбулись, — успішні).
    const photosOk = photoSendAttempts === photosToSend.length && t.tgPhotoMsgIds.length === photosToSend.length;
    // старі поля лишаються дублікатом першого фото — для сумісності зі старим кодом
    t.tgPhotoFileId = t.tgPhotoFileIds[0] || null;
    t.tgPhotoMsgId = t.tgPhotoMsgIds[0] || null;
    // 3) повний JSON-знімок УСІХ полів заявки — окремим файлом, це і є
    // "повний бекап" (а не лише те, що влізло в короткий текст вище)
    let jsonOk = false;
    try{
      const jsonTicket = {...t};
      delete jsonTicket.tgBackupPending;
      const jsonBlob = new Blob([JSON.stringify(jsonTicket, null, 2)], {type:'application/json'});
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('document', jsonBlob, `ticket-${t.id}.json`);
      const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {method:'POST', body: form});
      const data = await res.json();
      if(data.ok){ jsonOk = true; t.tgJsonMsgId = data.result.message_id; }
    }catch(e){ console.error('Telegram JSON backup request failed'); }
    // NEW: нова версія підтверджено відправлена (текст пройшов) — тепер
    // безпечно прибрати стару копію. Якщо старої не було (перший бекап
    // цієї заявки) — deleteTicketTelegramMessages просто нічого не робить.
    if(textOk && photosOk && jsonOk){
      t.tgBackedUp = true;
      await deleteTicketTelegramMessages(oldMsgIds, token, chatId);
      backupSucceeded = true;
      t.tgBackupPending = false;
    }
  }catch(e){ console.error('Telegram backup request failed'); } // тихо — це лише резервна копія, не критична дія
  finally{
    if(!backupSucceeded) Object.assign(t, previousBackupState);
    // NEW: раніше saveTickets() викликався лише в кінці "щасливого" шляху —
    // якщо зв'язок обривався десь на середині (а повідомлення в Telegram все
    // одно доходило), локально це не зберігалось і галочка "✅" губилась
    // назавжди, навіть після перезаходу в застосунок. Тепер зберігаємо й
    // перемальовуємо картку в будь-якому разі, незалежно від результату.
    await saveTicketsLocalOnly();
    refreshTicketCardDom(t.id);
  }
  return backupSucceeded;
}
// NEW: тестове повідомлення в Налаштуваннях — перевірити, що токен і chat_id правильні.
// Приймає chatId ззовні, щоб однією функцією перевіряти всі три призначення.

/* ---- Відновлення ОДНІЄЇ заявки з Telegram-архіву -------------------------
   Кожна заявка при бекапі (backupTicketToTelegram) додатково зберігається в
   групі повним JSON-файлом (ticket-<id>.json) з УСІМА полями: логін/пароль,
   номер договору, geo, нотатка майстра, а також ідентифікатори оригінальних
   повідомлень у групі (tgSepMsgId/tgTextMsgId/tgPhotoMsgId/tgJsonMsgId) —
   тому після відновлення кнопки "🕘" і "☁️✅" продовжують працювати так,
   ніби заявку й не видаляли, навіть якщо локальне фото вже загублено.
   Майстер сам відкриває потрібний .json у Telegram, копіює весь його текст
   і вставляє в модалку нижче — жодних токенів чи ручного набору полів. */
function restoreTicketFromTelegramJson(jsonText){
  let parsed;
  try{ parsed = JSON.parse(jsonText); }
  catch(e){ showToast('Не вдалося розпізнати текст — перевірте, що вставили ВЕСЬ вміст .json-файлу'); return false; }
  if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)){
    showToast('Схоже, це не файл заявки — перевірте, що скопіювали правильний .json'); return false;
  }
  // NEW: перевіряємо не лише наявність date, а й що це справді схоже на
  // заявку (дата у форматі ДД.ММ.РРРР, тип — непорожній рядок, сума — число,
  // якщо взагалі вказана) — щоб випадковий чи пошкоджений JSON не потрапив
  // у список заявок і не поламав рендер картки.
  if(typeof parsed.date !== 'string' || !/^\d{2}\.\d{2}\.\d{4}$/.test(parsed.date.trim())){
    showToast('У файлі немає коректної дати (формат ДД.ММ.РРРР) — це точно заявка з Майстер-Трекера?'); return false;
  }
  if(typeof parsed.type !== 'string' || !parsed.type.trim()){
    showToast('У файлі не вказано тип заявки — перевірте, що скопіювали правильний .json'); return false;
  }
  if(parsed.sum!==undefined && parsed.sum!==null && typeof parsed.sum!=='number' && isNaN(Number(parsed.sum))){
    showToast('Поле "сума" у файлі має неправильний формат — перевірте .json'); return false;
  }
  if(parsed.content!==undefined && parsed.content!==null && typeof parsed.content!=='string'){
    showToast('Поле "зміст" у файлі має неправильний формат — перевірте .json'); return false;
  }
  const restored = JSON.parse(JSON.stringify(parsed));
  if(restored.sum!==undefined && restored.sum!==null) restored.sum = Number(restored.sum) || 0;
  restored.id = MTSyncEngineRuntime.uuid();
  delete restored.synced;
  tickets.push(restored);
  saveTickets();
  currentTicketDate = restored.date || currentTicketDate;
  renderTicketsScreen();
  showToast('✅ Заявку відновлено з Telegram!');
  return true;
}
function showRestoreFromTelegramModal(){
  openModal('♻️ Відновити заявку з Telegram', `
    <div style="font-size:12.5px; color:var(--text-dim); margin-bottom:10px; line-height:1.6;">
      1. Відкрийте закриту групу-архів у Telegram, знайдіть потрібну заявку (за датою чи адресою в тексті над файлами).<br>
      2. Відкрийте при ній файл <span style="font-family:var(--mono); font-size:11.5px;">ticket-XXXXXXXXXXXXX.json</span> — Telegram покаже його як текст — і скопіюйте увесь вміст файлу.<br>
      3. Вставте цей текст у поле нижче й натисніть "Відновити".
    </div>
    <textarea id="tgRestoreJsonInput" rows="8" style="width:100%; font-family:var(--mono); font-size:12px; resize:vertical;" placeholder='{"id":..., "type":"Ремонт", "date":"..."}'></textarea>
    <button type="button" class="btn btn-accent btn-block" id="tgRestoreJsonBtn" style="margin-top:10px;">♻️ Відновити заявку</button>
  `, {onOpen: (root)=>{
    root.querySelector('#tgRestoreJsonBtn').addEventListener('click', ()=>{
      const text = root.querySelector('#tgRestoreJsonInput').value.trim();
      if(!text){ showToast('Вставте текст .json-файлу'); return; }
      const ok = restoreTicketFromTelegramJson(text);
      if(ok) closeModal();
    });
  }});
}
async function sendTelegramTestMessage(chatId, label){
  const token = (settings.tgBotToken||'').trim();
  chatId = (chatId||'').trim();
  if(!token || !chatId){ showToast('Спочатку заповніть токен і відповідний Chat ID'); return; }
  try{
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: chatId, text: `✅ Майстер-Трекер: зв'язок налаштовано (${label}).`})
    });
    const data = await res.json();
    showToast(data.ok ? 'Тестове повідомлення надіслано!' : `Помилка Telegram: ${data.description||'невідома'}`);
  }catch(e){ showToast('Не вдалося з\'єднатись із Telegram'); }
}

/* ---- Місячний звіт собі особисто (1-го числа, автоматично) ----
   Рахує зміни/години, кількість і суму заявок, та зведення встановленого
   обладнання/кабелю/робіт — усе за щойно завершений місяць. */
function buildMonthlyTelegramReport(refDate){
  const monthTickets = tickets.filter(t=>isSameMonth(t.date, refDate));
  const monthShifts = shifts.filter(s=>isSameMonth(s.date, refDate));
  const totalHours = monthShifts.reduce((s,x)=>s+(Number(x.hours)||0),0);
  const totalSum = monthTickets.reduce((s,t)=>s+(Number(t.sum)||0),0);
  const byType = {};
  monthTickets.forEach(t=>{ const ty=t.type||'Інше'; byType[ty] = (byType[ty]||0) + 1; });
  const lines = [];
  lines.push(`📊 ЗВІТ ЗА ${MONTH_NAMES[refDate.getMonth()].toUpperCase()} ${refDate.getFullYear()}`);
  lines.push('──────────');
  lines.push(`🕒 Змін: ${monthShifts.length}, годин: ${totalHours.toFixed(1)}`);
  lines.push(`🧾 Заявок: ${monthTickets.length}, сума: ${fmtMoney(totalSum)}`);
  Object.entries(byType).forEach(([ty,count])=> lines.push(`   • ${ty}: ${count}`));
  lines.push('──────────');
  lines.push('📦 Встановлено обладнання:');
  const eqLines = buildMonthlyEquipmentLines(monthTickets);
  if(eqLines.length) eqLines.forEach(l=> lines.push('   • '+l));
  else lines.push('   — немає даних');
  return lines.join('\n');
}
async function sendMonthlyTelegramReportNow(){
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgMyChatId||'').trim();
  if(!token || !chatId){ showToast('Спочатку заповніть токен і ваш особистий Chat ID'); return; }
  const now = new Date();
  const lastMonthRef = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const text = buildMonthlyTelegramReport(lastMonthRef);
  showToast('Надсилаю звіт…');
  const res = await sendToTelegramChat(chatId, text, null, null);
  showToast(res.ok ? '✅ Звіт надіслано!' : `Не вдалося надіслати: ${res.reason}`);
}
// NEW: викликається раз при старті застосунку — 1-го числа місяця сам надсилає
// звіт за щойно завершений місяць, якщо ще не надсилав цього місяця
async function maybeSendMonthlyTelegramReport(){
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgMyChatId||'').trim();
  if(!token || !chatId) return;
  const now = new Date();
  if(now.getDate() !== 1) return;
  const monthKey = localMonthKey(now);
  if(localStorage.getItem('tgMonthlyReportMonth') === monthKey) return;
  const lastMonthRef = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const text = buildMonthlyTelegramReport(lastMonthRef);
  const res = await sendToTelegramChat(chatId, text, null, null);
  if(res.ok) localStorage.setItem('tgMonthlyReportMonth', monthKey);
}

/* ---- Спільний "двигун" для масової відправки в Telegram-групу ----
   Показує модалку з прогресом, шле по одній заявці з паузою (щоб не
   впертися в ліміти Telegram), дає кнопку "Зупинити". Використовується і для
   довантаження нових заявок, і для повного перезапису вже надісланих. */
let bulkExportRunning = false;
let bulkExportCancelled = false;
async function runBulkTelegramJob(list, title){
  bulkExportRunning = true;
  bulkExportCancelled = false;
  openModal(title, `
    <div style="text-align:center; padding:16px 10px;">
      <div style="font-size:14.5px; color:var(--text-dim); margin-bottom:10px;">Надсилаю заявки в групу…</div>
      <div class="tabular" id="bulkExportCounter" style="font-size:26px; font-weight:800;">0 / ${list.length}</div>
    </div>
    <button type="button" class="btn btn-danger btn-block" id="bulkExportCancelBtn">Зупинити</button>
  `, {onOpen: ()=>{
    document.getElementById('bulkExportCancelBtn').addEventListener('click', ()=>{ bulkExportCancelled = true; });
  }});

  let done = 0;
  // NEW: те саме застереження, що й у retrySyncQueue — без try/finally
  // виняток усередині циклу назавжди заблокував би повторний запуск і
  // лишив би модалку відкритою.
  try{
    for(const t of list){
      if(bulkExportCancelled) break;
      await backupTicketToTelegram(t);
      done++;
      const counterEl = document.getElementById('bulkExportCounter');
      if(counterEl) counterEl.textContent = `${done} / ${list.length}`;
      await new Promise(r=>setTimeout(r, 1400));
    }
  } finally {
    bulkExportRunning = false;
    closeModal();
  }
  showToast(bulkExportCancelled ? `Зупинено: оброблено ${done} з ${list.length}` : `Готово: оброблено ${done} заявок(и)`);
}

/* ---- Одноразове вивантаження вже наявних заявок у групу-архів ----
   Для заявок, створених до налаштування бота. Надсилає лише ті, яких у
   групі ще НІКОЛИ не було — редаговані вже синхронізуються самі при
   збереженні, а вже надіслані пропускаються (щоб не плодити дублі). */
async function bulkExportTicketsToTelegram(){
  if(bulkExportRunning){ showToast('Вивантаження вже триває'); return; }
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgBackupChatId||'').trim();
  if(!token || !chatId){ showToast('Спочатку налаштуйте токен і Chat ID групи вище'); return; }
  const todo = tickets.filter(t => !t.tgBackedUp && t.content);
  if(!todo.length){ showToast('Усі заявки вже вивантажено в групу'); return; }
  const etaMin = Math.ceil(todo.length * 1.4 / 60);
  if(!confirm(`Буде надіслано ${todo.length} заявок(и) у групу. Орієнтовно ~${etaMin} хв (навмисна пауза між заявками, щоб не впертися в ліміти Telegram). Не закривайте застосунок, поки триває. Продовжити?`)) return;
  await runBulkTelegramJob(todo, 'Вивантаження в Telegram');
}

/* ---- Повний перезапис УЖЕ надісланих заявок ----
   На відміну від функції вище — бере геть усі заявки з текстом, незалежно
   від того, чи вони вже позначені tgBackedUp. Кожну спочатку видаляє з групи
   (старі повідомлення), потім шле заново — текст + фото + повний JSON-файл.
   Потрібно, наприклад, якщо бот/функцію бекапу додали пізніше, і старі заявки
   в групі є лише текстом без JSON-файлу — цим можна "дотягнути" їх до повного
   формату заднім числом. */
async function resyncAllTicketsToTelegram(){
  if(bulkExportRunning){ showToast('Вивантаження вже триває'); return; }
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgBackupChatId||'').trim();
  if(!token || !chatId){ showToast('Спочатку налаштуйте токен і Chat ID групи вище'); return; }
  const all = tickets.filter(t => t.content);
  if(!all.length){ showToast('Немає заявок для вивантаження'); return; }
  const etaMin = Math.ceil(all.length * 1.4 / 60);
  if(!confirm(`Це ПЕРЕЗАПИШЕ геть усі ${all.length} заявок(и) у групі: старі повідомлення кожної заявки буде видалено, замість них надіслано свіжі (текст + фото + повний JSON-файл). Орієнтовно ~${etaMin} хв. Не закривайте застосунок, поки триває. Продовжити?`)) return;
  await runBulkTelegramJob(all, 'Перезапис усіх заявок у Telegram');
}

/* Поділитися заявкою (текст + фото, якщо є) — відкриває системне меню «Поділитися»,
   де серед застосунків буде Viber, якщо він встановлений на телефоні. */

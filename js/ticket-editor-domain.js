/* Canonical ticket calculator/editor workflows. */

function hasUnsavedChanges(){
  const s = calcState;
  if(s.signal) return true;
  if(s.otherNote) return true;
  if(s.city || s.address || s.street || s.house || s.clientName || s.phone) return true;
  if(s.note || s.masterNote) return true;
  if(s.photo) return true;
  if(s.macAddress) return true;
  // NEW: для заявки, відновленої з хмари (cloudImported), правки в контенті
  // й сумі (поля f_rawContent/f_rawSum, синхронізуються syncFormToState)
  // раніше НІЯК не потрапляли в цю перевірку — жодне з полів вище для такої
  // заявки типово не заповнене (вона зберігає лише текстовий content, а не
  // розібрані city/address/phone/...). Через це для raw-заявок автозбереження
  // чернетки НЕ спрацьовувало, і попередження "є незбережені зміни" при виході
  // без збереження НЕ з'являлось — правки тихо губились.
  if(s.cloudImported && (s.content !== s._origContent || s.sum !== s._origSum)) return true;
  if(s.login || s.password) return true;
  if(s.type === 'Ремонт' && s.contractNumber) return true; // NEW: вручну введений номер договору для ремонту
  if(s.geoLink) return true;
  if((s.callFee>0 && !feeIsAutoDefault) || (s.tariff>0 && !tariffIsAutoDefault)) return true; // NEW: авто-підставлена ціна за замовчуванням — не «зміна»
  if((s.cables||[]).some(c=> Number(c.meters)>0)) return true; // NEW: динамічний список кабелів
  if((s.equipment||[]).some(e=>e.checked)) return true;
  if((s.presetWorks||[]).some(w=>w.checked)) return true;
  if((s.additionalWork||[]).some(w=>w.desc || w.sum)) return true; // порожній рядок за замовчуванням не рахується
  // NEW: тег типу роботи (підключення/ремонт) вмикається автоматично для щойно
  // створеної заявки — сам по собі він не «зміна», інакше кожна порожня нова
  // заявка вважалась би чернеткою і при кожному відкритті застосунку зайве
  // спливало б «Відновити чернетку?». Рахуємо зміною лише БУДЬ-ЯКИЙ ІНШИЙ тег.
  const autoTag = TYPE_TAG_MAP[s.type];
  if((s.tags||[]).some(tag => tag !== autoTag)) return true;
  return false;
}

/* ---- Автозбереження чернетки ---- */
const DRAFT_KEY = 'ticketDraft';

function saveDraftToLocalStorage(){
  syncFormToState(); // NEW: без цього calcState міг лишатись застарілим (не оновлювався на кожне натискання клавіші) — автозбереження раз на 30с іноді записувало старі дані, а не те, що реально введено в полях
  if(!hasUnsavedChanges()) return; // немає що зберігати — не смітимо сховище
  if(!formTouchedByUser) return; // NEW: форму лише відкрили (можливо, з автопідстановкою з наряду/профілю) — руками ще нічого не вводили, це не "чернетка"
  try{
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      ts: Date.now(),
      editingTicketId,
      state: calcState,
      // Потрібно після перезапуску відрізнити фото самої збереженої заявки
      // від фото, доданих лише до чернетки й ще не підтверджених збереженням.
      originalPhotoKeys: calcOriginalPhotoKeys.slice()
    }));
  }catch(e){ /* сховище повне чи недоступне — пропускаємо, це не критично */ }
}

function clearDraft(){
  localStorage.removeItem(DRAFT_KEY);
}

// NEW: прибирає з IndexedDB фото, додані в поточному сеансі редагування,
// але так і не збережені в жодній заявці (щоб не накопичувалось "сміття"
// при скасуванні редагування/створення заявки з уже зробленими фото).
function cleanupUnsavedNewPhotos(){
  (calcState.photos||[]).forEach(key=>{
    if(key && String(key).startsWith('idb:') && !calcOriginalPhotoKeys.includes(key)) deletePhotoKey(key);
  });
}
function cleanupUnsavedDraftPhotos(draft){
  // Старі чернетки не мають цього списку. Не видаляємо їхні фото навмання:
  // частина з них могла належати вже збереженій заявці.
  if(!Array.isArray(draft.originalPhotoKeys)) return;
  const originalKeys = draft.originalPhotoKeys;
  (draft.state.photos||[]).forEach(key=>{
    if(key && String(key).startsWith('idb:') && !originalKeys.includes(key)) deletePhotoKey(key);
  });
}

function restoreDraftIfAny(){
  const raw = localStorage.getItem(DRAFT_KEY);
  if(!raw) return;
  let draft;
  try{ draft = JSON.parse(raw); } catch(e){ clearDraft(); return; }
  if(!draft || !draft.state) { clearDraft(); return; }
  const d = new Date(draft.ts);
  const ok = confirm(`Знайдено незбережену чернетку заявки від ${formatDate(d)} ${formatTime(d)}.\nВідновити її?`);
  if(!ok){ cleanupUnsavedDraftPhotos(draft); clearDraft(); return; }
  editingTicketId = draft.editingTicketId || null;
  loadTicketIntoForm(draft.state);
  if(Array.isArray(draft.originalPhotoKeys)) calcOriginalPhotoKeys = draft.originalPhotoKeys.slice();
  if(editingTicketId){
    document.getElementById('saveTicketBtn').textContent = 'Оновити заявку';
    document.getElementById('cancelEditBtn').classList.remove('hidden');
  }
  switchTab('calculator');
  showToast('Чернетку відновлено');
}

// NEW: "бригада на сьогодні" — перший вибір напарників за поточний календарний
// день запам'ятовується і сам підставляється в кожну наступну НОВУ заявку,
// поки ви його свідомо не зміните (тоді підставлятиметься вже нове значення).
// Наступного дня скидається — знову чекає першого вибору.
const DAILY_MASTERS_KEY = 'dailyMastersDefault';
function loadDailyMastersDefault(){
  try{
    const raw = JSON.parse(localStorage.getItem(DAILY_MASTERS_KEY));
    if(raw && raw.date === formatDate(new Date())) return raw.masters || [];
  }catch(e){}
  return null; // нічого не збережено на сьогодні (або запис ще з учорашнього дня)
}
function saveDailyMastersDefault(masters){
  try{ localStorage.setItem(DAILY_MASTERS_KEY, JSON.stringify({date: formatDate(new Date()), masters})); }catch(e){}
}
function resetCalcForm(presetDate, overrides){
  calcState = blankCalcState();
  naryadPendingCompletionId = null;
  formSessionId++; // NEW: новий сеанс форми — попередні "фото в польоті" себе впізнають і не приліпляться сюди
  if(presetDate) calcState.date = presetDate;
  calcOriginalPhotoKeys = []; // NEW: нова порожня заявка — жодного "оригінального" фото ще нема
  // NEW: дозволяє одразу підставити тип заявки й дані абонента (з профілю
  // навігатора адрес) у щойно відкриту порожню форму — застосовується ДО
  // логіки тегу за типом нижче, щоб автотег теж підхопив правильний тип.
  if(overrides) Object.assign(calcState, overrides);
  if(overrides && !Object.prototype.hasOwnProperty.call(overrides,'baseCallFee') && Object.prototype.hasOwnProperty.call(overrides,'callFee')){
    calcState.baseCallFee=safeNonNegativeNumber(overrides.callFee);
  }
  editingTicketId = null;
  feeIsAutoDefault = true; // NEW: нова заявка — ціну можна підставляти автоматично за типом
  tariffIsAutoDefault = true;
  formTouchedByUser = false; // NEW: нова (можливо, підставлена з наряду/профілю) форма — ще не "чернетка", доки самі не почнете її заповнювати
  // NEW: нова заявка стартує з типом "Підключення" — одразу вмикаємо тег "підключення"
  const defTag = TYPE_TAG_MAP[calcState.type];
  if(defTag){
    if(!settings.tags.includes(defTag)){ settings.tags.push(defTag); saveSettings(); }
    if(!calcState.tags.includes(defTag)) calcState.tags.push(defTag);
  }
  // NEW: підставляємо "бригаду на сьогодні", якщо вона вже обиралась раніше цього дня
  const dailyMasters = loadDailyMastersDefault();
  if(dailyMasters && dailyMasters.length){
    calcState.connectMasters = dailyMasters.map(m=>({...m}));
    dailyMasters.forEach(m=>{ if(!calcState.tags.includes(m.name)) calcState.tags.push(m.name); });
  }
  document.getElementById('saveTicketBtn').textContent = 'Зберегти заявку';
  document.getElementById('cancelEditBtn').classList.add('hidden');
  fillFormFromState();
  // NEW: якщо тип підставили через overrides (не "Підключення" за замовчуванням) —
  // ціну виклику/тариф перерахуємо під фактичний тип, а не під той, для якого
  // їх порахував blankCalcState() ще до застосування overrides.
  if(overrides && overrides.type){ applyDefaultCallFee(); applyDefaultTariff(); }
}

function loadTicketIntoForm(t){
  calcState = JSON.parse(JSON.stringify(t)); // глибока копія, щоб не мутувати реєстр до збереження
  // Старі заявки не мають окремої базової ціни. Беремо їхнє фактичне
  // збережене значення як є (у тому числі 0), не намагаючись вгадати,
  // чи колись воно було обнулене порогом безкоштовного виклику.
  if(!Object.prototype.hasOwnProperty.call(calcState,'baseCallFee')) calcState.baseCallFee=safeNonNegativeNumber(calcState.callFee);
  else calcState.baseCallFee=safeNonNegativeNumber(calcState.baseCallFee);
  naryadPendingCompletionId = null;
  formSessionId++; // NEW: те саме застереження, що й у resetCalcForm — новий сеанс форми
  // NEW: знімок оригінальних content/sum на момент відкриття — потрібен
  // лише для cloudImported (raw) заявок, де hasUnsavedChanges порівнює з
  // цими значеннями, щоб побачити правки в f_rawContent/f_rawSum (див. там).
  calcState._origContent = calcState.content || '';
  calcState._origSum = calcState.sum || 0;
  // NEW: старі заявки мають лише одне фото в полі photo — якщо масиву photos
  // ще нема (чи він порожній), а старе фото є, переносимо його в масив, щоб
  // форма з підтримкою до 3 фото показала його як завжди.
  if((!calcState.photos || !calcState.photos.length) && calcState.photo){
    calcState.photos = [calcState.photo];
  }
  if(!calcState.photos) calcState.photos = [];
  calcOriginalPhotoKeys = calcState.photos.slice(); // NEW: знімок "рідних" фото заявки — щоб при скасуванні прибрати з IndexedDB лише щойно додані в цьому сеансі, а не ці
  // NEW: у самій заявці тепер зберігається лише вибране (checked / meters>0),
  // тож тут завжди розгортаємо це назад у повний каталог для форми — працює
  // однаково і для нового "розрідженого" формату, і для старих заявок, де
  // ще зберігався весь каталог із checked:false (просто нічого не зміниться).
  calcState.equipment = mergeEquipmentWithCatalog(calcState.equipment, getEquipmentConfig());
  calcState.presetWorks = mergePresetWorksWithCatalog(calcState.presetWorks, getWorkTypesConfig());
  if(!calcState.cables || !calcState.cables.length){
    // NEW: сумісність із зовсім старими заявками — переносимо старі окремі поля
    // UTP/Оптика (якщо були) у новий динамічний список кабелів; для заявок, де
    // просто не було вибрано жодного кабелю, дає той самий (порожній) результат
    calcState.cables = getCableTypesConfig().map(c=>({id:c.id, label:c.label, meters:0, pricePerMeter:c.pricePerMeter}));
    const utp = calcState.cables.find(c=>c.id==='utp');
    if(utp && calcState.utpMeters) { utp.meters = Number(calcState.utpMeters)||0; utp.pricePerMeter = Number(calcState.utpPrice)||utp.pricePerMeter; }
    const optic = calcState.cables.find(c=>c.id==='optic');
    if(optic && calcState.opticMeters) { optic.meters = Number(calcState.opticMeters)||0; optic.pricePerMeter = Number(calcState.opticPrice)||optic.pricePerMeter; }
  } else {
    calcState.cables = mergeCablesWithCatalog(calcState.cables, getCableTypesConfig());
  }
  // якщо в збереженій заявці немає додаткових робіт — все одно показуємо
  // одне порожнє поле для вводу, а не порожній список з кнопкою "+"
  calcState.additionalWork = (calcState.additionalWork && calcState.additionalWork.length)
    ? calcState.additionalWork
    : [{desc:'', sum:0}];
  calcState.tags = calcState.tags || [];
  // Теги є частиною самої заявки. Якщо старий/імпортований запис має тег,
  // якого вже немає у загальному переліку Налаштувань, повертаємо його до
  // переліку, щоб він не зникав з форми під час редагування.
  let restoredTagList = false;
  calcState.tags.forEach(tag=>{
    if(!settings.tags.includes(tag)){
      settings.tags.push(tag);
      restoredTagList = true;
    }
  });
  if(restoredTagList) saveSettings();
  // сумісність зі старими заявками, де майстер зберігався як одне ім'я/літера,
  // а не масив (до того, як зробили множинний вибір майстрів)
  if(!calcState.connectMasters){
    calcState.connectMasters = (calcState.masterName || calcState.masterLetter)
      ? [{name: calcState.masterName || '', letter: calcState.masterLetter || ''}]
      : [];
  }
  // Ранні версії під час збереження ремонту могли стерти connectMasters,
  // але ім'я напарника лишалось у тегах. Відновлюємо такий вибір і для вже
  // наявних заявок, щоб він знову був видимим у формі.
  if(calcState.connectMasters.length===0){
    calcState.connectMasters = settings.masters
      .filter(master=>calcState.tags.includes(master.name))
      .map(master=>({name:master.name, letter:master.letter}));
  }
  editingTicketId = t.id;
  feeIsAutoDefault = false; // NEW: редагуємо існуючу заявку — ціну вже введено, автопідстановку вимикаємо
  tariffIsAutoDefault = false;
  formTouchedByUser = true; // NEW: це або реальне редагування наявної заявки, або відновлення чернетки — в обох випадках це вже "справжній" вміст, а не щойно підставлені за замовчуванням дані
  document.getElementById('saveTicketBtn').textContent = 'Оновити заявку';
  { const cancelBtn = document.getElementById('cancelEditBtn'); cancelBtn.textContent = 'Скасувати редагування'; cancelBtn.classList.remove('hidden'); } // NEW: скидаємо підпис — міг лишитись "Назад до пошуку" від попереднього створення нової заявки з профілю
  fillFormFromState();
}

/* Розбирає текст, вставлений з Viber/Telegram від диспетчера, на логін і пароль.
   Формат зазвичай — два рядки: перший логін, другий пароль. Якщо рядок один —
   пробуємо розбити по пробілу/табу; якщо нічого не вдалось — все йде в логін. */
function updateCredParsedHint(){
  const hintEl = document.getElementById('credParsedHint');
  if(!hintEl) return;
  const cred = parseCredentials(document.getElementById('f_credRaw').value);
  hintEl.textContent = (cred.login || cred.password)
    ? `✅ Логін: ${cred.login || '—'} · Пароль: ${cred.password || '—'}`
    : '';
}

function fillFormFromState(){
  calcState.networkPointIds=typeof MTToolsCore!=='undefined'?MTToolsCore.networkPointIds(calcState.networkPointIds):(Array.isArray(calcState.networkPointIds)?calcState.networkPointIds:[]);
  document.getElementById('f_type').value = calcState.type || 'Підключення';
  document.getElementById('f_otherNote').value = calcState.otherNote || '';
  renderMasterChips();
  toggleTypeOtherField();
  updateCallFeeLabel();
  document.getElementById('f_city').value = calcState.city || '';
  renderStreetDatalist(calcState.city || ''); // NEW: підказки вулиць саме для міста цієї заявки
  if(calcState.street || calcState.house || calcState.apartment){
    document.getElementById('f_street').value = calcState.street || '';
    document.getElementById('f_house').value = calcState.house || '';
    document.getElementById('f_apartment').value = calcState.apartment || '';
  } else {
    // Стара заявка без розбитих полів — кладемо весь текст адреси у "Вулиця",
    // будинок/квартиру можна донести вручну при редагуванні.
    document.getElementById('f_street').value = calcState.address || '';
    document.getElementById('f_house').value = '';
    document.getElementById('f_apartment').value = '';
  }
  document.getElementById('f_client').value = calcState.clientName || '';
  document.getElementById('f_phone').value = calcState.phone || '';
  syncPhoneFieldMaskState(); // NEW: див. коментар біля оголошення функції
  document.getElementById('f_mac').value = calcState.macAddress || '';
  const signalInputState=onuSignalInputState(calcState.signal);
  document.getElementById('f_signalPreset').value=signalInputState.preset;
  document.getElementById('f_signalCustom').value=signalInputState.custom;
  updateOnuSignalCustomVisibility(false);
  { const hint = document.getElementById('macHint'); if(hint) hint.style.display = (calcState.macAddress && !/^[0-9A-F]{12}$/.test(calcState.macAddress)) ? '' : 'none'; }
  document.getElementById('f_credRaw').value = [calcState.login, calcState.password].filter(Boolean).join('\n');
  updateCredParsedHint();
  document.getElementById('f_contractManual').value = calcState.type === 'Ремонт' ? (calcState.contractNumber || '') : ''; // NEW
  setDateFieldValue(calcState.date || '');
  document.getElementById('f_time').value = calcState.time || '';
  document.getElementById('f_callFee').value = effectiveTicketCallFee({
    ...calcState,
    freeRepairCallThreshold:Number(settings.freeRepairCallThreshold)||0
  });
  document.getElementById('f_tariff').value = calcState.tariff || 0;
  document.getElementById('f_payment').value = calcState.payment || '';
  updateMixedPaymentVisibility(); // NEW: показує/ховає перелік розбивки суми залежно від способу оплати (і сам малює позиції з calcState.itemPayments)
  document.getElementById('f_note').value = calcState.note || '';
  document.getElementById('f_masterNote').value = calcState.masterNote || '';
  document.getElementById('f_rawContent').value = calcState.content || ''; // NEW
  document.getElementById('f_rawSum').value = calcState.sum || 0; // NEW
  updateCallFeeLabel();
  renderEquipmentList();
  renderCablesList(); // NEW: динамічний список кабелів замість фіксованих UTP/Оптика
  renderPresetWorksList();
  renderAdditionalWorkList();
  renderCalcTagChips();
  renderPhotoPreview();
  renderGeoBadge();
  if(typeof toolsRenderTicketNetworkLinks==='function')toolsRenderTicketNetworkLinks();
  computeTotal();
}

function updateOnuSignalCustomVisibility(focusCustom=false){
  const preset=document.getElementById('f_signalPreset');
  const custom=document.getElementById('f_signalCustom');
  const wrap=document.getElementById('signalCustomWrap');
  const show=preset && preset.value==='other';
  if(wrap) wrap.classList.toggle('hidden',!show);
  if(show && focusCustom && custom) custom.focus();
  if(!show && custom) custom.value='';
}

function renderPhotoPreview(){
  const wrap = document.getElementById('photoPreviewWrap');
  const cameraBtn = document.getElementById('photoCameraBtn');
  const galleryBtn = document.getElementById('photoGalleryBtn');
  const photos = calcState.photos || [];
  wrap.innerHTML = photos.map((p, i)=>`
    <div class="photo-thumb-wrap">
      <img class="photo-thumb" id="photoPreview${i}" src="">
      <button type="button" class="photo-remove" data-idx="${i}">✕</button>
    </div>`).join('');
  const fallbackFileIds = (calcState.tgPhotoFileIds && calcState.tgPhotoFileIds.length)
    ? calcState.tgPhotoFileIds
    : (calcState.tgPhotoFileId ? [calcState.tgPhotoFileId] : []);
  photos.forEach((p, i)=>{
    const img = document.getElementById('photoPreview'+i);
    const fallbackId = fallbackFileIds[i] || null;
    const resolved = getPhotoCached(p, (val)=>{ if(img) img.src = val; }, fallbackId);
    if(img) img.src = resolved || '';
  });
  // NEW: два окремі входи — "Камера" (capture=environment, відкриває саме
  // камеру) і "Галерея" (multiple, без capture — вибір із наявних фото).
  // Раніше була одна кнопка з input[multiple], а на Android Chrome
  // атрибут multiple прибирає пункт "Камера" з системного вибору — тому
  // зняти фото прямо з застосунку не виходило, лишалась тільки галерея.
  const full = photos.length >= 3;
  if(cameraBtn){ cameraBtn.disabled = full; cameraBtn.textContent = full ? '📷 Максимум 3 фото' : '📷 Камера'; }
  if(galleryBtn){ galleryBtn.disabled = full; galleryBtn.textContent = full ? '🖼️ Максимум 3 фото' : `🖼️ Галерея${photos.length ? ` (${photos.length}/3)` : ''}`; }
}

function computeTotal(){
  let calculation;
  if(calcState.cloudImported){ // NEW: для відновленої з хмари заявки сума вводиться вручну
    calculation=calculateTicketTotal({cloudImported:true,rawSum:safeNonNegativeNumber(document.getElementById('f_rawSum').value)});
    document.getElementById('calcTotal').textContent = fmtMoney(calculation.total);
    return calculation.total;
  }
  // NEW: якщо оплату позначено як "Безкоштовно" — сума завжди 0, незалежно
  // від того, скільки обладнання/робіт/кабелів заповнено в калькуляторі
  // (раніше сума рахувалась як завжди, і "Безкоштовно" в оплаті на неї не впливало).
  const paymentEl = document.getElementById('f_payment');
  if(paymentEl && paymentEl.value === 'Безкоштовно'){
    calculation = calculateTicketTotal({payment:'Безкоштовно'});
    document.getElementById('calcTotal').textContent = fmtMoney(calculation.total);
    return calculation.total;
  }
  calculation = calculateTicketTotal({
    type:getEffectiveType(),
    freeRepairCallThreshold:Number(settings.freeRepairCallThreshold)||0,
    payment: paymentEl ? paymentEl.value : '',
    baseCallFee:ticketBaseCallFee(calcState),
    callFee:safeNonNegativeNumber(document.getElementById('f_callFee').value),
    tariff:safeNonNegativeNumber(document.getElementById('f_tariff').value),
    equipment: calcState.equipment,
    cables: calcState.cables,
    additionalWork: calcState.additionalWork,
    presetWorks: calcState.presetWorks
  });
  document.getElementById('calcTotal').textContent = fmtMoney(calculation.total);
  if(paymentEl && paymentEl.value === 'Змішана') renderMixedPaymentItems(); // NEW: перелік позицій і підсумок готівка/безготівка перераховуються при будь-якій зміні складу/цін
  return calculation.total;
}

// NEW: замість двох порожніх полів "скільки готівкою / скільки
// безготівкою" (які треба було рахувати вручну — саме те, для чого
// калькулятор і існує) — список УЖЕ вибраних позицій (виклик, тариф,
// обладнання, кабелі, роботи) з перемикачем 💵/💳 на кожну. Розбивка
// готівка/безготівка рахується сама, завжди гарантовано збігається із
// загальною сумою — рахувати в умі більше не треба.
function buildMixedPaymentItems(){
  return buildMixedPaymentItemsFromTicket({
    type: getEffectiveType(),
    freeRepairCallThreshold:Number(settings.freeRepairCallThreshold)||0,
    baseCallFee:ticketBaseCallFee(calcState),
    callFee: Number(document.getElementById('f_callFee').value)||0,
    tariff: Number(document.getElementById('f_tariff').value)||0,
    equipment: calcState.equipment, cables: calcState.cables,
    presetWorks: calcState.presetWorks, additionalWork: calcState.additionalWork
  });
}
// NEW: та сама розбивка на позиції, що й для живої форми (buildMixedPaymentItems
// вище), але працює з уже ЗБЕРЕЖЕНОЮ заявкою (без DOM-полів) — потрібна, щоб
// показати в тексті заявки й у профілі абонента не просто дві суми, а
// конкретно ЩО саме куплено готівкою, а що безготівкою.
// NEW: рядки "готівка: X (перелік позицій), безготівка: Y (перелік позицій)"
// для тексту заявки/профілю — щоб диспетчер одразу бачив, ЩО саме за яку
// оплату, а не лише дві суми без прив'язки до конкретного обладнання.
function renderMixedPaymentItems(){
  const wrap = document.getElementById('mixedPaymentItemsWrap');
  if(!wrap) return;
  const items = buildMixedPaymentItems();
  if(!calcState.itemPayments) calcState.itemPayments = {};
  // NEW: нову позицію (щойно додану заявку/обладнання) за замовчуванням
  // ставимо на "готівка" — типовий випадок "усе готівкою, крім однієї-двох
  // позицій" вимагає найменше тапів (перемкнути лише виняток на 💳)
  items.forEach(it=>{ if(!calcState.itemPayments[it.key]) calcState.itemPayments[it.key] = 'cash'; });
  if(!items.length){
    wrap.innerHTML = `<div style="font-size:12.5px; color:var(--text-faint); padding:6px 0;">Спочатку додайте виклик/обладнання/роботи вище</div>`;
  } else {
    wrap.innerHTML = items.map(it=>{
      const method = calcState.itemPayments[it.key];
      return `<div class="row" style="justify-content:space-between; align-items:center; gap:8px; padding:7px 0; border-bottom:1px solid var(--border);">
        <span style="flex:1; font-size:13.5px;">${escapeHtml(it.label)} — ${fmtMoney(it.amount)}</span>
        <div class="row" style="gap:4px;">
          <button type="button" class="btn btn-sm mixed-item-toggle ${method==='cash'?'btn-accent':''}" data-key="${escapeHtml(it.key)}" data-method="cash">💵</button>
          <button type="button" class="btn btn-sm mixed-item-toggle ${method==='card'?'btn-accent':''}" data-key="${escapeHtml(it.key)}" data-method="card">💳</button>
        </div>
      </div>`;
    }).join('');
  }
  // NEW: розбивка рахується сама з призначень вище — завжди коректна,
  // на відміну від ручного вводу двох чисел, де легко помилитись.
  const cash = items.reduce((s,it)=> s + (calcState.itemPayments[it.key]==='cash' ? it.amount : 0), 0);
  const card = items.reduce((s,it)=> s + (calcState.itemPayments[it.key]==='card' ? it.amount : 0), 0);
  calcState.cashAmount = cash;
  calcState.cardAmount = card;
  const hint = document.getElementById('mixedPaymentHint');
  if(hint) hint.innerHTML = `💵 Готівка: <b>${fmtMoney(cash)}</b> · 💳 Безготівка: <b>${fmtMoney(card)}</b>`;
}

// NEW: показує список позицій розбивки лише для "Змішана оплата" — коли
// частину суми (наприклад, абонплату) абонент кинув на карту, а частину
// (наприклад, роутер) віддав готівкою просто в руки. Раніше вся сума заявки
// могла бути зарахована лише ОДНИМ способом оплати, хоча реально бувало
// по-різному — звідси й плутанина при звірці з диспетчером.
function updateMixedPaymentVisibility(){
  const wrap = document.getElementById('mixedPaymentWrap');
  if(!wrap) return; // NEW: захист від старої версії index.html без цього блока — щоб не впала вся ініціалізація
  const isMixed = document.getElementById('f_payment').value === 'Змішана';
  wrap.classList.toggle('hidden', !isMixed);
  if(isMixed) renderMixedPaymentItems();
}

/* NEW: текст поточної заявки для копіювання/надсилання. Для заявок,
   відновлених з хмари, беремо текст напряму з textarea (щоб не перезаписати
   оригінальний опис порожніми даними калькулятора) — для решти рахуємо як
   раніше, через калькулятор. */
/* Номер договору формується лише для підключень. Якщо після першого
   збереження дату або склад майстрів більше НЕ чіпали — номер лишається
   тим самим (щоб не "плив" сам по собі при кожному редагуванні). Але якщо
   виявили помилку і поправили дату чи майстра — номер перераховується під
   нові дані, саме цього просив користувач.
   Формат: ДДММРРРРN<літери майстрів>, де N — порядковий номер підключення
   за цей день, літери — в порядку списку майстрів у Налаштуваннях. */
function assignContractNumberIfNeeded(){
  if(calcState.type === 'Ремонт'){
    // NEW: для ремонту номер договору не генерується — його вже поставив
    // syncFormToState() з поля "Номер договору абонента", лишається тільки
    // скинути "знімок", що стосується автогенерації для підключень.
    calcState.contractNumberDate = '';
    calcState.contractNumberMastersKey = '';
    return;
  }
  if(calcState.type !== 'Підключення'){
    calcState.contractNumber = '';
    calcState.contractNumberDate = '';
    calcState.contractNumberMastersKey = '';
    return;
  }
  const currentMastersKey = (calcState.connectMasters||[]).map(m=>m.name).join('|');

  if(calcState.contractNumber){
    // Для заявок зі старих версій застосунку (де ще не зберігали "знімок"
    // дати/майстрів на момент призначення номера) знімка немає — довіряємо
    // наявному номеру й просто донаповнюємо знімок, без перерахунку.
    const hasSnapshot = !!calcState.contractNumberDate;
    const dateChanged = hasSnapshot && calcState.contractNumberDate !== calcState.date;
    const mastersChanged = hasSnapshot && calcState.contractNumberMastersKey !== currentMastersKey;
    if(!hasSnapshot || (!dateChanged && !mastersChanged)){
      calcState.contractNumberDate = calcState.date;
      calcState.contractNumberMastersKey = currentMastersKey;
      return;
    }
    // дата чи майстри дійсно змінились відносно того, з чим формували номер
    // раніше — перераховуємо нижче.
  }

  const dateDigits = String(calcState.date||'').replace(/\./g,'');
  if(!dateDigits) return;
  // NEW: раніше номер рахувався як "кількість підключень сьогодні + 1"
  // (tickets.filter(...).length + 1) — якщо одну з сьогоднішніх заявок
  // видалили (наприклад, помилково створена), НАСТУПНИЙ згенерований номер
  // міг ЗБІГТИСЯ з номером заявки, що й досі існує (кількість зменшилась,
  // а вже видані номери — ні). Тепер беремо НАЙБІЛЬШИЙ вже використаний
  // сьогодні порядковий номер (з тексту самого contractNumber) і додаємо 1 —
  // видалення заявок посередині дня більше не може призвести до дубля.
  const todayConnections = tickets.filter(t=>
    t.type === 'Підключення' &&
    t.date === calcState.date &&
    String(t.id) !== String(editingTicketId||'')
  );
  let maxSeq = 0;
  todayConnections.forEach(t=>{
    const m = String(t.contractNumber||'').match(/-(\d+)[A-Za-zА-Яа-яЇїІіЄєҐґ]*$/);
    if(m){ const n = Number(m[1]); if(n>maxSeq) maxSeq = n; }
  });
  const seq = maxSeq + 1;
  const selectedNames = new Set((calcState.connectMasters||[]).map(m=>m.name));
  const letters = (settings.masters||[])
    .filter(m=>selectedNames.has(m.name))
    .map(m=>m.letter)
    .join('');
  calcState.contractNumber = `${dateDigits}-${seq}${letters}`;
  calcState.contractNumberDate = calcState.date;
  calcState.contractNumberMastersKey = currentMastersKey;
}

function getCurrentTicketText(){
  if(calcState.cloudImported){
    return document.getElementById('f_rawContent').value.trim();
  }
  const isOther = calcState.type === 'Інше';
  assignContractNumberIfNeeded();
  const total = isOther ? 0 : computeTotal();
  return buildTicketContent({
    ...calcState,
    type:getEffectiveType(),
    freeRepairCallThreshold:Number(settings.freeRepairCallThreshold)||0
  }, total);
}

function getEffectiveType(){
  return document.getElementById('f_type').value;
}
function isOtherType(){
  return document.getElementById('f_type').value === 'Інше';
}
function toggleTypeOtherField(){
  const other = isOtherType();
  const isConnect = getEffectiveType() === 'Підключення';
  const isRepair = getEffectiveType() === 'Ремонт';
  const raw = !!calcState.cloudImported; // NEW: заявка відновлена з хмари — свій режим редагування
  document.getElementById('otherNoteWrap').classList.toggle('hidden', !other);
  // NEW: вибір напарників тепер показуємо і для "Ремонт", не лише для
  // "Підключення" — але номер договору формується, як і раніше, лише для
  // підключень (див. assignContractNumberIfNeeded).
  document.getElementById('connectMasterWrap').classList.toggle('hidden', !(isConnect || isRepair) || raw);
  document.getElementById('connectMasterWrapLabel').innerHTML = isConnect
    ? 'Хто підключав <span style="font-size:11px; color:var(--text-faint); font-weight:400;">(для номера договору)</span>'
    : 'Напарники';
  // NEW: "(для договору)" при логіні/паролі актуально і для підключення
  // (новий договір), і для ремонту (номер вже існуючого договору абонента)
  { const sfx = document.getElementById('credCardDogovorSuffix'); if(sfx) sfx.style.display = (isConnect || isRepair) ? '' : 'none'; }
  // NEW: для ремонту абонент вже існує — номер договору не генерується, а
  // вводиться майстром вручну в окремому полі (див. syncFormToState/assignContractNumberIfNeeded)
  document.getElementById('contractManualWrap').classList.toggle('hidden', !isRepair || raw);
  document.getElementById('importedRawWrap').classList.toggle('hidden', !raw); // NEW
  document.getElementById('fullFormFields').classList.toggle('hidden', other);
  document.getElementById('fullFormBlocks').classList.toggle('hidden', other);
  // NEW: обладнання/вартість/MAC для сирої заявки не мають сенсу — сума редагується вручну
  document.getElementById('calcMacCard').classList.toggle('hidden', other || raw);
  document.getElementById('calcPricingBlocks').classList.toggle('hidden', other || raw);
  document.getElementById('f_payment').required = !other;
}
// NEW: підставляє ціну виклику/підключення за замовчуванням при зміні типу
// заявки — але тільки якщо майстер ще не ввів своє значення вручну.
// NEW: коли обрано тип роботи "Підключення"/"Ремонт" — одразу вмикає відповідний
// тег (щоб потім було зручно шукати заявки за тегом). Порівнюємо з calcState.type,
// який на момент події 'change' ще містить ПОПЕРЕДНЄ значення (синхронізується
// з форми лише при збереженні) — тож знімаємо старий тег типу й ставимо новий.
const TYPE_TAG_MAP = {'Підключення':'підключення', 'Ремонт':'ремонт'};
function applyDefaultTypeTag(){
  const newType = document.getElementById('f_type').value;
  const prevType = calcState.type;
  const newTag = TYPE_TAG_MAP[newType];
  const prevTag = TYPE_TAG_MAP[prevType];
  if(prevTag && prevTag!==newTag){
    const i = calcState.tags.indexOf(prevTag);
    if(i>-1) calcState.tags.splice(i,1);
  }
  if(newTag){
    if(!settings.tags.includes(newTag)){ settings.tags.push(newTag); saveSettings(); }
    if(!calcState.tags.includes(newTag)) calcState.tags.push(newTag);
  }
  calcState.type = newType;
  renderCalcTagChips();
}
function applyDefaultCallFee(){
  // У режимі редагування автопідстановка ціни вимкнена, але сам підсумок
  // однаково має одразу реагувати на зміну обладнання.
  if(calcState.cloudImported){ computeTotal(); return; }
  const type = getEffectiveType();
  let baseFee;
  if(feeIsAutoDefault){
    if(type === 'Підключення') baseFee = Number(settings.defaultConnectFee) || 0;
    else if(type === 'Ремонт') baseFee = Number(settings.defaultRepairCallFee) || 0;
    else baseFee = 0;
    calcState.baseCallFee=safeNonNegativeNumber(baseFee);
  }else{
    baseFee=ticketBaseCallFee(calcState);
  }
  const effectiveFee=effectiveTicketCallFee({
    ...calcState,
    type,
    baseCallFee:baseFee,
    freeRepairCallThreshold:Number(settings.freeRepairCallThreshold)||0
  });
  calcState.callFee=effectiveFee;
  document.getElementById('f_callFee').value = effectiveFee;
  computeTotal();
}

// NEW: тариф за замовчуванням підставляється лише для типу "Підключення" —
// для ремонту та інших типів заявок тарифу бути не повинно.
function applyDefaultTariff(){
  if(!tariffIsAutoDefault || calcState.cloudImported) return;
  const type = getEffectiveType();
  document.getElementById('f_tariff').value = (type === 'Підключення') ? (Number(settings.defaultTariff) || 0) : 0;
  computeTotal();
}

function syncFormToState(){
  calcState.networkPointIds=typeof MTToolsCore!=='undefined'?MTToolsCore.networkPointIds(calcState.networkPointIds):(Array.isArray(calcState.networkPointIds)?calcState.networkPointIds:[]);
  calcState.type = getEffectiveType();
  calcState.otherNote = document.getElementById('f_otherNote').value.trim();
  // NEW: для ремонту номер договору абонента вводиться вручну (абонент вже
  // існує) — на відміну від підключення, де номер генерується автоматично
  // в assignContractNumberIfNeeded()
  if(calcState.type === 'Ремонт'){
    calcState.contractNumber = document.getElementById('f_contractManual').value.trim();
  }
  calcState.city = document.getElementById('f_city').value.trim();
  calcState.street = document.getElementById('f_street').value.trim();
  calcState.house = document.getElementById('f_house').value.trim();
  calcState.apartment = document.getElementById('f_apartment').value.trim();
  calcState.address = [
    [calcState.street, calcState.house].filter(Boolean).join(' '),
    calcState.apartment ? `кв. ${calcState.apartment}` : ''
  ].filter(Boolean).join(', ');
  calcState.clientName = document.getElementById('f_client').value.trim();
  calcState.phone = document.getElementById('f_phone').value.trim();
  calcState.macAddress = normalizeMac(document.getElementById('f_mac').value);
  calcState.signal = resolveOnuSignalInput(
    document.getElementById('f_signalPreset').value,
    document.getElementById('f_signalCustom').value
  );
  const cred = parseCredentials(document.getElementById('f_credRaw').value);
  calcState.login = cred.login;
  calcState.password = cred.password;
  calcState.date = document.getElementById('f_date').value.trim() || formatDate(new Date());
  calcState.time = document.getElementById('f_time').value.trim() || formatTime(new Date());
  if(!Object.prototype.hasOwnProperty.call(calcState,'baseCallFee')){
    calcState.baseCallFee=safeNonNegativeNumber(document.getElementById('f_callFee').value);
  }
  calcState.callFee=effectiveTicketCallFee({
    ...calcState,
    type:calcState.type,
    freeRepairCallThreshold:Number(settings.freeRepairCallThreshold)||0
  });
  calcState.tariff=safeNonNegativeNumber(document.getElementById('f_tariff').value);
  calcState.payment = document.getElementById('f_payment').value;
  // NEW: для "Змішана" cashAmount/cardAmount і так вже актуальні — їх
  // рахує й одразу пише в calcState сам renderMixedPaymentItems() при
  // кожному тапі на 💵/💳, вручну тут рахувати нічого не треба. Для решти
  // способів оплати обнуляємо — щоб старі значення (з попереднього разу,
  // коли, наприклад, вибрали "Змішана", а потім передумали) не залишались
  // "мертвим вантажем" у заявці.
  if(calcState.payment !== 'Змішана'){
    calcState.cashAmount = 0;
    calcState.cardAmount = 0;
    calcState.itemPayments = {};
  }
  calcState.note = document.getElementById('f_note').value.trim();
  calcState.masterNote = document.getElementById('f_masterNote').value.trim();
  // NEW: для заявки, відновленої з хмари (cloudImported), контент і сума
  // редагуються напряму в полях f_rawContent/f_rawSum (не через звичайний
  // калькулятор) — раніше ця функція їх не читала, тож автозбереження
  // чернетки (яке викликає саме syncFormToState) записувало СТАРІ значення,
  // і правки в цих двох полях губились при випадковому закритті застосунку.
  if(calcState.cloudImported){
    calcState.content = document.getElementById('f_rawContent').value.trim();
    calcState.sum=safeNonNegativeNumber(document.getElementById('f_rawSum').value);
  }
  // geoLink вже синхронізується через setGeoLink
}

/* ---- Фото: зчитування + стиснення до ширини 800px ---- */
function handlePhotoFile(file){
  if(!file) return;
  if(!calcState.photos) calcState.photos = [];
  if(calcState.photos.length >= 3){ showToast('Максимум 3 фото на заявку'); return; }
  const sessionAtStart = formSessionId; // NEW: знімок сеансу форми — див. коментар біля оголошення formSessionId
  const reader = new FileReader();
  reader.onload = (e)=>{
    const img = new Image();
    img.onload = ()=>{
      const maxW = 800;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width*scale);
      canvas.height = Math.round(img.height*scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if(calcState.photos.length >= 3) return; // NEW: могли додати паралельно кілька файлів одразу — перевіряємо ще раз перед пушем
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      // NEW: раніше сире фото (сотні КБ у base64) лежало прямо в
      // calcState.photos, і кожні 30с автозбереження чернетки записувало
      // ЙОГО ЦІЛИКОМ у localStorage (ліміт ~5МБ). 2-3 фото за зміну легко
      // переповнювали сховище — JSON.stringify падав з QuotaExceededError,
      // яка гасилась порожнім catch(e){}, і чернетка (весь введений текст,
      // не лише фото) тихо переставала зберігатись, без жодного попередження.
      // Тепер фото одразу переносимо в IndexedDB (як і при остаточному
      // збереженні заявки — storePhoto) ДО того, як воно потрапить у
      // calcState.photos — запис в IndexedDB займає долі секунди, тож
      // затримка перед появою у прев'ю непомітна, зате чернетка в
      // localStorage завжди лишається легкою, незалежно від кількості й
      // розміру фото.
      storePhoto(dataUrl).then(key=>{
        if(!key) return;
        // NEW: поки йшов запис в IndexedDB, користувач міг скасувати заявку
        // або відкрити іншу (formSessionId змінився) — тоді calcState вже
        // зовсім ІНШИЙ об'єкт (не той, для якого фото знімали), і без цієї
        // перевірки фото "приліплювалось" би до чужої заявки. У такому
        // випадку просто видаляємо щойно записане фото з IndexedDB.
        if(formSessionId !== sessionAtStart){ deletePhotoKey(key); return; }
        if(calcState.photos.length >= 3){ deletePhotoKey(key); return; } // могли встигнути додати ще, поки це фото записувалось
        photoCacheSet(key, dataUrl); // одразу в кеш — прев'ю показується миттєво, без походу в IndexedDB
        calcState.photos.push(key);
        calcState.photo = calcState.photos[0]; // NEW: перше фото дублюється в старе поле photo — для коду, який ще читає лише його
        renderPhotoPreview();
      });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ---- Геолокація ---- */

function setGeoLink(link,coords=null){
  calcState.geoLink = link;
  if(coords){calcState.geoLat=Number(coords.lat.toFixed(6));calcState.geoLng=Number(coords.lng.toFixed(6));}
  formTouchedByUser = true; // NEW: модалка геолокації живе поза #calcForm, тож звичайний input/change-делегат її не бачить — без цього рядка чернетка з самою лише геолокацією (без інших полів) не зберігалась
  // Геолокація тепер НЕ потрапляє в текст примітки/заявки — вона лише
  // для власного використання майстра (кнопка 📍 і бейдж з посиланням).
  renderGeoBadge();
}

/* Розпізнає координати з посилання Google Maps (формати @lat,lng / q=lat,lng / ll=lat,lng)
   або з простого тексту "lat,lng", введеного вручну */
/* Одна розумна кнопка 📍:
   - якщо HTTPS і GPS доступні — визначає координати автоматично
   - якщо GPS заблокований або файл відкрито локально — одразу показує модалку «вставити посилання» */
function handleGeoBtn(){
  if((calcState.geoLink||MTToolsCore.explicitCoordinates(calcState))&&!confirm('Геолокація вже додана. Оновити?'))return;
  openGeoPasteModal();
}

/* Модалка ручного введення — відкривається автоматично при відмові GPS */
function openGeoPasteModal(headerMsg){
  openModal('📍 Додати геолокацію', `
    <div style="font-size:13px; color:var(--text-dim); margin-bottom:10px;">
      ${escapeHtml(headerMsg||'Оберіть точку на внутрішній карті або, за потреби, вставте старе посилання Google Maps.')}
    </div>
    <button type="button" class="btn btn-accent btn-block" id="openInternalMapBtn" style="margin-bottom:10px;">📍 На внутрішній карті</button>
    <button type="button" class="btn btn-block" id="openMapsAppBtn" style="margin-bottom:10px;">🗺️ Відкрити Google Maps</button>
    <div class="field"><label>Посилання або координати (50.4501, 30.5234)</label>
      <textarea id="geoPasteInput" placeholder="https://maps.app.goo.gl/... або 50.4501, 30.5234" style="min-height:60px;"></textarea>
    </div>
    <div id="geoPasteShortLinkStatus" class="tools-map-status hidden" role="status" style="margin-bottom:10px;"></div>
    <button type="button" class="btn btn-block hidden" id="geoPasteRefineBtn" style="margin-bottom:10px;">📍 Уточнити точку</button>
    <button type="button" class="btn btn-accent btn-block" id="geoPasteAddBtn">✅ Додати в заявку</button>
  `, {onOpen:()=>{
    document.getElementById('openInternalMapBtn').onclick = ()=> openTicketGeoPointPicker();
    document.getElementById('openMapsAppBtn').onclick = ()=> window.open('https://www.google.com/maps', '_blank');
    document.getElementById('geoPasteRefineBtn').onclick = ()=> openTicketGeoPointPicker();
    document.getElementById('geoPasteAddBtn').onclick = ()=>{
      const raw = document.getElementById('geoPasteInput').value.trim();
      if(!raw){ showToast('Встав посилання або координати'); return; }
      const result = prepareGeoInput(raw);
      setGeoLink(result.link,result.coords);
      if(result.needsPicker){
        const status = document.getElementById('geoPasteShortLinkStatus');
        status.textContent = 'Посилання збережено, але координати не визначено';
        status.classList.remove('hidden');
        document.getElementById('geoPasteRefineBtn').classList.remove('hidden');
        showToast('Посилання збережено, але координати не визначено');
        return;
      }
      closeModal();
      showToast('✅ Геолокацію збережено');
    };
  }});
}

/* NEW: редагування геолокації прямо з профілю абонента (навігатор адрес) —
   на відміну від калькулятора, тут немає власного calcState, тож посилання
   застосовується одразу до всіх заявок за цією адресою (ids), як і решта
   полів профілю. */
function openAbonentGeoEditModal(ids, currentLink){
  openModal(currentLink ? '✏️ Геолокація абонента' : '📍 Додати геолокацію', `
    <div style="font-size:13px; color:var(--text-dim); margin-bottom:10px;">
      Відкрий Google Maps → постав мітку → Поділитися → Копіювати посилання → встав нижче. Застосується до всіх заявок за цією адресою (${ids.length} шт.).
    </div>
    <button type="button" class="btn btn-block" id="abonentGeoOpenMapsBtn" style="margin-bottom:10px;">🗺️ Відкрити Google Maps</button>
    <div class="field"><label>Посилання або координати (50.4501, 30.5234)</label>
      <textarea id="abonentGeoPasteInput" placeholder="https://maps.app.goo.gl/... або 50.4501, 30.5234" style="min-height:60px;">${escapeHtml(currentLink||'')}</textarea>
    </div>
    <div id="abonentGeoShortLinkStatus" class="tools-map-status hidden" role="status" style="margin-bottom:10px;"></div>
    <button type="button" class="btn btn-block hidden" id="abonentGeoRefineBtn" style="margin-bottom:10px;">📍 Уточнити точку</button>
    <div class="row" style="gap:8px; margin-top:10px;">
      ${currentLink ? `<button type="button" class="btn btn-danger" id="abonentGeoClearBtn" style="flex:1;">🗑️ Прибрати</button>` : ''}
      <button type="button" class="btn btn-accent" id="abonentGeoSaveBtn" style="flex:2;">✅ Зберегти</button>
    </div>
  `, {onClose: renderAddressNav, onOpen: ()=>{
    document.getElementById('abonentGeoOpenMapsBtn').onclick = ()=> window.open('https://www.google.com/maps', '_blank');
    document.getElementById('abonentGeoRefineBtn').onclick = ()=> openAbonentMapPointPicker(ids);
    const clearBtn = document.getElementById('abonentGeoClearBtn');
    if(clearBtn) clearBtn.onclick = ()=>{
      ids.forEach(id=>{ const t = tickets.find(x=>String(x.id)===String(id)); if(t) t.geoLink=''; });
      saveTickets();
      showToast('Геолокацію прибрано');
      renderAddressNav();
    };
    document.getElementById('abonentGeoSaveBtn').onclick = async()=>{
      const raw = document.getElementById('abonentGeoPasteInput').value.trim();
      if(!raw){ showToast('Встав посилання або координати'); return; }
      const result = prepareGeoInput(raw);
      ids.forEach(id=>{ const t = tickets.find(x=>String(x.id)===String(id)); if(t){t.geoLink=result.link;if(result.coords){t.geoLat=Number(result.coords.lat.toFixed(6));t.geoLng=Number(result.coords.lng.toFixed(6));}} });
      await saveTickets();
      if(result.needsPicker){
        const status = document.getElementById('abonentGeoShortLinkStatus');
        status.textContent = 'Посилання збережено, але координати не визначено';
        status.classList.remove('hidden');
        document.getElementById('abonentGeoRefineBtn').classList.remove('hidden');
        showToast('Посилання збережено, але координати не визначено');
        return;
      }
      showToast('✅ Геолокацію збережено');
      renderAddressNav();
    };
  }});
}

/* NEW: редагування примітки про абонента прямо з профілю — окремо від
   повного "Редагувати абонента", щоб не заходити всередину заради одного
   поля. Так само застосовується одразу до всіх заявок за цією адресою. */
function openAbonentNoteEditModal(ids, currentNote){
  openModal(currentNote ? '✏️ Примітка про абонента' : '📝 Додати примітку', `
    <div class="field"><textarea id="abonentNoteEditInput" placeholder="Наприклад: землячка з Кураховки" style="min-height:100px;">${escapeHtml(currentNote||'')}</textarea></div>
    <div class="row" style="gap:8px; margin-top:10px;">
      ${currentNote ? `<button type="button" class="btn btn-danger" id="abonentNoteClearBtn" style="flex:1;">🗑️ Прибрати</button>` : ''}
      <button type="button" class="btn btn-accent" id="abonentNoteSaveBtn" style="flex:2;">✅ Зберегти</button>
    </div>
  `, {onClose: renderAddressNav, onOpen: ()=>{
    const clearBtn = document.getElementById('abonentNoteClearBtn');
    if(clearBtn) clearBtn.onclick = ()=>{
      ids.forEach(id=>{ const t = tickets.find(x=>String(x.id)===String(id)); if(t) t.abonentNote=''; });
      saveTickets();
      showToast('Примітку прибрано');
      renderAddressNav();
    };
    document.getElementById('abonentNoteSaveBtn').onclick = ()=>{
      const val = document.getElementById('abonentNoteEditInput').value.trim();
      ids.forEach(id=>{ const t = tickets.find(x=>String(x.id)===String(id)); if(t) t.abonentNote=val; });
      saveTickets();
      showToast('✅ Примітку збережено');
      renderAddressNav();
    };
  }});
}

/* ---- Копіювати текст / Поділитись фото ---- */
async function saveTicketFromForm(e){
  e.preventDefault();
  // NEW: захист від подвійного тапу — на телефоні під час мережевої затримки
  // легко тапнути "Зберегти" двічі поспіль, і без цього обидва виклики
  // проходили валідацію й створювали дві майже однакові заявки. Кнопку
  // блокуємо одразу і гарантовано розблоковуємо в finally, незалежно від
  // того, яким шляхом (успіх, скасування, помилка) функція завершиться.
  const saveBtn = document.getElementById('saveTicketBtn');
  if(saveBtn.disabled) return;
  saveBtn.disabled = true;
  const saveBtnOriginalText = saveBtn.textContent;
  saveBtn.textContent = '⏳ Збереження...';
  try{
  syncFormToState();
  // прибираємо порожні рядки додаткових робіт (незаповнений рядок за
  // замовчуванням не повинен потрапляти у збережену заявку)
  calcState.additionalWork = (calcState.additionalWork||[]).filter(w => w.desc || w.sum);
  // NEW: автопрописка міста та вулиці — якщо введеного немає в довідниках,
  // додаємо автоматично (без походу в Налаштування), за зразком автопрописки
  // імен напарників у теги вище (calcMasterChips click-хендлер)
  if(calcState.city){
    if(!settings.cities) settings.cities = [];
    if(!settings.cities.includes(calcState.city)){
      settings.cities.push(calcState.city);
      saveSettings();
      renderCityDatalist();
    }
    if(calcState.street){
      if(!settings.streets) settings.streets = {};
      if(!settings.streets[calcState.city]) settings.streets[calcState.city] = [];
      if(!settings.streets[calcState.city].includes(calcState.street)){
        settings.streets[calcState.city].push(calcState.street);
        saveSettings();
      }
    }
  }
  if(!calcState.type){ showToast('Оберіть тип роботи'); return; }
  const isOther = calcState.type === 'Інше';
  const isRaw = !!calcState.cloudImported; // NEW

  if(isRaw){
    // NEW: заявка відновлена з хмари — структурних полів калькулятора в ній
    // немає, тож перезбирати текст не можна (втратимо оригінальний опис).
    // Берем текст і суму напряму з полів редагування.
    if(!calcState.payment){ showToast('Оберіть спосіб оплати'); return; }
    calcState.content = document.getElementById('f_rawContent').value.trim();
    calcState.sum=safeNonNegativeNumber(document.getElementById('f_rawSum').value);
  } else {
    if(isOther && !calcState.otherNote){ showToast('Введіть текст нотатки'); return; }
    if(!isOther && !calcState.payment){ showToast('Оберіть спосіб оплати'); return; }
    assignContractNumberIfNeeded();
    const total = isOther ? 0 : computeTotal();
    calcState.callFee = effectiveTicketCallFee({
      ...calcState,
      type:getEffectiveType(),
      freeRepairCallThreshold:Number(settings.freeRepairCallThreshold)||0
    });
    calcState.sum = total;
    calcState.content = buildTicketContent(calcState, total);
  }

  // NEW: у саму заявку записуємо лише вибрані позиції каталогу (checked /
  // meters>0), а не весь каталог обладнання/кабелів/робіт із checked:false —
  // це і є той рефакторинг, що прибирає роздування об'єкта заявки. Форма й
  // далі повністю розгортає каталог при відкритті (loadTicketIntoForm /
  // blankCalcState) — тут лише те, що потрапляє у збережений об'єкт.
  calcState.additionalWork=(calcState.additionalWork||[]).map(w=>({...w,sum:safeNonNegativeNumber(w.sum)}));
  calcState.equipment=(calcState.equipment||[]).filter(e=>e.checked).map(e=>({id:e.id,label:e.label,price:safeNonNegativeNumber(e.price)}));
  calcState.cables=(calcState.cables||[]).filter(c=>safeNonNegativeNumber(c.meters)>0).map(c=>({id:c.id,label:c.label,meters:safeNonNegativeNumber(c.meters),pricePerMeter:safeNonNegativeNumber(c.pricePerMeter)}));
  calcState.presetWorks=(calcState.presetWorks||[]).filter(w=>w.checked).map(w=>({id:w.id,label:w.label,price:safeNonNegativeNumber(w.price),qty:safeWorkQuantity(w.qty)}));

  // NEW: до 3 фото на заявку — кожне НОВЕ (сире, ще не idb:...) переносимо
  // в IndexedDB, а всі старі фото цієї заявки, яких більше нема в новому
  // списку (видалені чи замінені майстром), приберемо з IndexedDB, щоб не
  // копичити "сирітські" записи.
  if(!calcState.photos) calcState.photos = [];
  const prevPhotoKeys = [];
  if(editingTicketId){
    const prev = tickets.find(t=>String(t.id)===String(editingTicketId)); // NEW: String() — id з хмари приходить рядком, а локально створений може бути числом
    if(prev){
      if(prev.photos && prev.photos.length) prevPhotoKeys.push(...prev.photos);
      else if(prev.photo) prevPhotoKeys.push(prev.photo);
    }
  }
  const newPhotoKeys = [];
  for(const p of calcState.photos){
    if(p && !String(p).startsWith('idb:')){
      const key = await storePhoto(p);
      if(!key) return;
      newPhotoKeys.push(key);
    }
    else if(p) newPhotoKeys.push(p);
  }
  calcState.photos = newPhotoKeys;
  calcState.photo = newPhotoKeys[0] || null; // NEW: перше фото дублюється у старе поле — для коду, який ще читає лише його
  for(const key of prevPhotoKeys){
    if(!newPhotoKeys.includes(key)) await deletePhotoKey(key);
  }


  // Захист від дублів: якщо за останні 3 години вже є заявка з такою ж
  // адресою (і вона не та, що зараз редагується) — попереджаємо.
  if(!editingTicketId && calcState.address){
    const threeHoursMs = 3*60*60*1000;
    const nowMs = Date.now();
    const similar = tickets.find(t=>
      t.address && t.address.trim().toLowerCase() === calcState.address.trim().toLowerCase() &&
      t.city === calcState.city &&
      (nowMs - Number(t.id||0)) < threeHoursMs
    );
    if(similar && !confirm(`Схожа заявка вже є (${similar.date} ${similar.time}, ${similar.city||''} ${similar.address}).\nЗберегти ще одну?`)){
      cleanupUnsavedNewPhotos(); // NEW: якщо скасували через дубль — не лишати щойно зроблені фото сиротами в IndexedDB
      return;
    }
  }

  let savedTicketRef = null; // NEW: посилання на щойно збережений об'єкт у tickets — для бекапу в Telegram нижче
  let successMessage = '';
  if(editingTicketId){
    // Зберігаємо ID до виходу з форми. Після збереження resetCalcForm()
    // обнуляє editingTicketId, а відповідь синхронізації приходить уже у фоні.
    // Без окремої копії callback не знаходив оновлену заявку, лишав її у
    // черзі та міг повторно відправляти оновлення при наступній синхронізації.
    const updatedTicketId = editingTicketId;
    calcState.id = updatedTicketId;
    const idx = tickets.findIndex(t=>String(t.id)===String(updatedTicketId)); // NEW: String() — те саме застереження, що й вище з фото
    if(idx>-1) tickets[idx] = JSON.parse(JSON.stringify(calcState));
    if(idx>-1) savedTicketRef = tickets[idx];
    successMessage = 'Заявку оновлено';
  } else {
    calcState.id = MTSyncEngineRuntime.uuid();
    const newTicket = JSON.parse(JSON.stringify(calcState));
    tickets.push(newTicket);
    savedTicketRef = tickets.find(t=>t.id===newTicket.id);
    // Якщо локальне сховище тимчасово недоступне, повторне натискання має
    // дописувати ту саму заявку, а не створювати дублікат з новим id.
    editingTicketId = newTicket.id;
    successMessage = 'Заявку збережено';
  }
  let localSaved = false;
  try{
    // Чекаємо лише durable local path: sync-journal + IndexedDB або аварійний
    // localStorage fallback. Google flush запускається recordDiff у фоні.
    localSaved = await saveTickets();
  }catch(e){
    console.error('Local ticket persistence failed');
  }
  if(!localSaved){
    showToast('⚠️ Заявку не вдалося надійно зберегти. Форма й чернетка залишені — спробуйте ще раз.');
    document.getElementById('saveTicketBtn').textContent = editingTicketId ? 'Оновити заявку' : saveBtnOriginalText;
    return;
  }
  showToast(successMessage);
  if(savedTicketRef && naryadPendingCompletionId){
    const naryad = naryadQueue.find(n=>String(n.id)===String(naryadPendingCompletionId));
    if(naryad){
      naryad.done = true;
      // Зберігаємо стабільний зв'язок із щойно створеною заявкою. До цього
      // моменту черга містила лише сирий текст наряду, тому після перезапуску
      // застосунку без цього поля безпечно відкрити заявку на редагування було неможливо.
      naryad.ticketId = savedTicketRef.id;
      saveNaryadQueue();
      updateNaryadQueueBtn();
    }
    naryadPendingCompletionId = null;
  }
  if(savedTicketRef) backupTicketToTelegram(savedTicketRef); // NEW: фонова резервна копія тексту/фото в Telegram (не блокує збереження)

  currentTicketDate = calcState.date;
  clearDraft();
  resetCalcForm();
  returnAfterTicketEdit();
  renderTicketsScreen();
  }finally{
    saveBtn.disabled = false;
    saveBtn.textContent = saveBtnOriginalText;
  }
}

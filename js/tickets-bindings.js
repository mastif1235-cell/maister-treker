/* Canonical ticket list/editor/scanner event bindings. */

function bindTicketsScreen(){
  // NEW: черга нарядів від диспетчера — кнопка під датою
  document.getElementById('naryadQueueBtn').addEventListener('click', ()=> showNaryadQueue());
  updateNaryadQueueBtn();

  // NEW: кнопки "Копіювати за день"/"Надіслати за день" прибрано з головного
  // екрана — той самий функціонал (і повний, з фільтрами за період) уже є
  // в модалці "Звіти", а тут вони лише захаращували екран і майже не
  // використовувались.

  let searchDebounceTimer = null;
  document.getElementById('searchInput').addEventListener('input', e=>{
    const value = e.target.value;
    clearTimeout(searchDebounceTimer);
    // Дебаунс 220мс: при великій базі (1000+ заявок) фільтрація на кожне
    // натискання клавіші відчутно гальмує введення тексту на слабких телефонах.
    searchDebounceTimer = setTimeout(()=>{
      searchQuery = value;
      activeFilterTags.clear();
      document.getElementById('tagFilterPanel').classList.add('hidden');
      renderTicketsScreen();
    }, 220);
  });
  document.getElementById('filterToggleBtn').addEventListener('click', ()=>{
    document.getElementById('calendarPanel').classList.add('hidden');
    const panel = document.getElementById('tagFilterPanel');
    panel.classList.toggle('hidden');
    if(!panel.classList.contains('hidden')) renderTagFilterChips();
  });
  document.getElementById('calendarToggleBtn').addEventListener('click', ()=>{
    document.getElementById('tagFilterPanel').classList.add('hidden');
    const panel = document.getElementById('calendarPanel');
    panel.classList.toggle('hidden');
    if(!panel.classList.contains('hidden')){ calendarViewDate = parseDate(currentTicketDate); renderCalendar(); }
  });
  document.getElementById('reportToggleBtn').addEventListener('click', openReportModal);
  document.getElementById('addrNavToggleBtn').addEventListener('click', openAddressNavigator); // NEW
  document.getElementById('clearTagFilterBtn').addEventListener('click', ()=>{
    activeFilterTags.clear(); renderTagFilterChips(); renderTicketsScreen();
  });
  document.getElementById('tagFilterChips').addEventListener('click', e=>{
    const delBtn = e.target.closest('[data-deltag]');
    if(delBtn){
      const tag = delBtn.dataset.deltag;
      const count = tickets.filter(t=>(t.tags||[]).includes(tag)).length;
      if(!confirm(`Видалити тег "${tag}"? Він зникне з ${count} заявок і зі списку тегів.`)) return;
      backupLocalData();
      tickets.forEach(t=>{ if(t.tags) t.tags = t.tags.filter(x=>x!==tag); });
      settings.tags = (settings.tags||[]).filter(x=>x!==tag);
      activeFilterTags.delete(tag);
      saveTickets(); saveSettings();
      renderTagFilterChips(); renderTicketsScreen();
      showToast('Тег видалено. Синхронізація з хмарою...');
      if(getScriptUrl()){
        syncEngine.flush().then(ok=>{
          renderTicketsScreen();
          showToast(ok ? 'Синхронізовано' : 'Синхронізація не вдалась — перевірте інтернет');
        });
      }
      return;
    }
    const btn = e.target.closest('[data-tag]'); if(!btn) return;
    const tag = btn.dataset.tag;
    if(activeFilterTags.has(tag)) activeFilterTags.delete(tag); else activeFilterTags.add(tag);
    document.getElementById('searchInput').value=''; searchQuery='';
    renderTagFilterChips(); renderTicketsScreen();
  });
  document.getElementById('calPrevMonth').addEventListener('click', ()=>{
    calendarViewDate.setMonth(calendarViewDate.getMonth()-1); renderCalendar();
  });
  document.getElementById('calNextMonth').addEventListener('click', ()=>{
    calendarViewDate.setMonth(calendarViewDate.getMonth()+1); renderCalendar();
  });
  document.getElementById('calGrid').addEventListener('click', e=>{
    const day = e.target.closest('[data-date]'); if(!day) return;
    currentTicketDate = day.dataset.date;
    searchQuery=''; document.getElementById('searchInput').value='';
    activeFilterTags.clear();
    document.getElementById('calendarPanel').classList.add('hidden');
    renderTicketsScreen();
  });
  document.getElementById('prevDayBtn').addEventListener('click', ()=>{ currentTicketDate = shiftDate(currentTicketDate,-1); renderTicketsScreen(); });
  document.getElementById('nextDayBtn').addEventListener('click', ()=>{ currentTicketDate = shiftDate(currentTicketDate,1); renderTicketsScreen(); });
  document.getElementById('todayBtn').addEventListener('click', ()=>{
    const today = new Date();
    currentTicketDate = formatDate(today);
    calendarViewDate = new Date(today.getFullYear(), today.getMonth(), 1);
    if(!document.getElementById('calendarPanel').classList.contains('hidden')) renderCalendar();
    renderTicketsScreen();
  });
  document.getElementById('modeResetBtn').addEventListener('click', ()=>{
    searchQuery=''; document.getElementById('searchInput').value=''; activeFilterTags.clear();
    renderTicketsScreen();
  });
  document.getElementById('ticketList').addEventListener('click', e=>{
    const networkOpen=e.target.closest('.ticket-network-open');
    const networkUnlink=e.target.closest('.ticket-network-unlink');
    if(networkOpen){toolsShowNetworkPoint(networkOpen.dataset.pointId);return;}
    if(networkUnlink){
      if(!confirm('Відв’язати об’єкт від заявки?'))return;
      const ticket=tickets.find(item=>String(item.id)===String(networkUnlink.dataset.ticketId));if(!ticket)return;
      ticket.networkPointIds=MTToolsCore.unlinkNetworkPoint(ticket.networkPointIds,networkUnlink.dataset.pointId);saveTickets().then(renderTicketsScreen);return;
    }
    const editBtn  = e.target.closest('.edit-ticket-btn');
    const delBtn   = e.target.closest('.delete-ticket-btn');
    const shareBtn = e.target.closest('.share-ticket-btn');
    const tgBtn    = e.target.closest('.tg-dispatcher-btn');
    const tgOpenBtn= e.target.closest('.tg-open-btn');
    const copyBtn  = e.target.closest('.copy-ticket-btn');
    const dgBtn    = e.target.closest('.contract-ticket-btn');
    const expBtn   = e.target.closest('.tc-expand-btn');
    const retryBtn = e.target.closest('.retry-sync-btn');
    const conflictBtn = e.target.closest('.resolve-sync-conflict-btn');
    const retryTgBtn = e.target.closest('.retry-tg-btn');
    const gotoProfileBtn = e.target.closest('.goto-profile-btn'); // NEW: замінила "На дату" на звичайних картках
    const moreBtn  = e.target.closest('.show-more-tickets-btn');
    const photoBadgeBtn = e.target.closest('.tc-photo-toggle-btn');
    if(photoBadgeBtn){ toggleTicketCardPhoto(photoBadgeBtn, document.getElementById('ticketList')); return; }
    const photoThumb = e.target.closest('.tc-photo-thumb');
    if(photoThumb){ openTicketPhotoFullscreen(photoThumb.dataset.full); return; }
    if(gotoProfileBtn){ goToTicketProfile(gotoProfileBtn.dataset.id); return; }
    if(moreBtn){
      ticketListRenderLimit += TICKET_LIST_PAGE_SIZE;
      renderMainTicketList();
      return;
    }
    if(editBtn){ editReturnAddrState = null; editTicket(editBtn.dataset.id); } // NEW: редагування зі звичайного списку — повертатись нема куди, скидаємо можливий "хвіст" від профілю
    if(delBtn)   deleteTicket(delBtn.dataset.id);
    if(shareBtn) shareTicket(shareBtn.dataset.id);
    if(tgBtn)    sendTicketToDispatcher(tgBtn.dataset.id);
    if(tgOpenBtn) openTicketInTelegram(tgOpenBtn.dataset.id);
    if(copyBtn)  copyTicketCardText(copyBtn.dataset.id);
    if(dgBtn)    showDogovor(dgBtn.dataset.id);
    if(retryBtn) retrySyncTicket(retryBtn.dataset.id);
    if(conflictBtn) showTicketConflictResolution(conflictBtn.dataset.id);
    if(retryTgBtn) retryTelegramBackup(retryTgBtn.dataset.id);
    if(expBtn){
      const id = expBtn.dataset.id;
      const contentEl = document.getElementById('tcc-'+id);
      if(!contentEl) return;
      const collapsed = contentEl.classList.toggle('tc-collapsed');
      expBtn.textContent = collapsed ? '▼ Розгорнути' : '▲ Згорнути';
    }
  });
  document.getElementById('showVizitkaBtn').addEventListener('click', showVizitka);
  document.getElementById('addTicketFab').addEventListener('click', ()=>{
    // NEW: спершу обираємо тип заявки, а не одразу відкриваємо порожню форму
    showTicketTypePicker(type=> startNewTicketFlow(type, null, null));
  });
  // NEW: свайп для зміни дня прибрано навмисно — занадто легко смикнути
  // випадково під час скролу списку і опинитись не на тій даті. Дата
  // тепер змінюється тільки кнопками ‹ › біля дати вгорі екрана.
}

function bindCalculatorScreen(){
  // <details> у деяких мобільних браузерах може змінювати scrollTop
  // прокручуваного контейнера після розкриття великого блоку. Нативний
  // toggle не потребує перерендеру, тому зберігаємо позицію до його дії та
  // повертаємо її після layout. Це спільний захист для всіх секцій калькулятора.
  const calcFormEl = document.getElementById('calcForm');
  const calcScrollEl = document.querySelector('main.screens');
  const rememberAccordionScroll = e=>{
    const summary = e.target.closest && e.target.closest('details > summary');
    if(!summary || !calcFormEl.contains(summary)) return;
    summary.parentElement._scrollTopBeforeToggle = calcScrollEl.scrollTop;
  };
  calcFormEl.addEventListener('pointerdown', rememberAccordionScroll, true);
  calcFormEl.addEventListener('click', rememberAccordionScroll, true);
  calcFormEl.addEventListener('keydown', e=>{
    if(e.key==='Enter' || e.key===' ') rememberAccordionScroll(e);
  }, true);
  calcFormEl.querySelectorAll('details').forEach(details=>{
    details.addEventListener('toggle', ()=>{
      const top = details._scrollTopBeforeToggle;
      if(!Number.isFinite(top)) return;
      requestAnimationFrame(()=> requestAnimationFrame(()=>{ calcScrollEl.scrollTop = top; }));
    });
  });
  // NEW: будь-яка реальна взаємодія з полями форми (а не автопідстановка з
  // наряду/профілю) позначає форму як "торкнуту руками" — від цього залежить,
  // чи вважати її чернеткою (див. formTouchedByUser і saveDraftToLocalStorage)
  document.getElementById('calcForm').addEventListener('input', ()=>{ formTouchedByUser = true; });
  document.getElementById('calcForm').addEventListener('change', ()=>{ formTouchedByUser = true; });
  // Автоматично виділяємо весь вміст числового поля при фокусі —
  // щоб не доводилось вручну видаляти «0» перед введенням ціни
  document.querySelectorAll('#calcForm input[type="number"]').forEach(el=>{
    el.addEventListener('focus', ()=> el.select());
  });
  ['f_callFee','f_tariff'].forEach(id=>{
    document.getElementById(id).addEventListener('input', computeTotal);
  });
  // NEW: при виборі "Безкоштовно" сума одразу обнуляється (див. computeTotal),
  // а при поверненні на "Готівка"/"Безготівка" — рахується знову як завжди.
  document.getElementById('f_payment').addEventListener('change', ()=>{ updateMixedPaymentVisibility(); computeTotal(); });
  // NEW: делегований клік по 💵/💳 в переліку розбивки суми ("Змішана" оплата)
  const mixedItemsWrapEl = document.getElementById('mixedPaymentItemsWrap');
  if(mixedItemsWrapEl) mixedItemsWrapEl.addEventListener('click', e=>{
    const btn = e.target.closest('.mixed-item-toggle');
    if(!btn) return;
    if(!calcState.itemPayments) calcState.itemPayments = {};
    calcState.itemPayments[btn.dataset.key] = btn.dataset.method;
    renderMixedPaymentItems();
  });
  document.getElementById('f_phone').addEventListener('input', formatPhoneInput);
  document.getElementById('f_type').addEventListener('change', ()=>{ applyDefaultTypeTag(); toggleTypeOtherField(); updateCallFeeLabel(); applyDefaultCallFee(); applyDefaultTariff(); });
  document.getElementById('f_signalPreset').addEventListener('change', ()=> updateOnuSignalCustomVisibility(true));
  // NEW: при зміні міста — одразу підвантажуємо підказки вулиць саме для цього міста
  // NEW: підказка клієнта за адресою — якщо на цю ж адресу вже була заявка,
// пропонуємо підставити ім'я/телефон, щоб не вбивати вручну вдруге.
// Спрацьовує тільки для НОВОЇ заявки (не при редагуванні) і тільки якщо
// клієнта/телефон ще не вписані — нічого не нав'язуємо, якщо вже заповнено.
// NEW: тепер враховуємо і квартиру (не лише будинок — в одному будинку
// різні квартири можуть належати різним абонентам), і підставляємо не лише
// ім'я/телефон, а й логін/пароль/номер договору — це дані самого абонента,
// а не конкретного візиту, тож мають лишатись з ним від заявки до заявки.
function findPreviousTicketAtAddress(city, street, house, apartment){
  const norm = s => (s||'').trim().toLowerCase();
  if(!norm(city) || !norm(street) || !norm(house)) return null;
  const aptKey = (apartment||'').trim() || '(без кв.)';
  const matches = tickets.filter(t=>
    !t.cloudImported &&
    norm(t.city)===norm(city) && norm(t.street)===norm(street) && norm(t.house)===norm(house) &&
    ticketApartmentKey(t)===aptKey &&
    (t.clientName || t.phone || t.login || t.password || t.contractNumber)
  );
  if(!matches.length) return null;
  matches.sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
  return matches[0];
}
function maybeSuggestClientFromAddress(){
  if(editingTicketId) return; // при редагуванні вже існуючої заявки нічого не пропонуємо
  if(getEffectiveType() !== 'Ремонт') return; // NEW: для Підключення номер/логін і так генеруються заново — підставляти старі не варто
  if(calcState.clientName || calcState.phone) return; // щось уже вписано — не заважаємо
  const city = document.getElementById('f_city').value.trim();
  const street = document.getElementById('f_street').value.trim();
  const house = document.getElementById('f_house').value.trim();
  const apartment = document.getElementById('f_apartment').value.trim();
  const prev = findPreviousTicketAtAddress(city, street, house, apartment);
  if(!prev) return;
  const addr = [city, street, house, apartment ? `кв. ${apartment}` : ''].filter(Boolean).join(', ');
  openModal('Клієнт на цій адресі', `
    <div style="font-size:14px; margin-bottom:14px; color:var(--text-dim);">
      На адресі <strong style="color:var(--text);">${escapeHtml(addr)}</strong> вже була заявка:<br>
      ${prev.clientName ? escapeHtml(prev.clientName)+'<br>' : ''}${prev.phone ? escapeHtml(prev.phone) : ''}
    </div>
    <button type="button" class="btn btn-accent btn-block" id="useAddrClientBtn">Підставити дані</button>
    <button type="button" class="btn btn-block" id="skipAddrClientBtn" style="margin-top:8px;">Ні, це інша людина</button>
  `, {onOpen: ()=>{
    document.getElementById('useAddrClientBtn').addEventListener('click', ()=>{
      document.getElementById('f_client').value = prev.clientName || '';
      document.getElementById('f_phone').value = prev.phone || '';
      syncPhoneFieldMaskState(); // NEW: див. коментар біля оголошення функції
      calcState.clientName = prev.clientName || '';
      calcState.phone = prev.phone || '';
      // NEW: логін/пароль/номер договору — теж дані абонента, підставляємо разом з ім'ям
      if(prev.login || prev.password){
        document.getElementById('f_credRaw').value = [prev.login, prev.password].filter(Boolean).join('\n');
        updateCredParsedHint();
      }
      if(prev.contractNumber){
        document.getElementById('f_contractManual').value = prev.contractNumber;
      }
      closeModal();
      showToast('Дані абонента підставлено');
    });
    document.getElementById('skipAddrClientBtn').addEventListener('click', closeModal);
  }});
}
document.getElementById('f_house').addEventListener('blur', maybeSuggestClientFromAddress);
document.getElementById('f_apartment').addEventListener('blur', maybeSuggestClientFromAddress); // NEW: якщо адресу вже вбито, а квартиру дописали останньою

document.getElementById('f_city').addEventListener('input', e=>{ renderStreetDatalist(e.target.value.trim()); });
  // NEW: як тільки майстер сам щось ввів у поле ціни виклику — більше не чіпаємо його автоматично
  document.getElementById('f_callFee').addEventListener('input', event=>{
    feeIsAutoDefault = false;
    calcState.baseCallFee=safeNonNegativeNumber(event.target.value);
  }, {capture:true});
  document.getElementById('f_tariff').addEventListener('input', ()=>{ tariffIsAutoDefault = false; }, {capture:true});
  /* Сканер MAC через штрих-код на наліпці пристрою (Code128 і т.п.).
   Використовує нативний BarcodeDetector — без зовнішніх бібліотек, тому
   працює і офлайн. Якщо браузер API не підтримує — просто ховаємо кнопку
   сканування, залишаючи ручне поле введення як основний спосіб. */
let macScanStream = null;
let macScanRAF = null;
let macScanSeen = new Map(); // rawValue -> кнопка, щоб не дублювати список щокадру

async function startMacScan(){
  const modal = document.getElementById('macScanModal');
  const video = document.getElementById('macScanVideo');
  const results = document.getElementById('macScanResults');
  results.innerHTML = '';
  macScanSeen = new Map();
  if(!('BarcodeDetector' in window)){
    showToast('Камера-сканер не підтримується цим браузером — введіть MAC вручну');
    return;
  }
  try{
    macScanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
  }catch(e){
    showToast('Не вдалося відкрити камеру');
    return;
  }
  video.srcObject = macScanStream;
  modal.classList.remove('hidden');
  let detector;
  try{
    detector = new BarcodeDetector({formats:['code_128','code_39','code_93','codabar','itf','ean_13','ean_8','upc_a','upc_e','qr_code','data_matrix','pdf417']});
  }catch(e){
    detector = new BarcodeDetector();
  }
  const addResultButton = (raw)=>{
    if(macScanSeen.has(raw)) return;
    const mac = normalizeMac(raw);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-block';
    btn.style.textAlign = 'left';
    btn.innerHTML = `<div style="font-weight:700;">${mac}</div><div style="font-size:11.5px; color:var(--text-dim);">як відскановано: ${raw}</div>`;
    btn.addEventListener('click', ()=>{
      document.getElementById('f_mac').value = mac;
      showToast(`Обрано: ${mac}`);
      stopMacScan();
    });
    macScanSeen.set(raw, btn);
    results.appendChild(btn);
  };
  const scanFrame = async ()=>{
    if(!macScanStream) return; // сканер вже закрито
    try{
      const codes = await detector.detect(video);
      (codes||[]).forEach(c=>{ if(c.rawValue) addResultButton(c.rawValue); });
    }catch(e){ /* кадр не розпізнався — просто пробуємо наступний */ }
    macScanRAF = requestAnimationFrame(scanFrame);
  };
  macScanRAF = requestAnimationFrame(scanFrame);
}

function stopMacScan(){
  if(macScanRAF) cancelAnimationFrame(macScanRAF);
  macScanRAF = null;
  if(macScanStream){ macScanStream.getTracks().forEach(t=>t.stop()); macScanStream = null; }
  document.getElementById('macScanModal').classList.add('hidden');
}

const photoCameraBtnEl = document.getElementById('photoCameraBtn');
  const photoGalleryBtnEl = document.getElementById('photoGalleryBtn');
  const f_photoCameraInputEl = document.getElementById('f_photoCameraInput');
  const f_photoInputEl = document.getElementById('f_photoInput');
  // NEW: захист від падіння всього застосунку, якщо на сторінці випадково
  // опиниться СТАРА версія index.html (без кнопок "Камера"/"Галерея") разом
  // із НОВИМ app.js — раніше через відсутній елемент тут виникала помилка
  // "Cannot read properties of null", яка зупиняла виконання решти скрипта
  // (звідси зникала дата, версія застосунку, список заявок).
  if(photoCameraBtnEl) photoCameraBtnEl.addEventListener('click', ()=> f_photoCameraInputEl && f_photoCameraInputEl.click());
  if(photoGalleryBtnEl) photoGalleryBtnEl.addEventListener('click', ()=> f_photoInputEl && f_photoInputEl.click());
  if(f_photoCameraInputEl) f_photoCameraInputEl.addEventListener('change', e=>{
    // NEW: капча з камери завжди дає лише один файл за раз (на відміну від
    // галереї, де можна вибрати одразу декілька) — тому обробляємо просто files[0]
    const file = e.target.files && e.target.files[0];
    if(file){
      if((calcState.photos||[]).length >= 3) showToast('Максимум 3 фото на заявку');
      else handlePhotoFile(file);
    }
    e.target.value = '';
  });
  if(f_photoInputEl) f_photoInputEl.addEventListener('change', e=>{
    const files = Array.from(e.target.files || []);
    const remaining = 3 - (calcState.photos||[]).length;
    files.slice(0, remaining).forEach(handlePhotoFile);
    if(files.length > remaining && remaining>0) showToast(`Додано лише ${remaining} з ${files.length} — максимум 3 фото на заявку`);
    else if(remaining<=0 && files.length) showToast('Максимум 3 фото на заявку');
    e.target.value = '';
  });
  document.getElementById('photoPreviewWrap').addEventListener('click', e=>{
    const btn = e.target.closest('.photo-remove');
    if(!btn) return;
    const idx = Number(btn.dataset.idx);
    // NEW: якщо це фото ще НЕ належить збереженій заявці (додане щойно в
    // цьому сеансі) — одразу прибираємо його з IndexedDB, а не лишаємо
    // "сиротою" без жодного посилання. Фото, які вже були в заявці до
    // початку редагування (є в calcOriginalPhotoKeys), не чіпаємо тут —
    // ними керує saveTicketFromForm при збереженні.
    const key = calcState.photos[idx];
    if(key && String(key).startsWith('idb:') && !calcOriginalPhotoKeys.includes(key)) deletePhotoKey(key);
    calcState.photos.splice(idx, 1);
    calcState.photo = calcState.photos[0] || null; // NEW: перше фото — і далі дублюється у старе поле photo
    renderPhotoPreview();
  });
  document.getElementById('macScanBtn').addEventListener('click', startMacScan);
  document.getElementById('macScanCloseBtn').addEventListener('click', stopMacScan);
  document.getElementById('f_mac').addEventListener('input', e=>{
    const pos = e.target.selectionStart;
    const before = e.target.value;
    e.target.value = normalizeMac(before).slice(0,12);
    // якщо не редагували середину рядка (звичайне друкування в кінці) — курсор лишаємо в кінці
    if(pos === before.length) e.target.selectionStart = e.target.selectionEnd = e.target.value.length;
    // NEW: м'яка підказка (не блокує збереження) — повний MAC це рівно 12 символів 0-9/A-F
    const hint = document.getElementById('macHint');
    if(hint) hint.style.display = (e.target.value && !/^[0-9A-F]{12}$/.test(e.target.value)) ? '' : 'none';
  });
  if(!('BarcodeDetector' in window)) document.getElementById('macScanBtn').classList.add('hidden');
  document.getElementById('f_credRaw').addEventListener('input', updateCredParsedHint);
  document.getElementById('f_dateNative').addEventListener('change', e=>{
    const ddmmyyyy = isoToDdmmyyyy(e.target.value);
    if(ddmmyyyy) document.getElementById('f_date').value = ddmmyyyy;
  });
  document.getElementById('geoBtn').addEventListener('click', handleGeoBtn);
  document.getElementById('geoClearBtn').addEventListener('click', ()=>{ setGeoLink(''); showToast('Геолокацію видалено'); });

  document.getElementById('equipmentList').addEventListener('change', e=>{
    const chk = e.target.closest('.eq-check');
    if(chk){
      const idx = Number(chk.dataset.eqidx);
      calcState.equipment[idx].checked = chk.checked;
      syncCatalogTagState(calcState.equipment[idx].label, chk.checked); // NEW: авто-тег за назвою матеріалу
      applyDefaultCallFee(); renderEquipmentList();
    }
  });
  document.getElementById('equipmentList').addEventListener('input', e=>{
    const price = e.target.closest('.eq-price');
    if(price){ calcState.equipment[Number(price.dataset.eqidx)].price=safeNonNegativeNumber(price.value);applyDefaultCallFee();updateEquipmentSummary(); }
  });

  // NEW: обробники для динамічного списку кабелів
  document.getElementById('cablesList').addEventListener('input', e=>{
    const metersEl = e.target.closest('.cab-meters');
    const priceEl = e.target.closest('.cab-price');
    if(metersEl){calcState.cables[Number(metersEl.dataset.cabidx)].meters=safeNonNegativeNumber(metersEl.value);computeTotal();updateCablesSummary();}
    if(priceEl){calcState.cables[Number(priceEl.dataset.cabidx)].pricePerMeter=safeNonNegativeNumber(priceEl.value);computeTotal();updateCablesSummary();}
  });

  document.getElementById('presetWorksList').addEventListener('change', e=>{
    const chk = e.target.closest('.pw-check');
    if(chk){
      const idx = Number(chk.dataset.pwidx);
      calcState.presetWorks[idx].checked = chk.checked;
      syncCatalogTagState(calcState.presetWorks[idx].label, chk.checked); // NEW: авто-тег за назвою роботи
      computeTotal(); renderPresetWorksList();
    }
  });
  document.getElementById('presetWorksList').addEventListener('input', e=>{
    const qty = e.target.closest('.pw-qty');
    const price = e.target.closest('.pw-price');
    if(qty){calcState.presetWorks[Number(qty.dataset.pwidx)].qty=safeWorkQuantity(qty.value);computeTotal();}
    if(price){calcState.presetWorks[Number(price.dataset.pwidx)].price=safeNonNegativeNumber(price.value);computeTotal();}
  });

  document.getElementById('addWorkBtn').addEventListener('click', ()=>{
    calcState.additionalWork.push({desc:'', sum:0});
    renderAdditionalWorkList(); computeTotal();
  });
  document.getElementById('additionalWorkList').addEventListener('input', e=>{
    const row = e.target.closest('[data-awidx]'); if(!row) return;
    const idx = Number(row.dataset.awidx);
    if(e.target.classList.contains('aw-desc')) calcState.additionalWork[idx].desc = e.target.value;
    if(e.target.classList.contains('aw-sum')) {
      calcState.additionalWork[idx].sum=safeNonNegativeNumber(e.target.value);
      computeTotal();
      const sum=calcState.additionalWork.reduce((s,w)=>s+safeNonNegativeNumber(w.sum),0);
      document.getElementById('additionalWorkSummary').textContent = `— ${calcState.additionalWork.length}, ${fmtMoney(sum)}`;
    }
  });
  document.getElementById('additionalWorkList').addEventListener('click', e=>{
    const removeBtn = e.target.closest('.aw-remove'); if(!removeBtn) return;
    const idx = Number(removeBtn.closest('[data-awidx]').dataset.awidx);
    calcState.additionalWork.splice(idx,1);
    // Ключі змішаної оплати для додаткових робіт залежать від індексу aw_N.
    // Після видалення рядка зсуваємо ключі наступних робіт разом зі списком,
    // щоб робота не успадковувала спосіб оплати видаленої сусідньої позиції.
    if(calcState.itemPayments){
      const updatedPayments = {};
      Object.entries(calcState.itemPayments).forEach(([key, method])=>{
        const match = key.match(/^aw_(\d+)$/);
        if(!match){ updatedPayments[key] = method; return; }
        const oldIndex = Number(match[1]);
        if(oldIndex < idx) updatedPayments[key] = method;
        else if(oldIndex > idx) updatedPayments[`aw_${oldIndex-1}`] = method;
      });
      calcState.itemPayments = updatedPayments;
    }
    // не лишаємо список зовсім порожнім — завжди має бути хоч одне поле для вводу
    if(calcState.additionalWork.length===0) calcState.additionalWork.push({desc:'', sum:0});
    renderAdditionalWorkList(); computeTotal();
  });

  document.getElementById('calcTagChips').addEventListener('click', e=>{
    const chip = e.target.closest('[data-calctag]'); if(!chip) return;
    const tag = chip.dataset.calctag;
    const i = calcState.tags.indexOf(tag);
    if(i>-1) calcState.tags.splice(i,1); else calcState.tags.push(tag);
    // NEW: раніше тут викликався renderCalcTagChips(), який перебудовував весь
    // innerHTML — це знищувало саме ту кнопку, по якій щойно тапнули, і браузер
    // "губив" фокус та підкидав скрол сторінки вгору. Тепер міняємо лише клас.
    chip.classList.toggle('active');
    document.getElementById('tagsSummary').textContent = calcState.tags.length ? `— обрано: ${calcState.tags.length}` : '';
  });
  document.getElementById('calcMasterChips').addEventListener('click', e=>{
    const chip = e.target.closest('[data-master-letter]'); if(!chip) return;
    const letter = chip.dataset.masterLetter;
    const name = chip.dataset.masterName;
    if(!calcState.connectMasters) calcState.connectMasters = [];
    const idx = calcState.connectMasters.findIndex(m=>m.name===name);
    let newTagRegistered = false; // NEW: чи з'явився зовсім новий тег у списку (тоді таки треба перемалювати)
    if(idx>-1){
      // повторний тап на вже вибраного майстра знімає вибір
      calcState.connectMasters.splice(idx,1);
      // прибираємо його ім'я з тегів цієї заявки (сам тег у Налаштуваннях лишається)
      const ti = calcState.tags.indexOf(name);
      if(ti>-1) calcState.tags.splice(ti,1);
    } else {
      // додаємо в кінець — порядок натискань визначає порядок літер у номері договору
      calcState.connectMasters.push({name, letter});
      // напарник одразу стає тегом заявки — не треба вписувати ім'я двічі
      if(!calcState.tags.includes(name)) calcState.tags.push(name);
      // якщо такого тега ще нема серед офіційних у Налаштуваннях — реєструємо його там же
      if(!settings.tags.includes(name)){ settings.tags.push(name); saveSettings(); newTagRegistered = true; }
    }
    // NEW: раніше тут завжди викликались renderMasterChips()/renderCalcTagChips(), які
    // перебудовували весь innerHTML і губили скрол/фокус (та сама причина, що й з тегами
    // вище). Тепер повне перемальовування тегів робимо лише тоді, коли справді з'явився
    // новий елемент списку — інакше просто оновлюємо класи "active" на місці.
    chip.classList.toggle('active');
    saveDailyMastersDefault(calcState.connectMasters); // NEW: запам'ятовуємо поточний вибір як "бригаду на сьогодні"
    if(newTagRegistered){
      renderCalcTagChips();
    } else {
      document.getElementById('tagsSummary').textContent = calcState.tags.length ? `— обрано: ${calcState.tags.length}` : '';
      document.querySelectorAll('#calcTagChips [data-calctag]').forEach(btn=>{
        btn.classList.toggle('active', calcState.tags.includes(btn.dataset.calctag));
      });
    }
  });

  document.getElementById('sendTicketBtn').addEventListener('click', shareCurrentTicket);
  document.getElementById('sendToDispatcherBtn').addEventListener('click', sendCurrentTicketToDispatcher);
  document.getElementById('copyTextBtn').addEventListener('click', copyTicketText);
  document.getElementById('sharePhotoBtn').addEventListener('click', sharePhoto);
  document.getElementById('saveTicketBtn').addEventListener('click', saveTicketFromForm);
  document.getElementById('cancelEditBtn').addEventListener('click', ()=>{
    syncFormToState(); // щоб hasUnsavedChanges бачила саме те, що зараз у полях, а не стан на момент відкриття
    // NEW: та сама кнопка тепер править і "Скасувати редагування" (для наявної
    // заявки), і "Назад до пошуку" (для нової заявки, відкритої з профілю/
    // пошуку) — текст підтвердження підбираємо залежно від того, що з двох
    const confirmMsg = editingTicketId ? 'Скасувати редагування? Незбережені зміни буде втрачено.' : 'Повернутись назад? Введені у заявку дані буде втрачено.';
    if(hasUnsavedChanges() && !confirm(confirmMsg)) return;
    cleanupUnsavedNewPhotos(); // NEW: не лишати в IndexedDB фото, зроблені в цьому сеансі, якщо заявку скасовано
    clearDraft(); resetCalcForm(currentTicketDate); returnAfterTicketEdit();
  });
}

/* ---- Пасивний рендеринг навігатора адресів і профілю абонента ----
   Будує дані та HTML без обробників, мережі або зміни стану. */

function buildAddressTree(){
  const tree = new Map(); // city -> Map(street -> Set(house))
  tickets.forEach(t=>{
    const city = (t.city||'').trim();
    const street = (t.street||'').trim();
    if(!city || !street) return;
    if(!tree.has(city)) tree.set(city, new Map());
    const streetsMap = tree.get(city);
    if(!streetsMap.has(street)) streetsMap.set(street, new Set());
    streetsMap.get(street).add((t.house||'').trim() || '(без номера)');
  });
  return tree;
}

function getApartmentGroupsForHouse(city, street, house){
  const list = tickets.filter(t=>
    (t.city||'').trim()===city &&
    (t.street||'').trim()===street &&
    ((t.house||'').trim() || '(без номера)')===house
  );
  const groups = new Map(); // apartmentKey -> [tickets]
  list.forEach(t=>{
    const key = ticketApartmentKey(t);
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  return groups;
}

function ticketMatchesSearchQuery(t, q){
  const ql = q.trim().toLowerCase();
  if(!ql) return false;
  const qDigits = ql.replace(/\D/g,'');
  if(qDigits.length>=3){
    const tDigits = String(t.phone||'').replace(/\D/g,'');
    if(tDigits.includes(qDigits)) return true;
    // NEW: шукаємо і серед додаткових телефонів абонента
    if((t.extraPhones||[]).some(p=>String(p||'').replace(/\D/g,'').includes(qDigits))) return true;
  }
  if((t.clientName||'').toLowerCase().includes(ql)) return true;
  const addr = [t.city, t.street, t.house, t.address].filter(Boolean).join(' ').toLowerCase();
  if(addr.includes(ql)) return true;
  return false;
}

function addrNavBreadcrumbHtml(){
  const crumbs = [`<span class="chip addr-nav-crumb" data-crumb="city" style="cursor:pointer;">🧭 Усі міста</span>`];
  if(addrNavState.city) crumbs.push(`<span class="chip addr-nav-crumb" data-crumb="street" style="cursor:pointer;">${escapeHtml(addrNavState.city)}</span>`);
  if(addrNavState.street) crumbs.push(`<span class="chip addr-nav-crumb" data-crumb="house" style="cursor:pointer;">${escapeHtml(addrNavState.street)}</span>`);
  if(addrNavState.house && (addrNavState.level==='profiles' || addrNavState.level==='tickets')) crumbs.push(`<span class="chip addr-nav-crumb" data-crumb="profiles" style="cursor:pointer;">буд. ${escapeHtml(addrNavState.house)}</span>`);
  return `<div class="row wrap" style="gap:6px; margin-bottom:12px;">${crumbs.join('')}</div>`;
}

function addrNavSearchResultsHtml(query){
  // NEW: тут і в трьох місцях нижче раніше сортування йшло як текстове
  // порівняння "ДД.ММ.РРРР ГГ:ХХ" (localeCompare) — через формат дати з
  // числом дня ПЕРШИМ це фактично сортувало здебільшого за днем місяця, а
  // не за реальною хронологією (наприклад, "01.12.2025" опинялось б ПЕРЕД
  // "15.01.2026", хоча хронологічно все навпаки). Тепер — числовий ключ
  // ticketSortKey (справжня дата+час у мілісекундах), як і в решті коду.
  const list = tickets.filter(t=>ticketMatchesSearchQuery(t, query))
    .sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
  const header = `<div style="font-size:12.5px; color:var(--text-dim); margin-bottom:8px;">Знайдено профілів:</div>`;
  if(!list.length) return `<div style="font-size:12.5px; color:var(--text-dim); margin-bottom:8px;">Знайдено: 0</div><div class="empty-state" style="padding:24px 10px;">Нічого не знайдено</div>`;

  // NEW: результати пошуку — це список ПРОФІЛІВ (адреса + ім'я + телефон),
  // а не одразу картки заявок. Групуємо за місто+вулиця+будинок+КВАРТИРА
  // (не просто будинком — в одному будинку можуть жити різні абоненти по
  // різних квартирах). Тап на профіль веде всередину — там уже шапка
  // профілю й картки. Заявки без структурованої адреси (місто+вулиця)
  // показуємо окремо як прості картки — для них профіль зібрати нема з чого.
  const groups = new Map(); // "місто||вулиця||будинок||кв" -> {city,street,house,apartment,list:[]}
  const loose = [];
  list.forEach(t=>{
    const city = (t.city||'').trim(), street = (t.street||'').trim();
    if(!city || !street){ loose.push(t); return; }
    const house = (t.house||'').trim() || '(без номера)';
    const apartment = ticketApartmentKey(t);
    const key = `${city}||${street}||${house}||${apartment}`;
    if(!groups.has(key)) groups.set(key, {city, street, house, apartment, list:[]});
    groups.get(key).list.push(t);
  });

  const groupsHtml = [...groups.values()]
    .sort((a,b)=>{
      const aLatest = a.list.slice().sort((x,y)=>ticketSortKey(y) - ticketSortKey(x))[0];
      const bLatest = b.list.slice().sort((x,y)=>ticketSortKey(y) - ticketSortKey(x))[0];
      return ticketSortKey(bLatest) - ticketSortKey(aLatest); // NEW: числовий ключ замість текстового порівняння дати
    })
    .map(g=>{
      const sorted = g.list.slice().sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
      const addrLabel = [g.city, g.street, g.house!=='(без номера)' ? `буд. ${g.house}` : '', g.apartment!=='(без кв.)' ? `кв. ${g.apartment}` : ''].filter(Boolean).join(', ');
      return addrProfileSummaryButtonHtml(sorted, addrLabel, `data-city="${escapeHtml(g.city)}" data-street="${escapeHtml(g.street)}" data-house="${escapeHtml(g.house)}" data-apartment="${escapeHtml(g.apartment)}"`);
    }).join('');

  const looseHtml = loose.length ? `<div style="font-size:12px; color:var(--text-dim); margin:14px 0 4px;">Без структурованої адреси:</div><div class="ticket-list">${loose.map(renderTicketCard).join('')}</div>` : '';
  return header + groupsHtml + looseHtml;
}

function addrNavTitle(){
  if(addrNavSearchQuery.trim()) return `Пошук: «${addrNavSearchQuery.trim()}»`;
  const tree = buildAddressTree();
  if(addrNavState.level==='city') return `Місто (${tree.size})`;
  if(addrNavState.level==='street') return addrNavState.city;
  if(addrNavState.level==='house') return `${addrNavState.city}, ${addrNavState.street}`;
  if(addrNavState.level==='profiles') return `буд. ${addrNavState.house} — профілі`;
  if(addrNavState.level==='tickets') return addrNavState.apartment && addrNavState.apartment!=='(без кв.)' ? `буд. ${addrNavState.house}, кв. ${addrNavState.apartment}` : `буд. ${addrNavState.house}`;
  return 'Навігатор адрес';
}

function addrProfileSummaryButtonHtml(list, addrLabel, dataAttrs){
  const named = list.filter(t=>t.clientName || t.phone);
  const primary = named[0] || null;
  const name = primary && primary.clientName ? primary.clientName : 'Ім’я невідоме';
  const phone = primary && primary.phone ? primary.phone : '';
  return `
    <button type="button" class="btn btn-block addr-profile-btn" ${dataAttrs} style="text-align:left; justify-content:space-between; margin-bottom:8px; height:auto; padding:12px 14px;">
      <span>
        <div style="font-size:15px; font-weight:700; margin-bottom:2px;">📍 ${escapeHtml(addrLabel)}</div>
        <div style="font-size:12px; opacity:.7; margin-bottom:1px;">👤 ${escapeHtml(name)}</div>
        <div style="font-size:12px; opacity:.7;">${phone ? escapeHtml(phone)+' · ' : ''}${list.length} заявок</div>
      </span>
      <span style="opacity:.5;">›</span>
    </button>`;
}

function addrAbonentProfileHtml(list, keySuffix=''){
  // NEW: шапка тепер завжди показується (адреса й кількість заявок відомі
  // завжди) — раніше вона повністю зникала, якщо жодна заявка ще не мала
  // заповненого ПІБ/телефону, що і виглядало як "профіль десь загубився".
  const named = list.filter(t=>t.clientName || t.phone); // list вже відсортовано від новіших до старіших
  const primary = named[0] || null;
  const seen = primary ? new Set([`${primary.clientName||''}|${primary.phone||''}`]) : new Set();
  const others = [];
  named.slice(primary?1:0).forEach(t=>{
    const key = `${t.clientName||''}|${t.phone||''}`;
    if(!seen.has(key)){ seen.add(key); others.push(t); }
  });
  // NEW: повна адреса — першим рядком у профілі, крупніше за ПІБ (адреса тут
  // головний орієнтир, ПІБ — другорядний підпис)
  const first = list[0] || {};
  const addrLine = [first.city, first.street, first.house ? `${first.house}` : '', first.apartment ? `кв. ${first.apartment}` : ''].filter(Boolean).join(', ');
  // NEW: фото абонента — не зберігаємо його додатково на телефоні "про
  // всяк випадок": кнопка підвантажує знімки лише за запитом (з локального
  // кешу IndexedDB, якщо вже завантажували, інакше — напряму з Telegram), і
  // тепер її можна натиснути повторно, щоб знову приховати фото.
  // keySuffix — коли на екрані одночасно кілька профілів (результати
  // пошуку по кількох адресах), id мають бути унікальними для кожного.
  // NEW: раніше показувалось лише ОДНЕ (найсвіжіше) фото з усіх заявок за
  // адресою — тепер збираємо фото з УСІХ заявок (кожен виклик міг мати своє
  // фото), щоб у профілі було видно всю ситуацію по адресі одразу.
  const photoEntries = [];
  list.forEach(t=>{
    const keys = (t.photos && t.photos.length) ? t.photos : (t.photo ? [t.photo] : []);
    const fileIds = (t.tgPhotoFileIds && t.tgPhotoFileIds.length)
      ? t.tgPhotoFileIds
      : (t.tgPhotoFileId ? [t.tgPhotoFileId] : []);
    keys.forEach((key, i)=>{ if(key) photoEntries.push({key, fileId: fileIds[i] || null}); });
  });
  const wrapId = `abonentProfilePhotoWrap${keySuffix}`;
  const photoBtnHtml = photoEntries.length ? `
    <button type="button" class="btn btn-sm abonent-photo-btn" data-wrap-id="${wrapId}" data-photo-keys='${escapeHtml(JSON.stringify(photoEntries.map(p=>p.key)))}' data-tg-file-ids='${escapeHtml(JSON.stringify(photoEntries.map(p=>p.fileId)))}' style="margin-top:8px;">📷 Показати фото (${photoEntries.length})</button>
    <div id="${wrapId}" class="hidden row wrap" style="gap:8px; margin-top:8px;"></div>`
    : `<div style="font-size:12px; color:var(--text-faint); margin-top:8px;">📷 Фото до жодної заявки тут не додано</div>`;
  // NEW: номер договору/логін/пароль — це дані абонента, а не конкретного
  // візиту: показуємо один раз у профілі (з найсвіжішої заявки, де вони є),
  // а не дублюємо в кожній картці нижче (там вони прибрані).
  const acctTicket = list.find(t=>t.contractNumber || t.login || t.password);
  const acctHtml = acctTicket ? `
    <div style="margin-top:8px; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px solid var(--accent); font-size:13.5px; line-height:1.6;">
      ${acctTicket.contractNumber ? `📄 <strong>№ дог.:</strong> ${escapeHtml(acctTicket.contractNumber)}<br>` : ''}
      ${acctTicket.login ? `👤 <strong>Логін:</strong> <span style="font-family:var(--mono);">${escapeHtml(acctTicket.login)}</span><br>` : ''}
      ${acctTicket.password ? `🔑 <strong>Пароль:</strong> <span style="font-family:var(--mono);">${escapeHtml(acctTicket.password)}</span>` : ''}
    </div>` : '';
  // NEW: додаткові телефони абонента (окрім основного) — рівня профілю, як
  // і решта полів; беремо з найсвіжішої заявки, де вони вказані.
  const extraPhonesTicket = list.find(t=>t.extraPhones && t.extraPhones.length);
  const extraPhonesHtml = (extraPhonesTicket && extraPhonesTicket.extraPhones.length)
    ? `<div style="margin-bottom:4px;">${extraPhonesTicket.extraPhones.map(p=>`<a href="tel:${escapeHtml(p)}" style="display:inline-block; margin-right:12px; color:var(--accent); text-decoration:none;">📞 ${escapeHtml(p)}</a>`).join('')}</div>`
    : '';
  // NEW: примітка про абонента (не про конкретний візит — та примітка
  // (masterNote) лишається в кожній заявці окремо) — теж рівня профілю.
  // Тепер має власну кнопку редагування — не треба заходити в повне
  // "Редагувати абонента", щоб просто дописати чи виправити примітку.
  const noteTicket = list.find(t=>t.abonentNote);
  const noteIdsJson = escapeHtml(JSON.stringify(list.map(t=>t.id)));
  const noteVal = (noteTicket && noteTicket.abonentNote) || '';
  const noteHtml = noteVal
    ? `<div style="margin-top:8px; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px dashed var(--text-dim); font-size:13px; color:var(--text-dim); display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <span style="white-space:pre-wrap;">📝 ${escapeHtml(noteVal)}</span>
        <button type="button" class="btn btn-sm abonent-note-edit-btn" data-ids="${noteIdsJson}" data-note="${escapeHtml(noteVal)}" title="Редагувати примітку" style="flex-shrink:0;">✏️</button>
      </div>`
    : `<button type="button" class="btn btn-sm abonent-note-edit-btn" data-ids="${noteIdsJson}" data-note="" style="margin-top:8px;">📝 Додати примітку</button>`;
  // NEW: кнопки "Договір" і "Перейти" (геолокація) тепер тут, на рівні
  // профілю — а не дублюються в кожній картці заявки нижче
  const geoTicket = list.find(t=>t.geoLink);
  // NEW: геолокацію тепер можна не лише переглянути ("Перейти"), а й
  // додати/виправити прямо з профілю — застосовується одразу до ВСІХ
  // заявок за цією адресою, як і решта полів профілю.
  const geoIdsJson = escapeHtml(JSON.stringify(list.map(t=>t.id)));
  const geoEditBtnHtml = `<button type="button" class="btn btn-sm abonent-geo-edit-btn" data-ids="${geoIdsJson}" data-geo-link="${escapeHtml(geoTicket ? geoTicket.geoLink : '')}" title="${geoTicket ? 'Редагувати геолокацію' : 'Додати геолокацію'}" style="${geoTicket ? '' : 'flex:1;'}">${geoTicket ? '✏️' : '📍 Додати геолокацію'}</button>`;
  const actionBtnsHtml = `
    <div class="row" style="gap:8px; margin-top:8px;">
      <!-- NEW: раніше кнопка "Договір" з'являлась лише за наявності номера
           договору — але showDogovor() і так коректно показує картку/QR і
           без нього (просто без рядка "№ ..."). Якщо номер невідомий (лише
           логін/пароль від диспетчера, без офіційного номера) — кнопка
           тепер теж доступна, щоб абонент міг відсканувати ті ж дані. -->
      ${acctTicket ? `<button type="button" class="btn btn-sm contract-ticket-btn" data-id="${acctTicket.id}" style="flex:1;">📜 Договір</button>` : ''}
      ${geoTicket ? `<a href="${escapeHtml(geoTicket.geoLink)}" target="_blank" rel="noopener" class="btn btn-sm" style="flex:1; text-decoration:none; text-align:center;">📍 Перейти</a>` : ''}
      ${geoEditBtnHtml}
    </div>`;
  // NEW: редагування ПІБ/телефону/адреси/логіна/пароля/договору просто в
  // профілі — застосовується одразу до ВСІХ заявок за цією адресою (додає,
  // де не було, виправляє, де було). Дані пакуємо в один data-атрибут, щоб
  // не тягнути купу окремих data-*.
  const editData = {
    ids: list.map(t=>t.id),
    clientName: primary && primary.clientName || '', phone: primary && primary.phone || '',
    city: first.city||'', street: first.street||'', house: first.house||'', apartment: first.apartment||'',
    login: acctTicket && acctTicket.login || '', password: acctTicket && acctTicket.password || '',
    contractNumber: acctTicket && acctTicket.contractNumber || '',
    note: noteTicket && noteTicket.abonentNote || '',
    extraPhones: (extraPhonesTicket && extraPhonesTicket.extraPhones) || []
  };
  // NEW: "Створити заявку" з профілю — той самий тип-пікер, що й на "+
  // Заявка", але форма одразу відкривається з підставленими даними абонента
  // (адреса/ПІБ/телефон/логін/пароль/договір), як просив користувач.
  const newTicketPrefill = {
    city: editData.city, street: editData.street, house: editData.house, apartment: editData.apartment,
    clientName: editData.clientName, phone: editData.phone,
    login: editData.login, password: editData.password, contractNumber: editData.contractNumber
  };
  return `
    <div class="card abonent-profile-card" style="margin-bottom:12px; padding:14px;">
      <div class="row between" style="align-items:flex-start; gap:8px;">
        <div style="font-size:17px; font-weight:700; margin-bottom:4px;">📍 ${escapeHtml(addrLine || 'Адреса не вказана')}</div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button type="button" class="btn btn-sm abonent-new-ticket-btn" data-prefill="${escapeHtml(JSON.stringify(newTicketPrefill))}" title="Створити заявку на цю адресу">➕</button>
          <button type="button" class="btn btn-sm abonent-edit-btn" data-profile="${escapeHtml(JSON.stringify(editData))}" title="Редагувати дані абонента">✏️</button>
        </div>
      </div>
      <div style="font-size:13.5px; font-weight:600; color:var(--text-dim); margin-bottom:4px;">👤 ${escapeHtml(primary && primary.clientName ? primary.clientName : 'Ім’я невідоме')}</div>
      ${primary && primary.phone ? `<a href="tel:${escapeHtml(primary.phone)}" style="display:inline-block; margin-bottom:4px; color:var(--accent); text-decoration:none;">📞 ${escapeHtml(primary.phone)}</a>` : `<div style="font-size:12.5px; color:var(--text-faint); margin-bottom:4px;">📞 телефон не вказано</div>`}
      ${extraPhonesHtml}
      ${acctHtml}
      ${noteHtml}
      ${actionBtnsHtml}
      ${photoBtnHtml}
      <div style="font-size:12.5px; color:var(--text-dim); margin-top:8px;">🗓️ Заявок за цією адресою: ${list.length}</div>
      ${others.length ? `<div style="margin-top:8px; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px dashed var(--text-dim); font-size:12.5px; color:var(--text-dim);">⚠️ Раніше тут також траплялось: ${others.map(o=>escapeHtml([o.clientName,o.phone].filter(Boolean).join(' · '))).join('; ')} — можливо, інший абонент</div>` : ''}
    </div>`;
}

function addrNavResultsAreaHtml(){
  if(addrNavSearchQuery.trim()) return addrNavSearchResultsHtml(addrNavSearchQuery);
  const tree = buildAddressTree();
  let bodyHtml = addrNavBreadcrumbHtml();

  if(addrNavState.level==='city'){
    const cities = naturalSortStrings([...tree.keys()]);
    bodyHtml += cities.length ? cities.map(city=>`
      <button type="button" class="btn btn-block addr-nav-city-btn" data-city="${escapeHtml(city)}" style="justify-content:space-between; margin-bottom:6px;">
        <span>${escapeHtml(city)}</span><span style="opacity:.6; font-weight:400;">${tree.get(city).size} вул. ›</span>
      </button>`).join('') : `<div class="empty-state" style="padding:24px 10px;"><div class="es-icon">🗺️</div>Ще немає заявок зі структурованою адресою</div>`;
  } else if(addrNavState.level==='street'){
    const streetsMap = tree.get(addrNavState.city) || new Map();
    const streets = naturalSortStrings([...streetsMap.keys()]);
    bodyHtml += streets.length ? streets.map(street=>`
      <button type="button" class="btn btn-block addr-nav-street-btn" data-street="${escapeHtml(street)}" style="justify-content:space-between; margin-bottom:6px;">
        <span>${escapeHtml(street)}</span><span style="opacity:.6; font-weight:400;">${streetsMap.get(street).size} буд. ›</span>
      </button>`).join('') : `<div class="empty-state" style="padding:24px 10px;">Вулиць не знайдено</div>`;
  } else if(addrNavState.level==='house'){
    const streetsMap = tree.get(addrNavState.city) || new Map();
    const houses = naturalSortStrings([...(streetsMap.get(addrNavState.street) || new Set())]);
    bodyHtml += houses.length ? houses.map(house=>`
      <button type="button" class="btn btn-block addr-nav-house-btn" data-house="${escapeHtml(house)}" style="justify-content:space-between; margin-bottom:6px;">
        <span>буд. ${escapeHtml(house)}</span><span style="opacity:.6;">›</span>
      </button>`).join('') : `<div class="empty-state" style="padding:24px 10px;">Будинків не знайдено</div>`;
  } else if(addrNavState.level==='profiles'){
    // NEW: у будинку кілька квартир з різними абонентами — показуємо список
    // профілів (не одразу картки), тап на профіль веде всередину до нього.
    const groups = getApartmentGroupsForHouse(addrNavState.city, addrNavState.street, addrNavState.house);
    const entries = [...groups.entries()].sort((a,b)=>{
      const aLatest = a[1].slice().sort((x,y)=>ticketSortKey(y) - ticketSortKey(x))[0];
      const bLatest = b[1].slice().sort((x,y)=>ticketSortKey(y) - ticketSortKey(x))[0];
      return ticketSortKey(bLatest) - ticketSortKey(aLatest); // NEW: числовий ключ замість текстового порівняння дати
    });
    bodyHtml += entries.length ? entries.map(([aptKey, aptList])=>{
      const addrLabel = aptKey!=='(без кв.)' ? `кв. ${aptKey}` : `буд. ${addrNavState.house}`;
      return addrProfileSummaryButtonHtml(aptList, addrLabel, `data-apartment="${escapeHtml(aptKey)}"`);
    }).join('') : `<div class="empty-state" style="padding:24px 10px;">Профілів не знайдено</div>`;
  } else if(addrNavState.level==='tickets'){
    // NEW: "профіль абонента" (ім'я/телефон/скільки разів були) один раз
    // згори, а картки під ним — уже без дублювання цих даних, лише що робили.
    // Фільтруємо і за квартирою теж — інакше різні абоненти в одному будинку
    // змішувались би в один профіль.
    const list = tickets.filter(t=>
      (t.city||'').trim()===addrNavState.city &&
      (t.street||'').trim()===addrNavState.street &&
      ((t.house||'').trim() || '(без номера)')===addrNavState.house &&
      ticketApartmentKey(t)===addrNavState.apartment
    ).sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
    bodyHtml += list.length
      ? addrAbonentProfileHtml(list) + `<div class="ticket-list">${list.map(t=>renderTicketCard(t, {workOnly:true})).join('')}</div>`
      : `<div class="empty-state" style="padding:24px 10px;">Заявок не знайдено</div>`;
  }

  if(addrNavState.level==='city'){
    bodyHtml += `<div style="margin-top:14px; padding-top:10px; border-top:1px dashed var(--border); font-size:11.5px; color:var(--text-faint); text-align:center;">
      Заявки з таблиць з'являться тут, тільки якщо вручну заповнити для них місто й вулицю — інакше шукайте їх через пошук вище
    </div>`;
  }
  return bodyHtml;
}

/* ---- Візуальний рендеринг екрана налаштувань ----
   Читає лише settings і оновлює DOM. */
function renderSettingsScreen(){
  document.getElementById('appVersionLabel').textContent = `Версія застосунку: ${APP_VERSION}`; // NEW
  document.getElementById('hourlyRateInput').value = settings.hourlyRate;
  document.getElementById('defaultConnectFeeInput').value = settings.defaultConnectFee;
  document.getElementById('defaultTariffInput').value = settings.defaultTariff;
  renderDeletedTicketsList();
  document.getElementById('defaultRepairCallFeeInput').value = settings.defaultRepairCallFee;
  document.getElementById('freeRepairCallThresholdInput').value = settings.freeRepairCallThreshold;
  document.getElementById('themeSwitch').checked = settings.theme==='dark';
  // NEW: стан захисту входу
  document.getElementById('appLockToggle').checked = !!settings.appLockEnabled;
  document.getElementById('appLockStatusDesc').textContent = settings.appLockEnabled ? 'Увімкнено' : 'Вимкнено';
  document.getElementById('appLockChangePwBtn').classList.toggle('hidden', !settings.appLockEnabled);
  document.getElementById('appLockBiometricRow').classList.toggle('hidden', !settings.appLockEnabled);
  document.getElementById('appLockBiometricToggle').checked = !!settings.appLockBiometricEnabled;
  document.getElementById('scriptUrlInput').value = settings.scriptUrl || '';
  document.getElementById('tgBotTokenInput').value = settings.tgBotToken || '';
  document.getElementById('tgBackupChatIdInput').value = settings.tgBackupChatId || '';
  document.getElementById('tgDisp1NameInput').value = (settings.tgDispatchers && settings.tgDispatchers[0] && settings.tgDispatchers[0].name) || '';
  document.getElementById('tgDisp1ChatIdInput').value = (settings.tgDispatchers && settings.tgDispatchers[0] && settings.tgDispatchers[0].chatId) || '';
  document.getElementById('tgDisp2NameInput').value = (settings.tgDispatchers && settings.tgDispatchers[1] && settings.tgDispatchers[1].name) || '';
  document.getElementById('tgDisp2ChatIdInput').value = (settings.tgDispatchers && settings.tgDispatchers[1] && settings.tgDispatchers[1].chatId) || '';
  document.getElementById('tgMyChatIdInput').value = settings.tgMyChatId || '';
  document.getElementById('syncSecretInput').value = settings.syncSecret || '';
  document.getElementById('shiftsScriptUrlInput').value = settings.shiftsScriptUrl || '';
  document.getElementById('vizitkaUrlInput').value = settings.vizitkaUrl || '';
  document.getElementById('dogovorUrlInput').value = settings.dogovorUrl || '';
  renderTagMgmtList();
  renderQuickDialMgmtList();
  renderCityMgmtList();
  renderCwMgmtList();
  renderMatMgmtList();
  renderWorkMgmtList();
  renderCableMgmtList();
  renderMasterMgmtList();
  renderDailyBackupList();
}

function renderTagMgmtList(){
  document.getElementById('tagMgmtList').innerHTML = settings.tags.map(tag=>
    `<span class="chip">${escapeHtml(tag)} <span class="chip-x remove-tag-btn" data-tag="${escapeHtml(tag)}">✕</span></span>`
  ).join('') || '<span style="color:var(--text-faint); font-size:13px;">Тегів немає</span>';
}
/* NEW: "Швидкий набір" — номери, які часто треба набрати (диспетчери тощо),
   керуються в Налаштуваннях, а самі кнопки показуються внизу вкладки
   «Заявки», під візиткою — тап одразу відкриває номеронабирач. */
function renderQuickDialMgmtList(){
  const wrap = document.getElementById('quickDialMgmtList');
  if(!wrap) return;
  const list = settings.quickDialContacts||[];
  wrap.innerHTML = list.length ? list.map((c,i)=>`
    <div class="settings-row" style="align-items:center;">
      <div><div class="sr-title">${escapeHtml(c.name)}</div><div style="font-size:12px; color:var(--text-dim);">${escapeHtml(c.phone)}</div></div>
      <button type="button" class="btn btn-sm btn-danger remove-quickdial-btn" data-idx="${i}">✕</button>
    </div>`).join('') : '<span style="color:var(--text-faint); font-size:13px;">Контактів ще немає</span>';
  renderQuickDialButtons();
}
function renderQuickDialButtons(){
  const card = document.getElementById('quickDialCard');
  const wrap = document.getElementById('quickDialButtons');
  if(!card || !wrap) return;
  const list = settings.quickDialContacts||[];
  card.classList.toggle('hidden', !list.length);
  wrap.innerHTML = list.map(c=>
    `<a href="tel:${escapeHtml(c.phone.replace(/[^\d+]/g,''))}" class="btn" style="flex:1 1 45%; text-decoration:none; text-align:center;">📞 ${escapeHtml(c.name)}</a>`
  ).join('');
}
function renderCityMgmtList(){
  document.getElementById('cityMgmtList').innerHTML = (settings.cities||[]).map(city=>
    `<span class="chip">${escapeHtml(city)} <span class="chip-x remove-city-btn" data-city="${escapeHtml(city)}">✕</span></span>`
  ).join('') || '<span style="color:var(--text-faint); font-size:13px;">Міст ще немає</span>';
  renderCityDatalist();
  renderStreetMgmtCitySelect(); // NEW: список міст для керування вулицями завжди в курсі актуальних міст
  renderStreetMgmtList();
}
/* Підказки міст у полі "Місто" калькулятора (через <datalist> — рідна підтримка
   браузера: і підказки за першими буквами, і вільний ввід одночасно) */
function renderCityDatalist(){
  const dl = document.getElementById('cityDatalist');
  if(!dl) return;
  dl.innerHTML = (settings.cities||[]).map(c=>`<option value="${escapeHtml(c)}"></option>`).join('');
}
// NEW: підказки вулиць у полі "Вулиця" — окремий список для кожного міста
// (щоб «Шевченка» в Дніпрі не підмішувалась до «Шевченка» в Кам'янському),
// оновлюється щоразу при зміні поля "Місто"
function renderStreetDatalist(city){
  const dl = document.getElementById('streetDatalist');
  if(!dl) return;
  const list = (settings.streets && settings.streets[city]) || [];
  dl.innerHTML = list.map(s=>`<option value="${escapeHtml(s)}"></option>`).join('');
}
/* NEW: керування вулицями в Налаштуваннях — окремий список для кожного міста,
   можна дописати вручну або видалити помилково внесене */
let streetMgmtSelectedCity = '';
function renderStreetMgmtCitySelect(){
  const sel = document.getElementById('streetMgmtCitySelect');
  if(!sel) return;
  const cities = (settings.cities||[]).slice().sort((a,b)=>a.localeCompare(b,'uk'));
  if(!cities.includes(streetMgmtSelectedCity)) streetMgmtSelectedCity = cities[0] || '';
  sel.innerHTML = cities.length
    ? cities.map(c=>`<option value="${escapeHtml(c)}" ${c===streetMgmtSelectedCity?'selected':''}>${escapeHtml(c)}</option>`).join('')
    : `<option value="">— спершу додайте місто —</option>`;
}
function renderStreetMgmtList(){
  const wrap = document.getElementById('streetMgmtList');
  if(!wrap) return;
  const city = streetMgmtSelectedCity;
  const streets = (city && settings.streets && settings.streets[city]) || [];
  wrap.innerHTML = streets.length
    ? streets.map(s=>`<span class="chip">${escapeHtml(s)} <span class="chip-x remove-street-btn" data-street="${escapeHtml(s)}">✕</span></span>`).join('')
    : `<span style="color:var(--text-faint); font-size:13px;">${city ? 'Вулиць ще немає' : 'Спершу додайте місто вище'}</span>`;
}
// NEW: одноразово підтягує місто/вулицю з уже наявних заявок (з будь-яких, де ці поля
// фактично заповнені — включно з заявками з таблиць, якщо для них дозаповнили адресу вручну)

function renderCwMgmtList(){
  document.getElementById('cwMgmtList').innerHTML = settings.coworkers.map(cw=>
    `<span class="chip">${escapeHtml(cw)} <span class="chip-x remove-cw-btn" data-cw="${escapeHtml(cw)}">✕</span></span>`
  ).join('') || '<span style="color:var(--text-faint); font-size:13px;">Список порожній</span>';
}
function renderMasterMgmtList(){
  const wrap = document.getElementById('masterMgmtList');
  if(!settings.masters || settings.masters.length===0){
    wrap.innerHTML = '<span style="color:var(--text-faint); font-size:13px;">Майстрів немає</span>'; return;
  }
  wrap.innerHTML = settings.masters.map((m,i)=>`
    <div class="row" style="gap:8px; align-items:center;">
      <input type="text" class="master-name-inp" data-idx="${i}" value="${escapeHtml(m.name)}" placeholder="Ім'я" style="flex:2;">
      <input type="text" class="master-letter-inp" data-idx="${i}" value="${escapeHtml(m.letter)}" placeholder="Літера" maxlength="3" style="flex:1; text-transform:uppercase;">
      <button type="button" class="btn btn-icon btn-sm remove-master-btn" data-idx="${i}">✕</button>
    </div>`).join('');
}
function renderMatMgmtList(){
  const wrap = document.getElementById('matMgmtList');
  if(!settings.materials || settings.materials.length===0){
    wrap.innerHTML = '<span style="color:var(--text-faint); font-size:13px;">Матеріалів немає</span>'; return;
  }
  wrap.innerHTML = settings.materials.map((m,i)=>`
    <div class="row" style="gap:8px; align-items:center;">
      <input type="text" class="mat-label-inp" data-idx="${i}" value="${escapeHtml(m.label)}" style="flex:2;">
      <input type="number" class="mat-price-inp" data-idx="${i}" value="${m.price}" min="0" style="flex:1;">
      <button type="button" class="btn btn-icon btn-sm remove-mat-btn" data-idx="${i}">✕</button>
    </div>`).join('');
}
function renderWorkMgmtList(){
  const wrap = document.getElementById('workMgmtList');
  if(!settings.workTypes || settings.workTypes.length===0){
    wrap.innerHTML = '<span style="color:var(--text-faint); font-size:13px;">Робіт немає</span>'; return;
  }
  wrap.innerHTML = settings.workTypes.map((w,i)=>`
    <div class="row" style="gap:8px; align-items:center;">
      <input type="text" class="work-label-inp" data-idx="${i}" value="${escapeHtml(w.label)}" style="flex:2;">
      <input type="number" class="work-price-inp" data-idx="${i}" value="${w.price}" min="0" style="flex:1;">
      <button type="button" class="btn btn-icon btn-sm remove-work-btn" data-idx="${i}">✕</button>
    </div>`).join('');
}
// NEW: керування списком типів кабелів (аналогічно матеріалам/роботам)
function renderCableMgmtList(){
  const wrap = document.getElementById('cableMgmtList');
  if(!settings.cableTypes || settings.cableTypes.length===0){
    wrap.innerHTML = '<span style="color:var(--text-faint); font-size:13px;">Типів кабелю немає</span>'; return;
  }
  wrap.innerHTML = settings.cableTypes.map((c,i)=>`
    <div class="row" style="gap:8px; align-items:center;">
      <input type="text" class="cable-label-inp" data-idx="${i}" value="${escapeHtml(c.label)}" style="flex:2;">
      <input type="number" class="cable-price-inp" data-idx="${i}" value="${c.pricePerMeter}" min="0" style="flex:1;">
      <button type="button" class="btn btn-icon btn-sm remove-cable-btn" data-idx="${i}">✕</button>
    </div>`).join('');
}

function applyTheme(){
  document.documentElement.setAttribute('data-theme', settings.theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', settings.theme==='dark' ? '#14181C' : '#EEF1F3');
}


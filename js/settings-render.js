/* ---- Візуальний рендеринг екрана налаштувань ----
   Читає лише settings і оновлює DOM. */
function renderSettingsScreen(){
  ensureSettingsHub();
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

/* ---- Навігаційний центр налаштувань ----
   Перегруповує наявні <details> у тематичні блоки, не змінюючи їхні id,
   обробники чи логіку збереження. Усі реальні поля лишаються тими самими. */
let settingsHubInitialized = false;
let settingsHubCurrentKey = '';

const SETTINGS_HUB_SECTIONS = [
  {key:'address', icon:'📍', title:'Адреси', sub:'Міста та вулиці', match:['Міста','Вулиці']},
  {key:'calculator', icon:'🧮', title:'Калькулятор і ціни', sub:'Теги, матеріали, роботи, кабелі та тарифи', match:['Теги','Матеріали','Роботи з переліку','Типи кабелів','Ціни за замовчуванням']},
  {key:'people', icon:'👷', title:'Люди і контакти', sub:'Майстри, напарники, швидкий набір, візитка й договір', match:['Напарники','Майстри','Візитка та договір','Швидкий набір']},
  {key:'sync', icon:'☁️', title:'Синхронізація', sub:'Google для заявок і змін', match:['Синхронізація — Заявки','Синхронізація — Зміни']},
  {key:'telegram', icon:'✈️', title:'Telegram', sub:'Диспетчери, архів і звіти', match:['Telegram-бот']},
  {key:'security', icon:'🔐', title:'Безпека', sub:'Пароль та відбиток пальця', match:['Захист входу']},
  {key:'data', icon:'💾', title:'Дані та резервні копії', sub:'Кошик, імпорт, експорт і бекапи', match:['Кошик','Дані','Щоденні бекапи']},
  {key:'app', icon:'⚙️', title:'Застосунок', sub:'Ставка, тема та загальні параметри', match:['Параметри']},
];

function settingsHubSummaryText(detailsEl){
  const summary = detailsEl.querySelector(':scope > summary');
  return summary ? summary.textContent.replace('▾','').trim() : '';
}

function settingsHubSectionFor(detailsEl){
  const text = settingsHubSummaryText(detailsEl);
  return SETTINGS_HUB_SECTIONS.find(section => section.match.some(part => text.includes(part))) || null;
}

function ensureSettingsHub(){
  if(settingsHubInitialized) return;
  const screen = document.getElementById('screen-settings');
  const version = document.getElementById('appVersionLabel');
  if(!screen || !version) return;

  const allDetails = Array.from(screen.querySelectorAll(':scope > details.card.acc-card'));
  if(!allDetails.length) return;

  const style = document.createElement('style');
  style.id = 'settingsHubStyles';
  style.textContent = `
    .settings-hub-intro{font-size:12.5px;color:var(--text-dim);margin:2px 2px 12px;}
    .settings-hub-grid{display:grid;grid-template-columns:1fr;gap:10px;}
    .settings-hub-card{width:100%;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px;background:var(--surface);color:var(--text);}
    .settings-hub-card:active{transform:scale(.985);}
    .settings-hub-icon{font-size:23px;line-height:1;width:32px;text-align:center;flex:0 0 32px;}
    .settings-hub-copy{min-width:0;flex:1;}
    .settings-hub-title{font-size:15px;font-weight:700;line-height:1.25;}
    .settings-hub-sub{font-size:12px;color:var(--text-dim);margin-top:3px;line-height:1.35;}
    .settings-hub-arrow{font-size:20px;color:var(--text-faint);}
    .settings-hub-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
    .settings-hub-head-copy{min-width:0;flex:1;}
    .settings-hub-head-title{font-size:17px;font-weight:800;line-height:1.2;}
    .settings-hub-head-sub{font-size:12px;color:var(--text-dim);margin-top:2px;}
    .settings-hub-content > .acc-card{margin-bottom:10px;}
    .settings-hub-parking{display:none!important;}
  `;
  document.head.appendChild(style);

  const home = document.createElement('div');
  home.id = 'settingsHubHome';
  home.innerHTML = `
    <div class="settings-hub-intro">Оберіть розділ — усі звичні налаштування залишилися на місці, тільки тепер вони згруповані.</div>
    <div class="settings-hub-grid"></div>
  `;

  const page = document.createElement('div');
  page.id = 'settingsHubPage';
  page.className = 'hidden';
  page.innerHTML = `
    <div class="card settings-hub-head">
      <button type="button" class="btn btn-icon btn-sm" id="settingsHubBackBtn" aria-label="Назад до налаштувань">‹</button>
      <div class="settings-hub-head-copy">
        <div class="settings-hub-head-title" id="settingsHubPageTitle"></div>
        <div class="settings-hub-head-sub" id="settingsHubPageSub"></div>
      </div>
    </div>
    <div class="settings-hub-content" id="settingsHubContent"></div>
  `;

  const parking = document.createElement('div');
  parking.id = 'settingsHubParking';
  parking.className = 'settings-hub-parking';

  screen.insertBefore(home, version.nextSibling);
  screen.insertBefore(page, home.nextSibling);
  screen.appendChild(parking);
  allDetails.forEach(details => parking.appendChild(details));

  const unmatched = allDetails.filter(details => !settingsHubSectionFor(details));
  const sections = SETTINGS_HUB_SECTIONS.slice();
  if(unmatched.length){
    sections.push({key:'other', icon:'🧩', title:'Інше', sub:'Інші параметри застосунку', match:[]});
  }

  const grid = home.querySelector('.settings-hub-grid');
  grid.innerHTML = sections.map(section => `
    <button type="button" class="card settings-hub-card" data-settings-hub="${section.key}">
      <span class="settings-hub-icon">${section.icon}</span>
      <span class="settings-hub-copy">
        <span class="settings-hub-title">${section.title}</span>
        <span class="settings-hub-sub">${section.sub}</span>
      </span>
      <span class="settings-hub-arrow">›</span>
    </button>
  `).join('');

  grid.addEventListener('click', e=>{
    const btn = e.target.closest('[data-settings-hub]');
    if(btn) openSettingsHubSection(btn.dataset.settingsHub);
  });
  page.querySelector('#settingsHubBackBtn').addEventListener('click', closeSettingsHubSection);

  settingsHubInitialized = true;
}

function openSettingsHubSection(key){
  ensureSettingsHub();
  const home = document.getElementById('settingsHubHome');
  const page = document.getElementById('settingsHubPage');
  const content = document.getElementById('settingsHubContent');
  const parking = document.getElementById('settingsHubParking');
  if(!home || !page || !content || !parking) return;

  while(content.firstChild) parking.appendChild(content.firstChild);

  const section = SETTINGS_HUB_SECTIONS.find(item=>item.key===key);
  const candidates = Array.from(parking.querySelectorAll(':scope > details.card.acc-card'));
  const selected = key==='other'
    ? candidates.filter(details=>!settingsHubSectionFor(details))
    : candidates.filter(details=>settingsHubSectionFor(details)?.key===key);

  selected.forEach(details=>{
    details.open = false;
    content.appendChild(details);
  });

  document.getElementById('settingsHubPageTitle').textContent = section ? `${section.icon} ${section.title}` : '🧩 Інше';
  document.getElementById('settingsHubPageSub').textContent = section ? section.sub : 'Інші параметри застосунку';
  home.classList.add('hidden');
  document.getElementById('appVersionLabel').classList.add('hidden');
  page.classList.remove('hidden');
  settingsHubCurrentKey = key;

  const screens = document.querySelector('main.screens');
  if(screens) screens.scrollTop = 0;
}

function closeSettingsHubSection(){
  const home = document.getElementById('settingsHubHome');
  const page = document.getElementById('settingsHubPage');
  const content = document.getElementById('settingsHubContent');
  const parking = document.getElementById('settingsHubParking');
  if(!home || !page || !content || !parking) return;

  while(content.firstChild) parking.appendChild(content.firstChild);
  page.classList.add('hidden');
  home.classList.remove('hidden');
  document.getElementById('appVersionLabel').classList.remove('hidden');
  settingsHubCurrentKey = '';

  const screens = document.querySelector('main.screens');
  if(screens) screens.scrollTop = 0;
}

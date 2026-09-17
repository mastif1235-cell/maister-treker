/* 💰 Ціни — екран у Налаштуваннях.

   Зверху «Загальні ціни» (три поля + збереження), нижче «Населені пункти»
   зі списком і компактним статусом. Тап по пункту відкриває його екран із
   трьома рядками (Виклик / Тариф / Підключення), де видно ефективну ціну,
   статус «Загальна»/«Індивідуальна» і кнопку повернення до загальної.

   Верстка розрахована на телефон: поля й кнопки на всю ширину, великі зони
   натискання, без горизонтального скролу. */
(function(){
'use strict';
if(typeof document === 'undefined') return;

const doc = document;
const store = window.MTPricingStorage;
const service = window.MTPricingService;
if(!store || !service) return;

let openCityKey = '';

function $(id){ return doc.getElementById(id); }
function esc(value){ return typeof escapeHtml === 'function' ? escapeHtml(String(value)) : String(value); }
function currentSettings(){ return typeof settings !== 'undefined' ? settings : {}; }
function currentTickets(){ return typeof tickets !== 'undefined' && Array.isArray(tickets) ? tickets : []; }
function persist(){ if(typeof saveSettings === 'function') saveSettings(); }
function toast(message){ if(typeof showToast === 'function') showToast(message); }

function injectStyles(){
  if($('pricingStyles')) return;
  const style = doc.createElement('style');
  style.id = 'pricingStyles';
  style.textContent = `
    .pricing-hint{font-size:12.5px;color:var(--text-dim);line-height:1.45;margin-bottom:12px;}
    .pricing-field{margin-bottom:12px;}
    .pricing-field label{display:block;font-size:13px;font-weight:600;margin-bottom:5px;}
    .pricing-field input{width:100%;box-sizing:border-box;min-height:46px;font-size:16px;padding:9px 12px;}
    .pricing-city{width:100%;box-sizing:border-box;text-align:left;display:flex;align-items:center;gap:10px;
      padding:13px 14px;margin-bottom:8px;background:var(--surface);color:var(--text);cursor:pointer;}
    .pricing-city-copy{flex:1;min-width:0;display:block;}
    .pricing-city-name{display:block;font-size:15px;font-weight:700;line-height:1.25;overflow-wrap:anywhere;}
    .pricing-city-status{display:block;font-size:12px;color:var(--text-dim);margin-top:3px;line-height:1.35;overflow-wrap:anywhere;}
    .pricing-city-arrow{font-size:20px;color:var(--text-faint);flex:0 0 auto;}
    .pricing-row{padding:12px 0;border-bottom:1px solid var(--border);}
    .pricing-row:last-child{border-bottom:0;}
    .pricing-row-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;}
    .pricing-row-name{font-size:15px;font-weight:700;}
    .pricing-row-value{font-size:15px;font-weight:700;white-space:nowrap;}
    .pricing-badge{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 9px;border-radius:999px;margin-top:5px;}
    .pricing-badge-general{background:rgba(127,127,127,.18);color:var(--text-dim);}
    .pricing-badge-individual{background:rgba(255,168,46,.18);color:#ffa82e;}
    .pricing-row-controls{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap;}
    .pricing-row-controls input{flex:1 1 120px;min-width:0;box-sizing:border-box;min-height:44px;font-size:16px;padding:8px 11px;}
    .pricing-row-controls .btn{min-height:44px;flex:0 0 auto;}
    .pricing-reset{width:100%;margin-top:8px;min-height:44px;}
    .pricing-empty{font-size:13px;color:var(--text-faint);padding:6px 0;}
  `;
  doc.head.appendChild(style);
}

function build(){
  const screen = $('screen-settings');
  if(!screen || $('pricingCard')) return;
  injectStyles();

  const details = doc.createElement('details');
  details.className = 'card acc-card';
  details.id = 'pricingCard';
  details.innerHTML = `
    <summary>💰 Ціни <span class="acc-chevron">▾</span></summary>
    <div style="margin-top:10px;" id="pricingBody"></div>
  `;

  // Розділ живе поруч із рештою налаштувань; хаб сам віднесе його у свою
  // групу «Калькулятор і ціни» при наступному рендері екрана.
  const anchor = Array.from(screen.querySelectorAll(':scope > details.card.acc-card'))
    .find(node=>(node.querySelector(':scope > summary')?.textContent || '').includes('Ціни за замовчуванням'));
  if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(details, anchor.nextSibling);
  else screen.appendChild(details);

  details.addEventListener('click', onClick);
  details.addEventListener('keydown', event=>{
    if(event.key !== 'Enter') return;
    const input = event.target.closest('input[data-pricing-input]');
    if(!input) return;
    event.preventDefault();
    if(input.dataset.pricingInput === 'general') saveGeneral();
    else applyOverride(input.dataset.city, input.dataset.kind);
  });
  render();
}

function render(){
  const body = $('pricingBody');
  if(!body) return;
  body.innerHTML = openCityKey ? cityView(openCityKey) : listView();
}

function listView(){
  const settingsRef = currentSettings();
  const general = store.generalPrices(settingsRef);
  const cities = service.collectCities(settingsRef, currentTickets());

  const rows = cities.length
    ? cities.map(city=>`
        <button type="button" class="card pricing-city" data-pricing-open="${esc(city.key)}">
          <span class="pricing-city-copy">
            <span class="pricing-city-name">${esc(city.displayName)}</span>
            <span class="pricing-city-status">${esc(service.citySummary(settingsRef, city.key))}</span>
          </span>
          <span class="pricing-city-arrow">›</span>
        </button>`).join('')
    : '<div class="pricing-empty">Населених пунктів ще немає — вони з\'являться самі, щойно буде заявка з містом.</div>';

  return `
    <div class="pricing-hint">Загальні ціни діють скрізь. Якщо в окремому населеному пункті ціна інша — задайте її в цьому пункті, і лише він відрізнятиметься.</div>
    <div class="pricing-field">
      <label for="pricingGeneralCallout">Виклик, грн</label>
      <input type="number" inputmode="numeric" min="0" id="pricingGeneralCallout" data-pricing-input="general" value="${general.callout}">
    </div>
    <div class="pricing-field">
      <label for="pricingGeneralTariff">Тариф, грн</label>
      <input type="number" inputmode="numeric" min="0" id="pricingGeneralTariff" data-pricing-input="general" value="${general.tariff}">
    </div>
    <div class="pricing-field">
      <label for="pricingGeneralConnection">Підключення, грн</label>
      <input type="number" inputmode="numeric" min="0" id="pricingGeneralConnection" data-pricing-input="general" value="${general.connection}">
    </div>
    <button type="button" class="btn btn-accent btn-block" data-pricing-action="save-general" style="min-height:46px;">Зберегти загальні ціни</button>
    <div style="margin-top:18px; font-size:15px; font-weight:700;">Населені пункти</div>
    <div class="pricing-hint" style="margin-top:4px;">Список збирається із ваших заявок автоматично.</div>
    ${rows}
  `;
}

function cityView(cityKey){
  const settingsRef = currentSettings();
  const city = service.collectCities(settingsRef, currentTickets()).find(item=>item.key === cityKey)
    || {key: cityKey, displayName: cityKey, configured: false};

  const rows = service.priceInfoList(settingsRef, cityKey).map(info=>`
    <div class="pricing-row">
      <div class="pricing-row-head">
        <span class="pricing-row-name">${esc(info.label)}</span>
        <span class="pricing-row-value">${info.value} грн</span>
      </div>
      <div>
        <span class="pricing-badge ${info.individual ? 'pricing-badge-individual' : 'pricing-badge-general'}">${esc(info.status)}</span>
        ${info.individual ? `<span style="font-size:12px;color:var(--text-dim);"> · загальна ${info.general} грн</span>` : ''}
      </div>
      <div class="pricing-row-controls">
        <input type="number" inputmode="numeric" min="0" placeholder="${info.value}"
          data-pricing-input="override" data-kind="${esc(info.kind)}" data-city="${esc(cityKey)}">
        <button type="button" class="btn btn-accent" data-pricing-action="set-override" data-kind="${esc(info.kind)}" data-city="${esc(cityKey)}">Зберегти</button>
      </div>
      ${info.individual
        ? `<button type="button" class="btn pricing-reset" data-pricing-action="clear-override" data-kind="${esc(info.kind)}" data-city="${esc(cityKey)}">↩ Повернути загальну ціну</button>`
        : ''}
    </div>
  `).join('');

  return `
    <button type="button" class="btn btn-sm" data-pricing-action="back" style="min-height:40px;">‹ Усі населені пункти</button>
    <div style="margin-top:12px; font-size:17px; font-weight:800; overflow-wrap:anywhere;">${esc(city.displayName)}</div>
    <div class="pricing-hint" style="margin-top:4px;">Порожнє поле означає, що діє загальна ціна. Збережені раніше заявки не змінюються.</div>
    ${rows}
    ${city.configured
      ? `<button type="button" class="btn pricing-reset" data-pricing-action="remove-city" data-city="${esc(cityKey)}" style="margin-top:14px;">🗑 Прибрати пункт із налаштувань цін</button>
         <div class="pricing-hint" style="margin-top:6px;">Старі заявки залишаться недоторканими. Якщо буде нова заявка з цим містом, воно знову з'явиться у списку.</div>`
      : ''}
  `;
}

function saveGeneral(){
  const settingsRef = currentSettings();
  const pairs = [['callout', 'pricingGeneralCallout'], ['tariff', 'pricingGeneralTariff'], ['connection', 'pricingGeneralConnection']];
  const invalid = pairs.some(([, id])=>store.normalizeAmount($(id)?.value) === null);
  if(invalid){ toast('Вкажіть суму числом (0 або більше)'); return; }
  pairs.forEach(([kind, id])=>store.setGeneralPrice(settingsRef, kind, $(id).value));
  persist();
  refreshLegacyInputs();
  render();
  toast('Загальні ціни збережено');
}

function applyOverride(cityKey, kind){
  const settingsRef = currentSettings();
  const input = doc.querySelector(`input[data-pricing-input="override"][data-city="${cssEscape(cityKey)}"][data-kind="${cssEscape(kind)}"]`);
  const raw = input ? input.value : '';
  if(store.normalizeAmount(raw) === null){ toast('Вкажіть суму числом (0 або більше)'); return; }
  const city = service.collectCities(settingsRef, currentTickets()).find(item=>item.key === cityKey);
  store.setOverride(settingsRef, city ? city.displayName : cityKey, kind, raw);
  persist();
  render();
  toast(`${store.LABELS[kind]}: індивідуальну ціну збережено`);
}

function clearOverride(cityKey, kind){
  const settingsRef = currentSettings();
  if(store.clearOverride(settingsRef, cityKey, kind)){
    persist();
    render();
    toast(`${store.LABELS[kind]}: повернуто загальну ціну`);
  }
}

function removeCity(cityKey){
  const settingsRef = currentSettings();
  if(store.removeCity(settingsRef, cityKey)){
    persist();
    openCityKey = '';
    render();
    toast('Пункт прибрано з налаштувань цін — заявки не змінено');
  }
}

/* CSS.escape є не в кожному WebView — простий запасний варіант. */
function cssEscape(value){
  const text = String(value);
  if(typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
  return text.replace(/["\\]/g, '\\$&');
}

/* Старі поля «Ціни за замовчуванням» і новий розділ — це одні й ті самі
   значення, тому після збереження оновлюємо і їх. */
function refreshLegacyInputs(){
  const settingsRef = currentSettings();
  const map = [['defaultRepairCallFeeInput', 'callout'], ['defaultTariffInput', 'tariff'], ['defaultConnectFeeInput', 'connection']];
  map.forEach(([id, kind])=>{ const el = $(id); if(el) el.value = store.generalPrice(settingsRef, kind); });
}

function onClick(event){
  const openBtn = event.target.closest('[data-pricing-open]');
  if(openBtn){ openCityKey = openBtn.dataset.pricingOpen; render(); return; }
  const actionBtn = event.target.closest('[data-pricing-action]');
  if(!actionBtn) return;
  const action = actionBtn.dataset.pricingAction;
  if(action === 'back'){ openCityKey = ''; render(); return; }
  if(action === 'save-general'){ saveGeneral(); return; }
  if(action === 'set-override'){ applyOverride(actionBtn.dataset.city, actionBtn.dataset.kind); return; }
  if(action === 'clear-override'){ clearOverride(actionBtn.dataset.city, actionBtn.dataset.kind); return; }
  if(action === 'remove-city'){ removeCity(actionBtn.dataset.city); }
}

window.MTPricingUI = Object.freeze({
  build,
  render,
  reset(){ openCityKey = ''; }
});

if(doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', build);
else build();
})();

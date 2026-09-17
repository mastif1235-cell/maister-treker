/* AI: розділ «Налаштування → 🤖 AI-асистент». Provider/model — селекти з
   реєстру (новий провайдер/модель з'являються тут автоматично). Токен
   після збереження НІКОЛИ не показується (тільки стан «збережено»).
   Ключі провайдерів (Groq/DeepSeek) у PWA відсутні як поняття. */
(function(){
'use strict';
if(typeof document === 'undefined') return;
const MTAI = window.MTAI;
const doc = document;

function $(id){ return doc.getElementById(id); }

function build(){
  const screen = $('screen-settings');
  if(!screen || $('aiSettingsCard')) return;
  const cfg = MTAI.provider.ensure(MTAI.storage);
  const details = doc.createElement('details');
  details.className = 'card acc-card';
  details.id = 'aiSettingsCard';

  const providerOptions = MTAI.providers.enabledList().map(function(p){
    return '<option value="' + p.id + '"' + (p.id === cfg.provider ? ' selected' : '') + '>' + p.name + '</option>';
  }).join('');

  details.innerHTML = `
    <summary>🤖 AI-асистент</summary>
    <div class="settings-row" style="align-items:center; justify-content:space-between;">
      <div style="min-width:0;">
        <strong>AI увімкнено</strong>
        <div style="font-size:12px;color:var(--text-dim);">Кнопка 🤖 у «Інструментах»; режим лише для читання</div>
      </div>
      <input type="checkbox" id="aiEnabledToggle">
    </div>
    <div class="settings-row">
      <label for="aiProviderSelect"><strong>Провайдер</strong> (ключі провайдерів — тільки на Worker'і)</label>
      <select id="aiProviderSelect">${providerOptions}</select>
    </div>
    <div class="settings-row">
      <label for="aiModelSelect"><strong>Модель</strong></label>
      <select id="aiModelSelect"></select>
      <div style="font-size:12px;color:var(--text-dim);" id="aiModelCaps"></div>
    </div>
    <div class="settings-row">
      <label for="aiBackendUrlInput"><strong>AI-бекенд (Worker /ask)</strong> — лише дозволені хости</label>
      <input type="url" id="aiBackendUrlInput" list="aiBackendList" autocomplete="off" spellcheck="false">
      <datalist id="aiBackendList"></datalist>
    </div>
    <div class="settings-row">
      <label for="aiTokenInput"><strong>Токен AI-бекенда</strong> (READ-ONLY; у зашифрованому vault)</label>
      <input type="password" id="aiTokenInput" placeholder="${MTAI.storage.hasToken() ? '•••••••• (збережено)' : 'name:token:scope або сам токен'}" autocomplete="new-password" spellcheck="false">
      <div style="font-size:12px;color:var(--text-dim);" id="aiTokenState">${MTAI.storage.hasToken() ? '✓ Токен збережено (не відображається).' : 'Токен не заданий.'}</div>
    </div>
    <div class="settings-row" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
      <button type="button" class="btn btn-sm" id="aiTestBtn">Перевірити з'єднання</button>
      <span id="aiConnStatus" style="font-size:12.5px;color:var(--text-dim);"></span>
    </div>
    <div class="settings-row" style="font-size:12px;color:var(--text-dim);" id="aiInfoLine"></div>
    <div class="settings-row" style="font-size:12px;color:var(--text-dim);">
      🔒 Режим: <strong>READ-ONLY</strong>. AI не може створювати/змінювати/видаляти заявки чи зміни.
      Безкоштовний Groq: ліміт ~8000 токенів/хв — при «Rate limit» чекайте 20–30 с.
    </div>`;
  const parking = $('settingsHubParking');
  (parking || screen).appendChild(details);

  function refreshModels(){
    const provider = MTAI.providers.get($('aiProviderSelect').value);
    const sel = $('aiModelSelect');
    while(sel.firstChild) sel.removeChild(sel.firstChild);
    provider.models.forEach(function(m){
      const o = doc.createElement('option');
      o.value = m.id;
      o.textContent = m.label + ' (' + MTAI.provider.capsLabel(m.capabilities) + ')';
      if(m.id === cfg.model) o.selected = true;
      sel.appendChild(o);
    });
    $('aiModelCaps').textContent = 'Можливості: ' + MTAI.provider.capsLabel(MTAI.provider.capabilities(MTAI.storage));
  }
  function refreshInfo(){
    const st = MTAI.storage.get();
    $('aiInfoLine').textContent = 'Provider: ' + MTAI.providers.get(st.provider).name +
      ' · Model: ' + st.model + ' · Backend: ' + (st.backendUrl || '—') + ' · Mode: READ-ONLY';
  }

  $('aiEnabledToggle').checked = !!cfg.enabled;
  $('aiProviderSelect').value = cfg.provider;
  $('aiBackendUrlInput').value = cfg.backendUrl;
  const dl = $('aiBackendList');
  MTAI.config.ALLOWED_BACKENDS.forEach(function(url){
    const o = doc.createElement('option'); o.value = url; dl.appendChild(o);
  });
  refreshModels(); refreshInfo();

  $('aiEnabledToggle').addEventListener('change', function(e){
    MTAI.storage.update({ enabled: e.target.checked });
    showToast && showToast(e.target.checked ? 'AI-асистент увімкнено' : 'AI-асистент вимкнено');
  });
  $('aiProviderSelect').addEventListener('change', function(e){
    MTAI.storage.update({ provider: e.target.value, model: (MTAI.providers.get(e.target.value).models[0] || {}).id });
    cfg = MTAI.provider.ensure(MTAI.storage);
    refreshModels(); refreshInfo();
  });
  $('aiModelSelect').addEventListener('change', function(e){
    MTAI.storage.update({ model: e.target.value });
    refreshModels(); refreshInfo();
  });
  $('aiBackendUrlInput').addEventListener('change', function(e){
    const url = e.target.value.trim().replace(/\/+$/, '');
    if(url && !MTAI.storage.isAllowedBackend(url)){
      showToast && showToast('Цей хост не в allowlist (CSP) — оберіть дозволений');
      e.target.value = MTAI.storage.get().backendUrl;
      return;
    }
    MTAI.storage.update({ backendUrl: url || MTAI.config.DEFAULT_BACKEND });
    e.target.value = MTAI.storage.get().backendUrl;
    refreshInfo();
  });
  $('aiTokenInput').addEventListener('change', function(e){
    const value = e.target.value.trim();
    if(!value){ e.target.value = ''; return; } // пусте поле = залишити як є
    MTAI.storage.setToken(value);
    e.target.value = '';
    e.target.placeholder = '•••••••• (збережено)';
    $('aiTokenState').textContent = '✓ Токен збережено (у зашифрованому vault, не відображається).';
    showToast && showToast('Токен AI збережено');
  });
  $('aiTestBtn').addEventListener('click', async function(){
    const out = $('aiConnStatus');
    out.textContent = '⏳ Перевіряю…';
    const res = await MTAI.client.health();
    if(res.online){
      out.textContent = '✅ ' + (res.service || 'бекенд') + ' · read_only: ' + (res.readOnly ? 'так' : 'ні') + (MTAI.storage.hasToken() ? '' : ' · токен не заданий');
    }else{
      out.textContent = res.status ? '⚠️ Бекенд відповів ' + res.status : '📴 Бекенд недоступний (мережа/адреса)';
    }
  });
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', build);
}else{
  build();
}
window.MTAI.settings = { build: build };
})();

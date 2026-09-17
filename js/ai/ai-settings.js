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
  let cfg = MTAI.provider.ensure(MTAI.storage); // let: оновлюється після change provider
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
    <div class="settings-row" style="align-items:center; justify-content:space-between;">
      <div style="min-width:0;">
        <strong>Показувати AI в «Інструментах»</strong>
        <div style="font-size:12px;color:var(--text-dim);">Кнопка 🤖 AI Асистент у сітці інструментів</div>
      </div>
      <input type="checkbox" id="aiShowInToolsToggle">
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
    <div class="settings-row" style="border-top:1px solid rgba(127,127,127,.25); padding-top:10px;">
      <label for="aiBackendModeSelect"><strong>Підключення</strong></label>
      <select id="aiBackendModeSelect">
        <option value="shared">Спільний backend (потрібен персональний токен)</option>
        <option value="custom">Свій backend (свій Worker і свої ключі провайдерів)</option>
      </select>
      <button type="button" class="btn btn-accent" id="aiOnboardBtn" style="margin-top:6px;">Підключити AI</button>
      <div id="aiOnboardStatus" style="font-size:12.5px;color:var(--text-dim);margin-top:4px;"></div>
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
  $('aiShowInToolsToggle').checked = !!cfg.showInTools;
  $('aiBackendModeSelect').value = cfg.backendMode === 'custom' ? 'custom' : (cfg.backendMode === 'shared' || cfg.backendUrl ? 'shared' : 'shared');
  function applyModeUi(){
    const mode = $('aiBackendModeSelect').value;
    const inp = $('aiBackendUrlInput');
    if(mode === 'shared'){
      inp.value = MTAI.config.SHARED_BACKEND;
      inp.readOnly = true;
    }else{
      inp.readOnly = false;
    }
  }
  applyModeUi();
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
    cfg = MTAI.provider.ensure(MTAI.storage); // settings.ai (той самий об'єкт)
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
  $('aiShowInToolsToggle').addEventListener('change', function(e){
    MTAI.storage.update({ showInTools: e.target.checked });
    showToast && showToast(e.target.checked ? 'Кнопку 🤖 показано в Інструментах' : 'Кнопку 🤖 сховано (налаштування збережено)');
  });
  $('aiBackendModeSelect').addEventListener('change', function(){
    applyModeUi();
    const mode = $('aiBackendModeSelect').value;
    MTAI.storage.update({ backendMode: mode, backendUrl: mode === 'shared' ? MTAI.config.SHARED_BACKEND : $('aiBackendUrlInput').value });
    $('aiBackendUrlInput').value = MTAI.storage.get().backendUrl;
  });
  /* Онбординг: токен -> health -> /ai/config (providers/models) -> save.
     Бронебойний: будь-яка помилка — ВИДиме повідомлення (ніколи не silent);
     кнопка блокується на час підключення; токен береться з поля або з vault. */
  $('aiOnboardBtn').addEventListener('click', async function(){
    const btn = $('aiOnboardBtn');
    const status = $('aiOnboardStatus');
    const say = function(t){ status.textContent = t; };
    if(btn.disabled) return;
    btn.disabled = true;
    say('⏳ Підключення…');
    try{
      const mode = $('aiBackendModeSelect').value;
      const tokenField = $('aiTokenInput');
      const token = String(tokenField.value || '').trim();
      const backendUrl = $('aiBackendUrlInput').value.trim().replace(/\/+$/, '');
      if(!/^https:\/\/[^\s]+$/i.test(backendUrl)){ say('❌ Вкажіть https-адресу бекенда'); return; }
      if(mode === 'shared' && !MTAI.storage.isAllowedBackend(backendUrl)){ say('❌ Цей хост не є дозволеним спільним бекендом'); return; }
      if(!token && !MTAI.storage.hasToken()){ say('❌ Вставте ваш персональний access-токен'); return; }
      say('⏳ Крок 1/4: зберігаю токен…');
      MTAI.storage.update({ backendMode: mode, backendUrl: backendUrl });
      if(token){
        MTAI.storage.setToken(token);
        tokenField.value = '';
        tokenField.placeholder = '•••••••• (збережено)';
        $('aiTokenState').textContent = '✓ Токен збережено (у зашифрованому vault, не відображається).';
      }
      say('⏳ Крок 2/4: перевіряю бекенд…');
      const health = await MTAI.client.health();
      if(health.status === 404){ say('❌ Endpoint не знайдено (404). Перевірте адресу бекенда.'); return; }
      if(health.status === 401 || health.status === 403){ say('❌ Невірний токен або доступ заборонено (' + health.status + ').'); return; }
      if(!health.online){
        say(health.status ? ('❌ Бекенд відповів ' + health.status + '.') : '❌ Мережа/CORS: бекенд недоступний з браузера. Перевірте адресу та HTTPS.');
        return;
      }
      say('⏳ Крок 3/4: читаю providers/models (/ai/config)…');
      const cfgRes = await MTAI.client.config();
      if(cfgRes.status === 401){ say('❌ Невірний токен (401 від /ai/config)'); return; }
      if(cfgRes.status === 404){ say('❌ Endpoint /ai/config не знайдено (404) — оновіть Worker'); return; }
      if(cfgRes.ok && cfgRes.config && Array.isArray(cfgRes.config.providers)){
        cfgRes.config.providers.forEach(function(p){
          if(!MTAI.providers.get(p.id)){
            MTAI.providers.register({
              id: p.id, name: p.name || p.id, enabled: p.enabled !== false,
              capabilities: { text:true, tools:true },
              models: (p.models || []).map(function(m){
                const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
                return { id:m.id, label:m.id, capabilities:{
                  text: caps.indexOf('text') !== -1 || caps.length === 0,
                  vision: caps.indexOf('vision') !== -1,
                  tools: caps.indexOf('tools') !== -1,
                  reasoning: caps.indexOf('reasoning') !== -1,
                  audioInput: caps.indexOf('audio_input') !== -1
                } };
              })
            });
          }
        });
        // Перебудова селекта провайдерів БЕЗ синтетичних подій:
        // зберігаємо вибір у storage, потім оновлюємо моделі/статус.
        const firstEnabled = (cfgRes.config.providers.find(function(p){ return p.enabled !== false; }) || cfgRes.config.providers[0] || {});
        MTAI.storage.update({ provider: firstEnabled.id || MTAI.config.DEFAULT_PROVIDER, model: ((MTAI.providers.get(firstEnabled.id) || {models:[{}]}).models[0] || {}).id || MTAI.config.DEFAULT_MODEL });
        cfg = MTAI.provider.ensure(MTAI.storage);
        const sel = $('aiProviderSelect');
        while(sel.firstChild) sel.removeChild(sel.firstChild);
        MTAI.providers.enabledList().forEach(function(pp){
          const o = doc.createElement('option');
          o.value = pp.id; o.textContent = pp.name;
          if(pp.id === cfg.provider) o.selected = true;
          sel.appendChild(o);
        });
        sel.value = cfg.provider;
        if(cfgRes.config.mode && cfgRes.config.mode !== 'read-only'){
          say('ℹ️ Бекенд повідомив режим: ' + cfgRes.config.mode);
        }
      }else{
        say('ℹ️ Бекенд не віддав /ai/config — використовую локальний реєстр (Groq)');
      }
      say('⏳ Крок 4/4: зберігаю…');
      MTAI.storage.update({ enabled: true, showInTools: true });
      $('aiEnabledToggle').checked = true;
      $('aiShowInToolsToggle').checked = true;
      refreshModels(); refreshInfo();
      say('✅ Підключено! Кнопка 🤖 з\u2019явилася в «Інструментах».');
      showToast && showToast('AI підключено');
    }catch(err){
      say('❌ Помилка підключення: ' + String((err && err.message) || err).slice(0, 200));
    }finally{
      btn.disabled = false;
    }
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

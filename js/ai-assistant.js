/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — 🤖 AI-асистент (етап D UI, гілка feat/ai-groq-orchestrator)
   READ-ONLY: кнопка/чат надсилають питання на /ask нашого MCP-Worker'а;
   Worker сам тримає Groq-ключ (Secret) і викликає лише 7 READ-інструментів.
   У застосунку НЕ зберігається і не вводиться жоден AI/Groq API key —
   тільки bearer-токен нашого бекенда (у зашифрованому vault, як tgBotToken).
   ===================================================================== */
(function(){
'use strict';

const AI_DEFAULT_MODEL = 'openai/gpt-oss-120b';
const AI_DEFAULT_BACKEND = 'https://maister-tracker-mcp.mastif1235.workers.dev';
const AI_ALLOWED_BACKENDS = [
  'https://maister-tracker-mcp.mastif1235.workers.dev',
  'https://maister-tracker-mcp-dev.mastif1235.workers.dev'
];
const AI_TIMEOUT_MS = 90000;
const AI_MAX_QUESTION = 2000;

function aiEnsure(){
  if(!settings.ai || typeof settings.ai !== 'object'){
    settings.ai = { enabled:false, provider:'Groq', model:AI_DEFAULT_MODEL, backendUrl:AI_DEFAULT_BACKEND };
  }
  const ai = settings.ai;
  if(typeof ai.enabled !== 'boolean') ai.enabled = false;
  if(ai.provider !== 'Groq') ai.provider = 'Groq'; // інші провайдери в цій стадії не підтримуються
  if(typeof ai.model !== 'string' || !ai.model.trim()) ai.model = AI_DEFAULT_MODEL;
  if(typeof ai.backendUrl !== 'string') ai.backendUrl = AI_DEFAULT_BACKEND;
  ai.backendUrl = ai.backendUrl.trim().replace(/\/+$/, '');
  if(typeof settings.aiBearerToken !== 'string') settings.aiBearerToken = '';
  return ai;
}
function aiBackendAllowed(url){
  return AI_ALLOWED_BACKENDS.indexOf(url) !== -1;
}
function aiReady(){
  const ai = aiEnsure();
  return !!(ai.enabled && ai.backendUrl && settings.aiBearerToken);
}

/* ── DOM ── */
function aiBuildSettingsCard(){
  const screen = document.getElementById('screen-settings');
  if(!screen || document.getElementById('aiSettingsCard')) return;
  const ai = aiEnsure();
  const details = document.createElement('details');
  details.className = 'card acc-card';
  details.id = 'aiSettingsCard';
  details.innerHTML = `
    <summary>🤖 AI-асистент</summary>
    <div class="settings-row" style="align-items:center; justify-content:space-between;">
      <div style="min-width:0;">
        <strong>AI-асистент увімкнено</strong>
        <div style="font-size:12px;color:var(--text-dim);">Кнопка 🤖 з питаннями по заявках (тільки читання)</div>
      </div>
      <input type="checkbox" id="aiEnabledToggle" ${ai.enabled ? 'checked' : ''}>
    </div>
    <div class="settings-row">
      <label for="aiModelInput"><strong>Модель</strong> (провайдер: Groq, openai-сумісний)</label>
      <input type="text" id="aiModelInput" value="${escapeHtml(ai.model)}" autocomplete="off" spellcheck="false">
    </div>
    <div class="settings-row">
      <label for="aiBackendUrlInput"><strong>AI-бекенд (Worker /ask)</strong></label>
      <input type="url" id="aiBackendUrlInput" value="${escapeHtml(ai.backendUrl)}" autocomplete="off" spellcheck="false"
        placeholder="${AI_DEFAULT_BACKEND}" list="aiBackendList">
      <datalist id="aiBackendList">
        <option value="${AI_ALLOWED_BACKENDS[0]}"></option>
        <option value="${AI_ALLOWED_BACKENDS[1]}"></option>
      </datalist>
    </div>
    <div class="settings-row">
      <label for="aiTokenInput"><strong>Токен AI-бекенда</strong> (READ-ONLY)</label>
      <input type="password" id="aiTokenInput" value="${escapeHtml(settings.aiBearerToken || '')}" autocomplete="new-password" spellcheck="false" placeholder="name:token:scope або сам токен">
      <div style="font-size:12px;color:var(--text-dim);">Зберігається у зашифрованому сховищі пристрою. Groq API key у застосунку не зберігається і не вводиться — він є Secret'ом на Worker'і.</div>
    </div>
    <div class="settings-row">
      <button type="button" class="btn btn-sm" id="aiTestBtn">Перевірити з'єднання</button>
      <span id="aiConnStatus" style="font-size:12.5px;color:var(--text-dim);"></span>
    </div>
    <div style="font-size:12px;color:var(--text-dim);">
      🔒 Режим: <strong>READ-ONLY</strong> — асистент лише читає заявки/зміни/звіти.
      Створення й зміна заявок AI недоступні. Безкоштовний Groq має ліміт ~8000 токенів/хв: при
      «Rate limit reached» повторіть через 20–30 секунд.
    </div>
  `;
  /* Карта потрапляє у «паркінг» налаштувань: hub або вже існує (тоді вона
     підхопиться розділом «🤖 AI-асистент»), або буде створена пізніше з
     нашої карти як зі звичайного details.card.acc-card. */
  const parking = document.getElementById('settingsHubParking');
  (parking || screen).appendChild(details);

  details.querySelector('#aiEnabledToggle').addEventListener('change', (e)=>{
    aiEnsure().enabled = e.target.checked;
    saveSettings();
    aiUpdateVisibility();
    showToast(e.target.checked ? 'AI-асистент увімкнено' : 'AI-асистент вимкнено');
  });
  details.querySelector('#aiModelInput').addEventListener('change', (e)=>{
    aiEnsure().model = e.target.value.trim() || AI_DEFAULT_MODEL;
    e.target.value = settings.ai.model;
    saveSettings();
  });
  details.querySelector('#aiBackendUrlInput').addEventListener('change', (e)=>{
    const url = e.target.value.trim().replace(/\/+$/, '');
    if(url && !aiBackendAllowed(url)){
      showToast('Цей хост не додано до CSP — оберіть дозволений бекенд');
      e.target.value = settings.ai.backendUrl;
      return;
    }
    aiEnsure().backendUrl = url || AI_DEFAULT_BACKEND;
    e.target.value = settings.ai.backendUrl;
    saveSettings();
  });
  details.querySelector('#aiTokenInput').addEventListener('change', (e)=>{
    settings.aiBearerToken = e.target.value.trim();
    saveSettings();
    showToast('Токен AI збережено');
  });
  details.querySelector('#aiTestBtn').addEventListener('click', async ()=>{
    const ai = aiEnsure();
    const out = document.getElementById('aiConnStatus');
    if(!ai.backendUrl){ out.textContent = '❌ Вкажіть адресу бекенда'; return; }
    out.textContent = '⏳ Перевіряю…';
    try{
      const res = await fetch(ai.backendUrl + '/healthz', { method:'GET' });
      const data = await res.json().catch(()=>null);
      if(res.ok && data && data.ok){
        out.textContent = `✅ ${data.service || 'бекенд'} · read_only:${!!data.read_only}` + (settings.aiBearerToken ? '' : ' · токен не заданий');
      }else{
        out.textContent = '⚠️ Бекенд відповів ' + res.status;
      }
    }catch(_e){
      out.textContent = '📴 Немає з\u0454днання з бекендом';
    }
  });
}

/* ── Чат ── */
function aiBuildChat(){
  if(document.getElementById('aiFab')) return;
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'aiFab';
  fab.className = 'hidden';
  fab.setAttribute('aria-label', 'AI-асистент');
  fab.textContent = '🤖';
  document.body.appendChild(fab);

  const sheet = document.createElement('div');
  sheet.id = 'aiSheet';
  sheet.className = 'hidden';
  sheet.innerHTML = `
    <div class="ai-sheet-card">
      <div class="ai-sheet-head">
        <span class="ai-sheet-title">🤖 AI-асистент <span class="ai-readonly-badge">READ-ONLY</span></span>
        <span style="flex:1"></span>
        <button type="button" class="btn btn-icon btn-sm" id="aiClearBtn" aria-label="Очистити">🗑</button>
        <button type="button" class="btn btn-icon btn-sm" id="aiCloseBtn" aria-label="Закрити">✕</button>
      </div>
      <div id="aiMessages" class="ai-messages"></div>
      <form id="aiForm" class="ai-form">
        <input type="text" id="aiInput" maxlength="${AI_MAX_QUESTION}" placeholder="Питання по заявках…" autocomplete="off">
        <button type="submit" class="btn btn-accent btn-sm" id="aiSendBtn">Надіслати</button>
      </form>
      <div class="ai-footnote">Дані беруться з вашого Workers-беку через Groq (${escapeHtml(aiEnsure().model)}). Помилки пишуться без секретів.</div>
    </div>
  `;
  document.body.appendChild(sheet);

  const style = document.createElement('style');
  style.id = 'aiAssistantStyles';
  style.textContent = `
    #aiFab{position:fixed;right:14px;bottom:calc(72px + env(safe-area-inset-bottom));z-index:70;width:52px;height:52px;border-radius:50%;border:none;font-size:24px;background:var(--accent,#4c7dff);color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.35);cursor:pointer;}
    #aiFab:active{transform:scale(.94);}
    #aiSheet{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;}
    #aiSheet.hidden,#aiFab.hidden{display:none;}
    .ai-sheet-card{width:100%;max-height:82vh;background:var(--surface,#fff);color:var(--text,#111);border-radius:16px 16px 0 0;display:flex;flex-direction:column;padding:12px 12px calc(10px + env(safe-area-inset-bottom));box-sizing:border-box;}
    .ai-sheet-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
    .ai-sheet-title{font-weight:800;font-size:15px;}
    .ai-readonly-badge{font-size:10px;font-weight:800;letter-spacing:.4px;background:rgba(46,160,67,.15);color:#2ea043;border-radius:6px;padding:2px 6px;vertical-align:2px;}
    .ai-messages{flex:1;overflow-y:auto;min-height:180px;max-height:52vh;display:flex;flex-direction:column;gap:8px;padding:4px 2px;}
    .ai-msg{max-width:86%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
    .ai-msg-user{align-self:flex-end;background:var(--accent,#4c7dff);color:#fff;border-bottom-right-radius:4px;}
    .ai-msg-bot{align-self:flex-start;background:rgba(127,127,127,.14);border-bottom-left-radius:4px;}
    .ai-msg-err{align-self:stretch;background:rgba(220,38,38,.12);color:var(--text,#111);font-size:13px;}
    .ai-meta{font-size:11px;color:var(--text-dim);align-self:flex-start;margin-top:-4px;}
    .ai-form{display:flex;gap:8px;margin-top:8px;}
    .ai-form input{flex:1;min-width:0;}
    .ai-footnote{font-size:11px;color:var(--text-faint);margin-top:6px;}
  `;
  document.head.appendChild(style);

  fab.addEventListener('click', ()=>{
    sheet.classList.remove('hidden');
    setTimeout(()=>{ const inp = document.getElementById('aiInput'); if(inp) inp.focus(); }, 50);
  });
  sheet.querySelector('#aiCloseBtn').addEventListener('click', ()=> sheet.classList.add('hidden'));
  sheet.addEventListener('click', (e)=>{ if(e.target === sheet) sheet.classList.add('hidden'); });
  sheet.querySelector('#aiClearBtn').addEventListener('click', ()=>{
    document.getElementById('aiMessages').innerHTML = '';
  });
  sheet.querySelector('#aiForm').addEventListener('submit', (e)=>{
    e.preventDefault();
    const inp = document.getElementById('aiInput');
    const question = (inp.value || '').trim();
    if(question) { inp.value = ''; aiAsk(question); }
  });
}

function aiBubble(kind, text){
  const box = document.getElementById('aiMessages');
  if(!box) return null;
  const el = document.createElement('div');
  el.className = 'ai-msg' + (kind === 'user' ? ' ai-msg-user' : kind === 'err' ? ' ai-msg-err' : ' ai-msg-bot');
  el.textContent = text; // textContent — без HTML-ін'єкцій з даних інструментів
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

let aiBusy = false;
async function aiAsk(question){
  if(aiBusy){ showToast('Дочекайтеся відповіді'); return; }
  if(!aiReady()){
    aiBubble('err', 'AI не налаштований: увімкніть його і вкажіть токен у Налаштуваннях → 🤖 AI-асистент.');
    return;
  }
  const ai = aiEnsure();
  const bearer = midToken(settings.aiBearerToken);
  aiBusy = true;
  const sendBtn = document.getElementById('aiSendBtn');
  if(sendBtn) sendBtn.disabled = true;
  aiBubble('user', question);
  const load = aiBubble('bot', '⏳ Думаю…');
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), AI_TIMEOUT_MS);
  try{
    const res = await fetch(ai.backendUrl + '/ask', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + bearer },
      body: JSON.stringify({ question: question.slice(0, AI_MAX_QUESTION) }),
      signal: ctrl.signal
    });
    const data = await res.json().catch(()=>null);
    if(load && load.parentNode) load.remove();
    if(res.ok && data && data.ok){
      aiBubble('bot', String(data.answer || '').trim() || '(порожня відповідь)');
      const meta = data.meta || {};
      aiMetaLine(`rounds: ${meta.rounds ?? '?'} · tool_calls: ${meta.tool_calls ?? 0}`);
    }else if(res.status === 401){
      aiBubble('err', '🔑 Невірний токен AI-бекенда. Перевірте його в Налаштуваннях → 🤖 AI-асистент.');
    }else if(res.status === 429){
      aiBubble('err', '⏳ Ліміт Groq (TPM). ' + aiRetryHint(data) + ' Спробуйте за 20–30 секунд ще раз.');
    }else if(res.status === 503){
      aiBubble('err', '🚧 Сервер повідомив: ' + ((data && (data.error || data.code)) || 'ask_not_configured') + '. Ймовірно, на Worker\u2019і не задано ключ Groq (це server secret, у застосунку його немає).');
    }else{
      const detail = data && data.detail ? '\nДеталі: ' + String(data.detail).slice(0, 300) : '';
      aiBubble('err', '⚠️ Помилка ' + res.status + ' ' + ((data && data.code) || '') + '.' + detail);
    }
  }catch(err){
    if(load && load.parentNode) load.remove();
    aiBubble('err', (err && err.name === 'AbortError')
      ? '⏱ Бекенд не відповів вчасно (холодний запит може тривати до ~20 с). Спробуйте ще раз.'
      : '📴 Немає з\u0454днання з AI-бекендом.');
  }finally{
    clearTimeout(timer);
    aiBusy = false;
    if(sendBtn) sendBtn.disabled = false;
  }
}
function midToken(value){
  const parts = String(value || '').trim().split(':');
  return parts.length >= 3 ? parts[parts.length - 2] : String(value || '').trim();
}
function aiRetryHint(data){
  const m = /(\d{1,3})\s*(сек|sec)/i.exec(String((data && data.detail) || ''));
  return m ? ('Просить зачекати ~' + m[1] + ' с.') : '';
}
function aiMetaLine(text){
  const box = document.getElementById('aiMessages');
  if(!box) return;
  const el = document.createElement('div');
  el.className = 'ai-meta';
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
function aiUpdateVisibility(){
  const fab = document.getElementById('aiFab');
  if(fab) fab.classList.toggle('hidden', !aiReady());
}

function initAIAssistant(){
  try{
    aiEnsure();
    aiBuildSettingsCard();
    aiBuildChat();
    aiUpdateVisibility();
  }catch(_e){ /* AI-UI не повинен ламати старт застосунку */ }
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initAIAssistant);
}else{
  initAIAssistant();
}
window.MTAI = { ask: aiAsk, updateVisibility: aiUpdateVisibility };
})();

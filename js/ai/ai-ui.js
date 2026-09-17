/* AI: UI — панель чата. DOM строится программно, все данные через
   textContent (XSS-safe). Кнопка в «Инструментах» рендерится
   tools-domain.js (условная: enabled+showInTools); клик ловится
   делегированным обработчиком. */
(function(){
'use strict';
if(typeof document === 'undefined') return; // unit-тесты в node
const MTAI = window.MTAI;
const doc = document;

let built = false, chat = null, attachments = null, voice = null;
let quickExpanded = false; // 💡-панель подсказок: свёрнута после первого вопроса

function $(id){ return doc.getElementById(id); }

/* Чистая функция состояний (тестируется в node без DOM):
   disabled -> unconfigured -> chat. */
function resolveAction(state){
  const s = state || MTAI.storage.get();
  if(!s.enabled) return 'disabled';
  if(!MTAI.storage.isReady()) return 'unconfigured';
  return 'chat';
}

/* ── Блокирующий экран: явные состояния вместо silent no-op ──
   Собственные стили инжектятся ВСЕГДА (раньше стили появлялись только из
   build() чата, и панель показывалась нестилизованным div внизу страницы —
   визуально «ничего не происходило»). */
function openBlocked(kind){
  if(!$('aiBlockedStyles')){
    const style = doc.createElement('style');
    style.id = 'aiBlockedStyles';
    style.textContent = [
      '#aiBlockedPanel{position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;}',
      '.ai-blocked-card{width:100%;max-width:400px;background:var(--surface,#fff);color:var(--text,#111);border-radius:14px;padding:16px;box-sizing:border-box;box-shadow:0 10px 30px rgba(0,0,0,.35);}',
      '.ai-blocked-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;}',
      '.ai-blocked-title{font-weight:800;font-size:15px;flex:1;}',
      '.ai-blocked-text{font-size:14px;line-height:1.5;margin-bottom:12px;white-space:pre-line;}'
    ].join('\n');
    doc.head.appendChild(style);
  }
  let overlay = $('aiBlockedPanel');
  if(!overlay){
    overlay = doc.createElement('div');
    overlay.id = 'aiBlockedPanel';
    overlay.style.display = 'none';
    const card = doc.createElement('div');
    card.className = 'ai-blocked-card';
    const head = doc.createElement('div');
    head.className = 'ai-blocked-head';
    const title = doc.createElement('span');
    title.className = 'ai-blocked-title';
    title.textContent = '🤖 AI-асистент';
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-icon btn-sm';
    closeBtn.setAttribute('aria-label', 'Закрити');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', function(){ overlay.style.display = 'none'; });
    head.appendChild(title); head.appendChild(closeBtn);
    const text = doc.createElement('div');
    text.className = 'ai-blocked-text';
    text.id = 'aiBlockedText';
    const go = doc.createElement('button');
    go.type = 'button';
    go.className = 'btn btn-accent';
    go.id = 'aiBlockedGo';
    go.style.width = '100%';
    go.addEventListener('click', function(){
      overlay.style.display = 'none';
      try{
        if(typeof switchTab === 'function') switchTab('settings');
        const cardEl = $('aiSettingsCard');
        if(cardEl){ cardEl.open = true; if(typeof cardEl.scrollIntoView === 'function') cardEl.scrollIntoView({ behavior:'smooth', block:'center' }); }
        else if(typeof showToast === 'function') showToast('Налаштування → 🤖 AI-асистент');
      }catch(_e){}
    });
    card.appendChild(head); card.appendChild(text); card.appendChild(go);
    overlay.appendChild(card);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) overlay.style.display = 'none'; });
    doc.body.appendChild(overlay);
  }
  const text = $('aiBlockedText'), go = $('aiBlockedGo');
  if(kind === 'disabled'){
    text.textContent = '🔒 AI вимкнено.\nУвімкніть AI у Налаштуваннях → 🤖 AI-асистент — кнопка в «Інструментах» з\u2019явиться після підключення.';
    go.textContent = 'Увімкнути в налаштуваннях';
  }else{
    text.textContent = '⚙️ AI не налаштований.\nПотрібні адреса AI-бекенда і ваш персональний access-токен. Налаштування → 🤖 AI-асистент → «Підключити AI».';
    go.textContent = 'Перейти в налаштування AI';
  }
  overlay.style.display = 'flex';
}

function build(){
  if(built) return;
  built = true;

  const panel = doc.createElement('div');
  panel.id = 'aiChatPanel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="ai-panel-card">
      <div class="ai-panel-head">
        <span class="ai-panel-title">🤖 AI-асистент <span class="ai-badge-ro">🔒 READ-ONLY</span></span>
        <span class="ai-panel-status" id="aiStatusLine"></span>
        <span style="flex:1"></span>
        <button type="button" class="btn btn-icon btn-sm" id="aiClearBtn" aria-label="Очистити чат">🗑</button>
        <button type="button" class="btn btn-icon btn-sm" id="aiCloseBtn" aria-label="Закрити">✕</button>
      </div>
      <div class="ai-messages" id="aiMessages"></div>
      <div class="ai-quick" id="aiQuick"></div>
      <div class="ai-attach-previews" id="aiAttachPreviews"></div>
      <form class="ai-inputrow" id="aiForm">
        <input type="file" id="aiFileInput" accept="image/*" multiple class="hidden">
        <button type="button" class="btn btn-icon btn-sm" id="aiAttachBtn" aria-label="Прикріпити фото">📎</button>
        <textarea id="aiInput" rows="1" placeholder="Питання по заявках…" autocomplete="off" enterkeyhint="send"></textarea>
        <button type="button" class="btn btn-icon btn-sm" id="aiVoiceBtn" aria-label="Надиктувати питання">🎤</button>
        <button type="submit" class="btn btn-accent btn-sm" id="aiSendBtn" aria-label="Надіслати">➤</button>
      </form>
      <div class="ai-foot" id="aiVoiceStatus"></div>
    </div>`;
  doc.body.appendChild(panel);

  const style = doc.createElement('style');
  style.id = 'aiPanelStyles';
  style.textContent = `
    #aiChatPanel{position:fixed;inset:0;z-index:85;background:rgba(0,0,0,.45);align-items:flex-end;}
    .ai-panel-card{width:100%;height:92dvh;max-height:92dvh;display:flex;flex-direction:column;background:var(--surface,#fff);color:var(--text,#111);border-radius:16px 16px 0 0;padding:10px 10px calc(8px + env(safe-area-inset-bottom));box-sizing:border-box;}
    @media (min-width:600px){ .ai-panel-card{height:auto;max-height:86vh;} }
    .ai-panel-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;flex:0 0 auto;}
    .ai-panel-title{font-weight:800;font-size:14px;}
    .ai-badge-ro{font-size:9.5px;font-weight:800;background:rgba(46,160,67,.15);color:#2ea043;border-radius:6px;padding:2px 5px;white-space:nowrap;}
    .ai-panel-status{font-size:10.5px;color:var(--text-dim);width:100%;}
    .ai-messages{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;min-height:120px;display:flex;flex-direction:column;gap:8px;padding:4px 2px;}
    .ai-msg{max-width:88%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.45;}
    .ai-msg-user{align-self:flex-end;background:var(--accent,#4c7dff);color:#fff;border-bottom-right-radius:4px;white-space:pre-wrap;word-break:break-word;}
    .ai-msg-assistant{align-self:flex-start;background:rgba(127,127,127,.14);border-bottom-left-radius:4px;}
    .ai-msg-assistant .ai-line{margin:2px 0;}
    .ai-msg-assistant .ai-list{margin:4px 0 4px 18px;padding:0;}
    .ai-msg-assistant .ai-ticket-ref{display:inline-block;margin:2px 4px;font-size:12px;}
    .ai-msg-error{align-self:stretch;background:rgba(220,38,38,.12);font-size:13px;}
    .ai-msg-loading{align-self:flex-start;color:var(--text-dim);font-size:13px;}
    .ai-meta{font-size:11px;color:var(--text-faint);align-self:flex-start;margin-top:-4px;}
    .ai-cards{display:flex;flex-direction:column;gap:6px;margin-top:6px;}
    .ai-card{border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:7px 9px;background:rgba(127,127,127,.06);}
    .ai-card-title{font-size:13px;font-weight:700;}
    .ai-card-desc{font-size:12px;color:var(--text-dim,#555);margin:2px 0 5px;word-break:break-word;}
    .ai-quick{display:flex;gap:6px;align-items:center;margin:6px 0 0;flex:0 0 auto;}
    .ai-quick-toggle{flex:0 0 auto;font-size:12px;padding:5px 9px;}
    .ai-chips{display:flex;gap:6px;overflow-x:auto;flex:1;min-width:0;-webkit-overflow-scrolling:touch;padding-bottom:2px;}
    .ai-chips button{flex:0 0 auto;font-size:12px;padding:5px 10px;white-space:nowrap;border-radius:999px;}
    .ai-attach-previews{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;}
    .ai-attach-previews:empty{display:none;}
    .ai-att{width:76px;border:1px solid rgba(127,127,127,.35);border-radius:8px;padding:4px;font-size:10px;text-align:center;}
    .ai-att img{width:64px;height:64px;object-fit:cover;border-radius:6px;display:block;margin:0 auto;}
    .ai-att select{width:100%;font-size:10px;margin-top:2px;}
    .ai-inputrow{display:flex;gap:6px;margin-top:8px;align-items:flex-end;flex:0 0 auto;}
    .ai-inputrow textarea{flex:1;min-width:0;font-size:16px;resize:none;min-height:38px;max-height:96px;line-height:1.35;border-radius:10px;padding:8px 10px;font-family:inherit;box-sizing:border-box;}
    .ai-foot{font-size:10.5px;color:var(--text-faint);margin-top:4px;min-height:13px;flex:0 0 auto;}
    .ai-cards{display:flex;flex-direction:column;gap:6px;margin-top:6px;}
    .ai-card{border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:7px 9px;background:rgba(127,127,127,.06);}
    .ai-card-title{font-size:13px;font-weight:700;}
    .ai-card-addr{font-size:12.5px;margin-top:1px;word-break:break-word;}
    .ai-card-facts{font-size:11.5px;color:var(--text-dim,#555);margin-top:2px;}
    .ai-card-note{font-size:11.5px;color:var(--text-dim,#555);margin-top:2px;font-style:italic;word-break:break-word;}
    .ai-card .ai-card-open{margin-top:5px;}
    .ai-cards-more{margin-top:4px;}
  `;
  doc.head.appendChild(style);

  const renderer = MTAI.createRenderer(doc);
  const messages = $('aiMessages');

  const msgBubble = function(kind){
    const el = doc.createElement('div');
    el.className = 'ai-msg ai-msg-' + kind;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  };
  attachments = MTAI.createAttachmentManager({
    document: doc,
    onChange: renderPreviews
  });
  voice = MTAI.createVoiceInput({
    onStatus: function(state, text){ $('aiVoiceStatus').textContent = text || ''; },
    onResult: function(text){ const inp = $('aiInput'); inp.value = (inp.value ? inp.value + ' ' : '') + text; inp.focus(); },
    onError: function(err){ $('aiVoiceStatus').textContent = err.message; if(typeof showToast === 'function') showToast(err.message); }
  });
  chat = MTAI.createChatController({
    client: MTAI.client,
    attachments: attachments,
    capabilities: function(){ return MTAI.provider.capabilities(MTAI.storage); },
    hooks: {
      user: function(text){
        const b = msgBubble('user'); renderer.renderUserBubble(b, text);
      },
      busy: function(on){
        if(on){ const b = msgBubble('loading'); b.id = 'aiLoading'; b.textContent = '⏳ AI думає…'; renderQuick(); }
        else { const l = $('aiLoading'); if(l) l.remove(); renderQuick(); }
        $('aiSendBtn').disabled = on;
      },
      wait: function(sec){ $('aiVoiceStatus').textContent = '⏳ Ліміт Groq: чекаємо ~' + sec + ' с і повторюємо…'; },
      assistant: function(out){
        const b = msgBubble('assistant'); renderer.renderAnswer(b, out.text);
        /* Структуровані заявки з /ask -> картки з кнопками «Відкрити заявку»
           (READ-ONLY навігація через MTAI.actions.openTicket). Якщо бекенд
           ще без контракту — inline-кнопки з тексту додає renderAnswer. */
        if(out.tickets && out.tickets.length && MTAI.cards){
          MTAI.cards.render(b, out.tickets, function(id){ MTAI.actions.openTicket(id); });
        }
        /* Техническая строка rounds/tool_calls — только в Debug-режиме AI
           (обычному монтажнику она не нужна). */
        if(out.meta && MTAI.storage.get().debug === true){
          const m = doc.createElement('div'); m.className = 'ai-meta'; m.textContent = 'rounds: ' + (out.meta.rounds != null ? out.meta.rounds : '?') + ' · tool_calls: ' + (out.meta.tool_calls != null ? out.meta.tool_calls : 0); messages.appendChild(m);
        }
      },
      error: function(err){
        const b = msgBubble('error');
        b.textContent = (err.kind === 'rate_limit' ? '⏳ ' : err.kind === 'auth' ? '🔑 ' : '⚠️ ') + err.message;
        if(chat.canRetry()){
          const rb = doc.createElement('button');
          rb.type = 'button'; rb.className = 'btn btn-sm'; rb.textContent = '↻ Повторити запит';
          rb.addEventListener('click', function(){ rb.disabled = true; chat.retry(); });
          b.appendChild(doc.createElement('br')); b.appendChild(rb);
        }
      },
      cleared: function(){ while(messages.firstChild) messages.removeChild(messages.firstChild); renderQuick(); }
    }
  });

  /* Быстрые подсказки: НЕ висят постоянно над composer. В новом/пустом
     чате — 4 компактных chip; после первого сообщения панель скрывается;
     кнопка «💡 Підказки» раскрывает/скрывает полный список; после выбора
     chip панель снова сворачивается. */
  function renderQuick(){
    const q = $('aiQuick');
    while(q.firstChild) q.removeChild(q.firstChild);
    if(!chat) return;
    const sessionActive = chat.history().some(function(m){ return m.role === 'user'; });
    const all = MTAI.config.quickPrompts();
    const chips = doc.createElement('div');
    chips.className = 'ai-chips';
    /* Пустой чат: 4 chips (или все 8 после тоггла). Активная сессия: скрыто
       (или все 8 после тоггла). */
    const visible = quickExpanded ? all : (sessionActive ? [] : all.slice(0, 4));
    visible.forEach(function(prompt){
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'btn btn-sm'; b.textContent = prompt;
      b.addEventListener('click', function(){
        if(chat.isBusy()) return;
        quickExpanded = false;
        renderQuick();
        chat.send(prompt);
      });
      chips.appendChild(b);
    });
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-sm ai-quick-toggle';
    toggle.setAttribute('aria-expanded', quickExpanded ? 'true' : 'false');
    toggle.textContent = quickExpanded ? '💡 Сховати підказки' : '💡 Підказки';
    toggle.addEventListener('click', function(){ quickExpanded = !quickExpanded; renderQuick(); });
    q.appendChild(toggle);
    if(visible.length) q.appendChild(chips);
  }
  function renderPreviews(items){
    const box = $('aiAttachPreviews');
    while(box.firstChild) box.removeChild(box.firstChild);
    items.forEach(function(it){
      const card = doc.createElement('div'); card.className = 'ai-att';
      const img = doc.createElement('img'); img.src = it.dataUrl; img.alt = '';
      const sel = doc.createElement('select');
      MTAI.config.ATTACHMENT_KINDS.forEach(function(k){
        const o = doc.createElement('option'); o.value = k.id; o.textContent = k.label;
        if(k.id === it.kind) o.selected = true; sel.appendChild(o);
      });
      sel.addEventListener('change', function(){ attachments.setKind(it.id, sel.value); });
      const del = doc.createElement('button'); del.type = 'button'; del.className = 'btn btn-sm'; del.textContent = '✕ прибрати';
      del.addEventListener('click', function(){ attachments.remove(it.id); });
      card.appendChild(img); card.appendChild(sel); card.appendChild(del);
      box.appendChild(card);
    });
  }
  function updateStatusLine(){
    const line = MTAI.provider.statusLine(MTAI.storage, null);
    $('aiStatusLine').textContent = 'Provider: ' + line.provider + ' · Model: ' + line.model + ' · Mode: ' + line.mode;
  }

  function autosizeInput(){
    const inp = $('aiInput');
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 96) + 'px';
  }
  function submitQuestion(){
    const inp = $('aiInput');
    const value = inp.value; inp.value = '';
    inp.style.height = '';
    chat.send(value);
  }
  $('aiForm').addEventListener('submit', function(e){ e.preventDefault(); submitQuestion(); });
  $('aiInput').addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); submitQuestion(); }
  });
  $('aiInput').addEventListener('input', autosizeInput);
  $('aiAttachBtn').addEventListener('click', function(){
    if(!MTAI.provider.capabilities(MTAI.storage).vision){
      $('aiVoiceStatus').textContent = '📷 Поточна модель не приймає фото (контракт vision у розробці).';
    }
    $('aiFileInput').click();
  });
  $('aiFileInput').addEventListener('change', function(e){ attachments.addFiles(e.target.files); e.target.value = ''; });
  $('aiVoiceBtn').addEventListener('click', function(){
    if(!voice.supported()){ $('aiVoiceStatus').textContent = '🎤 Голос не підтримується цим браузером — працює текст.'; return; }
    if(voice.isActive()){ voice.stop(); } else { voice.start(); }
  });
  $('aiClearBtn').addEventListener('click', function(){ chat.clear(); });
  $('aiCloseBtn').addEventListener('click', function(){ panel.style.display = 'none'; });
  panel.addEventListener('click', function(e){ if(e.target === panel) panel.style.display = 'none'; });

  renderQuick();
  updateStatusLine();

  /* Android-клавиатура: держим панель в пределах visualViewport, чтобы
     composer всегда был виден (браузеры без visualViewport — как есть). */
  try{
    if(window.visualViewport && typeof window.visualViewport.addEventListener === 'function'){
      const vv = window.visualViewport;
      const fit = function(){ panel.style.height = Math.round(vv.height) + 'px'; };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
      fit();
    }
  }catch(_vvErr){}
}

function open(){
  /* Явные состояния: chat / unconfigured / disabled. Никаких silent no-op. */
  const action = resolveAction();
  if(action === 'disabled'){ openBlocked('disabled'); return; }
  if(action === 'unconfigured'){ openBlocked('unconfigured'); return; }
  MTAI.ui.build();
  const panel = $('aiChatPanel');
  panel.style.display = 'flex';
  setTimeout(function(){ const inp = $('aiInput'); if(inp) inp.focus(); }, 60);
}

/* Кнопка в «Інструментах» рендериться tools-domain.js; тут — делегований
   обробник (переживає будь-які ре-рендери інструментів). */
doc.addEventListener('click', function(e){
  const btn = e.target && e.target.closest ? e.target.closest('[data-tools-action="ai-assistant"]') : null;
  if(btn){ e.preventDefault(); open(); }
});

window.MTAI.ui = { open: open, build: build, resolveAction: resolveAction };
})();

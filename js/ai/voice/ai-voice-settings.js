/* AI voice (v91.60): the two device-local voice switches, both OFF by default.
     • «Автовідправка після голосового вводу»  → settings.ai.voiceAutoSend
     • «Автоматично озвучувати відповіді AI»   → settings.ai.voiceAutoRead
   Stored through the existing MTAI.storage (settings object + saveSettings):
   no second storage, nothing synced to the backend. No pitch/rate/voice
   pickers — the browser defaults are used. The rows are appended to the
   existing «🤖 AI-асистент» card of the settings tab: ai-settings.js calls
   MTAI.voiceSettings.build() at the end of its own build(). */
(function(){
'use strict';
if(typeof document === 'undefined') return;
const MTAI = window.MTAI;
if(!MTAI) return;
const doc = document;

function row(id, title, hint, checked){
  const wrap = doc.createElement('div');
  wrap.className = 'settings-row';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'space-between';
  const text = doc.createElement('div');
  text.style.minWidth = '0';
  const strong = doc.createElement('strong');
  strong.textContent = title;
  const small = doc.createElement('div');
  small.style.fontSize = '12px';
  small.style.color = 'var(--text-dim)';
  small.textContent = hint;
  text.appendChild(strong); text.appendChild(small);
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = !!checked;
  wrap.appendChild(text); wrap.appendChild(input);
  return {wrap: wrap, input: input};
}

function build(){
  const card = doc.getElementById('aiSettingsCard');
  if(!card || doc.getElementById('aiVoiceAutoSendToggle')) return false;
  const cfg = MTAI.storage.get();
  const ttsSupported = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);

  const box = doc.createElement('div');
  box.id = 'aiVoiceSettings';
  box.className = 'settings-row';
  box.style.borderTop = '1px solid rgba(127,127,127,.25)';
  box.style.paddingTop = '10px';
  box.style.display = 'block';
  const head = doc.createElement('div');
  head.style.fontSize = '12px';
  head.style.color = 'var(--text-dim)';
  head.style.marginBottom = '4px';
  head.textContent = '🎙 Голос (лише на цьому пристрої; типово вимкнено)';
  box.appendChild(head);

  const autoSend = row('aiVoiceAutoSendToggle', 'Автовідправка після голосового вводу',
    'Після розпізнавання текст видно ~1 с, потім питання надсилається само. Редагування або ➤ скасовує.', cfg.voiceAutoSend);
  autoSend.input.addEventListener('change', function(e){
    MTAI.storage.update({ voiceAutoSend: e.target.checked });
    if(typeof showToast === 'function') showToast(e.target.checked ? 'Автовідправку після диктування увімкнено' : 'Автовідправку вимкнено');
  });
  box.appendChild(autoSend.wrap);

  const autoRead = row('aiVoiceAutoReadToggle', 'Автоматично озвучувати відповіді AI',
    ttsSupported ? 'Кожна нова відповідь читається один раз голосом браузера. Кнопка 🔊 у відповіді працює завжди.'
                 : 'Цей браузер не підтримує озвучення (speechSynthesis) — чат працює без нього.', cfg.voiceAutoRead);
  if(!ttsSupported) autoRead.input.disabled = true;
  autoRead.input.addEventListener('change', function(e){
    MTAI.storage.update({ voiceAutoRead: e.target.checked });
    if(typeof showToast === 'function') showToast(e.target.checked ? 'Озвучення відповідей увімкнено' : 'Озвучення відповідей вимкнено');
  });
  box.appendChild(autoRead.wrap);

  card.appendChild(box);
  return true;
}

/* ai-settings.js calls MTAI.voiceSettings.build() right after it has built
   its card; the direct call below covers a card that already exists. */
MTAI.voiceSettings = { build: build };
build();
})();

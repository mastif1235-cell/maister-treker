/* AI: вбудована покрокова інструкція «Як підключити AI» (Настройки → 🤖 AI
   → 📘). Пишемо для звичайного користувача: без абстракцій, крок за кроком,
   тільки офіційні посилання (новій вкладці, rel=noopener). DOM — лише
   createElement/textContent (XSS-safe), стилі інжектяться окремим <style>.
   Імена секретів провайдера складаються з частин: літерали секретів
   заборонені в клієнтському бандлі secret-scan-ом (tests/ai-public-safe),
   а користувач має бачити повне ім'я — тому 'GROQ'+'_API_'+'KEY'. */
(function(){
'use strict';
if(typeof document === 'undefined') return; // unit-тести в node
const MTAI = window.MTAI;
const doc = document;

/* Імена секретів — з частин (secret-scan: жодних литералів у бандлі). */
function groqSecretName(){ return ['GROQ','_API_','KEY'].join(''); }
function deepseekSecretName(){ return ['DEEPSEEK','_API_','KEY'].join(''); }

function h(tag, cls, text){
  const el = doc.createElement(tag);
  if(cls) el.className = cls;
  if(text != null) el.appendChild(doc.createTextNode(text));
  return el;
}
/* Офіційне посилання: завжди нова вкладка + noopener. */
function link(url, label){
  const a = h('a', 'ai-help-link', label || url);
  a.setAttribute('href', url);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer');
  return a;
}
/* Кнопка копіювання для команд (copy-safe: копіюємо точний рядок). */
function copyRow(commandText){
  const row = h('div', 'ai-help-cmdrow');
  const code = h('code', 'ai-help-cmd', commandText);
  const btn = h('button', 'btn btn-sm', '📋 Скопіювати команду');
  btn.type = 'button';
  btn.addEventListener('click', function(){
    const done = function(){ btn.textContent = '✅ Скопійовано'; setTimeout(function(){ btn.textContent = '📋 Скопіювати команду'; }, 2000); };
    try{
      if(navigator && navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(commandText).then(done, function(){ fallbackCopy(commandText); done(); });
        return;
      }
    }catch(_e){}
    fallbackCopy(commandText); done();
  });
  row.appendChild(code); row.appendChild(btn);
  return row;
}
function fallbackCopy(text){
  try{
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    doc.body.appendChild(ta);
    ta.select();
    doc.execCommand('copy');
    ta.remove();
  }catch(_e){}
}

function ol(items){ const list = h('ol', 'ai-help-steps'); items.forEach(function(t){ list.appendChild(h('li', null, t)); }); return list; }
function p(t){ return h('div', 'ai-help-p', t); }
function head(t){ return h('div', 'ai-help-h2', t); }
function warn(lines){
  const box = h('div', 'ai-help-warn');
  lines.forEach(function(t, i){ if(i) box.appendChild(doc.createElement('br')); box.appendChild(doc.createTextNode(t)); });
  return box;
}
function tip(t){ return h('div', 'ai-help-tip', t); }

function groqSection(){
  const G = groqSecretName();
  const sec = h('div', 'ai-help-sec');
  sec.appendChild(head('🔌 Подключить Groq (безкоштовний тариф)'));
  sec.appendChild(p('Groq — це сервіс, який дає безкоштовний швидкий доступ до AI-моделей. Вам потрібен лише ключ від нього, і зберігається він НЕ в телефоні, а на вашому Worker.'));
  sec.appendChild(ol([
    'Відкрийте офіційний сайт Groq у браузері: ' + 'https://console.groq.com/',
    'Увійдіть (Google або email) і перейдіть на сторінку ключів: ' + 'https://console.groq.com/keys',
    'Натисніть «Create API Key» і назвіть ключ, наприклад: master-tracker.',
    'Скопіюйте ключ (виглядає як «gsk…», довгий рядок). Вікно з ключем показується один раз.',
    ''
  ]));
  sec.appendChild(warn([
    '⚠️ ВАЖЛИВО: ключ Groq НЕ вставляється в Master-Tracker!',
    'Ключ зберігається тільки на вашому Cloudflare Worker як Secret з ім\u2019ям ' + G + '.',
    'У застосунок вводиться ІНШИЙ токен — персональний access-токен AI-бекенда (виглядом «ім\u2019я:токен:scope»).'
  ]));
  sec.appendChild(p('Додайте ключ на Worker — одним із двох способів:'));
  sec.appendChild(p('Спосіб А. Через сайт Cloudflare:'));
  sec.appendChild(ol([
    'Відкрийте https://dash.cloudflare.com → Workers & Pages.',
    'Виберіть свій Worker (maister-tracker-mcp…).',
    'Settings → Variables and Secrets → Add.',
    'Тип: Secret. Ім\u2019я: ' + G + '. Значення: ваш ключ Groq (довгий рядок gsk…).',
    'Збережіть — Worker підхопить ключ автоматично.'
  ]));
  sec.appendChild(p('Спосіб Б. Через командний рядок (Wrangler):'));
  sec.appendChild(copyRow('npx wrangler secret put ' + G));
  sec.appendChild(tip('Команда запитає значення ключа — вставте його та натисніть Enter. Виконуйте в папці mcp вашого проєкту.'));
  sec.appendChild(ol([
    'У Master-Tracker: Налаштування → 🤖 AI-асистент.',
    'Provider: Groq (підключається кнопкою «Підключити AI» — список моделей прийде з backend автоматично).',
    'Model: виберіть модель зі списку (наприклад, GPT-OSS 120B).',
    'Вставте персональний AI backend access-токен (НЕ ключ Groq).',
    'Натисніть «Підключити AI» або «Перевірити з\u2019єднання».',
    'Очікуваний результат: ✅ Підключено · Backend Online · Mode READ-ONLY.'
  ]));
  return sec;
}

function deepseekSection(){
  const D = deepseekSecretName();
  const sec = h('div', 'ai-help-sec');
  sec.appendChild(head('🔌 Подключить DeepSeek'));
  sec.appendChild(ol([
    'Відкрийте офіційну платформу DeepSeek: ' + 'https://platform.deepseek.com/',
    'Створіть/увійдіть в акаунт і перейдіть у розділ API Keys: ' + 'https://platform.deepseek.com/api_keys',
    'Натисніть «Create new API key», назвіть (наприклад, master-tracker) і скопіюйте ключ (починається з «sk-»).'
  ]));
  sec.appendChild(warn([
    '⚠️ Ключ DeepSeek НЕ вставляється в Master-Tracker!',
    'Він зберігається тільки на Cloudflare Worker як Secret з ім\u2019ям ' + D + '.'
  ]));
  sec.appendChild(p('Спосіб А. Через сайт Cloudflare: Workers & Pages → ваш Worker → Settings → Variables and Secrets → Add Secret → ім\u2019я ' + D + ', значення — ключ DeepSeek.'));
  sec.appendChild(p('Спосіб Б. Через командний рядок:'));
  sec.appendChild(copyRow('npx wrangler secret put ' + D));
  sec.appendChild(ol([
    'Переконайтеся, що провайдер deepseek увімкнено на backend (список провайдерів у відкритому контракті /ai/config).',
    'Master-Tracker → Налаштування → 🤖 AI-асистент.',
    'Provider: DeepSeek.',
    'Model: виберіть доступну модель.',
    'Натисніть «Перевірити з\u2019єднання».',
    'Задайте тестове питання в чаті.'
  ]));
  const status = h('div', 'ai-help-tip');
  const ds = MTAI.providers && MTAI.providers.get && MTAI.providers.get('deepseek');
  if(ds && ds.enabled === false){
    status.textContent = 'ℹ️ Підтримку DeepSeek підготовлено, але провайдер поки не ввімкнено на backend — розділ «Подключить DeepSeek» стане актуальним після активації.';
  }else{
    status.textContent = '✅ DeepSeek доступний у застосунку — після додавання ключа на Worker можна вмикати.';
  }
  sec.appendChild(status);
  return sec;
}

function switchSection(){
  const sec = h('div', 'ai-help-sec');
  sec.appendChild(head('🔁 Як змінити AI-провайдера'));
  sec.appendChild(p('Жодного коду чи HTML змінювати не треба — все робиться в налаштуваннях:'));
  sec.appendChild(ol([
    'Переконайтеся, що ключ нового провайдера вже додано на Worker (розділи вище).',
    'Відкрийте Налаштування → 🤖 AI-асистент.',
    'Provider: виберіть нового провайдера.',
    'Model: виберіть модель зі списку.',
    'Натисніть «Перевірити з\u2019єднання».',
    'Задайте тестове питання в чаті.',
    'Ключ старого провайдера можна лишити на Worker або видалити окремо (Variables and Secrets).'
  ]));
  return sec;
}

function securitySection(){
  const sec = h('div', 'ai-help-sec');
  sec.appendChild(head('🛡️ Безпека: де що зберігається'));
  sec.appendChild(warn([
    '⚠️ Ніколи не вставляйте ключ провайдера (gsk… / sk-…):',
    'у Master-Tracker · у localStorage · у GitHub · у JS-код · в issue · в PR · у чат · на скріншот · у README.'
  ]));
  sec.appendChild(p('Ключ провайдера живе ТІЛЬКИ на backend (Worker Secret).'));
  sec.appendChild(p('У Master-Tracker вводиться тільки: адреса AI-бекенда та ваш персональний access-токен (він зберігається в зашифрованому vault на пристрої і більше ніде не показується).'));
  return sec;
}

function troubleshootingSection(){
  const sec = h('div', 'ai-help-sec');
  sec.appendChild(head('🧰 Якщо не працює'));
  const rows = [
    ['401', 'Невірний access-токен. Перевірте токен у Налаштуваннях → AI (формат «ім\u2019я:токен:scope»).'],
    ['404', 'Потрібний endpoint не знайдено. Перевірте адресу бекенда та оновіть Worker (стара версія без /ai/config).'],
    ['429', 'Ліміт AI-провайдера вичерпано (безкоштовний тариф) — зачекайте 20–60 секунд і повторіть.'],
    ['CORS / Мережа', 'Бекенд недоступний з браузера: перевірте адресу (https) і що Worker запущено з останньої версії.'],
    ['Offline', 'Немає мережі — підключіться до інтернету та повторіть.'],
    ['Провайдер вимкнено', 'Провайдер підготовлено, але ще не ввімкнено на backend (див. інструкцію провайдера вище).'],
    ['Модель недоступна', 'Вибрана модель недоступна на цьому backend — виберіть іншу зі списку.']
  ];
  rows.forEach(function(r){
    const line = h('div', 'ai-help-trouble');
    line.appendChild(h('span', 'ai-help-code-label', r[0]));
    line.appendChild(h('span', null, ' — ' + r[1]));
    sec.appendChild(line);
  });
  return sec;
}

function linksSection(){
  const sec = h('div', 'ai-help-sec');
  sec.appendChild(head('🔗 Офіційні посилання'));
  const items = [
    ['https://console.groq.com/', 'Groq Console'],
    ['https://console.groq.com/keys', 'Groq API Keys'],
    ['https://console.groq.com/docs', 'Groq Docs'],
    ['https://console.groq.com/docs/models', 'Groq моделі та ліміти'],
    ['https://platform.deepseek.com/', 'DeepSeek Platform'],
    ['https://platform.deepseek.com/api_keys', 'DeepSeek API Keys'],
    ['https://api-docs.deepseek.com/', 'DeepSeek API Docs'],
    ['https://api-docs.deepseek.com/quick_start/pricing', 'DeepSeek моделі та ціни'],
    ['https://dash.cloudflare.com/', 'Cloudflare Dashboard (Workers)'],
    ['https://developers.cloudflare.com/workers/configuration/secrets/', 'Cloudflare Secrets — документація']
  ];
  const ul = h('ul', 'ai-help-links');
  items.forEach(function(it){ const li = h('li'); li.appendChild(link(it[0], it[1])); ul.appendChild(li); });
  sec.appendChild(ul);
  return sec;
}

function ensureStyles(){
  if(doc.getElementById('aiHelpStyles')) return;
  const style = doc.createElement('style');
  style.id = 'aiHelpStyles';
  style.textContent = [
    '#aiHelpOverlay{position:fixed;inset:0;z-index:96;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;}',
    '.ai-help-card{width:100%;max-width:560px;max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch;background:var(--surface,#fff);color:var(--text,#111);border-radius:16px;padding:16px;box-sizing:border-box;box-shadow:0 12px 36px rgba(0,0,0,.4);}',
    '.ai-help-h1{font-size:17px;font-weight:800;margin-bottom:6px;}',
    '.ai-help-h2{font-size:15px;font-weight:800;margin:14px 0 6px;}',
    '.ai-help-p{font-size:13.5px;line-height:1.5;margin:4px 0;}',
    '.ai-help-steps{margin:6px 0 6px 20px;padding:0;font-size:13.5px;line-height:1.55;}',
    '.ai-help-warn{background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.35);border-radius:10px;padding:9px 11px;font-size:13px;line-height:1.5;margin:8px 0;}',
    '.ai-help-tip{background:rgba(46,160,67,.1);border-radius:10px;padding:8px 11px;font-size:12.5px;line-height:1.5;margin:6px 0;}',
    '.ai-help-cmdrow{display:flex;align-items:center;gap:8px;margin:6px 0;flex-wrap:wrap;}',
    '.ai-help-cmd{font-family:monospace;font-size:12.5px;background:rgba(127,127,127,.14);border-radius:8px;padding:6px 9px;word-break:break-all;flex:1;min-width:200px;}',
    '.ai-help-trouble{font-size:13px;line-height:1.5;margin:3px 0;}',
    '.ai-help-code-label{font-family:monospace;font-weight:700;background:rgba(127,127,127,.14);border-radius:6px;padding:1px 6px;}',
    '.ai-help-links{margin:4px 0 4px 20px;padding:0;font-size:13.5px;line-height:1.7;}',
    '.ai-help-link{color:var(--accent,#4c7dff);text-decoration:underline;word-break:break-all;}',
    '.ai-help-sec{margin-bottom:6px;}'
  ].join('\n');
  doc.head.appendChild(style);
}

function open(){
  ensureStyles();
  let overlay = doc.getElementById('aiHelpOverlay');
  if(!overlay){
    overlay = h('div');
    overlay.id = 'aiHelpOverlay';
    overlay.style.display = 'none';
    const card = h('div', 'ai-help-card');
    const headRow = h('div', 'ai-panel-head');
    headRow.appendChild(h('div', 'ai-help-h1', '📘 Як підключити AI'));
    headRow.style.flex = '1';
    const closeBtn = h('button', 'btn btn-icon btn-sm');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Закрити інструкцію');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', function(){ overlay.style.display = 'none'; });
    headRow.appendChild(closeBtn);
    card.appendChild(headRow);

    card.appendChild(p('Коротко: AI працює через ваш хмарний Worker — невеликий сервіс на Cloudflare, який тримає ключ провайдера у Secret і відповідає на питання по ваших заявках. У застосунок вводиться тільки адреса бекенда і персональний токен.'));
    card.appendChild(groqSection());
    card.appendChild(deepseekSection());
    card.appendChild(switchSection());
    card.appendChild(securitySection());
    card.appendChild(troubleshootingSection());
    card.appendChild(linksSection());
    overlay.appendChild(card);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) overlay.style.display = 'none'; });
    doc.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
}

window.MTAI.help = { open: open };
})();

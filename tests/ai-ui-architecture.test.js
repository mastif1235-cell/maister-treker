'use strict';
// Архітектура AI UI (модулі js/ai/*): підключення, CSP/SW-контракти,
// безпека, READ-ONLY, відсутність provider-ключів у фронтенді.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const exists=f=>fs.existsSync(path.join(root,f));
const html=read('index.html'),sw=read('sw.js'),tools=read('js/tools-domain.js');

// 1) Модульна структура: жодного моноліту, старий single-file чернетку видалено
const AI_FILES=[
  'js/ai/ai-config.js','js/ai/ai-ticket-id.js','js/ai/ai-storage.js','js/ai/ai-provider.js','js/ai/ai-client.js',
  'js/ai/ai-render.js','js/ai/ai-result-cards.js','js/ai/ai-chat.js','js/ai/ai-ui.js','js/ai/ai-help.js','js/ai/ai-settings.js',
  'js/ai/ai-attachments.js','js/ai/ai-voice.js',
  'js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js',
  'js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js','js/ai/actions/photo-actions.js'
];
for(const f of AI_FILES) assert.ok(exists(f),'exists '+f);
assert.ok(!exists('js/ai-assistant.js'),'single-file draft removed (superseded by js/ai/)');

// 2) index.html підключає всі модулі останніми (після security-обгорток)
const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);
for(const f of AI_FILES) assert.ok(scripts.includes(f),'wired in index.html: '+f);
assert.equal(scripts[scripts.length-1],'js/ai/ai-settings.js','ai modules load last');

// 3) SW pre-cache покриває всі ai-модулі (офлайн-запуск без мережі)
for(const f of AI_FILES) assert.ok(sw.includes("'./"+f+"'"),'sw CORE_ASSETS: '+f);

// 4) Кнопка у «Інструментах»: УМОВНА (enabled+showInTools) + роутер дії
assert.match(tools,/settings&&settings\.ai&&settings\.ai\.enabled&&settings\.ai\.showInTools\)\?'<button[^>]*data-tools-action="ai-assistant"/,'AI button conditional (hidden by default)');
assert.match(tools,/action==='ai-assistant'\)\{\s*if\(window\.MTAI&&MTAI\.ui\)MTAI\.ui\.open\(\);\s*\}/,'tools router opens AI chat');
// onboarding: майстер підключення + тоггл видимості
const settingsUi=read('js/ai/ai-settings.js');
assert.match(settingsUi,/aiOnboardBtn/,'onboarding wizard button');
assert.match(settingsUi,/aiShowInToolsToggle/,'show-in-tools toggle');
assert.match(settingsUi,/ai\/config/,'onboarding reads /ai/config');
assert.match(read('js/ai/ai-client.js'),/'\/ai\/config'/,'client exposes GET /ai/config');

// 5) CSP: рівно два наші Workers-хости, паритет index/_headers
for(const [name,src] of [['index.html',html],['_headers',read('_headers')]]){
  const csp=src.match(/connect-src[^;]+;/)?.[0]||'';
  const hosts=[...csp.matchAll(/https:\/\/([a-z0-9.-]+\.workers\.dev)/g)].map(m=>m[1]).sort();
  assert.deepEqual(hosts,['maister-tracker-mcp-dev.mastif1235.workers.dev','maister-tracker-mcp.mastif1235.workers.dev'],name+': exact workers.dev allowlist');
}

// 6) Безпека модулів: без eval; innerHTML — лише статичні шаблони без
//    інтерполяції даних користувача/моделі (виняток: providerOptions з нашого реєстру)
for(const f of AI_FILES){
  const code=read(f);
  assert.doesNotMatch(code,/\beval\s*\(|new\s+Function\s*\(/,f+': no eval');
  const templates=[...code.matchAll(/innerHTML\s*=\s*`([^`]*)`/gs)];
  for(const t of templates){
    const interpolations=[...t[1].matchAll(/\$\{([^}]*)\}/g)].map(m=>m[1].trim());
    for(const expr of interpolations){
      const safe=/^providerOptions$/.test(expr) ||
        /^MTAI\.storage\.hasToken\(\) \? '[^']*' : '[^']*'$/.test(expr); // только статические тексты-заглушки, само значение токена не выводится
      assert.ok(safe,f+': innerHTML interpolates only registry-owned/static-safe expressions (got: '+expr+')');
    }
    assert.ok(!/<script/i.test(t[1]),f+': no script tags in static template');
  }
  const rest=code.replace(/innerHTML\s*=\s*`[^`]*`/gs,'');
  assert.doesNotMatch(rest,/\.innerHTML\s*=/,f+': no innerHTML assignment outside static templates');
}
const render=read('js/ai/ai-render.js'),chatCode=read('js/ai/ai-chat.js'),client=read('js/ai/ai-client.js');
assert.match(render,/createTextNode/,'renderer builds text nodes');
assert.doesNotMatch(chatCode,/\.innerHTML\s*=/,'chat never assigns innerHTML');

// 7) Мережа: клієнт ходить лише у /ask і /healthz нашого бекенда; жодних
//    Groq/DeepSeek endpoint'ів чи ключів у фронтенді
const urls=[...client.matchAll(/backendUrl\s*\+\s*'([^']+)'/g)].map(m=>m[1]).sort();
assert.deepEqual(urls,['/ai/config','/ask','/healthz'],'client calls only /ai/config, /ask and /healthz');
for(const f of AI_FILES){
  const code=read(f);
  assert.doesNotMatch(code,/api\.groq\.com|api\.deepseek\.com|gsk_|DEEPSEEK_API_KEY|sk-[a-z0-9]{8}/i,f+': no provider endpoints/keys');
}
assert.match(read('js/ai/providers/groq.js'),/ключи? — Worker Secret|ключ — Worker Secret/,'groq adapter documents server-side-only keys');

// 8) READ-ONLY: бейдж у чаті та налаштуваннях; усі write-дії вимкнені
assert.match(read('js/ai/ai-ui.js'),/READ-ONLY/,'chat READ-ONLY badge');
assert.match(read('js/ai/ai-settings.js'),/READ-ONLY/,'settings READ-ONLY status');
assert.match(read('js/ai/actions/ai-actions.js'),/write_disabled/,'execute() refuses write actions');
// поведінкова перевірка WRITE-гардів — у tests/ai-modules.test.js (vm-реєстр)

// 9) Токен: only vault + Authorization header; не логується, не показується
assert.match(read('js/ai/ai-storage.js'),/bearer/,'storage exposes bearer() for header');
assert.match(read('js/ai/ai-client.js'),/Authorization['"]\s*:\s*'Bearer \u0027 \+/,'token only in Authorization header');
assert.doesNotMatch(client,/console\.(log|info|debug)/,'client never logs');
assert.match(read('js/ai/ai-settings.js'),/•••••••• \(збережено\)/,'token is never displayed after save');

// 10) Chat open guard: вимкнений/неналаштований AI не відкриває чат
//     (resolveAction -> blocked-екран; DOM-сценарії — tests/ai-ui-dom.test.js)
assert.match(read('js/ai/ai-ui.js'),/function resolveAction/,'resolveAction guard');
assert.match(read('js/ai/ai-ui.js'),/openBlocked/,'blocked screen for non-ready states');
assert.match(read('js/ai/ai-ui.js'),/aiBlockedStyles/,'blocked screen injects its own styles (no unstyled no-op)');

console.log('PASS ai-ui architecture: modules, wiring, CSP/SW, no provider keys, READ-ONLY, safe rendering');

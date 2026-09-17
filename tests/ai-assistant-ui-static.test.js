'use strict';
// Регресія UI-етапу AI (гілка feat/ai-groq-orchestrator): кнопка/чат/налаштування
// 🤖 AI підключені безпечно, без секретів і без порушень CSP/SW-контракту.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const html=read('index.html'),headers=read('_headers'),sw=read('sw.js'),js=read('js/ai-assistant.js'),
      vault=read('js/settings-secrets-vault.js'),render=read('js/settings-render.js');

// 1) Модуль підключений останнім і попередньо кешується SW
assert.match(html,/<script src="js\/ai-assistant\.js"><\/script>/,'ai-assistant.js wired in index.html');
const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);
assert.equal(scripts[scripts.length-1],'js/ai-assistant.js','ai-assistant loads last (after security wrappers)');
assert.ok(sw.includes("'./js/ai-assistant.js'"),'ai-assistant.js must be in sw.js CORE_ASSETS');

// 2) CSP: дозволені лише наші два Workers-хости, в index.html І в _headers (паритет)
for(const [name,src] of [['index.html',html],['_headers',headers]]){
  const csp=src.match(/connect-src[^;]+;/)?.[0]||'';
  assert.match(csp,/https:\/\/maister-tracker-mcp\.mastif1235\.workers\.dev/,name+': prod Worker in connect-src');
  assert.match(csp,/https:\/\/maister-tracker-mcp-dev\.mastif1235\.workers\.dev/,name+': dev Worker in connect-src');
  const hosts=[...csp.matchAll(/https:\/\/([a-z0-9.-]+\.workers\.dev)/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(hosts)].sort(),['maister-tracker-mcp-dev.mastif1235.workers.dev','maister-tracker-mcp.mastif1235.workers.dev'],name+': no other workers.dev hosts');
}

// 3) Токен: тільки в Authorization header; Groq API key у фронтенді відсутній як поняття вводу
assert.doesNotMatch(js,/gsk_|GROQ_API_KEY|api\.groq\.com/i,'frontend never references Groq keys/endpoints');
assert.match(js,/['"]Authorization['"]\s*:\s*['"]Bearer \u0027 \+/,'token travels only in Authorization header');
assert.match(vault,/MT_SETTINGS_SECRET_KEYS\s*=\s*\[[^\]]*'aiBearerToken'[^\]]*\]/,'aiBearerToken is vault-encrypted');
assert.doesNotMatch(js,/localStorage/,'ai-assistant must not roll its own storage');

// 4) READ-ONLY: бейдж і заборона запису в UX
assert.match(js,/READ-ONLY/,'READ-ONLY badge present');
assert.match(render,/key:'ai'/,'settings hub has an AI section');

// 5) XSS: відповідь інструментів рендериться через textContent, не innerHTML
assert.match(js,/el\.textContent\s*=\s*text/,'assistant bubbles use textContent');
const msgAssign=[...js.matchAll(/aiMessages['"]\)\.innerHTML\s*=\s*([^;]+);/g)];
assert.ok(msgAssign.length>=1,'clear-chat assignment exists');
for(const a of msgAssign) assert.match(a[1],/^''$/,'messages innerHTML may only be cleared to empty string');

// 6) Мережа: тільки наш /ask і /healthz на дозволеному бекенді
const urls=[...js.matchAll(/(?:backendUrl|ai\.backendUrl)\s*\+\s*'([^']+)'/g)].map(m=>m[1]);
assert.deepEqual(urls.sort(),['/ask','/healthz'],'only /ask and /healthz are called');

console.log('PASS ai-assistant UI: wired, precached, CSP-parity, no secrets, READ-ONLY, XSS-safe');

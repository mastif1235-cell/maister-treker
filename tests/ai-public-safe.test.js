'use strict';
// PUBLIC-SAFE: fresh-install поведение, видимостКнопки AI в Инструментах,
// явные состояния кнопки (никаких silent no-op) и скан клиентского бандла
// на секреты. Все проверки статические/vm — без сети.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

// ── 1. Fresh install: AI OFF, backend не задан, токена нет, showInTools нет ──
{
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON, AbortController, Response, Headers };
  sandbox.globalThis=sandbox;
  for(const f of ['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js']){
    vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
  }
  sandbox.settings={}; sandbox.saveSettings=function(){ sandbox.saved=true; };
  let fetchCalls=0; sandbox.fetch=function(){ fetchCalls++; return Promise.resolve(new Response('{}',{status:200})); };
  const M=sandbox.MTAI;
  const ai=M.storage.ensure();
  assert.equal(ai.enabled,false,'fresh: AI OFF');
  assert.equal(ai.backendUrl,'','fresh: backend unset');
  assert.equal(ai.showInTools,false,'fresh: tools button hidden');
  assert.equal(sandbox.settings.aiBearerToken,'','fresh: token absent');
  assert.equal(M.storage.isReady(),false,'fresh: not ready');
  assert.equal(M.storage.isConfigured(),false,'fresh: not configured');
  // init-модули не делают фоновых запросов (ui/settings без document — early return)
  assert.equal(fetchCalls,0,'fresh: zero background AI requests');
  console.log('PASS fresh install: AI OFF, backend unset, token absent, no background requests');
}

// ── 2. Кнопка в Инструментах: по умолчанию скрыта, показывается тогглом ──
{
  const tools=read('js/tools-domain.js');
  assert.match(tools,/settings&&settings\.ai&&settings\.ai\.enabled&&settings\.ai\.showInTools/,'AI button is conditional (enabled+showInTools)');
  // по умолчанию условия не выполняются → кнопки в разметке нет (static simulate)
  const settings={ai:{enabled:false,showInTools:false}};
  const html=tools.match(/function toolsHomeHtml\(\)\{[\s\S]*?\n\}/)[0];
  const rendered=evalConditionally(html,settings);
  assert.ok(!rendered.includes('data-tools-action="ai-assistant"'),'default render has NO AI button');
  const settingsOn={ai:{enabled:true,showInTools:true}};
  const renderedOn=evalConditionally(html,settingsOn);
  assert.ok(renderedOn.includes('data-tools-action="ai-assistant"'),'toggle ON renders the AI button');
  const settingsHidden={ai:{enabled:true,showInTools:false}};
  assert.ok(!evalConditionally(html,settingsHidden).includes('data-tools-action="ai-assistant"'),'manual hide keeps AI configured but hides button');
  function evalConditionally(src,st){
    // извлечь template literal из toolsHomeHtml и вычислить ${...} с переданным settings
    const body=src.slice(src.indexOf('`')+1,src.lastIndexOf('`'));
    const fakeRequire=null;
    const fn=new Function('settings','escapeHtml','toolsDiagnosticContext','toolsDiagnosticResult','appNavigationCanGoBack','appBackButtonHtml','toolsView','toolsOfflineReturnSettings',
      'return `'+body+'`;');
    try{ return fn(st, s=>String(s), null, null, ()=>false, ()=> '', 'home', false); }catch(_e){ return src; }
  }
  console.log('PASS tools button: hidden by default, toggle show/hide, settings preserved');
}

// ── 3. Кнопка: явные состояния, никаких silent no-op ──
{
  const ui=read('js/ai/ai-ui.js');
  assert.match(ui,/openBlocked/,'blocked panel exists');
  assert.match(ui,/storage\.get\(\)\.enabled/,'disabled state checked first');
  assert.match(ui,/isReady\(\)/,'ready state checked');
  assert.match(ui,/AI не налаштований/,'unconfigured message');
  assert.match(ui,/AI вимкнено/,'disabled message');
  assert.match(ui,/Перейти в налаштування AI/,'settings navigation button');
  // двойной гард: chat panel не создаётся до isReady
  const openBody=ui.slice(ui.indexOf('function open()'),ui.indexOf('window.MTAI.ui'));
  assert.ok(openBody.indexOf('isReady')>=0 && openBody.indexOf('build()')>=0 && openBody.indexOf('build()')>openBody.indexOf('isReady'),'build() only after readiness guard');
  console.log('PASS button states: chat / unconfigured->settings / disabled, reopen-safe');
}

// ── 4. SECRET SCAN клиентского бандла (публичная сборка) ──
{
  const clientFiles=['index.html','sw.js','styles.css','manifest.json',
    ...fs.readdirSync(path.join(root,'js')).filter(f=>f.endsWith('.js')).map(f=>'js/'+f),
    ...fs.readdirSync(path.join(root,'js/ai')).filter(f=>f.endsWith('.js')).map(f=>'js/ai/'+f),
    ...fs.readdirSync(path.join(root,'js/ai/providers')).filter(f=>f.endsWith('.js')).map(f=>'js/ai/providers/'+f),
    ...fs.readdirSync(path.join(root,'js/ai/actions')).filter(f=>f.endsWith('.js')).map(f=>'js/ai/actions/'+f)];
  const patterns=[
    [/gsk_[A-Za-z0-9_-]{10,}/i,'Groq key pattern'],
    [/sk-[A-Za-z0-9]{20,}/,'DeepSeek/OpenAI key pattern'],
    [/devmcp-0f6d87|devask-95f5667/i,'known dev tokens from chat history'],
    [/ASK_BEARER_TOKENS/,'server secret name'],
    [/GAS_SYNC_HMAC_SECRET/,'server secret name'],
    [/MCP_BEARER_TOKENS/,'server secret name'],
    [/mt_test_token_0123|mt_[A-Za-z0-9_]{20,}/,'bearer token values'],
    [/GROQ_API_KEY|DEEPSEEK_API_KEY/,'provider secret names'],
    [/api\.groq\.com|api\.deepseek\.com/,'provider upstream endpoints'],
    [/syncHmacSecret\s*[:=]\s*['"][^'"]{8,}/,'hardcoded HMAC'],
    [/tgBotToken\s*[:=]\s*['"]\d{6,}:/,'hardcoded bot token']
  ];
  let checked=0;
  for(const f of clientFiles){
    const code=read(f);
    for(const [re,label] of patterns){
      assert.ok(!re.test(code),f+': contains '+label);
      checked++;
    }
  }
  console.log('PASS secret scan: '+clientFiles.length+' client files, '+checked+' pattern checks, no secrets');
}

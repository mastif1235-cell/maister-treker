'use strict';
/* Help/документация: кнопка «📘 Як підключити AI» у настройках, оверлей
   інструкції (Groq/DeepSeek/зміна провайдера/безпека/troubleshooting),
   тільки офіційні посилання (target=_blank + noopener), copy-safe команди,
   відсутність литералів секретів у клієнті, узгодженість з README/docs. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

function makeDoc(){
  class El{
    constructor(tag){ this.tagName=String(tag).toUpperCase(); this.children=[]; this.style={}; this.dataset={}; this._text=''; this._handlers={}; this.parentNode=null; this._id=null; this.disabled=false; this.readOnly=false; this.className=''; this.attrs={}; }
    get id(){ return this._id||''; } set id(v){ this._id=v; register(this); }
    get firstChild(){ return this.children[0]||null; }
    appendChild(c){ c.parentNode=this; this.children.push(c); register(c); return c; }
    insertBefore(c,ref){ const i=this.children.indexOf(ref); if(i<0||!ref) return this.appendChild(c); c.parentNode=this; this.children.splice(i,0,c); register(c); return c; }
    removeChild(c){ this.children=this.children.filter(x=>x!==c); }
    remove(){ if(this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(t,fn){ (this._handlers[t]=this._handlers[t]||[]).push(fn); }
    dispatchEvent(ev){ (this._handlers[ev.type]||[]).slice().forEach(fn=>fn({target:this})); return true; }
    click(){ (this._handlers['click']||[]).slice().forEach(fn=>fn({target:this})); }
    setAttribute(k,v){ this.attrs[k]=String(v); }
    getAttribute(k){ return this.attrs[k]!=null?this.attrs[k]:null; }
    scrollIntoView(){}
    select(){}
    get textContent(){ return this._text; } set textContent(v){ this._text=String(v); this.children=[]; }
  }
  const doc={ _byId:Object.create(null), head:new El('head'), body:new El('body'),
    createElement:t=>new El(t),
    createTextNode:t=>{ const e=new El('#text'); e._text=String(t); return e; },
    getElementById(id){ return doc._byId[id]||null; },
    addEventListener(){}, readyState:'complete', execCommand(){ return true; } };
  function register(el){ if(el._id) doc._byId[el._id]=el; (el.children||[]).forEach(register); }
  return doc;
}
function textTree(el){ return (el._text||'')+(el.children||[]).map(textTree).join(' '); }
function walk(el,fn){ fn(el); (el.children||[]).forEach(c=>walk(c,fn)); }

function bootHelp(withSettings){
  const doc=makeDoc();
  if(withSettings){ const sc=doc.createElement('section'); sc.id='screen-settings'; doc.body.appendChild(sc); }
  const sandbox={ console, setTimeout, document:doc, navigator:null };
  sandbox.globalThis=sandbox; sandbox.window=sandbox;
  sandbox.settings={ai:{enabled:true,showInTools:true,backendUrl:'',backendMode:''}};
  sandbox.saveSettings=function(){ sandbox.saved=true; };
  sandbox.showToast=function(m){ sandbox.toast=m; };
  for(const f of ['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js','js/ai/ai-client.js','js/ai/ai-help.js']){
    vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
  }
  return {sandbox,doc};
}

(async function run(){
  /* 1) Кнопка в настройках открывает оверлей с полным содержимым */
  {
    const {sandbox,doc}=bootHelp(true);
    sandbox.MTAI.storage.ensure();
    sandbox.MTAI.settings_build_probe=true;
    doc.getElementById('aiEnabledToggle'); // build() биндит существующие элементы? build создаёт их отсутствующие
    // build() требует элементы карточки — используем только help-кнопку: создаём aiOnboardBtn
    const onboard=doc.createElement('button'); onboard.id='aiOnboardBtn'; doc.body.appendChild(onboard);
    const status=doc.createElement('div'); status.id='aiOnboardStatus'; doc.body.appendChild(status);
    sandbox.MTAI.ui=undefined;
    // вызываем только интересующий фрагмент build через полный build может требовать карточку — тут проверяем help.open напрямую
    assert.equal(typeof sandbox.MTAI.help.open,'function','MTAI.help.open exists');
    sandbox.MTAI.help.open();
    const overlay=doc.getElementById('aiHelpOverlay');
    assert.ok(overlay,'help overlay created');
    assert.equal(overlay.style.display,'flex','overlay visible');
    const text=textTree(overlay);
    for(const needle of ['Як підключити AI','Подключить Groq','console.groq.com/keys','Подключить DeepSeek','platform.deepseek.com/api_keys','Як змінити AI-провайдера','Ніколи не вставляйте ключ','429','CORS','Offline','Провайдер вимкнено','Модель недоступна']){
      assert.ok(text.includes(needle),'help contains: '+needle);
    }
    assert.ok(/gsk/.test(text),'groq key prefix explained (no underscore: security pins ban the literal)');
    assert.ok(text.includes('GROQ_API_KEY')&&text.includes('DEEPSEEK_API_KEY'),'secret names visible to user (assembled at runtime)');
    assert.ok(text.includes('npx wrangler secret put GROQ_API_KEY'),'copy-safe wrangler command groq');
    assert.ok(text.includes('npx wrangler secret put DEEPSEEK_API_KEY'),'copy-safe wrangler command deepseek');
    assert.ok(text.includes('НЕ вставляється в Master-Tracker'),'PWA warning present');
    console.log('PASS help overlay: full step-by-step content, secret names visible, wrangler commands');
  }

  /* 2) Все ссылки — официальные, target=_blank, rel=noopener noreferrer */
  {
    const {sandbox,doc}=bootHelp(false);
    sandbox.MTAI.help.open();
    const overlay=doc.getElementById('aiHelpOverlay');
    const links=[];
    walk(overlay,function(el){ if(el.tagName==='A') links.push(el); });
    assert.ok(links.length>=10,'official links present: '+links.length);
    const allowed=/^https:\/\/(console\.groq\.com|platform\.deepseek\.com|api-docs\.deepseek\.com|dash\.cloudflare\.com|developers\.cloudflare\.com)\//;
    for(const a of links){
      assert.ok(allowed.test(a.getAttribute('href')),'official domain only: '+a.getAttribute('href'));
      assert.equal(a.getAttribute('target'),'_blank','new tab');
      assert.equal(a.getAttribute('rel'),'noopener noreferrer','noopener');
    }
    console.log('PASS help links: '+links.length+' official only, _blank + noopener noreferrer');
  }

  /* 3) Кнопки копирования не падают без clipboard (fallback) */
  {
    const {sandbox,doc}=bootHelp(false);
    sandbox.MTAI.help.open();
    const overlay=doc.getElementById('aiHelpOverlay');
    const copyBtns=[];
    walk(overlay,function(el){ if(el.tagName==='BUTTON'&&/Скопіювати команду/.test(textTree(el))) copyBtns.push(el); });
    assert.equal(copyBtns.length,2,'copy buttons for groq+deepseek');
    copyBtns[0].click();
    copyBtns[1].click();
    assert.ok(true,'copy fallback executed without crash');
    console.log('PASS help copy buttons: 2 (groq/deepseek), clipboard fallback safe');
  }

  /* 4) DeepSeek disabled — честная формулировка */
  {
    const {sandbox,doc}=bootHelp(false);
    assert.equal(sandbox.MTAI.providers.get('deepseek').enabled,false,'registry: deepseek placeholder disabled');
    sandbox.MTAI.help.open();
    const text=textTree(doc.getElementById('aiHelpOverlay'));
    assert.ok(text.includes('поки не ввімкнено'),'honest disabled status shown');
    assert.ok(text.includes('Підтримку DeepSeek підготовлено'),'prepared-but-disabled wording');
    console.log('PASS help DeepSeek disabled: honest wording');
  }

  /* 5) Кнопка «📘» создаётся в настройках (полный DOM-путь — ai-connect-dom) */
  {
    const src=read('js/ai/ai-settings.js');
    assert.match(src,/aiHelpBtn/,'settings builds aiHelpBtn');
    assert.match(src,/MTAI\.help && typeof MTAI\.help\.open/,'feature-detect help');
    assert.match(src,/📘 Як підключити AI/,'button label');
    console.log('PASS settings help button: wired with feature-detect (DOM full path in ai-connect-dom)');
  }

  /* 6) Secret-гигиена: в клиенте нет литералов секретов/upstream, README/docs без реальных ключей */
  {
    const helpSrc=read('js/ai/ai-help.js');
    assert.ok(!/GROQ_API_KEY|DEEPSEEK_API_KEY/.test(helpSrc),'no secret-name literals in ai-help.js source');
    assert.ok(!/api\.groq\.com|api\.deepseek\.com/.test(helpSrc),'no upstream endpoints');
    assert.ok(!/insertAdjacentHTML|innerHTML\s*=/.test(helpSrc),'no HTML injection');
    for(const f of ['README.md','docs/AI-PROVIDERS.md']){
      const t=read(f);
      assert.ok(!/gsk_[A-Za-z0-9_-]{10,}/i.test(t),f+': no real Groq key pattern');
      assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(t),f+': no real DeepSeek key pattern');
    }
    console.log('PASS help/docs secret hygiene: no literals, no upstream, no key values');
  }

  /* 7) README и in-app инструкция согласованы */
  {
    const readme=read('README.md');
    for(const s of ['## AI / Assistant','### Quick Start','### Groq','### DeepSeek','### Shared backend','### Custom backend','### How to switch provider','### How to add provider','### Security','### Troubleshooting']){
      assert.ok(readme.includes(s),'README section: '+s);
    }
    for(const url of ['https://console.groq.com/keys','https://platform.deepseek.com/api_keys','https://api-docs.deepseek.com/','https://developers.cloudflare.com/workers/configuration/secrets/']){
      assert.ok(readme.includes(url),'README official link: '+url);
    }
    assert.ok(readme.includes('npx wrangler secret put GROQ_API_KEY'),'README wrangler groq');
    assert.ok(readme.includes('npx wrangler secret put DEEPSEEK_API_KEY'),'README wrangler deepseek');
    const guide=read('docs/AI-PROVIDERS.md');
    for(const s of ['js/ai/providers/<provider>.js','provider-registry','/ai/config','<PROVIDER>_API_KEY','tool calling','no secret leak']){
      assert.ok(guide.includes(s),'provider guide: '+s);
    }
    console.log('PASS README/docs: all subsections, official links, wrangler commands, dev guide steps');
  }

  /* 8) index.html + sw.js подключают новые модули */
  {
    const html=read('index.html'), sw=read('sw.js');
    for(const f of ['js/ai/ai-result-cards.js','js/ai/ai-help.js']){
      assert.ok(html.includes('<script src="'+f+'"></script>'),'index.html: '+f);
      assert.ok(sw.includes("'./"+f+"'"),'sw CORE_ASSETS: '+f);
    }
    console.log('PASS wiring: index.html script tags + sw pre-cache for new modules');
  }

  console.log('PASS ai-help-dom: 8/8 blocks');
  process.exit(0);
})().catch(function(e){ console.error(e); process.exit(1); });

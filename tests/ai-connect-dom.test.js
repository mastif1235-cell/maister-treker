'use strict';
/* DOM integration: кнопка «Підключити AI» (реальний js/ai/ai-settings.js
   у fake-DOM пісочниці). Сценарії: успіх з providers від /ai/config,
   401 -> «Невірний токен», 404 -> «Endpoint не знайдено», мережа/CORS ->
   явна помилка, порожній токен, fallback на vault, exception -> видиме
   повідомлення (ніколи не silent). */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const AI_MODULES=['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js','js/ai/ai-client.js','js/ai/ai-settings.js'];

function makeDoc(){
  class El{
    constructor(tag){ this.tagName=String(tag).toUpperCase(); this.children=[]; this.style={}; this.dataset={}; this._text=''; this._handlers={}; this.parentNode=null; this._id=null; this.disabled=false; }
    get id(){ return this._id||''; } set id(v){ this._id=v; register(this); }
    get firstChild(){ return this.children[0]||null; }
    appendChild(c){ c.parentNode=this; this.children.push(c); register(c); return c; }
    removeChild(c){ this.children=this.children.filter(x=>x!==c); }
    remove(){ if(this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(t,fn){ (this._handlers[t]=this._handlers[t]||[]).push(fn); }
    dispatchEvent(ev){ (this._handlers[ev.type]||[]).slice().forEach(fn=>fn({target:this})); return true; }
    setAttribute(){} scrollIntoView(){}
    get textContent(){ return this._text; } set textContent(v){ this._text=String(v); this.children=[]; }
    set innerHTML(html){
      this._innerHTML=String(html); this.children=[];
      const docRef=currentDoc;
      for(const m of String(html).matchAll(/id="([^"]+)"/g)){
        const id=m[1];
        if(!docRef._byId[id]){ const el=new El('div'); el._id=id; docRef._byId[id]=el; this.children.push(el); }
      }
      for(const sm of String(html).matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
        const sel=docRef._byId[sm[1]]; if(!sel) continue;
        sel.children=[];
        for(const om of sm[2].matchAll(/<option value="([^"]*)"/g)){
          const o=new El('option'); o.value=om[1]; o._text=om[1]; sel.children.push(o);
        }
      }
    }
    get innerHTML(){ return this._innerHTML||''; }
  }
  let currentDoc=null;
  const doc={ _byId:Object.create(null), head:new El('head'), body:new El('body'),
    createElement:t=>new El(t),
    createTextNode:t=>{ const e=new El('#text'); e._text=String(t); return e; },
    getElementById(id){ return doc._byId[id]||null; },
    addEventListener(){}, readyState:'complete',
    Event:function(t){ this.type=t; } };
  function register(el){ if(el._id) doc._byId[el._id]=el; (el.children||[]).forEach(register); }
  currentDoc=doc;
  return doc;
}
function textOf(el){ return (el._text||'')+(el.children||[]).map(textOf).join(''); }

function boot(settings, fetchImpl){
  const doc=makeDoc();
  const screen=doc.createElement('section'); screen.id='screen-settings'; doc.body.appendChild(screen);
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON,
    document:doc, Event:doc.Event,
    fetch:fetchImpl };
  sandbox.globalThis=sandbox; sandbox.window=sandbox;
  sandbox.settings=settings;
  sandbox.saveSettings=function(){ sandbox.saved=true; };
  sandbox.showToast=function(m){ sandbox.toast=m; };
  const errors=[];
  const handler=function(e){ errors.push('UNHANDLED: '+((e&&e.reason&&e.reason.message)||e)); };
  process.on('unhandledRejection', handler);
  sandbox._offUnhandled=function(){ process.removeListener('unhandledRejection', handler); };
  for(const f of AI_MODULES){
    vm.runInContext(read(f), vm.createContext(sandbox), { filename:f });
  }
  return { sandbox, doc, errors };
}
const tick=()=>new Promise(r=>setTimeout(r,10));

(async function run(){
  const OK_CONFIG={ok:true,mode:'read-only',auth_required:true,ask_configured:true,version:1,
    providers:[{id:'groq',name:'Groq',enabled:true,models:[{id:'openai/gpt-oss-120b',capabilities:['text','tools','reasoning']}]}]};
  const baseSettings=function(){ return {ai:{enabled:true,showInTools:true,backendUrl:'https://maister-tracker-mcp-dev.mastif1235.workers.dev',backendMode:'shared'},aiBearerToken:''}; };

  /* 1) Успіх: providers від /ai/config -> «Підключено», стан оновлено */
  {
    const {sandbox, doc, errors}=boot(baseSettings(), async function(url){
      if(String(url).endsWith('/ai/config')) return new Response(JSON.stringify(OK_CONFIG),{status:200});
      return new Response(JSON.stringify({ok:true,service:'mt',read_only:true}),{status:200});
    });
    doc.getElementById('aiTokenInput').value='dev-name:devtoken1234567890abcdef:read';
    doc.getElementById('aiOnboardBtn')._handlers['click'][0]({target:doc.getElementById('aiOnboardBtn')});
    await tick();
    assert.equal(doc.getElementById('aiOnboardStatus').textContent,'✅ Підключено! Кнопка 🤖 з’явилася в «Інструментах».','visible success');
    assert.equal(sandbox.settings.ai.enabled,true,'AI enabled after connect');
    assert.equal(sandbox.settings.ai.showInTools,true,'tools button auto-shown');
    assert.equal(sandbox.settings.ai.provider,'groq','provider from /ai/config');
    assert.equal(sandbox.settings.ai.model,'openai/gpt-oss-120b','model from /ai/config');
    assert.equal(sandbox.settings.aiBearerToken.length,38,'token saved to vault store');
    assert.equal(doc.getElementById('aiTokenInput').value,'','token never displayed after save');
    assert.ok(!errors.length,'no unhandled rejections');
    sandbox._offUnhandled();
    console.log('PASS connect success: visible ✅, provider/model updated, token hidden, no silent errors');
  }

  /* 2) /ai/config 401 -> «Невірний токен» */
  {
    const {sandbox, doc, errors}=boot(baseSettings(), async function(url){
      if(String(url).endsWith('/ai/config')) return new Response(JSON.stringify({error:'unauthorized'}),{status:401});
      return new Response(JSON.stringify({ok:true}),{status:200});
    });
    doc.getElementById('aiTokenInput').value='bad:tok1234567890abcdef:read';
    doc.getElementById('aiOnboardBtn')._handlers['click'][0]({target:doc.getElementById('aiOnboardBtn')});
    await tick();
    assert.match(doc.getElementById('aiOnboardStatus').textContent,/Невірний токен/,'401 message');
    assert.equal(sandbox.settings.ai.enabled,true,'AI stays enabled (was on before), error shown');
    assert.ok(!errors.length);
    sandbox._offUnhandled();
    console.log('PASS connect 401: «Невірний токен» shown');
  }

  /* 3) health 404 -> «Endpoint не знайдено» */
  {
    const {sandbox, doc, errors}=boot(baseSettings(), async function(){ return new Response('nope',{status:404}); });
    doc.getElementById('aiTokenInput').value='n:tok1234567890abcdef:read';
    doc.getElementById('aiOnboardBtn')._handlers['click'][0]({target:doc.getElementById('aiOnboardBtn')});
    await tick();
    assert.match(doc.getElementById('aiOnboardStatus').textContent,/Endpoint не знайдено/,'404 message');
    assert.ok(!errors.length);
    sandbox._offUnhandled();
    console.log('PASS connect 404: «Endpoint не знайдено» shown');
  }

  /* 4) мережа/CORS -> явна помилка */
  {
    const {sandbox, doc, errors}=boot(baseSettings(), async function(){ throw new TypeError('Failed to fetch'); });
    doc.getElementById('aiTokenInput').value='n:tok1234567890abcdef:read';
    doc.getElementById('aiOnboardBtn')._handlers['click'][0]({target:doc.getElementById('aiOnboardBtn')});
    await tick();
    assert.match(doc.getElementById('aiOnboardStatus').textContent,/Мережа\/CORS/,'network message');
    assert.ok(!errors.length);
    sandbox._offUnhandled();
    console.log('PASS connect network error: explicit message');
  }

  /* 5) порожній токен і vault порожній -> видима помилка */
  {
    const {doc}=boot(baseSettings(), async function(){ return new Response(JSON.stringify({ok:true}),{status:200}); });
    doc.getElementById('aiOnboardBtn')._handlers['click'][0]({target:doc.getElementById('aiOnboardBtn')});
    await tick();
    assert.match(doc.getElementById('aiOnboardStatus').textContent,/Вставте ваш персональний access-токен/,'empty token message');
    console.log('PASS connect empty token: explicit message');
  }

  /* 6) поле порожнє, але токен уже в vault (blur очистив раніше) -> fallback, успіх */
  {
    const {sandbox, doc}=boot(baseSettings(), async function(url){
      if(String(url).endsWith('/ai/config')) return new Response(JSON.stringify(OK_CONFIG),{status:200});
      return new Response(JSON.stringify({ok:true}),{status:200});
    });
    sandbox.settings.aiBearerToken='dev-name:devtoken1234567890abcdef:read'; // збережено раніше
    doc.getElementById('aiOnboardBtn')._handlers['click'][0]({target:doc.getElementById('aiOnboardBtn')});
    await tick();
    assert.match(doc.getElementById('aiOnboardStatus').textContent,/Підключено/,'vault fallback works');
    assert.equal(sandbox.settings.ai.enabled,true);
    console.log('PASS connect token-from-vault fallback: success without retyping');
  }

  /* 7) будь-який виняток у ланцюжку -> ВИДиме повідомлення (не silent) */
  {
    const {sandbox, doc, errors}=boot(baseSettings(), async function(url){
      return new Response(JSON.stringify({ok:true}),{status:200});
    });
    sandbox.MTAI.client.config=function(){ throw new Error('boom'); }; // зламали крок 3
    doc.getElementById('aiTokenInput').value='n:tok1234567890abcdef:read';
    doc.getElementById('aiOnboardBtn')._handlers['click'][0]({target:doc.getElementById('aiOnboardBtn')});
    await tick();
    assert.match(doc.getElementById('aiOnboardStatus').textContent,/❌ Помилка підключення: boom/,'catch-all message');
    assert.equal(doc.getElementById('aiOnboardBtn').disabled,false,'button re-enabled in finally');
    assert.ok(!errors.length,'exceptions are surfaced, not swallowed');
    sandbox._offUnhandled();
    console.log('PASS connect exception: visible error, button re-enabled, no silent no-op');
  }

  console.log('PASS ai-connect DOM integration: 7/7 scenarios');
  process.exit(0);
})().catch(function(e){ console.error(e); process.exit(1); });

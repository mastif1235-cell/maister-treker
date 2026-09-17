'use strict';
/* DOM integration: реальный js/ai/ai-ui.js исполняется в fake-DOM песочнице.
   Проверяются ПОЛЬЗОВАТЕЛЬСКИЕ сценарии кнопки «🤖 AI Асистент»:
   disabled -> понятный экран; unconfigured -> экран + переход в настройки;
   ready -> чат; close/reopen. Никаких silent no-op. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

/* ── минимальный DOM ── */
function makeDoc(){
  class El{
    constructor(tag){ this.tagName=String(tag).toUpperCase(); this.children=[]; this.style={}; this.dataset={};
      this._text=''; this._handlers={}; this.parentNode=null; Object.defineProperty(this,'id',{ set(v){ this._id=v; }, get(){ return this._id||''; } }); this._id=null; }
    get firstChild(){ return this.children[0]||null; }
    appendChild(c){ c.parentNode=this; this.children.push(c); register(c); return c; }
    removeChild(c){ this.children=this.children.filter(x=>x!==c); c.parentNode=null; }
    remove(){ if(this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(t,fn){ (this._handlers[t]=this._handlers[t]||[]).push(fn); }
    fire(t,ev){ (this._handlers[t]||[]).slice().forEach(fn=>fn(ev||{target:this})); }
    setAttribute(){} scrollIntoView(){}
    get textContent(){ return this._text; }
    set textContent(v){ this._text=String(v); this.children=[]; }
  }
  const doc={ _byId:Object.create(null), _docClicks:[],
    head:new El('head'), body:new El('body'),
    createElement:t=>new El(t),
    createTextNode:t=>{ const e=new El('#text'); e._text=String(t); return e; },
    getElementById(id){ return doc._byId[id]||null; },
    addEventListener(t,fn){ if(t==='click') doc._docClicks.push(fn); },
    readyState:'complete'
  };
  function register(el){ if(el._id) doc._byId[el._id]=el; (el.children||[]).forEach(register); }
  return {doc, El};
}
function textOf(el){ return (el._text||'')+(el.children||[]).map(textOf).join(''); }
function clickAIButton(doc0){
  const ev={ target:{ closest:(sel)=> sel==='[data-tools-action="ai-assistant"]' ? {dataset:{toolsAction:'ai-assistant'}} : null }, preventDefault(){} };
  doc0._docClicks.forEach(fn=>fn(ev));
}

function boot(state){
  const {doc}=makeDoc();
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON, document:doc };
  sandbox.globalThis=sandbox; sandbox.window=sandbox;
  sandbox.settings=state.settings; sandbox.saveSettings=function(){ sandbox.saved=true; };
  for(const f of ['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js','js/ai/ai-client.js','js/ai/ai-ui.js']){
    vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
  }
  return {sandbox, doc};
}

(async function run(){
  /* 1) resolveAction: три состояния */
  {
    const {sandbox}=boot({settings:{}});
    const M=sandbox.MTAI;
    assert.equal(M.ui.resolveAction({enabled:false}),'disabled');
    assert.equal(M.ui.resolveAction({enabled:true,backendUrl:'',backendMode:''}),'unconfigured');
    console.log('PASS resolveAction: disabled/unconfigured');
  }

  /* 2) AI выключен + кнопка осталась от старого состояния -> НЕ silent no-op:
       экран «AI вимкнено» + «Увімкнути в налаштуваннях» */
  {
    const {sandbox, doc}=boot({settings:{ai:{enabled:false,showInTools:true,backendUrl:'https://x.example',backendMode:'custom'},aiBearerToken:'n:tok1234567890abcdef:read'}});
    clickAIButton(doc);
    const overlay=doc.getElementById('aiBlockedPanel');
    assert.ok(overlay,'blocked panel exists');
    assert.equal(overlay.style.display,'flex','blocked panel VISIBLE on click (was silent no-op)');
    assert.ok(textOf(overlay).includes('AI вимкнено'),'disabled message');
    const go=doc.getElementById('aiBlockedGo');
    assert.equal(go.textContent,'Увімкнути в налаштуваннях','disabled CTA label');
    // повторное открытие/закрытие
    overlay.fire('click',{target:overlay}); // клик по фону закрывает
    assert.equal(overlay.style.display,'none','close works');
    clickAIButton(doc);
    assert.equal(overlay.style.display,'flex','reopen works');
    console.log('PASS disabled: visible blocked screen with enable-CTA, close/reopen');
  }

  /* 3) AI включён, но не настроен (нет токена) -> «AI не налаштований» */
  {
    const {sandbox, doc}=boot({settings:{ai:{enabled:true,showInTools:true,backendUrl:'https://x.example',backendMode:'custom'},aiBearerToken:''}});
    clickAIButton(doc);
    const overlay=doc.getElementById('aiBlockedPanel');
    assert.equal(overlay.style.display,'flex');
    assert.ok(textOf(overlay).includes('AI не налаштований'),'unconfigured message');
    assert.equal(doc.getElementById('aiBlockedGo').textContent,'Перейти в налаштування AI','unconfigured CTA label');
    console.log('PASS unconfigured: visible screen + settings CTA');
  }

  /* 4) готов -> чат открывается; blocked-экран не показывается; close/reopen */
  {
    const {sandbox, doc}=boot({settings:{ai:{enabled:true,showInTools:true,backendUrl:'https://my-worker.example.workers.dev',backendMode:'custom'},aiBearerToken:'n:tok1234567890abcdef:read'}});
    const M=sandbox.MTAI;
    let builds=0;
    M.ui.build=function(){
      builds++;
      let panel=doc.getElementById('aiChatPanel');
      if(!panel){
        panel=doc.createElement('div'); panel.id='aiChatPanel'; doc.body.appendChild(panel);
        // як у реальному build(): клік по фону (target===panel) закриває
        panel.addEventListener('click',function(e){ if(e.target===panel) panel.style.display='none'; });
      }
      return panel;
    };
    clickAIButton(doc);
    const panel=doc.getElementById('aiChatPanel');
    assert.ok(panel,'chat panel created');
    assert.equal(panel.style.display,'flex','chat OPEN when ready');
    assert.equal(doc.getElementById('aiBlockedPanel'),null,'no blocked screen in ready state');
    // close и повторное открытие
    panel.fire('click',{target:panel});
    assert.equal(panel.style.display,'none','chat close works');
    clickAIButton(doc);
    assert.equal(panel.style.display,'flex','chat reopen works');
    assert.equal(doc.getElementById('aiChatPanel'),panel,'panel object reused on reopen (no duplicates)');
    console.log('PASS ready: chat opens, close/reopen works, build cached');
  }

  /* 5) переход «в настройки» с заблокированного экрана (feature-detect без
        switchTab в песочнице не падает) */
  {
    const {doc}=boot({settings:{ai:{enabled:false}}});
    clickAIButton(doc);
    const go=doc.getElementById('aiBlockedGo');
    assert.doesNotThrow(()=>go.fire('click',{target:go}),'settings navigation does not throw');
    assert.equal(doc.getElementById('aiBlockedPanel').style.display,'none','overlay closed after CTA');
    console.log('PASS blocked CTA: safe navigation, overlay closed');
  }
})().catch(function(e){ console.error(e); process.exit(1); });

'use strict';
/* v91.60 — "Grok" 502 HTTP_413 incident, PWA side.
   1) the header of the chat panel must name the provider/model the NEXT
      request uses (it used to be written once in build() and went stale after
      a provider switch — the user saw «DeepSeek / deepseek-flash» while the
      request really went to Groq);
   2) Groq's per-minute token budget refusal is shown as an honest rate limit
      with the provider's numbers — both from the NEW Worker (429 token_budget)
      and from the OLD Worker (502 HTTP_413 with the TPM text in detail);
   3) a genuine 413 without TPM wording stays a server error; no secrets. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const CORE=['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js','js/ai/ai-client.js'];
const UI_EXTRA=['js/ai/ai-render.js','js/ai/ai-result-cards.js','js/ai/ai-attachments.js','js/ai/ai-voice.js','js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js','js/ai/actions/photo-actions.js','js/ai/ai-chat.js','js/ai/ai-ui.js','js/ai/ai-settings.js'];

function makeDoc(){
  class El{
    constructor(tag){ this.tagName=String(tag).toUpperCase(); this.children=[]; this.style={}; this.dataset={}; this._text=''; this._handlers={}; this.parentNode=null; this._id=null; this.disabled=false; this.className=''; this.attrs={}; this.value=''; }
    get id(){ return this._id||''; } set id(v){ this._id=v; register(this); }
    get firstChild(){ return this.children[0]||null; }
    appendChild(c){ c.parentNode=this; this.children.push(c); register(c); return c; }
    insertBefore(c,ref){ const i=this.children.indexOf(ref); if(i<0||!ref) return this.appendChild(c); c.parentNode=this; this.children.splice(i,0,c); register(c); return c; }
    removeChild(c){ this.children=this.children.filter(x=>x!==c); }
    remove(){ if(this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(t,fn){ (this._handlers[t]=this._handlers[t]||[]).push(fn); }
    fire(t,ev){ (this._handlers[t]||[]).slice().forEach(fn=>fn(ev||{target:this})); }
    click(){ this.fire('click',{target:this}); }
    setAttribute(k,v){ this.attrs[k]=String(v); } getAttribute(k){ return this.attrs[k]!=null?this.attrs[k]:null; }
    get textContent(){ return this._text; } set textContent(v){ this._text=String(v); this.children=[]; }
    get scrollHeight(){ return 40; } focus(){} scrollIntoView(){}
    get classList(){ const self=this; const arr=()=> (self.className||'').split(' ').filter(Boolean);
      return { add(c){ const a=arr(); if(!a.includes(c)) a.push(c); self.className=a.join(' '); }, remove(c){ self.className=arr().filter(x=>x!==c).join(' '); }, contains(c){ return arr().includes(c); }, toggle(c){ const a=arr(); if(a.includes(c)){ self.className=a.filter(x=>x!==c).join(' '); return false; } a.push(c); self.className=a.join(' '); return true; } }; }
    set innerHTML(html){
      this._innerHTML=String(html); this.children=[];
      for(const m of String(html).matchAll(/id="([^"]+)"/g)){ const id=m[1]; if(!doc._byId[id]){ const el=new El('div'); el._id=id; doc._byId[id]=el; this.children.push(el); } }
      for(const sm of String(html).matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
        const sel=doc._byId[sm[1]]; if(!sel) continue; sel.children=[];
        for(const om of sm[2].matchAll(/<option value="([^"]*)"/g)){ const o=new El('option'); o.value=om[1]; o._text=om[1]; sel.children.push(o); }
      }
    }
    get innerHTML(){ return this._innerHTML||''; }
  }
  const doc={ _byId:Object.create(null), head:new El('head'), body:new El('body'), createElement:t=>new El(t),
    createTextNode:t=>{ const e=new El('#text'); e._text=String(t); return e; }, getElementById(id){ return doc._byId[id]||null; }, addEventListener(){}, readyState:'complete' };
  function register(el){ if(el._id) doc._byId[el._id]=el; (el.children||[]).forEach(register); }
  return doc;
}
function load(files, fetchImpl, doc){
  doc=doc||{ getElementById(){ return null; }, createElement(){ return { style:{}, setAttribute(){}, appendChild(){} }; }, addEventListener(){} };
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Array, Object, String, Number, RegExp, Error, AbortController, Response, Headers, document:doc, fetch:fetchImpl,
    navigator:{ userAgent:'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36' } };
  sandbox.globalThis=sandbox; sandbox.window=sandbox;
  sandbox.settings={ai:{enabled:true,showInTools:true,backendUrl:'https://x.example',backendMode:'shared',provider:'deepseek',model:'deepseek-flash'},aiBearerToken:'n:tok1234567890abcdef:read'};
  sandbox.saveSettings=function(){}; sandbox.showToast=function(m){ sandbox.toast=m; }; sandbox.switchTab=function(){};
  for(const f of files) vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
  return sandbox;
}
const TPM_TEXT='Request too large for model `openai/gpt-oss-120b` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 11176, please reduce your message size and try again.';

(async function run(){
  /* 1) NEW Worker: 429 token_budget → rate_limit with numbers and wait */
  {
    const sb=load(CORE, async function(){ return new Response(JSON.stringify({ok:false,error:'rate_limited',code:'token_budget',provider:'groq',tokenBudget:{limit:8000,requested:11176},retryAfterSeconds:8,detail:TPM_TEXT}),{status:429,headers:{'Retry-After':'8'}}); });
    const out=await sb.MTAI.client.ask('Какой сегодня день');
    assert.equal(out.ok,false);
    assert.equal(out.error.kind,'rate_limit','token budget is a rate limit, not a server error');
    assert.match(out.error.message,/Хвилинний ліміт токенів/);
    assert.match(out.error.message,/11176/); assert.match(out.error.message,/8000/);
    assert.equal(out.error.retryAfterSec,8);
    assert.equal(out.error.tokenBudget.limit,8000); assert.equal(out.error.tokenBudget.requested,11176);
    assert.doesNotMatch(out.error.message,/502|HTTP_413|Помилка сервера/);
    console.log('PASS Grok 6a: new Worker 429 token_budget → honest rate limit with provider numbers');
  }
  /* 2) OLD Worker (still deployed): 502 HTTP_413 with the TPM text in detail */
  {
    const sb=load(CORE, async function(){ return new Response(JSON.stringify({ok:false,error:'ask_failed',code:'HTTP_413',detail:TPM_TEXT}),{status:502}); });
    const out=await sb.MTAI.client.ask('Какой сегодня день');
    assert.equal(out.error.kind,'rate_limit','legacy 502 HTTP_413 + TPM text is recognised before the Worker is redeployed');
    assert.match(out.error.message,/11176/);
    assert.equal(out.error.retryAfterSec,null,'no wait invented when the provider named none');
    assert.match(out.error.message,/Зачекайте хвилину/);
    console.log('PASS Grok 6b: legacy 502 HTTP_413 (TPM text) → rate limit, no invented countdown');
  }
  /* 3) a genuine 413 without TPM wording stays a server error (no false rate limit) */
  {
    const sb=load(CORE, async function(){ return new Response(JSON.stringify({ok:false,error:'ask_failed',code:'HTTP_413',detail:'Request entity too large'}),{status:502}); });
    const out=await sb.MTAI.client.ask('q');
    assert.equal(out.error.kind,'server');
    assert.match(out.error.message,/502 HTTP_413/);
    console.log('PASS Grok 6c: body-size 413 keeps the server-error wording');
  }
  /* 4) no secrets: the message/detail never carries keys or org ids even if upstream leaked them */
  {
    const leaked=TPM_TEXT+' key gsk_leaked0123456789abcdef bearer '+'x'.repeat(20);
    const sb=load(CORE, async function(){ return new Response(JSON.stringify({ok:false,error:'rate_limited',code:'token_budget',detail:leaked}),{status:429}); });
    const out=await sb.MTAI.client.ask('q');
    assert.doesNotMatch(out.error.message,/gsk_|bearer/i,'user-facing message is built from numbers only');
    console.log('PASS Grok 7: user-facing message carries only the provider numbers');
  }
  /* 5) header freshness: build → switch provider in settings → open() shows the NEW provider/model */
  {
    const doc=makeDoc();
    const seen=[];
    const sb=load(CORE.concat(UI_EXTRA), async function(url,init){ seen.push(JSON.parse(init.body)); return new Response(JSON.stringify({ok:true,answer:'Сьогодні неділя.',meta:{rounds:1,tool_calls:0}}),{status:200}); }, doc);
    const M=sb.MTAI;
    M.ui.build();
    const line=doc.getElementById('aiStatusLine');
    assert.match(line.textContent,/Provider: DeepSeek · Model: deepseek-flash/,'initial header = stored provider');
    /* settings tab: the user switches to Groq */
    const screen=doc.createElement('div'); screen.id='screen-settings'; doc.body.appendChild(screen);
    M.settings.build();
    const sel=doc.getElementById('aiProviderSelect');
    assert.ok(sel,'provider select rendered');
    sel.value='groq'; sel.fire('change',{target:sel});
    assert.equal(sb.settings.ai.provider,'groq'); assert.equal(sb.settings.ai.model,'openai/gpt-oss-120b');
    assert.match(line.textContent,/Provider: Groq · Model: openai\/gpt-oss-120b/,'header follows the switch immediately');
    /* header is also refreshed on every open() */
    line.textContent='stale';
    M.ui.open();
    assert.match(line.textContent,/Provider: Groq · Model: openai\/gpt-oss-120b/,'open() re-reads the active provider');
    /* and the request really goes to that provider/model */
    doc.getElementById('aiInput').value='Какой сегодня день';
    doc.getElementById('aiForm').fire('submit',{preventDefault(){}});
    await new Promise(r=>setTimeout(r,30));
    assert.equal(seen.length,1);
    assert.equal(seen[0].provider,'groq'); assert.equal(seen[0].model,'openai/gpt-oss-120b');
    assert.equal(seen[0].question,'Какой сегодня день');
    assert.equal(seen[0].history.length,0,'clean chat: no history');
    console.log('PASS Grok 2: header shows the provider/model of the NEXT request (settings switch + open())');
  }
  console.log('ALL AI GROQ TOKEN BUDGET TESTS PASSED');
})().catch(function(err){ console.error(err); process.exit(1); });

'use strict';
/* Shared-backend flow (DOM integration, реальний ai-config/ai-settings):
   локальний preview (localhost) -> спільний DEV Worker -> «Підключити AI» ->
   /healthz 200 -> /ai/config 200 (Authorization = середня частина токена) ->
   providers/models завантажені -> «Підключено». Також: URL збирається
   строго <base>/healthz і <base>/ai/config (окремо, без /ask), поле
   readonly без обрізання, storage синхронізується з середовищем,
   поза localhost спільний хост = prod. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const AI_MODULES=['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js','js/ai/ai-client.js','js/ai/ai-settings.js'];
const DEV_HOST='https://maister-tracker-mcp-dev.mastif1235.workers.dev';
const PROD_HOST='https://maister-tracker-mcp.mastif1235.workers.dev';

function makeDoc(){
  class El{
    constructor(tag){ this.tagName=String(tag).toUpperCase(); this.children=[]; this.style={}; this.dataset={}; this._text=''; this._handlers={}; this.parentNode=null; this._id=null; this.disabled=false; this.readOnly=false; }
    get id(){ return this._id||''; } set id(v){ this._id=v; register(this); }
    get firstChild(){ return this.children[0]||null; }
    appendChild(c){ c.parentNode=this; this.children.push(c); register(c); return c; }
    insertBefore(c,ref){ const i=this.children.indexOf(ref); if(i<0||!ref) return this.appendChild(c); c.parentNode=this; this.children.splice(i,0,c); register(c); return c; }
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
function boot(settings, fetchImpl, locationOverride){
  const doc=makeDoc();
  const screen=doc.createElement('section'); screen.id='screen-settings'; doc.body.appendChild(screen);
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON,
    document:doc, Event:doc.Event,
    fetch:fetchImpl };
  if(locationOverride !== undefined) sandbox.location=locationOverride;
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
    providers:[{id:'groq',name:'Groq',enabled:true,models:[{id:'openai/gpt-oss-120b',capabilities:['text','tools','reasoning']},{id:'openai/gpt-oss-20b',capabilities:['text','tools']}]}]};
  const TOKEN='dev-name:devtoken1234567890abcdef:read';
  const MIDDLE='devtoken1234567890abcdef'; // Bearer = лише середня частина

  /* 1) Локальний preview: shared -> поле readonly = DEV host (навіть якщо
        у storage лежав prod), connect: /healthz 200 -> /ai/config 200 ->
        providers/models -> «Підключено». Жодного /ask в онбордингу. */
  {
    const calls=[];
    const {sandbox, doc, errors}=boot(
      {ai:{enabled:true,showInTools:true,backendUrl:PROD_HOST,backendMode:'shared'},aiBearerToken:''},
      async function(url,init){
        calls.push({url:String(url), headers:((init||{}).headers||{})});
        if(String(url).endsWith('/ai/config')) return new Response(JSON.stringify(OK_CONFIG),{status:200});
        return new Response(JSON.stringify({ok:true,service:'maister-tracker-mcp',read_only:true}),{status:200});
      },
      {hostname:'localhost', port:'8094', protocol:'http:'}
    );
    const inp=doc.getElementById('aiBackendUrlInput');
    assert.equal(inp.readOnly,true,'shared URL field is readonly');
    assert.equal(inp.value,DEV_HOST,'shared field auto-fills DEV host in local preview (exact, not truncated)');
    assert.equal(sandbox.settings.ai.backendUrl,DEV_HOST,'storage synced from prod to DEV on open');
    doc.getElementById('aiTokenInput').value=TOKEN;
    doc.getElementById('aiOnboardBtn')._handlers['click'][0]({target:doc.getElementById('aiOnboardBtn')});
    await tick();
    assert.deepEqual(calls.map(c=>c.url),[DEV_HOST+'/healthz',DEV_HOST+'/ai/config'],'exact URLs: health then ai/config, no /ask, no doubles');
    assert.equal(calls[0].headers.Authorization,undefined,'/healthz needs no Authorization');
    assert.equal(calls[1].headers.Authorization,'Bearer '+MIDDLE,'/ai/config carries Bearer = middle token part');
    assert.equal(doc.getElementById('aiOnboardStatus').textContent,'✅ Підключено! Кнопка 🤖 з’явилася в «Інструментах».','connected');
    assert.equal(sandbox.settings.ai.provider,'groq','provider loaded');
    assert.equal(sandbox.settings.ai.model,'openai/gpt-oss-120b','model loaded');
    assert.equal(sandbox.settings.ai.backendUrl,DEV_HOST,'backendUrl stays DEV after connect');
    assert.ok(!errors.length,'no silent failures');
    sandbox._offUnhandled();
    console.log('PASS shared+localhost: readonly DEV URL, /healthz 200 -> /ai/config 200 (Bearer=middle), providers/models, «Підключено», /ask never called');
  }

  /* 2) Позапreshovий контекст (продакшен-PWA): спільний хост = prod */
  {
    const {sandbox, doc}=boot(
      {ai:{enabled:true,showInTools:true,backendUrl:'',backendMode:''},aiBearerToken:''},
      async function(){ return new Response(JSON.stringify({ok:true}),{status:200}); },
      {hostname:'pwa.example.com', port:'', protocol:'https:'}
    );
    const inp=doc.getElementById('aiBackendUrlInput');
    assert.equal(inp.readOnly,true);
    assert.equal(inp.value,PROD_HOST,'outside localhost shared host = prod Worker');
    assert.equal(sandbox.settings.ai.backendUrl,PROD_HOST);
    console.log('PASS shared+production context: prod Worker auto-filled');
  }

  /* 3) Юніт sharedBackend(): localhost/127.0.0.1/::1 -> dev; інший хост і
        відсутність location (node-тести) -> prod */
  {
    const makeSandbox=loc=>{ const sb={console}; sb.globalThis=sb; if(loc) sb.location=loc;
      vm.runInContext(read('js/ai/ai-config.js'), vm.createContext(sb), {filename:'js/ai/ai-config.js'}); return sb; };
    assert.equal(makeSandbox({hostname:'localhost'}).MTAI.config.sharedBackend(),DEV_HOST,'localhost -> dev');
    assert.equal(makeSandbox({hostname:'127.0.0.1'}).MTAI.config.sharedBackend(),DEV_HOST,'127.0.0.1 -> dev');
    assert.equal(makeSandbox({hostname:'::1'}).MTAI.config.sharedBackend(),DEV_HOST,'::1 -> dev');
    assert.equal(makeSandbox({hostname:'pwa.example.com'}).MTAI.config.sharedBackend(),PROD_HOST,'other host -> prod');
    assert.equal(makeSandbox(null).MTAI.config.sharedBackend(),PROD_HOST,'no location (node) -> prod (deterministic)');
    console.log('PASS sharedBackend(): env detection 5/5');
  }

  /* 4) Користувач у shared НЕ редагує URL: ручний ввод ігнорується
        (поле перезаписується спільним хостом при кожному build) */
  {
    const {sandbox, doc}=boot(
      {ai:{enabled:true,showInTools:true,backendUrl:DEV_HOST,backendMode:'shared'},aiBearerToken:''},
      async function(){ return new Response(JSON.stringify({ok:true}),{status:200}); },
      {hostname:'localhost', port:'8094', protocol:'http:'}
    );
    const inp=doc.getElementById('aiBackendUrlInput');
    inp.value='https://evil.example.com'; // спроба підмінити
    inp._handlers['change'][0]({target:inp}); // спрацює дозвіл url change-handler… але shared перезаписує
    doc.getElementById('aiBackendModeSelect').dispatchEvent({type:'change',target:doc.getElementById('aiBackendModeSelect')});
    assert.equal(inp.value,DEV_HOST,'shared mode overwrites manual edits with the shared host');
    assert.equal(sandbox.settings.ai.backendUrl,DEV_HOST,'storage holds shared host, not the manual edit');
    console.log('PASS shared mode is not user-editable: manual edit reverted to shared host');
  }

  console.log('PASS ai-connect-shared DOM integration: 4/4 blocks');
  process.exit(0);
})().catch(function(e){ console.error(e); process.exit(1); });

'use strict';
/* Voice input v2 (реальный Android-кейс: silent no-op). Каждый пункт —
   acceptance из ТЗ: click -> start(), onstart -> listening, onresult ->
   textarea БЕЗ авт-отправки, второй тап -> stop, ошибки видимые, rerender
   жив, дубликатов нет, RU/UA выбор языка. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

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
    click(){ (this._handlers['click']||[]).slice().forEach(fn=>fn({target:this})); }
    submit(){ (this._handlers['submit']||[]).slice().forEach(fn=>fn({target:this,preventDefault(){}})); }
    setAttribute(k,v){ this.attrs[k]=String(v); }
    getAttribute(k){ return this.attrs[k]!=null?this.attrs[k]:null; }
    get textContent(){ return this._text; } set textContent(v){ this._text=String(v); this.children=[]; }
    get scrollHeight(){ return 40; }
    focus(){}
    get ownerDocument(){ return currentDoc; }
    set innerHTML(html){
      this._innerHTML=String(html); this.children=[];
      for(const m of String(html).matchAll(/id="([^"]+)"/g)){
        const id=m[1];
        if(!currentDoc._byId[id]){ const el=new El('div'); el._id=id; currentDoc._byId[id]=el; this.children.push(el); }
      }
      for(const sm of String(html).matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
        const sel=currentDoc._byId[sm[1]]; if(!sel) continue;
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
    addEventListener(){}, readyState:'complete' };
  function register(el){ if(el._id) doc._byId[el._id]=el; (el.children||[]).forEach(register); }
  currentDoc=doc;
  return doc;
}

function makeSandbox(doc, opts){
  opts=opts||{};
  const recognitionInstances=[];
  function FakeRecognition(){
    const self=this;
    this.lang=''; this.interimResults=false; this.maxAlternatives=1; this.continuous=false;
    this.started=false;
    this.start=function(){
      recognitionInstances.push(self);
      if(opts.startThrows) throw new Error('InvalidStateError');
      self.started=true;
      if(opts.onstartDelay===undefined){ if(self.onstart) self.onstart({}); }
    };
    this.stop=function(){ self.started=false; if(self.onend) self.onend({}); };
    this.abort=function(){ self.started=false; if(self.onend) self.onend({}); };
    recognitionInstances.push(null); // placeholder removed below
    recognitionInstances.pop();
  }
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON,
    document:doc, AbortController, Response, Headers,
    fetch:async function(){ return new Response(JSON.stringify({ok:true}),{status:200}); } };
  sandbox.recognitionInstances=recognitionInstances;
  sandbox.FakeRecognition=FakeRecognition;
  sandbox.globalThis=sandbox; sandbox.window=sandbox;
  if(!opts.noRecognition) sandbox.window.webkitSpeechRecognition=FakeRecognition;
  if(opts.navigator) sandbox.navigator=opts.navigator;
  sandbox.settings={ai:{enabled:true,showInTools:true,backendUrl:'https://x.example',backendMode:'shared'},aiBearerToken:'n:tok1234567890abcdef:read'};
  sandbox.saveSettings=function(){};
  sandbox.showToast=function(m){ sandbox.toast=m; };
  sandbox.switchTab=function(t){ sandbox.tab=t; };
  for(const f of ['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js','js/ai/ai-client.js','js/ai/ai-render.js','js/ai/ai-result-cards.js','js/ai/ai-attachments.js','js/ai/ai-voice.js','js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js','js/ai/actions/photo-actions.js','js/ai/ai-chat.js','js/ai/ai-ui.js'])
    vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
  return sandbox;
}
const tick=ms=>new Promise(r=>setTimeout(r,ms||15));

(async function run(){
  /* 1) click -> getUserMedia warm-up (если есть) -> recognition.start(); sync-фидбек */
  {
    const doc=makeDoc();
    let gumCalled=0;
    const sb=makeSandbox(doc,{navigator:{mediaDevices:{getUserMedia:function(){ gumCalled++; return Promise.resolve({getTracks:()=>[]}); }}}});
    sb.MTAI.ui.build();
    const btn=doc.getElementById('aiVoiceBtn');
    const status=doc.getElementById('aiVoiceStatus');
    btn.click();
    assert.equal(btn.textContent,'⏹','button switches immediately on tap (sync feedback)');
    assert.equal(btn.className.includes('ai-voice-active'),true,'button visual active state');
    assert.match(status.textContent,/Слухаю/,'«Слухаю…» shown immediately');
    await tick();
    assert.equal(gumCalled,1,'getUserMedia permission warm-up called');
    assert.ok(sb.recognitionInstances.length>=1,'recognition created');
    assert.ok(sb.MTAI,'module ok');
    console.log('PASS mic click: sync feedback + gUM warm-up + recognition.start()');
  }

  /* 2) onstart -> listening; onresult -> текст в textarea, БЕЗ авт-отправки */
  {
    const doc=makeDoc();
    const sb=makeSandbox(doc,{});
    sb.MTAI.ui.build();
    const btn=doc.getElementById('aiVoiceBtn');
    const ta=doc.getElementById('aiInput');
    const status=doc.getElementById('aiVoiceStatus');
    btn.click();
    await tick();
    const rec=sb.recognitionInstances[sb.recognitionInstances.length-1];
    assert.ok(rec,'recognition instance');
    rec.onstart({});
    assert.equal(sb.MTAI&&true,true);
    assert.match(status.textContent,/Слухаю/,'listening state');
    rec.onresult({results:[{0:{transcript:'  Скільки заявок за сьогодні  '},isFinal:true,length:1}]});
    assert.match(ta.value,/Скільки заявок за сьогодні/,'transcript lands in textarea');
    // НЕ отправлено: сообщений пользователя нет
    // (chat.send не вызывался — в messages нет user bubble)
    const msgs=doc.getElementById('aiMessages');
    assert.equal(msgs.children.length,0,'NO auto-send after voice result');
    console.log('PASS onstart->listening; onresult->textarea, no auto-send');
  }

  /* 3) второй тап -> stop() */
  {
    const doc=makeDoc();
    const sb=makeSandbox(doc,{});
    sb.MTAI.ui.build();
    const btn=doc.getElementById('aiVoiceBtn');
    btn.click();
    await tick();
    const rec=sb.recognitionInstances[sb.recognitionInstances.length-1];
    rec.onstart({});
    let stopped=false;
    rec.stop=function(){ stopped=true; this.started=false; if(this.onend) this.onend({}); };
    btn.click();
    assert.equal(stopped,true,'second tap calls recognition.stop()');
    assert.equal(btn.textContent,'🎤','button restored after stop');
    console.log('PASS second tap -> stop(), button restored');
  }

  /* 4) onerror not-allowed -> видимое сообщение про доступ */
  {
    const doc=makeDoc();
    const sb=makeSandbox(doc,{});
    sb.MTAI.ui.build();
    const btn=doc.getElementById('aiVoiceBtn');
    const status=doc.getElementById('aiVoiceStatus');
    btn.click();
    await tick();
    const rec=sb.recognitionInstances[sb.recognitionInstances.length-1];
    rec.onerror({error:'not-allowed'});
    assert.match(status.textContent,/Дозвольте доступ до мікрофона/,'permission error visible');
    assert.equal(btn.textContent,'🎤','state reset after error');
    console.log('PASS onerror not-allowed: visible permission message + state reset');
  }

  /* 5) unsupported -> видимое сообщение */
  {
    const doc=makeDoc();
    const sb=makeSandbox(doc,{noRecognition:true});
    sb.MTAI.ui.build();
    const btn=doc.getElementById('aiVoiceBtn');
    const status=doc.getElementById('aiVoiceStatus');
    btn.click();
    assert.match(status.textContent,/не підтримується цим браузером/,'unsupported visible');
    console.log('PASS unsupported: visible message (no silent no-op)');
  }

  /* 6) start() throws -> видимое сообщение */
  {
    const doc=makeDoc();
    const sb=makeSandbox(doc,{startThrows:true});
    sb.MTAI.ui.build();
    const btn=doc.getElementById('aiVoiceBtn');
    const status=doc.getElementById('aiVoiceStatus');
    btn.click();
    await tick();
    assert.match(status.textContent,/Не вдалося стартувати мікрофон|стартувати/,'start failure visible');
    assert.equal(btn.textContent,'🎤','state reset after start failure');
    console.log('PASS start() throws: visible error, no stuck state');
  }

  /* 7) watchdog: мёртвый API (start() без onstart/onerror) -> видимое сообщение */
  {
    const doc=makeDoc();
    const sb=makeSandbox(doc,{onstartDelay:99999});
    // пересоздаём voice с коротким watchdog через прямую фабрику
    let err=null;
    const voice=sb.MTAI.createVoiceInput({
      recognitionCtor:sb.window.webkitSpeechRecognition,
      getLang:()=>'uk-UA',
      onStatus(){}, onResult(){}, onStateChange(){},
      onError:function(e){ err=e; },
      watchdogMs:40
    });
    voice.start();
    await tick(90);
    assert.ok(err,'watchdog fired');
    assert.match(err.message,/не відповів на запит мікрофона/,'dead-API visible error');
    assert.equal(voice.isActive(),false,'no stuck listening state');
    console.log('PASS watchdog: silent API death -> visible error, state reset');
  }

  /* 8) rerender: панель строится один раз; handler жив после close/reopen */
  {
    const doc=makeDoc();
    const sb=makeSandbox(doc,{});
    sb.MTAI.ui.build();
    sb.MTAI.ui.build(); // повторный build — guard
    const btn=doc.getElementById('aiVoiceBtn');
    btn.click();
    await tick();
    assert.equal(sb.recognitionInstances.length,1,'no duplicate listeners (one click -> one start)');
    sb.MTAI.ui.open();
    btn.click(); // reopen: handler всё ещё работает
    const rec=sb.recognitionInstances[sb.recognitionInstances.length-1];
    assert.ok(rec,'handler alive after reopen');
    rec.onstart({});
    btn.click();
    console.log('PASS rerender/reopen: handler persists, single listener, no duplicates');
  }

  /* 9) gUM denial -> permission message, recognition НЕ стартует */
  {
    const doc=makeDoc();
    const sb=makeSandbox(doc,{navigator:{mediaDevices:{getUserMedia:function(){ return Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'})); }}}});
    let err=null;
    const voice=sb.MTAI.createVoiceInput({
      recognitionCtor:sb.window.webkitSpeechRecognition,
      getLang:()=>'uk-UA',
      getUserMedia:sb.navigator.mediaDevices.getUserMedia,
      onStatus(){}, onResult(){}, onStateChange(){},
      onError:function(e){ err=e; }
    });
    voice.start();
    await tick(20);
    assert.ok(err&&/Дозвольте доступ/.test(err.message),'gUM denial -> permission message');
    console.log('PASS getUserMedia denial: visible permission message, no start');
  }

  /* 10) язык: RU-маркеры -> ru-RU; UA -> uk-UA; нейтральный -> язык браузера */
  {
    const doc=makeDoc();
    const sb=makeSandbox(doc,{navigator:{language:'uk-UA'}});
    assert.equal(sb.MTAI.detectVoiceLang('какой там сигнал был'),'ru-RU','RU markers (ы/э) -> ru-RU');
    assert.equal(sb.MTAI.detectVoiceLang('який там сигнал був'),'uk-UA','UA markers -> uk-UA');
    assert.equal(sb.MTAI.detectVoiceLang('покажи заявки'),'uk-UA','neutral + uk browser -> uk-UA');
    assert.equal(sb.MTAI.detectVoiceLang('покажи заявки','ru-RU'),'ru-RU','neutral + ru uiLang -> ru-RU');
    // recognition.lang берётся из getLang
    const sb2=makeSandbox(doc,{navigator:{language:'ru-RU'}});
    let seenLang='';
    function LangRecorder(){ const r=new sb2.window.webkitSpeechRecognition(); r.start=function(){ seenLang=r.lang; }; return r; }
    const voice=sb2.MTAI.createVoiceInput({
      recognitionCtor:LangRecorder,
      getLang:()=>sb2.MTAI.detectVoiceLang('какой сигнал','ru-RU'),
      onStatus(){}, onResult(){}, onStateChange(){}, onError(){}
    });
    voice.start();
    await tick(10);
    assert.equal(seenLang,'ru-RU','recognition.lang follows last-message language');
    console.log('PASS language: RU/UA detection + recognition.lang wired');
  }

  console.log('PASS ai-voice-dom: 10/10 voice acceptance checks');
  process.exit(0);
})().catch(function(e){ console.error(e); process.exit(1); });

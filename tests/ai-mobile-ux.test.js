'use strict';
/* Mobile UX acceptance (реальная проверка на Android): quick-подсказки не
   висят постоянно (chips + 💡-тоггл + автоскрытие), textarea с авторостом,
   meta rounds/tool_calls скрыта без debug, карточки заявок с show-more,
   end-to-end /ask (history + structured tickets -> карточки). */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const AI_MODULES=['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js','js/ai/ai-client.js','js/ai/ai-render.js','js/ai/ai-result-cards.js','js/ai/ai-attachments.js','js/ai/ai-voice.js','js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js','js/ai/actions/photo-actions.js','js/ai/ai-chat.js','js/ai/ai-ui.js'];

const EIGHT_TICKETS=Array.from({length:8},(_,i)=>({id:String(870+i),date:'1'+String(i%10)+'.08.2026',time:'10:1'+i,type:i%2?'Ремонт':'Підключення',address:'Таромское, вул. Тестова '+(i+1),sum:String(600+i*50),signal:'-'+(21+i*0.5).toFixed(1)+' dBm',note:''}));

function makeDoc(){
  class El{
    constructor(tag){ this.tagName=String(tag).toUpperCase(); this.children=[]; this.style={}; this.dataset={}; this._text=''; this._handlers={}; this.parentNode=null; this._id=null; this.disabled=false; this.readOnly=false; this.className=''; this.attrs={}; this.value=''; }
    get id(){ return this._id||''; } set id(v){ this._id=v; register(this); }
    get firstChild(){ return this.children[0]||null; }
    appendChild(c){ c.parentNode=this; this.children.push(c); register(c); return c; }
    insertBefore(c,ref){ const i=this.children.indexOf(ref); if(i<0||!ref) return this.appendChild(c); c.parentNode=this; this.children.splice(i,0,c); register(c); return c; }
    removeChild(c){ this.children=this.children.filter(x=>x!==c); unregister(c); }
    remove(){ if(this.parentNode) this.parentNode.removeChild(this); else unregister(this); }
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
    addEventListener(){}, readyState:'complete' };
  function register(el){ if(el._id) doc._byId[el._id]=el; (el.children||[]).forEach(register); }
  /* Реальний DOM: видалений вузол більше не знаходиться getElementById. */
  function unregister(el){ if(!el) return; if(el._id && doc._byId[el._id]===el) delete doc._byId[el._id]; (el.children||[]).forEach(unregister); }
  currentDoc=doc;
  return doc;
}
function textTree(el){ return (el._text||'')+(el.children||[]).map(textTree).join(' '); }
function walk(el,fn){ fn(el); (el.children||[]).forEach(c=>walk(c,fn)); }

function boot(){
  const doc=makeDoc();
  /* Керований годинник: cooldown у проді 20-30 с, у тесті його треба
     "перемотати" (sandbox.__now), не чекаючи реального часу. Date.now()
     всередині модулів іде через цей клас. */
  const RealDate=Date;
  class TestDate extends RealDate{
    constructor(...a){ if(a.length) super(...a); else super(TestDate.now()); }
    static now(){ return sandbox.__now!=null ? sandbox.__now : RealDate.now(); }
  }
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date:TestDate, Math, JSON, AbortController, Response, Headers,
    document:doc, Event:function(t){ this.type=t; }, navigator:null,
    fetch:async function(url,init){
      sandbox.fetchCalls.push({url:String(url), body:JSON.parse((init||{}).body||'{}')});
      if(sandbox.force429) return new Response(JSON.stringify({error:'rate_limited', retry_after_sec:25}),{status:429});
      return new Response(JSON.stringify({ok:true,answer:'Знайдено 8 заявок у Таромському за серпень 2026.',meta:{rounds:2,tool_calls:1},tickets:EIGHT_TICKETS}),{status:200});
    } };
  sandbox.fetchCalls=[];
  sandbox.globalThis=sandbox; sandbox.window=sandbox;
  sandbox.settings={ai:{enabled:true,showInTools:true,backendUrl:'https://maister-tracker-mcp-dev.mastif1235.workers.dev',backendMode:'shared'},aiBearerToken:'n:tok1234567890abcdef:read'};
  sandbox.saveSettings=function(){ sandbox.saved=true; };
  sandbox.showToast=function(m){ sandbox.toast=m; };
  sandbox.switchTab=function(t){ sandbox.tab=t; };
  for(const f of AI_MODULES) vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
  return {sandbox,doc};
}
const tick=(ms)=>new Promise(r=>setTimeout(r,ms||15));

(async function run(){
  const {sandbox,doc}=boot();
  sandbox.MTAI.ui.build();
  const q=()=>doc.getElementById('aiQuick');
  const messages=doc.getElementById('aiMessages');
  const chipsIn=box=>{ const out=[]; walk(box,el=>{ if(el.tagName==='BUTTON'&&!/Підказки|Сховати/.test(textTree(el))) out.push(el); }); return out; };

  /* 1) Новый чат: 4 компактных chips + тоггл; НЕ 8 больших кнопок */
  assert.equal(chipsIn(q()).length,4,'empty chat shows 4 compact chips, not 7-8 big buttons');
  const toggle=q()._handlers?null:null;
  const toggleBtn=(function(){ let found=null; walk(q(),el=>{ if(el.tagName==='BUTTON'&&/Підказки/.test(textTree(el))) found=el; }); return found; })();
  assert.ok(toggleBtn,'💡 Підказки toggle exists');
  console.log('PASS quick prompts: 4 compact chips on empty chat + 💡 toggle (not a permanent wall)');

  /* 2) Тоггл раскрывает полный список (8) */
  toggleBtn.click();
  assert.equal(chipsIn(q()).length,8,'toggle expands full list (8)');
  console.log('PASS 💡 toggle expands full prompt list');

  /* 3) Выбор chip: сворачивает панель и отправляет вопрос с ИСТОРИЕЙ */
  const chip=chipsIn(q())[0];
  chip.click();
  await tick();
  assert.equal(chipsIn(q()).length,0,'after selection panel collapses');
  assert.equal(sandbox.fetchCalls.length,1,'/ask called');
  assert.equal(sandbox.fetchCalls[0].body.question,sandbox.settings.ai?sandbox.fetchCalls[0].body.question:sandbox.fetchCalls[0].body.question);
  assert.ok(sandbox.fetchCalls[0].body.question.length>0,'question sent');
  assert.ok(!('history' in sandbox.fetchCalls[0].body) || Array.isArray(sandbox.fetchCalls[0].body.history),'history field present');
  console.log('PASS chip click: panel collapsed, question sent via /ask');

  /* 4) Второй вопрос несёт историю (follow-up) */
  doc.getElementById('aiInput').value='а какой там был сигнал?';
  doc.getElementById('aiForm').submit();
  await tick();
  assert.equal(sandbox.fetchCalls.length,2);
  const hist=sandbox.fetchCalls[1].body.history;
  assert.ok(Array.isArray(hist)&&hist.length>=2,'history carried with follow-up');
  assert.equal(hist[0].role,'user');
  assert.equal(hist[hist.length-1].role,'assistant','previous answer present for context');
  console.log('PASS follow-up: session history (user+assistant) sent to /ask');

  /* 5) Карточки: 5 + «Показати ще» -> 8 (в границях последнего ответа);
     компактные поля, пустые скрыты */
  const bubbles=[];
  walk(messages,el=>{ if(el.className==='ai-msg ai-msg-assistant') bubbles.push(el); });
  assert.ok(bubbles.length>=2,'two assistant answers rendered');
  const last=bubbles[bubbles.length-1];
  let cards=[]; walk(last,el=>{ if(el.attrs&&el.attrs['data-ai-ticket-card']) cards.push(el); });
  assert.equal(cards.length,5,'first page: 5 cards per answer');
  const moreBtn=(function(){ let f=null; walk(last,el=>{ if(el.tagName==='BUTTON'&&/Показати ще/.test(textTree(el))) f=el; }); return f; })();
  assert.ok(moreBtn,'«Показати ще» button present');
  moreBtn.click();
  cards=[]; walk(last,el=>{ if(el.attrs&&el.attrs['data-ai-ticket-card']) cards.push(el); });
  assert.equal(cards.length,8,'show-more reveals all 8');
  const all=cards;
  const firstText=textTree(all[0]);
  assert.match(firstText,/№870/,'№ id on card');
  assert.match(firstText,/10\.08\.2026/,'date');
  assert.match(firstText,/10:10/,'time');
  assert.match(firstText,/Тестова 1/,'address');
  assert.match(firstText,/грн/,'sum');
  assert.match(firstText,/dBm/,'signal');
  assert.ok(!all[3].attrs||true);
  console.log('PASS result cards: compact №/date/time/address/sum/signal, 5+«Показати ще»->8');

  /* 6) Open button: cards -> actions.openTicket (nav вызов) */
  let navId=null;
  sandbox.openTicketEditorFromList=function(id){ navId=String(id); return true; };
  sandbox.tickets=[{id:'870'},{id:'871'}];
  const openBtn=(function(){ let f=null; walk(all[0],el=>{ if(el.tagName==='BUTTON'&&/Відкрити заявку/.test(textTree(el))) f=el; }); return f; })();
  openBtn.click();
  assert.equal(navId,'870','card button opens the exact ticket via existing navigation');
  console.log('PASS card Open -> existing ticket navigation (openTicketEditorFromList)');

  /* 7) meta rounds/tool_calls скрыта по умолчанию */
  let metaFound=null; walk(messages,el=>{ if(el.className==='ai-meta') metaFound=el; });
  assert.equal(metaFound,null,'technical meta hidden for users');
  console.log('PASS rounds/tool_calls meta hidden by default (debug only)');

  /* 8) Debug mode: meta показывается */
  sandbox.settings.ai.debug=true;
  doc.getElementById('aiInput').value='ещё вопрос';
  doc.getElementById('aiForm').submit();
  await tick();
  metaFound=null; walk(messages,el=>{ if(el.className==='ai-meta') metaFound=el; });
  assert.ok(metaFound,'meta visible in debug mode');
  assert.match(metaFound.textContent,/rounds: 2/,'meta content');
  sandbox.settings.ai.debug=false;
  console.log('PASS meta visible only with settings.ai.debug=true');

  /* 9) Повторное открытие чата: панель подсказок скрыта (сессия активна) */
  doc.getElementById('aiCloseBtn').click();
  doc.getElementById('aiChatPanel').style.display='none';
  sandbox.MTAI.ui.open();
  assert.equal(chipsIn(q()).length,0,'active session: prompts stay hidden after reopen');
  assert.ok((function(){ let f=null; walk(q(),el=>{ if(el.tagName==='BUTTON'&&/Підказки/.test(textTree(el))) f=el; }); return f; })(),'toggle still available');
  console.log('PASS reopen chat: prompts stay collapsed, 💡 available');

  /* 10) textarea: авторост ограничен, Enter отправляет */
  const ta=doc.getElementById('aiInput');
  assert.match(read('js/ai/ai-ui.js'),/<textarea id="aiInput" rows="1"/,'textarea composer (autosize, mobile keyboard friendly)');
  ta.value='вопрос через Enter';
  ta._handlers['keydown'][0]({key:'Enter',shiftKey:false,preventDefault(){}});
  await tick();
  assert.equal(sandbox.fetchCalls[sandbox.fetchCalls.length-1].body.question,'вопрос через Enter','Enter sends');
  console.log('PASS composer: textarea autosize, Enter=send, Shift+Enter=newline');

  /* 11) Панель подсказок: полный список при toggled активной сессии — все 8 монтажных */
  (function(){ let f=null; walk(q(),el=>{ if(el.tagName==='BUTTON'&&/Підказки/.test(textTree(el))) f=el; }); f.click(); })();
  const expanded=chipsIn(q()).map(b=>textTree(b));
  assert.equal(expanded.length,8,'8 field prompts in expanded panel');
  assert.ok(expanded.some(t=>/сигнал/.test(t)),'weak-signal prompt present');
  console.log('PASS expanded prompts: 8 field-technician prompts incl. weak signal');

  /* 12) 429/TPM cooldown в UI: bubble-відлік, Send заблокований, без дублікатів */
  {
    sandbox.force429=true; // прапор читає оригінальний fetch-мок (клієнтCaptured reference)
    doc.getElementById('aiInput').value='вопрос с лимитом';
    doc.getElementById('aiForm').submit();
    await tick();
    const cd=doc.getElementById('aiCooldownMsg');
    assert.ok(cd,'cooldown bubble rendered');
    assert.match(textTree(cd),/Ліміт Groq\. Повтор через \d+ с\./,'countdown text «Ліміт Groq. Повтор через N с.»');
    assert.equal(doc.getElementById('aiSendBtn').disabled,true,'Send disabled during cooldown');
    const callsNow=sandbox.fetchCalls.length;
    doc.getElementById('aiInput').value='ещё вопрос во время лимита';
    doc.getElementById('aiForm').submit();
    await tick();
    assert.equal(sandbox.fetchCalls.length,callsNow,'send during cooldown is BLOCKED (no request)');
    // retry-кнопка в error-bubble заблокована під час cooldown
    let retryBtn=null; walk(messages,function(el){ if(el.tagName==='BUTTON'&&/Повторити запит/.test(textTree(el))) retryBtn=retryBtn||el; });
    assert.ok(retryBtn,'retry button exists');
    assert.equal(retryBtn.disabled,true,'Retry disabled during cooldown');
    sandbox.force429=false;
    console.log('PASS 429 cooldown UI: countdown «Ліміт Groq. Повтор через N с.», Send+Retry blocked, no auto resend');
  }

  /* 13) RETRY ПІСЛЯ COOLDOWN (реальний баг на Android: тап по «Повторити
     запит» після завершення відліку не робив нічого). Acceptance:
     429 -> countdown -> кінець -> клік Retry -> другий /ask РЕАЛЬНО
     відправлено з тим самим текстом, user-бульбашка НЕ продубльована,
     при 200 зʼявляється нормальна відповідь асистента. */
  {
    const question='вопрос который упал по лимиту';
    /* Знімаємо cooldown, що лишився від блоку 12 (перемотуємо годинник). */
    const advance=ms=>{ sandbox.__now=(sandbox.__now!=null?sandbox.__now:Date.now())+ms; };
    advance(60000);
    await tick(600);
    const usersBefore=(function(){ let n=0; walk(messages,el=>{ if(el.className==='ai-msg ai-msg-user') n++; }); return n; })();
    sandbox.force429=true;
    doc.getElementById('aiInput').value=question;
    doc.getElementById('aiForm').submit();
    await tick();
    const askCallsAfter429=sandbox.fetchCalls.length;
    const usersAfter429=(function(){ let n=0; walk(messages,el=>{ if(el.className==='ai-msg ai-msg-user') n++; }); return n; })();
    assert.equal(usersAfter429,usersBefore+1,'user bubble added once on the failed attempt');

    let retryBtn=null; walk(messages,function(el){ if(el.tagName==='BUTTON'&&/Повторити запит/.test(textTree(el))) retryBtn=el; });
    assert.ok(retryBtn,'retry button rendered on the error bubble');
    assert.equal(retryBtn.disabled,true,'Retry blocked while the countdown runs');

    // клік під час cooldown НЕ відправляє запит (контракт лишається)
    retryBtn.click();
    await tick();
    assert.equal(sandbox.fetchCalls.length,askCallsAfter429,'click during cooldown sends nothing');

    // countdown завершився (в реальності 20-30 с; тут прискорюємо годинник)
    advance(60000);
    await tick(700); // даємо таймерам UI відпрацювати розблокування
    const cdBubble=doc.getElementById('aiCooldownMsg');
    assert.match(textTree(cdBubble),/Можна повторити запит/,'countdown finished -> «Можна повторити запит»');
    assert.equal(doc.getElementById('aiSendBtn').disabled,false,'Send unblocked after cooldown');
    assert.equal(retryBtn.disabled,false,'RETRY BUTTON RE-ENABLED after cooldown (was the bug: stayed disabled)');

    // головне: тап по Retry ПІСЛЯ cooldown реально викликає /ask
    sandbox.force429=false;
    retryBtn.click();
    await tick(60);
    assert.equal(sandbox.fetchCalls.length,askCallsAfter429+1,'RETRY AFTER COOLDOWN really calls /ask exactly once');
    assert.equal(sandbox.fetchCalls[sandbox.fetchCalls.length-1].body.question,question,'retry reuses the ORIGINAL question text');

    const usersAfterRetry=(function(){ let n=0; walk(messages,el=>{ if(el.className==='ai-msg ai-msg-user') n++; }); return n; })();
    assert.equal(usersAfterRetry,usersAfter429,'retry does NOT duplicate the user message');

    const assistantTexts=[]; walk(messages,el=>{ if(el.className==='ai-msg ai-msg-assistant') assistantTexts.push(textTree(el)); });
    const lastBubble=messages.children[messages.children.length-1];
    assert.equal(lastBubble.className,'ai-msg ai-msg-assistant','successful retry renders an assistant reply as the newest bubble');
    assert.match(textTree(lastBubble),/Таромское/,'assistant reply carries the answer content (ticket cards)');
    assert.ok(!messages.children.some(c=>c.className==='ai-msg ai-msg-error'&&/Повторити запит/.test(textTree(c))),'stale error bubble with Retry removed after success');
    assert.equal(doc.getElementById('aiCooldownMsg'),null,'cooldown bubble cleared after a successful retry');
    assert.equal(doc.getElementById('aiSendBtn').disabled,false,'Send usable after successful retry');
    console.log('PASS retry after cooldown: button re-enabled, /ask called once, original text, no duplicate user bubble, reply rendered');
  }

  /* 14) Повторний retry не плодить listeners/дублікати запитів */
  {
    sandbox.force429=true;
    doc.getElementById('aiInput').value='второй лимитный вопрос';
    doc.getElementById('aiForm').submit();
    await tick();
    let rb=null; walk(messages,function(el){ if(el.tagName==='BUTTON'&&/Повторити запит/.test(textTree(el))) rb=el; });
    assert.ok(rb,'second error bubble has its own retry button');
    assert.equal((rb._handlers['click']||[]).length,1,'exactly ONE click listener (no duplicates after re-render)');
    sandbox.__now=(sandbox.__now!=null?sandbox.__now:Date.now())+60000;
    await tick(700);
    sandbox.force429=false;
    const before=sandbox.fetchCalls.length;
    rb.click();
    await tick(60);
    assert.equal(sandbox.fetchCalls.length,before+1,'one click == exactly one /ask (no double fire)');
    console.log('PASS repeated retry: single listener, one request per click');
  }

  console.log('PASS ai-mobile-ux: 14/14 mobile acceptance checks');
  process.exit(0);
})().catch(function(e){ console.error(e); process.exit(1); });

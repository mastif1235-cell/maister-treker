'use strict';
/* v91.60 — voice extras (js/ai/voice/*): auto-send after dictation and
   answers read aloud with the browser speechSynthesis. Both OFF by default.
   Real ai-ui.js + ai-chat.js + ai-voice.js + the new modules run in the fake
   DOM sandbox of tests/ai-voice-dom.test.js with a FakeRecognition and a
   fake speechSynthesis. Voice 1–13 of the task. */
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
    fire(t,ev){ (this._handlers[t]||[]).slice().forEach(fn=>fn(ev||{target:this})); }
    dispatchEvent(ev){ this.fire(ev.type, ev); return true; }
    click(){ this.fire('click',{target:this}); }
    submit(){ this.fire('submit',{target:this,preventDefault(){}}); }
    setAttribute(k,v){ this.attrs[k]=String(v); } getAttribute(k){ return this.attrs[k]!=null?this.attrs[k]:null; }
    get textContent(){ return this._text; } set textContent(v){ this._text=String(v); this.children=[]; }
    get scrollHeight(){ return 40; } focus(){} scrollIntoView(){}
    get ownerDocument(){ return doc; }
    get classList(){ const self=this; const arr=()=> (self.className||'').split(' ').filter(Boolean);
      return { add(c){ const a=arr(); if(!a.includes(c)) a.push(c); self.className=a.join(' '); }, remove(c){ self.className=arr().filter(x=>x!==c).join(' '); }, contains(c){ return arr().includes(c); }, toggle(c,force){ const a=arr(); const has=a.includes(c); const want=force===undefined?!has:!!force; if(want&&!has) a.push(c); self.className=(want?a:a.filter(x=>x!==c)).join(' '); return want; } }; }
    set innerHTML(html){
      this._innerHTML=String(html); this.children=[];
      for(const m of String(html).matchAll(/id="([^"]+)"/g)){ const id=m[1]; if(!doc._byId[id]){ const el=new El('div'); el._id=id; doc._byId[id]=el; this.children.push(el); } }
    }
    get innerHTML(){ return this._innerHTML||''; }
  }
  const doc={ _byId:Object.create(null), head:new El('head'), body:new El('body'), createElement:t=>new El(t),
    createTextNode:t=>{ const e=new El('#text'); e._text=String(t); return e; }, getElementById(id){ return doc._byId[id]||null; }, addEventListener(){}, readyState:'complete' };
  function register(el){ if(el._id) doc._byId[el._id]=el; (el.children||[]).forEach(register); }
  return doc;
}
function walk(el,fn){ fn(el); (el.children||[]).forEach(c=>walk(c,fn)); }
function findAll(root,pred){ const out=[]; walk(root,el=>{ if(pred(el)) out.push(el); }); return out; }
function textTree(el){ return (el._text||'')+(el.children||[]).map(textTree).join(' '); }

const FILES=['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js','js/ai/ai-client.js','js/ai/ai-render.js','js/ai/ai-result-cards.js','js/ai/ai-attachments.js','js/ai/ai-voice.js','js/ai/voice/ai-voice-autosend.js','js/ai/voice/ai-voice-tts.js','js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js','js/ai/actions/photo-actions.js','js/ai/ai-chat.js','js/ai/ai-ui.js','js/ai/voice/ai-voice-settings.js'];

function makeSandbox(opts){
  opts=opts||{};
  const doc=makeDoc();
  const recognitions=[];
  function FakeRecognition(){ const self=this; this.lang=''; this.start=function(){ recognitions.push(self); if(self.onstart) self.onstart({}); }; this.stop=function(){ if(self.onend) self.onend({}); }; this.abort=function(){ if(self.onend) self.onend({}); }; }
  const spoken=[]; let queue=[];
  const synth={ speak(u){ spoken.push(u); queue.push(u); }, cancel(){ queue=[]; synth.cancelled=(synth.cancelled||0)+1; }, cancelled:0 };
  function Utt(text){ this.text=text; this.lang=''; }
  const sent=[]; const answers=opts.answers||['Сьогодні неділя, 20.09.2026.'];
  const sandbox={ console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON, Event:function(type){ this.type=type; this.isTrusted=false; },
    document:doc, AbortController, Response, Headers,
    navigator:{ userAgent:'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36' },
    fetch:async function(url,init){ if(sandbox.fetchOverride) return sandbox.fetchOverride(url,init); const b=JSON.parse(init.body); sent.push(b); const a=answers[Math.min(sent.length-1,answers.length-1)]; return new Response(JSON.stringify({ok:true,answer:a,meta:{rounds:1,tool_calls:0}}),{status:200}); } };
  sandbox.globalThis=sandbox; sandbox.window=sandbox;
  sandbox.webkitSpeechRecognition=FakeRecognition;
  if(!opts.noTts){ sandbox.speechSynthesis=synth; sandbox.SpeechSynthesisUtterance=Utt; }
  sandbox.settings={ai:Object.assign({enabled:true,showInTools:true,backendUrl:'https://x.example',backendMode:'shared'},opts.ai||{}),aiBearerToken:'n:tok1234567890abcdef:read'};
  sandbox.saveSettings=function(){ sandbox.saved=(sandbox.saved||0)+1; };
  sandbox.showToast=function(m){ sandbox.toast=m; }; sandbox.switchTab=function(){};
  if(opts.history){ sandbox.localStorage={ _m:{'mtAiChatHistoryV1':JSON.stringify(opts.history)}, getItem(k){ return this._m[k]==null?null:this._m[k]; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } }; }
  for(const f of FILES) vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
  return {sb:sandbox, doc, recognitions, spoken, synth, sent};
}
const tick=ms=>new Promise(r=>setTimeout(r,ms||20));
/* recognition.start() runs after the permission preflight promises → await */
async function startMic(ctx){
  ctx.doc.getElementById('aiVoiceBtn').click();
  await tick(20);
  const rec=ctx.recognitions[ctx.recognitions.length-1];
  assert.ok(rec,'recognition started');
  return rec;
}
async function dictate(ctx, text){
  const rec=await startMic(ctx);
  rec.onresult({results:[{0:{transcript:text},isFinal:true,length:1}]});
  rec.onend({});
}
function speakButtons(doc){ return findAll(doc.getElementById('aiMessages'), el=>(el.className||'').includes('ai-speak-btn')); }

(async function run(){
  /* Voice 1: auto-send OFF (default) → dictation lands in the textarea, nothing is sent */
  {
    const ctx=makeSandbox(); ctx.sb.MTAI.ui.build();
    assert.equal(ctx.sb.MTAI.storage.get().voiceAutoSend,false,'default OFF'); assert.equal(ctx.sb.MTAI.storage.get().voiceAutoRead,false,'default OFF');
    await dictate(ctx,'Скільки заявок сьогодні');
    await tick(60);
    assert.equal(ctx.doc.getElementById('aiInput').value,'Скільки заявок сьогодні','text visible in the textarea');
    assert.equal(ctx.sent.length,0,'OFF: no automatic send');
    console.log('PASS Voice 1: auto-send OFF → text only, no send');
  }
  /* Voice 2: ON + FINAL → exactly one send after the delay, via the normal pipeline */
  {
    const ctx=makeSandbox({ai:{voiceAutoSend:true}}); ctx.sb.MTAI.ui.build();
    await dictate(ctx,'Скільки заявок сьогодні');
    assert.equal(ctx.doc.getElementById('aiInput').value,'Скільки заявок сьогодні','text visible BEFORE the send');
    assert.match(ctx.doc.getElementById('aiVoiceStatus').textContent,/Надсилаю за мить/,'quiet indication');
    assert.equal(ctx.sent.length,0,'not sent immediately');
    await tick(1400);
    assert.equal(ctx.sent.length,1,'exactly one send');
    assert.equal(ctx.sent[0].question,'Скільки заявок сьогодні');
    assert.equal(ctx.doc.getElementById('aiInput').value,'','textarea cleared by the ordinary submit path');
    await tick(30);
    const msgs=ctx.doc.getElementById('aiMessages');
    assert.equal(findAll(msgs,el=>el.className==='ai-msg ai-msg-user').length,1,'one user bubble');
    console.log('PASS Voice 2: auto-send ON + final → exactly one send through the normal pipeline');
  }
  /* Voice 3: interim results never trigger a send (ai-voice emits finals only; an interim-shaped event is ignored) */
  {
    const ctx=makeSandbox({ai:{voiceAutoSend:true}}); ctx.sb.MTAI.ui.build();
    const rec=await startMic(ctx);
    rec.onresult({results:[{0:{transcript:''},isFinal:false,length:1}]});
    await tick(1400);
    assert.equal(ctx.sent.length,0,'interim/empty → no send');
    console.log('PASS Voice 3/4: interim or empty result → no send');
  }
  /* Voice 5: error / cancel → no send */
  {
    const ctx=makeSandbox({ai:{voiceAutoSend:true}}); ctx.sb.MTAI.ui.build();
    const rec=await startMic(ctx);
    rec.onresult({results:[{0:{transcript:'Питання'},isFinal:true,length:1}]});
    rec.onerror({error:'network'});
    await tick(1400);
    assert.equal(ctx.sent.length,0,'error after a final result cancels the pending send');
    const ctx2=makeSandbox({ai:{voiceAutoSend:true}}); ctx2.sb.MTAI.ui.build();
    const rec2=await startMic(ctx2);
    rec2.onresult({results:[{0:{transcript:'Питання'},isFinal:true,length:1}]});
    ctx2.doc.getElementById('aiVoiceBtn').click(); /* user taps stop */
    await tick(1400);
    assert.equal(ctx2.sent.length,0,'manual stop cancels the pending send');
    console.log('PASS Voice 5: error / stop → no send');
  }
  /* Voice 6: user edit during the delay cancels */
  {
    const ctx=makeSandbox({ai:{voiceAutoSend:true}}); ctx.sb.MTAI.ui.build();
    await dictate(ctx,'Скільки заявок');
    const inp=ctx.doc.getElementById('aiInput');
    inp.value='Скільки заявок у вересні'; inp.fire('input',{target:inp,isTrusted:true});
    await tick(1400);
    assert.equal(ctx.sent.length,0,'edit cancels auto-send');
    assert.equal(inp.value,'Скільки заявок у вересні','edited text kept');
    assert.doesNotMatch(ctx.doc.getElementById('aiVoiceStatus').textContent,/Надсилаю/,'indication cleared');
    console.log('PASS Voice 6: edit during the delay cancels the auto-send');
  }
  /* Voice 7: manual Send during the delay → exactly one send, no duplicate */
  {
    const ctx=makeSandbox({ai:{voiceAutoSend:true}}); ctx.sb.MTAI.ui.build();
    await dictate(ctx,'Скільки заявок');
    ctx.doc.getElementById('aiForm').submit();
    await tick(1400);
    assert.equal(ctx.sent.length,1,'manual send during the delay → single send');
    console.log('PASS Voice 7: manual Send during the delay → no duplicate');
  }
  /* Voice 8: no speechSynthesis → no 🔊 control, chat works */
  {
    const ctx=makeSandbox({noTts:true,ai:{voiceAutoRead:true}}); ctx.sb.MTAI.ui.build();
    ctx.doc.getElementById('aiInput').value='Скільки заявок'; ctx.doc.getElementById('aiForm').submit();
    await tick(40);
    assert.equal(ctx.sent.length,1); assert.equal(speakButtons(ctx.doc).length,0,'no 🔊 without speechSynthesis');
    assert.equal(findAll(ctx.doc.getElementById('aiMessages'),el=>el.className==='ai-msg ai-msg-assistant').length,1,'answer rendered');
    console.log('PASS Voice 8: no speechSynthesis → control hidden, chat works');
  }
  /* Voice 9: 🔊 reads ONLY the answer text (no ids/metadata/buttons) */
  {
    const answer='Знайдено 2 заявки:\n1. **10.06.2026** — Дніпро, Матроська 22, кв. 4 [id:4f2a9c1e-77b1-4c2d-9e0a-1b2c3d4e5f60]\n2. 15.06.2026 — Таромське №754bcd12 https://example.test/x';
    const ctx=makeSandbox({answers:[answer]}); ctx.sb.MTAI.ui.build();
    ctx.doc.getElementById('aiInput').value='Де є Матроська 22'; ctx.doc.getElementById('aiForm').submit();
    await tick(40);
    const btns=speakButtons(ctx.doc); assert.equal(btns.length,1,'one 🔊 per answer');
    btns[0].click();
    assert.equal(ctx.spoken.length,1);
    const said=ctx.spoken[0].text;
    assert.match(said,/Дніпро, Матроська 22, кв. 4/); assert.match(said,/Таромське/);
    assert.doesNotMatch(said,/4f2a9c1e|754bcd12|https?:|\*\*|\[id/,'no UUID/№id/link/markdown');
    assert.doesNotMatch(said,/READ-ONLY|Provider|deepseek|Відкрити профіль|rounds/i,'no metadata or button text');
    assert.equal(ctx.spoken[0].lang,'uk-UA');
    assert.equal(btns[0].textContent,'⏹ Стоп','button becomes a stop control');
    btns[0].click(); assert.equal(btns[0].textContent,'🔊 Озвучити','stop restores the button'); assert.ok(ctx.synth.cancelled>=1,'synth.cancel called');
    console.log('PASS Voice 9: 🔊 reads only the answer text; stop control works');
  }
  /* Voice 10: a new read stops the previous one */
  {
    const ctx=makeSandbox({answers:['Перша відповідь.','Друга відповідь.']}); ctx.sb.MTAI.ui.build();
    ctx.doc.getElementById('aiInput').value='a'; ctx.doc.getElementById('aiForm').submit(); await tick(40);
    ctx.doc.getElementById('aiInput').value='b'; ctx.doc.getElementById('aiForm').submit(); await tick(40);
    const btns=speakButtons(ctx.doc); assert.equal(btns.length,2);
    btns[0].click(); const before=ctx.synth.cancelled; btns[1].click();
    assert.equal(ctx.spoken.length,2); assert.ok(ctx.synth.cancelled>before,'second read cancelled the first');
    assert.equal(btns[0].textContent,'🔊 Озвучити','first button no longer shows stop'); assert.equal(btns[1].textContent,'⏹ Стоп');
    console.log('PASS Voice 10: a new read stops the previous one');
  }
  /* Voice 11: auto-read OFF → nothing spoken automatically */
  {
    const ctx=makeSandbox(); ctx.sb.MTAI.ui.build();
    ctx.doc.getElementById('aiInput').value='a'; ctx.doc.getElementById('aiForm').submit(); await tick(40);
    assert.equal(ctx.spoken.length,0,'OFF: nothing read automatically');
    assert.equal(speakButtons(ctx.doc).length,1,'manual 🔊 still offered');
    console.log('PASS Voice 11: auto-read OFF → nothing spoken');
  }
  /* Voice 12: auto-read ON → each NEW successful answer read exactly once; errors are not read */
  {
    const ctx=makeSandbox({ai:{voiceAutoRead:true},answers:['Перша.','Друга.']}); ctx.sb.MTAI.ui.build();
    ctx.doc.getElementById('aiInput').value='a'; ctx.doc.getElementById('aiForm').submit(); await tick(40);
    assert.equal(ctx.spoken.length,1); assert.equal(ctx.spoken[0].text,'Перша.');
    ctx.doc.getElementById('aiInput').value='b'; ctx.doc.getElementById('aiForm').submit(); await tick(40);
    assert.equal(ctx.spoken.length,2,'second answer read once'); assert.equal(ctx.spoken[1].text,'Друга.');
    /* an error answer is never read */
    ctx.sb.fetchOverride=async function(){ return new Response(JSON.stringify({ok:false,error:'ask_failed',code:'HTTP_500'}),{status:502}); };
    ctx.doc.getElementById('aiInput').value='c'; ctx.doc.getElementById('aiForm').submit(); await tick(40);
    assert.equal(ctx.spoken.length,2,'error bubble is not spoken');
    console.log('PASS Voice 12: auto-read ON → each new answer once, errors silent');
  }
  /* Voice 13: restored history is never read and gets no automatic speech */
  {
    const hist={messages:[{role:'user',text:'Скільки заявок',ts:1},{role:'assistant',text:'Було 5 заявок.',ts:2}],chatSessionId:'chat-session-restored-1'};
    const ctx=makeSandbox({ai:{voiceAutoRead:true},history:hist}); ctx.sb.MTAI.ui.build(); ctx.sb.MTAI.ui.restoreFromNavigation();
    await tick(40);
    assert.equal(ctx.spoken.length,0,'restored history is not read');
    /* the restore really happened: the controller carries the persisted turn */
    ctx.doc.getElementById('aiInput').value='Ще одне'; ctx.doc.getElementById('aiForm').submit(); await tick(40);
    assert.equal(ctx.sent[0].history.length,2,'persisted history restored into the controller');
    assert.equal(ctx.spoken.length,1,'only the NEW answer is read');
    console.log('PASS Voice 13: restored history is not read');
  }
  /* settings rows: both toggles, persisted through MTAI.storage, defaults OFF, no voice/pitch/rate pickers */
  {
    const ctx=makeSandbox(); const doc=ctx.doc;
    const screen=doc.createElement('div'); screen.id='screen-settings'; doc.body.appendChild(screen);
    vm.runInContext(read('js/ai/ai-settings.js'),vm.createContext(ctx.sb),{filename:'js/ai/ai-settings.js'});
    const a=doc.getElementById('aiVoiceAutoSendToggle'), r=doc.getElementById('aiVoiceAutoReadToggle');
    assert.ok(a&&r,'both toggles rendered inside the AI card'); assert.equal(a.checked,false); assert.equal(r.checked,false);
    a.checked=true; a.fire('change',{target:a}); assert.equal(ctx.sb.settings.ai.voiceAutoSend,true,'persisted via settings.ai'); assert.ok(ctx.sb.saved>=1,'saveSettings called');
    r.checked=true; r.fire('change',{target:r}); assert.equal(ctx.sb.settings.ai.voiceAutoRead,true);
    assert.equal(doc.getElementById('aiVoiceRate'),null); assert.equal(doc.getElementById('aiVoicePitch'),null); assert.equal(doc.getElementById('aiVoiceVoice'),null);
    assert.equal(ctx.sb.MTAI.storage.update({voiceAutoSend:'yes'}).voiceAutoSend,false,'whitelist coerces to boolean');
    console.log('PASS voice settings: two toggles, device-local via MTAI.storage, OFF by default');
  }
  /* architecture: voice code lives in js/ai/voice/, ai-chat.js untouched, ai-ui.js has hooks only */
  {
    const chatSrc=read('js/ai/ai-chat.js'), uiSrc=read('js/ai/ai-ui.js');
    assert.doesNotMatch(chatSrc,/speechSynthesis|SpeechSynthesisUtterance|voiceAutoSend|voiceAutoRead/,'ai-chat.js knows nothing about voice extras');
    assert.doesNotMatch(uiSrc,/new SpeechSynthesisUtterance|speechSynthesis\.speak|speechSynthesis\.cancel/,'ai-ui.js never calls speechSynthesis directly');
    assert.match(read('js/ai/voice/ai-voice-tts.js'),/speechSynthesis/); assert.match(read('js/ai/voice/ai-voice-autosend.js'),/createVoiceAutoSend/);
    assert.match(read('js/ai/ai-voice.js'),/MTAI\.createVoiceInput/,'recognition module unchanged in role');
    console.log('PASS architecture: voice extras isolated in js/ai/voice/*');
  }
  console.log('ALL AI VOICE EXTRAS TESTS PASSED');
})().catch(function(err){ console.error(err); process.exit(1); });

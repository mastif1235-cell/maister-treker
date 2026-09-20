'use strict';
/* v91.59 regression: the selected-ticket presentation («відкрий другу картку»,
   «покажи її», «покажи картку заявки») must be the STANDARD ticket card with
   «👤 Відкрити профіль» — the existing openTicket action (goToTicketProfile) by
   the existing ticket.id — not a bare «Закрити / На карті» card. «На карті» is
   an addition only when the ticket has coordinates, never a replacement. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

function makeDoc(){
  class El{
    constructor(tag){ this.tagName=String(tag).toUpperCase(); this.children=[]; this.style={}; this.dataset={}; this._text=''; this._handlers={}; this.parentNode=null; this._id=null; this.disabled=false; this.className=''; this.attrs={}; }
    get id(){ return this._id||''; } set id(v){ this._id=v; register(this); }
    get firstChild(){ return this.children[0]||null; }
    get ownerDocument(){ return doc; }
    appendChild(c){ c.parentNode=this; this.children.push(c); register(c); return c; }
    removeChild(c){ this.children=this.children.filter(x=>x!==c); }
    remove(){ if(this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(t,fn){ (this._handlers[t]=this._handlers[t]||[]).push(fn); }
    click(){ (this._handlers.click||[]).forEach(fn=>fn({type:'click'})); }
    setAttribute(k,v){ this.attrs[k]=String(v); }
    getAttribute(k){ return this.attrs[k]!=null?this.attrs[k]:null; }
    get textContent(){ return this._text; } set textContent(v){ this._text=String(v); this.children=[]; }
  }
  const doc={ _byId:Object.create(null), head:new El('head'), body:new El('body'),
    createElement:t=>new El(t),
    createTextNode:t=>{ const e=new El('#text'); e._text=String(t); return e; },
    getElementById(id){ return doc._byId[id]||null; } };
  function register(el){ if(el._id) doc._byId[el._id]=el; (el.children||[]).forEach(register); }
  return doc;
}
const A={id:'t-ukr-20',date:'15.06.2026',time:'10:00',city:'Шевченко',street:'Українська',house:'20',type:'Підключення',sum:900};
const B={id:'t-ukr-31',date:'01.06.2026',time:'15:56',city:'Шевченко',street:'Українська',house:'31',type:'Ремонт',sum:600,signal:'-21'};
const GEO={id:'t-geo',date:'02.06.2026',time:'12:00',city:'Таромське',street:'Кобзаря',house:'15',type:'Ремонт',geoLink:'https://maps.google.com/?q=48.46,35.04'};

function boot(){
  const doc=makeDoc();
  const panel=doc.createElement('div'); panel.id='aiChatPanel'; panel.style.display='flex'; doc.body.appendChild(panel);
  const sandbox={ console, document:doc, tickets:[A,B,GEO], navFrames:[], navCalls:[], editorCalls:[], toasts:[], mapCalls:[],
    appNavigationPush(key, restore){ sandbox.navFrames.push({key, restore}); return true; },
    goToTicketProfile(id){ sandbox.navCalls.push(String(id)); },
    openTicketEditorFromList(id){ sandbox.editorCalls.push(String(id)); },
    showToast(m){ sandbox.toasts.push(String(m)); } };
  sandbox.globalThis=sandbox; sandbox.window=sandbox;
  const ctx=vm.createContext(sandbox);
  for(const f of ['js/ai/ai-config.js','js/ai/ai-ticket-id.js','js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js','js/ai/ai-result-cards.js']){
    vm.runInContext(read(f),ctx,{filename:f});
  }
  return {sandbox,doc};
}
const buttonsOf=el=>{ const out=[]; (function walk(n){ if(n.tagName==='BUTTON') out.push(n); (n.children||[]).forEach(walk); })(el); return out; };

(async()=>{
  const {sandbox,doc}=boot();
  const M=sandbox.MTAI;
  const wire=(box,id)=>M.cards.renderSingleLocal(box,id,tid=>M.actions.openTicket(tid),tid=>{ sandbox.mapCalls.push(tid); });

  /* A/B: «відкрий другу картку» → presentation single_ticket B → the standard
     card of B (the same card shape the list renders), «Відкрити профіль» first */
  const boxB=doc.createElement('div');
  assert.equal(wire(boxB,'t-ukr-31'),true);
  const cardB=boxB.children[0].children[0];
  assert.equal(cardB.getAttribute('data-ai-ticket-card'),'t-ukr-31','the card is for exactly ticket B');
  assert.ok(/ai-card/.test(cardB.className) && /ai-single-ticket/.test(cardB.className));
  assert.equal(cardB.children[0].textContent,'01.06.2026 15:56');
  assert.equal(cardB.children[1].textContent,'Шевченко, Українська, 31');
  assert.equal(cardB.children[2].textContent,'Ремонт · 600 грн · 📶 -21','the same facts line as the standard card');
  const btnsB=buttonsOf(boxB);
  assert.deepEqual(btnsB.map(b=>b.textContent),['👤 Відкрити профіль'],'no coordinates → profile action only, no «Закрити», no map');
  assert.equal(btnsB[0].getAttribute('data-ai-ticket-id'),'t-ukr-31');
  /* the list renderer produces the identical card for the same ticket */
  const listBox=doc.createElement('div');
  M.cards.render(listBox,[{id:'t-ukr-31',date:'01.06.2026',time:'15:56',address:'Шевченко, Українська, 31',type:'Ремонт',sum:'600',signal:'-21'}],()=>{},()=>{});
  const listCard=listBox.children[0].children[0];
  assert.deepEqual(listCard.children.map(c=>[c.className,c.textContent]).slice(0,3),cardB.children.map(c=>[c.className,c.textContent]).slice(0,3),'single presentation = the standard card');
  assert.deepEqual(buttonsOf(listBox).map(b=>b.textContent),btnsB.map(b=>b.textContent));

  /* D: the button is the EXISTING open-profile action by the existing ticket.id */
  btnsB[0].click();
  await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(sandbox.navCalls,['t-ukr-31'],'goToTicketProfile(existing ticket.id)');
  assert.deepEqual(sandbox.editorCalls,[],'never the editor');
  assert.equal(sandbox.navFrames[0].key,'ai-return','the app navigation frame the standard cards use');
  assert.deepEqual(sandbox.mapCalls,[],'the map was not opened');

  /* C: a single result opened by «покажи картку заявки» renders the same card */
  const boxA=doc.createElement('div');
  assert.equal(wire(boxA,'t-ukr-20'),true);
  assert.deepEqual(buttonsOf(boxA).map(b=>b.textContent),['👤 Відкрити профіль']);

  /* E: a ticket WITH coordinates gets «На карті» as an addition — «Відкрити
     профіль» stays first; the map is never the whole presentation */
  const boxGeo=doc.createElement('div');
  assert.equal(wire(boxGeo,'t-geo'),true);
  const btnsGeo=buttonsOf(boxGeo);
  assert.deepEqual(btnsGeo.map(b=>b.textContent),['👤 Відкрити профіль','🗺️ На карті']);
  btnsGeo[1].click();
  assert.deepEqual(sandbox.mapCalls,['t-geo'],'the map button is the explicit map action');
  assert.deepEqual(sandbox.navCalls,['t-ukr-31'],'the map button does not open the profile');

  /* wiring: ai-ui hands the existing actions to the single presentation */
  const ui=read('js/ai/ai-ui.js');
  assert.match(ui,/renderSingleLocal\(b, out\.presentation\.ticket_id, function\(id\)\{ MTAI\.actions\.openTicket\(id\); \}, function\(id\)\{ MTAI\.actions\.showOnMap\(id\); \}, function\(\)\{/,'single presentation: openTicket for the profile, showOnMap for the map, onMissing last');
  const cards=read('js/ai/ai-result-cards.js');
  assert.match(cards,/function drawSingleLocal\(container, ticket, id, onOpen, onMap\)[\s\S]*buildCard\(doc, item, onOpen, onMap\)/,'the single presentation reuses the standard card builder');
  assert.doesNotMatch(cards,/Закрити/,'the bare close-only card is gone');
  console.log('PASS ai single card: selected ticket → standard card with «Відкрити профіль» (openTicket by ticket.id); map only as an addition with coordinates');
})().catch(error=>{console.error(error);process.exit(1);});

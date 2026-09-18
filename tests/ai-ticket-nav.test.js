'use strict';
/* Навігація «Відкрити профіль» з чату: структуровані картки (ai-result-cards),
   безпечна дія openTicket (ai-actions): валідація id, пошук у локальному
   списку, перехід до профілю goToTicketProfile, згортання AI overlay,
   пуш кадру ai-return, БЕЗ fallback у калькулятор/редактор.
   READ-ONLY недоторканний. Жодних href/URL від моделі. */
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
function bootActions(tickets){
  const doc=makeDoc();
  const panel=doc.createElement('div'); panel.id='aiChatPanel'; panel.style.display='flex'; doc.body.appendChild(panel);
  const sandbox={ console, document:doc,
    tickets: tickets.slice(),
    navFrames: [],
    appNavigationPush(key, restore){ sandbox.navFrames.push({key, restore}); return true; },
    goToTicketProfile(id){ sandbox.navCalls.push(String(id)); },
    openTicketEditorFromList(id){ sandbox.editorCalls.push(String(id)); },
    showToast(m){ sandbox.toasts.push(String(m)); } };
  sandbox.navCalls=[]; sandbox.editorCalls=[]; sandbox.toasts=[];
  sandbox.globalThis=sandbox; sandbox.window=sandbox;
  for(const f of ['js/ai/ai-config.js','js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js']){
    vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
  }
  return {sandbox,doc};
}

(async function run(){
  /* 1) cards.normalize: только безопасные id, cap 8, обрезка полей */
  {
    const doc=makeDoc();
    const sandbox={ console, document:doc };
    sandbox.globalThis=sandbox; sandbox.window=sandbox;
    vm.runInContext(read('js/ai/ai-config.js'),vm.createContext(sandbox),{filename:'js/ai/ai-config.js'});
    vm.runInContext(read('js/ai/ai-result-cards.js'),vm.createContext(sandbox),{filename:'js/ai/ai-result-cards.js'});
    const norm=sandbox.MTAI.cards.normalize;
    const out=norm([
      {id:'123',date:'01.08.2026',address:'вул. Шевченка, 1',type:'ремонт'},
      {id:'../evil',address:'x'},
      {id:''},
      null,
      {id:'a'.repeat(100),date:'x'.repeat(100),address:'y'.repeat(500),type:'z'.repeat(300)},
      {id:'1'},{id:'2'},{id:'3'},{id:'4'},{id:'5'},{id:'6'},{id:'7'},{id:'8'},{id:'9'}
    ]);
    assert.equal(out.length,8,'capped at 8 items');
    assert.equal(out[0].id,'123');
    assert.equal(out[1].id,'a'.repeat(64),'id clipped at 64');
    assert.equal(out[1].address.length,200,'address clipped at 200');
    assert.equal(out[1].type.length,100,'type clipped at 100');
    console.log('PASS cards normalize: safe id filter, cap 8, field clipping');
  }

  /* 2) cards.render: кнопки «Відкрити профіль», 0 href/A elements */
  {
    const doc=makeDoc();
    const sandbox={ console, document:doc };
    sandbox.globalThis=sandbox; sandbox.window=sandbox;
    vm.runInContext(read('js/ai/ai-config.js'),vm.createContext(sandbox),{filename:'js/ai/ai-config.js'});
    vm.runInContext(read('js/ai/ai-result-cards.js'),vm.createContext(sandbox),{filename:'js/ai/ai-result-cards.js'});
    const container=doc.createElement('div');
    const opens=[];
    const n=sandbox.MTAI.cards.render(container,[
      {id:'123',date:'01.08.2026',address:'вул. Шевченка, 1',type:'ремонт'},
      {id:'124',date:'02.08.2026',address:'вул. Франка, 2',type:'підключення'},
      {id:'125',date:'03.08.2026',address:'',type:'діагностика'}
    ],function(id){ opens.push(id); });
    assert.equal(n,3,'three cards rendered');
    const buttons=[]; const cards=[];
    (function walk(el){ if(el.tagName==='BUTTON') buttons.push(el); if(el.attrs&&el.attrs['data-ai-ticket-card']) cards.push(el); (el.children||[]).forEach(walk); })(container);
    assert.equal(buttons.length,3,'separate open button per ticket');
    assert.ok(buttons.every(b=>/Відкрити профіль|Відкрити заявку/.test(b.textContent)),'button label');
    assert.ok(cards.length===3&&cards[0].attrs['data-ai-ticket-card']==='123','card identified by id');
    (function walk2(el){ assert.ok(!el.attrs||!el.attrs['href'],'no href attributes'); assert.ok(el.tagName!=='A','no anchor elements'); (el.children||[]).forEach(walk2); })(container);
    const src=read('js/ai/ai-result-cards.js');
    assert.ok(!/\.href\s*=|insertAdjacentHTML|innerHTML\s*=/.test(src),'cards source: no href/HTML injection');
    console.log('PASS cards render: 1->1, 3->3 separate buttons, zero href/anchors');
  }

  /* 3) openTicket (async): валідний id зі структурованою адресою -> goToTicketProfile + ai-return nav frame;
     невідомий -> чесне повідомлення, overlay ОСТАЄТЬСЯ;
     без структурованої адреси -> НЕ скидає в калькулятор! */
  {
    const {sandbox,doc}=bootActions([
      {id:'123', city:'Таромське', street:'вул. Лісова', house:'74'},
      {id:'124', city:'Дніпро', street:'вул. Поля', house:'10'}
    ]);
    const M=sandbox.MTAI;
    assert.equal(await M.actions.openTicket('123'),true,'valid id opens');
    assert.deepEqual(sandbox.navCalls,['123'],'uses goToTicketProfile (real profile router, not calculator)');
    assert.deepEqual(sandbox.editorCalls,[],'NEVER calls calculator editor');
    assert.ok(sandbox.navFrames.some(f=>f.key==='ai-return'),'ai-return frame pushed onto nav stack');
    assert.equal(doc.getElementById('aiChatPanel').style.display,'none','AI overlay collapsed AFTER successful lookup');
    doc.getElementById('aiChatPanel').style.display='flex';
    assert.equal(await M.actions.openTicket('999'),false,'unknown id does not navigate');
    assert.deepEqual(sandbox.navCalls,['123'],'no nav for missing ticket');
    assert.ok(sandbox.toasts.some(t=>t.includes('999')),'toast explains not found');
    assert.equal(doc.getElementById('aiChatPanel').style.display,'flex','overlay STAYS OPEN on failure');
    assert.equal(await M.actions.openTicket('javascript:alert(1)'),false,'script-ish id rejected');
    assert.deepEqual(sandbox.navCalls,['123'],'no nav for script id');
    assert.equal(await M.actions.openTicket(''),false,'empty id rejected');
    assert.equal(await M.actions.openTicket(null),false,'null id rejected');
    console.log('PASS openTicket: goToTicketProfile, ai-return nav pushed, no editor fallback, overlay hidden only on success');
  }

  /* 3b) Неструктурована заявка: НЕ відкриває калькулятор, показує пояснення */
  {
    const {sandbox,doc}=bootActions([{id:'99', city:'', street:'', content:'сирий текст без адреси'}]);
    const M=sandbox.MTAI;
    assert.equal(await M.actions.openTicket('99'),false,'unstructured ticket rejected from profile open');
    assert.deepEqual(sandbox.navCalls,[],'no profile nav called');
    assert.deepEqual(sandbox.editorCalls,[],'MANDATORY: zero editor fallback');
    assert.ok(sandbox.toasts.some(t=>t.includes('структурованої адреси')),'toast explains unstructured ticket');
    assert.equal(doc.getElementById('aiChatPanel').style.display,'flex','overlay STAYS OPEN, card readable in chat');
    console.log('PASS unstructured ticket: zero editor fallback, stays in AI chat');
  }

  /* 3c) числова нормалізація id (MCP '0871' vs локальний 871) */
  {
    const {sandbox,doc}=bootActions([{id:871, city:'Таромське', street:'вул. Лісова'}]);
    const M=sandbox.MTAI;
    assert.equal(await M.actions.openTicket('0871'),true,'string-with-zero matches numeric local id');
    assert.deepEqual(sandbox.navCalls,['871'],'profile receives the REAL local id');
    console.log('PASS openTicket id normalization: 0871 -> 871, profile gets local id');
  }

  /* 3d) IDB fallback: пустий масив у памʼяті, але заявка в IndexedDB */
  {
    const doc=makeDoc();
    const panel=doc.createElement('div'); panel.id='aiChatPanel'; panel.style.display='flex'; doc.body.appendChild(panel);
    const sandbox={ console, document:doc, tickets:[],
      navFrames: [],
      appNavigationPush(key, restore){ sandbox.navFrames.push({key, restore}); return true; },
      goToTicketProfile(id){ sandbox.navCalls.push(String(id)); },
      openTicketEditorFromList(id){ sandbox.editorCalls.push(String(id)); },
      showToast(m){ sandbox.toasts.push(String(m)); },
      ticketsDbRead(){ return Promise.resolve({status:'ok', value:[{id:'871', city:'Таромське', street:'вул. Лісова'}]}); } };
    sandbox.navCalls=[]; sandbox.editorCalls=[]; sandbox.toasts=[];
    sandbox.globalThis=sandbox; sandbox.window=sandbox;
    for(const f of ['js/ai/ai-config.js','js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js'])
      vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
    assert.equal(await sandbox.MTAI.actions.openTicket('871'),true,'ticket found via IndexedDB fallback');
    assert.deepEqual(sandbox.navCalls,['871'],'nav called with the IDB ticket');
    assert.equal(sandbox.tickets.length,1,'self-healed into in-memory tickets');
    console.log('PASS openTicket IDB fallback: fresh-origin empty list -> ticket found in IndexedDB, self-healed');
  }

  /* 4) READ-ONLY зберігається: write-дії вимкнені */
  {
    const {sandbox}=bootActions([]);
    const M=sandbox.MTAI;
    assert.equal(M.actions.isEnabled('ticket.create'),false,'create disabled');
    assert.equal(M.actions.isEnabled('ticket.update'),false,'update disabled');
    assert.equal(M.actions.isEnabled('ticket.delete'),false,'delete disabled');
    assert.equal(M.actions.isEnabled('ticket.open'),true,'open is read-only enabled');
    assert.equal(M.actions.isEnabled('ticket.map'),true,'map is read-only enabled');
    const res=await M.actions.execute('ticket.create',{content:'x'});
    assert.equal(res.ok,false);
    assert.equal(res.reason,'write_disabled');
    console.log('PASS actions security: create/update/delete strictly disabled (READ-ONLY)');
  }

  console.log('ALL ai-ticket-nav TESTS PASSED');
  process.exit(0);
})().catch(function(e){ console.error(e); process.exit(1); });

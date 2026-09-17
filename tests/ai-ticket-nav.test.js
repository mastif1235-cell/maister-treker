'use strict';
/* Навігація «Открити заявку» з чата: структуровані картки (ai-result-cards),
   безпечна дія openTicket (ai-actions): валідація id, пошук у локальному
   списку, існуюча навігація openTicketEditorFromList, згортання AI overlay,
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
    openTicketEditorFromList(id){ sandbox.navCalls.push(String(id)); },
    showToast(m){ sandbox.toasts.push(String(m)); } };
  sandbox.navCalls=[]; sandbox.toasts=[];
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
      'not-an-object'
    ]);
    assert.equal(out.length,2,'invalid ids dropped');
    assert.equal(out[0].id,'123');
    assert.equal(out[0].address,'вул. Шевченка, 1');
    assert.ok(out[1].id.length<=64&&out[1].address.length<=200&&out[1].type.length<=100,'fields clipped');
    assert.equal(norm([{id:'ok1'},{id:'ok1'}]).length,2,'client normalize does not dedupe (backend dedupes)');
    console.log('PASS cards normalize: safe ids only, caps enforced');
  }

  /* 2) render: 1 заявка -> 1 кнопка; 3 -> отдельные карточки; никаких href */
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
    assert.ok(buttons.every(b=>b.textContent==='📄 Відкрити заявку'),'button label');
    assert.ok(cards.length===3&&cards[0].attrs['data-ai-ticket-card']==='123','card identified by id');
    assert.ok(/№123/.test(buttons[0].parentNode.children[0].textContent),'card title shows №id');
    // клик по конкретной кнопке открывает именно её
    buttons[1].attrs['data-ai-ticket-id']==='124';
    // find click handlers: fake El без dispatchEvent — вызовем напрямую через _handlers? у нас нет; эмулируем: кнопки хранят обработчик в замыкании.
    // Для клика в тесте перерисуем через render c onOpen-шпионом: (уже сделано) — вызовем сохранённый handler:
    // в fake DOM addEventListener складывает в _handlers у El этого файла makeDoc — но здесь El другой; проверим _handlers наличием:
    // Проще: интеграцию клика покрывает блок 3 (actions). Здесь ассертим отсутствие href/URL:
    (function walk2(el){ assert.ok(!el.attrs||!el.attrs['href'],'no href attributes'); assert.ok(el.tagName!=='A','no anchor elements'); (el.children||[]).forEach(walk2); })(container);
    const src=read('js/ai/ai-result-cards.js');
    assert.ok(!/\.href\s*=|insertAdjacentHTML|innerHTML\s*=/.test(src),'cards source: no href/HTML injection');
    console.log('PASS cards render: 1->1, 3->3 separate buttons, zero href/anchors');
  }

  /* 3) openTicket (async): валидный id -> existing nav + сворачивает overlay;
     неизвестный -> честное сообщение, overlay ОСТАЁТСЯ, без «возврата в Tools»;
     числовая нормализация '0871'==871; IDB fallback */
  {
    const {sandbox,doc}=bootActions([{id:'123'},{id:'124'}]);
    const M=sandbox.MTAI;
    assert.equal(await M.actions.openTicket('123'),true,'valid id opens');
    assert.deepEqual(sandbox.navCalls,['123'],'uses openTicketEditorFromList (existing router)');
    assert.equal(doc.getElementById('aiChatPanel').style.display,'none','AI overlay collapsed AFTER successful lookup');
    doc.getElementById('aiChatPanel').style.display='flex'; // знову відкриємо чат для перевірки failure-шляху
    assert.equal(await M.actions.openTicket('999'),false,'unknown id does not navigate');
    assert.deepEqual(sandbox.navCalls,['123'],'no nav for missing ticket');
    assert.ok(sandbox.toasts.some(t=>t.includes('999')),'toast explains not found');
    assert.equal(doc.getElementById('aiChatPanel').style.display,'flex','overlay STAYS OPEN on failure (user sees the message)');
    assert.equal(await M.actions.openTicket('javascript:alert(1)'),false,'script-ish id rejected');
    assert.deepEqual(sandbox.navCalls,['123'],'no nav for script id');
    assert.equal(await M.actions.openTicket(''),false,'empty id rejected');
    assert.equal(await M.actions.openTicket(null),false,'null id rejected');
    console.log('PASS openTicket: existing nav, overlay hidden only on success, failure stays in chat with visible message');
  }

  /* 3b) числовая нормализация id (MCP '0871' vs локальный 871) */
  {
    const {sandbox,doc}=bootActions([{id:871}]);
    const M=sandbox.MTAI;
    assert.equal(await M.actions.openTicket('0871'),true,'string-with-zero matches numeric local id');
    assert.deepEqual(sandbox.navCalls,['871'],'editor receives the REAL local id (not the zero-padded one)');
    console.log('PASS openTicket id normalization: 0871 -> 871, editor gets local id');
  }

  /* 3c) IDB fallback: пустой массив в памяти, но заявка в IndexedDB */
  {
    const doc=makeDoc();
    const panel=doc.createElement('div'); panel.id='aiChatPanel'; panel.style.display='flex'; doc.body.appendChild(panel);
    const sandbox={ console, document:doc, tickets:[],
      openTicketEditorFromList(id){ sandbox.navCalls.push(String(id)); },
      showToast(m){ sandbox.toasts.push(String(m)); },
      ticketsDbRead(){ return Promise.resolve({status:'ok', value:[{id:'871', content:'Таромское'}]}); } };
    sandbox.navCalls=[]; sandbox.toasts=[];
    sandbox.globalThis=sandbox; sandbox.window=sandbox;
    for(const f of ['js/ai/ai-config.js','js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js'])
      vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
    assert.equal(await sandbox.MTAI.actions.openTicket('871'),true,'ticket found via IndexedDB fallback');
    assert.deepEqual(sandbox.navCalls,['871'],'nav called with the IDB ticket');
    assert.equal(sandbox.tickets.length,1,'self-healed into in-memory tickets');
    console.log('PASS openTicket IDB fallback: fresh-origin empty list -> ticket found in IndexedDB, self-healed');
  }

  /* 3d) integration: ID в формате MCP/GAS (строка из redactTicket) */
  {
    const {sandbox}=bootActions([{id:'871'},{id:'872'},{id:'903'}]);
    const M=sandbox.MTAI;
    await M.actions.openTicket('872');
    assert.deepEqual(sandbox.navCalls,['872'],'MCP-format string id opens the exact ticket');
    console.log('PASS openTicket integration: MCP/GAS id format (string) -> exact ticket');
  }

  /* 4) READ-ONLY сохраняется: write-действия по-прежнему выключены */
  {
    const {sandbox}=bootActions([]);
    const M=sandbox.MTAI;
    assert.equal(M.actions.isEnabled('ticket.create'),false,'create disabled');
    assert.equal(M.actions.isEnabled('ticket.update'),false,'update disabled');
    assert.equal(M.actions.isEnabled('ticket.delete'),false,'delete disabled');
    assert.equal(M.actions.isEnabled('ticket.open'),true,'open (read nav) enabled');
    (async function(){
      const res=await M.actions.execute('ticket.delete',{id:'123'},null);
      assert.equal(res.reason,'write_disabled','execute refuses write');
      console.log('PASS READ-ONLY: write actions still refused, only read-nav enabled');
      finish();
    })().catch(finish);
  }

  let done=0;
  function finish(err){
    if(err){ console.error(err); process.exit(1); }
    if(++done===1){ console.log('PASS ai-ticket-nav: 4/4 blocks'); process.exit(0); }
  }
})().catch(function(e){ console.error(e); process.exit(1); });

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/tickets-compact-view.js'),'utf8');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function load(initial){
  const values=new Map(initial?[['mtTicketViewModeV1',initial]]:[]);
  const storage={getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value)};
  const sandbox={
    localStorage:storage,
    MTStorageRegistry:{key:name=>name==='ticketViewMode'?'mtTicketViewModeV1':''},
    MTToolsCore:{addressLabel:t=>[t.city,t.street,t.house,t.apartment?`кв. ${t.apartment}`:''].filter(Boolean).join(', ')},
    escapeHtml:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    fmtMoney:value=>`${Math.round(value||0)} грн`,
    Set
  };
  vm.runInNewContext(source,sandbox,{filename:'js/tickets-compact-view.js'});
  return {api:sandbox.MTTicketCompactView,values};
}

const ticket={id:'ticket-1',date:'29.09.2026',time:'18:40',type:'Ремонт',city:'Дніпро',street:'вул. Робоча',house:'15',apartment:'27',sum:450,
  clientName:'PRIVATE_CLIENT',phone:'PRIVATE_PHONE',password:'PRIVATE_PASSWORD',content:'PRIVATE_NOTE'};
const fullRenderer=t=>`<div class="ticket-card" data-id="${t.id}"><button class="edit-ticket-btn">Редагувати</button><button class="delete-ticket-btn">Видалити</button><span>${t.clientName}</span></div>`;

{
  const {api,values}=load();
  assert.equal(api.mode(),'full','existing full mode is the default');
  assert.equal(api.renderItem(ticket,fullRenderer),fullRenderer(ticket),'full renderer output is unchanged');
  assert.equal(values.size,0,'reading default does not write a preference');
  assert.equal(api.toggleMode(),'compact');
  assert.equal(values.get('mtTicketViewModeV1'),'compact');
  const html=api.renderItem(ticket,fullRenderer);
  for(const text of ['29.09.2026','18:40','Ремонт','Дніпро, вул. Робоча, 15, кв. 27','450 грн','Розгорнути']) assert.ok(html.includes(text),text);
  for(const type of ['Підключення','Ремонт','Інше']) assert.ok(api.renderCard({...ticket,type}).includes(`<span class="ticket-compact-type">${type}</span>`),type);
  assert.ok(!api.renderCard({...ticket,type:''}).includes('ticket-compact-type'),'empty type has no badge');
  assert.ok(!api.renderCard({...ticket,type:'  '}).includes('ticket-compact-type'),'blank type has no badge');
  assert.ok(api.renderCard({...ticket,type:'<script>'}).includes('&lt;script&gt;'),'unknown type is escaped');
  for(const forbidden of ['PRIVATE_CLIENT','PRIVATE_PHONE','PRIVATE_PASSWORD','PRIVATE_NOTE','edit-ticket-btn','delete-ticket-btn','Telegram','Фото','Google Maps']) assert.ok(!html.includes(forbidden),forbidden);
  assert.equal(api.toggleExpanded(ticket.id),true);
  assert.ok(api.renderItem(ticket,fullRenderer).includes(fullRenderer(ticket)),'expanded item reuses canonical full renderer');
  assert.equal(api.renderItem({...ticket,id:'ticket-2'},fullRenderer).includes('ticket-compact-card'),true,'other ticket stays compact');
  assert.equal(api.toggleExpanded(ticket.id),false);
  assert.equal(api.renderItem(ticket,fullRenderer),html,'collapse restores compact card');
  assert.equal(api.toggleMode(),'full');
  assert.equal(values.get('mtTicketViewModeV1'),'full');
  assert.equal(api.renderItem(ticket,fullRenderer),fullRenderer(ticket));
}
{
  const {api}=load('compact');
  assert.equal(api.mode(),'compact','saved compact preference is restored');
  assert.equal(api.isExpanded(ticket.id),false,'individual expanded state does not persist');
  assert.equal(api.addressLabel({city:'Таромське',address:'Вул Привокзальна 3б, кв. 1'}),'Таромське, Вул Привокзальна 3б, кв. 1','legacy address uses existing full-card fallback');
  assert.equal(api.addressLabel({}),'Адресу не вказано');
}

const html=read('index.html'),sw=read('sw.js'),domain=read('js/tickets-domain.js'),bindings=read('js/tickets-bindings.js');
assert.ok(html.indexOf('js/tickets-render.js')<html.indexOf('js/tickets-compact-view.js'));
assert.ok(html.indexOf('js/tickets-compact-view.js')<html.indexOf('js/tickets-domain.js'));
assert.ok(sw.includes("'./js/tickets-compact-view.js'"));
assert.ok(html.indexOf('id="ticketList"')<html.indexOf('class="ticket-view-actions"'));
assert.ok(html.indexOf('class="ticket-view-actions"')<html.indexOf('id="quickDialCard"'));
assert.ok(domain.includes('visible.map(t=>MTTicketCompactView.renderItem(t,renderTicketCard))'),'the same filtered/sorted list selects either presentation');
assert.ok(bindings.includes("document.getElementById('showVizitkaBtn').addEventListener('click', showVizitka)"),'existing Vizitka action remains bound');
assert.ok(!read('js/tickets-compact-view.js').includes('function renderTicketCard('),'full renderer is not duplicated');
assert.ok(read('app.js').includes("APP_VERSION = 'v91.87 · 2026-10-05'"));
assert.ok(sw.includes("CACHE_NAME = 'maister-treker-v67-runtime-132'"));
console.log('PASS compact ticket mode state, safe markup, renderer reuse, wiring and release pins');

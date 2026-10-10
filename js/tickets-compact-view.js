/* Local presentation state for the main ticket list. Ticket data stays in the
   existing store; expanded entries reuse the canonical full-card renderer. */
(function(root){
  'use strict';
  const key=root.MTStorageRegistry.key('ticketViewMode');
  const expanded=new Set();
  let mode='full';
  try{ if(root.localStorage.getItem(key)==='compact') mode='compact'; }catch(_error){}

  function setMode(next){
    mode=next==='compact'?'compact':'full';
    expanded.clear();
    try{ root.localStorage.setItem(key,mode); }catch(_error){}
    return mode;
  }
  function toggleMode(){ return setMode(mode==='full'?'compact':'full'); }
  function toggleExpanded(id){
    const key=String(id);
    if(expanded.has(key)){ expanded.delete(key); return false; }
    expanded.add(key);
    return true;
  }
  function isExpanded(id){ return expanded.has(String(id)); }
  function addressLabel(ticket){
    if(ticket.type==='Інше') return String(ticket.otherNote||ticket.note||'').trim();
    if(ticket.street || ticket.house || ticket.apartment){
      const structured=root.MTToolsCore?.addressLabel(ticket);
      if(structured) return structured;
    }
    return [ticket.city,ticket.address].filter(Boolean).join(', ') || 'Адресу не вказано';
  }
  function renderCard(ticket){
    const id=escapeHtml(ticket.id);
    const dateTime=[ticket.date,ticket.time].filter(Boolean).join(' · ');
    const type=String(ticket.type??'').trim();
    return `<article class="ticket-compact-card" data-id="${id}">
      <div class="ticket-compact-meta"><span>${escapeHtml(dateTime)}</span>${type?`<span class="ticket-compact-type">${escapeHtml(type)}</span>`:''}</div>
      <span class="ticket-compact-sum tabular">${fmtMoney(ticket.sum)}</span>
      <div class="ticket-compact-address">${escapeHtml(addressLabel(ticket))}</div>
      <button type="button" class="btn ticket-view-expand-btn" data-id="${id}">Розгорнути</button>
    </article>`;
  }
  function renderItem(ticket,fullRenderer){
    if(mode!=='compact') return fullRenderer(ticket);
    if(!isExpanded(ticket.id)) return renderCard(ticket);
    return `<div class="ticket-compact-expanded" data-id="${escapeHtml(ticket.id)}">
      <button type="button" class="btn ticket-view-collapse-btn" data-id="${escapeHtml(ticket.id)}">▲ Згорнути картку</button>
      ${fullRenderer(ticket)}
    </div>`;
  }
  function updateModeButton(button){
    if(!button) return;
    const compact=mode==='compact';
    button.textContent=compact?'Повний вигляд':'Компактно';
    button.setAttribute('aria-label',compact?'Показати повні картки заявок':'Показати компактні картки заявок');
    button.setAttribute('aria-pressed',String(compact));
    button.classList.toggle('btn-accent',compact);
  }
  root.MTTicketCompactView=Object.freeze({runtimeRevision:'runtime-139',mode:()=>mode,setMode,toggleMode,toggleExpanded,isExpanded,addressLabel,renderCard,renderItem,updateModeButton});
})(typeof window!=='undefined'?window:globalThis);

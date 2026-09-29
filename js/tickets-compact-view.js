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
    if(ticket.street || ticket.house || ticket.apartment){
      const structured=root.MTToolsCore?.addressLabel(ticket);
      if(structured) return structured;
    }
    return [ticket.city,ticket.address].filter(Boolean).join(', ') || 'Адресу не вказано';
  }
  function renderCard(ticket){
    const id=escapeHtml(ticket.id);
    const dateTime=[ticket.date,ticket.time].filter(Boolean).join(' · ');
    return `<article class="ticket-compact-card" data-id="${id}">
      <div class="ticket-compact-meta">${escapeHtml(dateTime)}</div>
      <div class="ticket-compact-address">${escapeHtml(addressLabel(ticket))}</div>
      <div class="ticket-compact-bottom">
        <span class="ticket-compact-sum tabular">${fmtMoney(ticket.sum)}</span>
        <button type="button" class="btn ticket-view-expand-btn" data-id="${id}">Розгорнути</button>
      </div>
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
  root.MTTicketCompactView=Object.freeze({mode:()=>mode,setMode,toggleMode,toggleExpanded,isExpanded,addressLabel,renderCard,renderItem,updateModeButton});
})(typeof window!=='undefined'?window:globalThis);

/* ---- Пасивний рендеринг нарядів диспетчера ---- */
function naryadMatchesHtml(matches, escapeHtmlValue){
  if(!matches.length){
    return `<div class="empty-state" style="padding:20px 10px;">Збігів не знайдено — схоже, це нова заявка</div>`;
  }
  return matches.map(m=>{
    const o = m.ticket;
    const address = [o.city, o.address].filter(Boolean).join(', ') || '—';
    const badges = m.reasons.map(r=>`<span class="chip" style="pointer-events:none; ${r.strong ? 'background:rgba(63,191,111,0.18); color:#3fbf6f;' : ''}">${escapeHtmlValue(r.label)}</span>`).join(' ');
    return `
      <div class="card" style="margin-bottom:10px; padding:12px 14px;">
        <div class="row wrap" style="gap:4px; margin-bottom:6px;">${badges}</div>
        <div class="row between" style="margin-bottom:4px;">
          <strong>${escapeHtmlValue(o.date||'')} ${escapeHtmlValue(o.time||'')}</strong>
          <span style="font-size:12.5px; color:var(--text-dim);">${escapeHtmlValue(o.type||'')}</span>
        </div>
        <div style="font-size:13.5px; margin-bottom:2px;">📍 ${escapeHtmlValue(address)}</div>
        ${o.clientName ? `<div style="font-size:12.5px; color:var(--text-dim); margin-bottom:2px;">👤 ${escapeHtmlValue(o.clientName)}</div>` : ''}
        <button type="button" class="btn btn-sm btn-block open-address-btn" data-id="${o.id}">📍 Переглянути адресу</button>
      </div>`;
  }).join('');
}

function naryadItemDate(n, formatDateValue){
  return n.date || (n.createdAt||'').split(' ')[0] || formatDateValue(new Date());
}

function naryadQueueItemHtml(n, ticketList, escapeHtmlValue){
  const hasLinkedTicket = !!n.ticketId && ticketList.some(t=>String(t.id)===String(n.ticketId));
  return `
    <div class="card" style="margin-bottom:10px; padding:12px 14px; ${n.done ? 'opacity:.55;' : ''}">
      <div style="white-space:pre-wrap; font-size:13.5px; ${n.done ? 'text-decoration:line-through;' : ''}">${escapeHtmlValue(n.text)}</div>
      <div style="font-size:11px; color:var(--text-dim); margin:4px 0 8px;">додано ${escapeHtmlValue(n.createdAt||'')}</div>
      <div class="row" style="gap:6px; flex-wrap:wrap;">
        <button type="button" class="btn btn-sm naryad-queue-done-btn" data-id="${n.id}">${n.done ? '↩️ Повернути' : '✅ Виконано'}</button>
        ${n.done ? '' : `<button type="button" class="btn btn-sm naryad-queue-create-btn" data-id="${n.id}">➕ Заявка</button>`}
        ${n.done ? '' : `<button type="button" class="btn btn-sm naryad-queue-edit-btn" data-id="${n.id}">✏️ Редагувати</button>`}
        ${hasLinkedTicket ? `<button type="button" class="btn btn-sm naryad-queue-edit-ticket-btn" data-ticket-id="${n.ticketId}">✏️ Редагувати заявку</button>` : ''}
        <button type="button" class="btn btn-sm naryad-queue-reschedule-btn" data-id="${n.id}">🔁 Перенести</button>
        <button type="button" class="btn btn-sm btn-danger naryad-queue-delete-btn" data-id="${n.id}">🗑️</button>
      </div>
    </div>`;
}

function naryadQueueListHtml(queue, date, ticketList, formatDateValue, escapeHtmlValue){
  const forDate = queue.filter(n=>naryadItemDate(n, formatDateValue)===date);
  if(!forDate.length) return `<div style="font-size:12.5px; color:var(--text-faint); text-align:center; margin-top:10px;">На цю дату нарядів нема</div>`;
  const pending = forDate.filter(n=>!n.done).sort((a,b)=>b.id-a.id);
  const done = forDate.filter(n=>n.done).sort((a,b)=>b.id-a.id);
  return [...pending, ...done].map(n=>naryadQueueItemHtml(n, ticketList, escapeHtmlValue)).join('');
}

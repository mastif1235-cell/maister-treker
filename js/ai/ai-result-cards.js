/* AI: компактні картки заявок у чаті (мобільний UX). Контракт /ask:
   tickets:[{id,date,time,address,type,sum,signal,note}].
   Кнопки відкриття та карти ведуть ЛИШЕ через MTAI.actions.openTicket
   та MTAI.actions.showOnMap (валідація id + пошук у локальному списку +
   існуюча безпечна навігація). Жодних href/URL від моделі. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
const validateTicketId = MTAI.ticketIds ? MTAI.ticketIds.validate : function(value){ const id=String(value==null?'':value).trim(); return /^[A-Za-z0-9._:-]{1,128}$/.test(id)?id:null; };

MTAI.cards = (function(){
  function normalize(list){
    if(!Array.isArray(list)) return [];
    const out = [];
    for(const item of list){
      if(!item || typeof item !== 'object') continue;
      const id = validateTicketId(item.id);
      if(!id) continue;
      out.push({
        id: id,
        date: String(item.date == null ? '' : item.date).trim().slice(0, 32),
        time: String(item.time == null ? '' : item.time).trim().slice(0, 16),
        address: String(item.address == null ? '' : item.address).trim().slice(0, 200),
        type: String(item.type == null ? '' : item.type).trim().slice(0, 100),
        sum: String(item.sum == null ? '' : item.sum).trim().slice(0, 16),
        signal: String(item.signal == null ? '' : item.signal).trim().slice(0, 32),
        note: String(item.note == null ? '' : item.note).trim().slice(0, 120)
      });
      if(out.length >= 8) break;
    }
    return out;
  }

  const FIRST_PAGE = 5;

  function render(container, tickets, onOpen, onMap){
    while(container.firstChild) container.removeChild(container.firstChild);
    const items = normalize(tickets);
    if(!items.length) return 0;
    const doc = container.ownerDocument;
    const box = doc.createElement('div');
    box.className = 'ai-cards';

    const makeCard = function(item){
      const card = doc.createElement('div');
      card.className = 'ai-card';
      card.setAttribute('data-ai-ticket-card', item.id);
      const title = doc.createElement('div');
      title.className = 'ai-card-title';
      title.textContent = (item.date ? item.date : '') + (item.time ? ' ' + item.time : '');
      card.appendChild(title);
      if(item.address){
        const addr = doc.createElement('div');
        addr.className = 'ai-card-addr';
        addr.textContent = item.address;
        card.appendChild(addr);
      }
      const facts = [item.type, item.sum ? item.sum + ' грн' : '', item.signal ? '📶 ' + item.signal : '']
        .filter(Boolean).join(' · ');
      if(facts){
        const f = doc.createElement('div');
        f.className = 'ai-card-facts';
        f.textContent = facts;
        card.appendChild(f);
      }
      if(item.note){
        const n = doc.createElement('div');
        n.className = 'ai-card-note';
        n.textContent = item.note;
        card.appendChild(n);
      }

      const actionsRow = doc.createElement('div');
      actionsRow.className = 'ai-card-actions';
      actionsRow.style.display = 'flex';
      actionsRow.style.gap = '6px';
      actionsRow.style.marginTop = '6px';

      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm ai-card-open';
      btn.setAttribute('data-ai-ticket-id', item.id);
      btn.textContent = '👤 Відкрити профіль';
      btn.addEventListener('click', function(){
        if(typeof onOpen === 'function') onOpen(item.id);
      });
      actionsRow.appendChild(btn);

      // Check whether this specific ticket has saved map coordinates in local database
      let hasCoords = false;
      const globalTickets = (typeof window !== 'undefined' && Array.isArray(window.tickets))
        ? window.tickets
        : (typeof tickets !== 'undefined' && Array.isArray(tickets) ? tickets : []);
      const localTicket = globalTickets.find(function(t){ return t && String(t.id) === String(item.id); }) || item;
      if(typeof MTToolsCore !== 'undefined' && typeof MTToolsCore.explicitCoordinates === 'function'){
        hasCoords = Boolean(MTToolsCore.explicitCoordinates(localTicket) || (MTToolsCore.parseCoordinates && MTToolsCore.parseCoordinates(localTicket && localTicket.geoLink)));
      } else if(localTicket){
        const lat = Number(localTicket.geoLat != null ? localTicket.geoLat : localTicket.lat);
        const lng = Number(localTicket.geoLng != null ? localTicket.geoLng : localTicket.lng);
        if(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180){
          hasCoords = true;
        } else if(localTicket.geoLink && String(localTicket.geoLink).trim().length > 0){
          hasCoords = true;
        }
      }

      if(typeof onMap === 'function' && hasCoords){
        const mapBtn = doc.createElement('button');
        mapBtn.type = 'button';
        mapBtn.className = 'btn btn-sm ai-card-map';
        mapBtn.setAttribute('data-ai-ticket-map-id', item.id);
        mapBtn.textContent = '🗺️ На карті';
        mapBtn.addEventListener('click', function(){
          onMap(item.id);
        });
        actionsRow.appendChild(mapBtn);
      }

      card.appendChild(actionsRow);
      return card;
    };

    items.slice(0, FIRST_PAGE).forEach(function(item){ box.appendChild(makeCard(item)); });

    if(items.length > FIRST_PAGE){
      const more = doc.createElement('button');
      more.type = 'button';
      more.className = 'btn btn-sm ai-cards-more';
      more.textContent = 'Показати ще (' + (items.length - FIRST_PAGE) + ')';
      more.addEventListener('click', function(){
        items.slice(FIRST_PAGE).forEach(function(item){ box.insertBefore(makeCard(item), more); });
        more.remove();
      });
      box.appendChild(more);
    }

    container.appendChild(box);
    return items.length;
  }

  function renderResultList(container, raw, total, shown){
    if(!Array.isArray(raw) || !raw.length) return 0;
    const doc = container.ownerDocument;
    const box = doc.createElement('div');
    box.className = 'ai-result-list';
    const meta = doc.createElement('div');
    meta.className = 'ai-result-list-meta';
    meta.textContent = 'Знайдено ' + Math.max(0, Number(total) || 0) + ' · показано ' + Math.max(0, Number(shown) || raw.length);
    box.appendChild(meta);
    const list = doc.createElement('ol');
    for(const item of raw.slice(0,100)){
      if(!item || typeof item !== 'object' || !validateTicketId(item.ticket_id)) continue;
      const li = doc.createElement('li');
      li.textContent = [String(item.date||'').trim(), String(item.time||'').trim(), String(item.address||'').trim(), String(item.type||'').trim()].filter(Boolean).join(' — ');
      list.appendChild(li);
    }
    box.appendChild(list);
    container.appendChild(box);
    return list.children.length;
  }

  function renderSingleLocal(container, rawId, onMap){
    const id = validateTicketId(rawId);
    if(!id) return false;
    const all = typeof tickets !== 'undefined' && Array.isArray(tickets) ? tickets
      : (typeof globalThis !== 'undefined' && Array.isArray(globalThis.tickets) ? globalThis.tickets : []);
    const ticket = all.find(function(item){ return item && String(item.id).trim() === id; });
    if(!ticket) return false;
    const doc = container.ownerDocument;
    const card = doc.createElement('div');
    card.className = 'ai-card ai-single-ticket';
    card.setAttribute('data-ai-ticket-card', id);
    const title = doc.createElement('div');
    title.className = 'ai-card-title';
    title.textContent = [ticket.date, ticket.time].filter(Boolean).join(' ');
    card.appendChild(title);
    const address = doc.createElement('div');
    address.className = 'ai-card-addr';
    address.textContent = [ticket.city, ticket.street, ticket.house].filter(Boolean).join(', ');
    card.appendChild(address);
    const actions = doc.createElement('div');
    actions.className = 'ai-card-actions';
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-sm ai-card-close';
    close.textContent = 'Закрити';
    close.addEventListener('click', function(){ card.remove(); });
    actions.appendChild(close);
    if(typeof onMap === 'function'){
      const map = doc.createElement('button');
      map.type = 'button';
      map.className = 'btn btn-sm ai-card-map';
      map.textContent = 'На карті';
      map.addEventListener('click', function(){ onMap(id); });
      actions.appendChild(map);
    }
    card.appendChild(actions);
    container.appendChild(card);
    return true;
  }

  return { normalize: normalize, render: render, renderResultList:renderResultList, renderSingleLocal:renderSingleLocal };
})();
})();

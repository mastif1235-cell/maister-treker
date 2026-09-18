/* AI: компактні картки заявок у чаті (мобільний UX). Контракт /ask:
   tickets:[{id,date,time,address,type,sum,signal,note}].
   Кнопки відкриття та карти ведуть ЛИШЕ через MTAI.actions.openTicket
   та MTAI.actions.showOnMap (валідація id + пошук у локальному списку +
   існуюча безпечна навігація). Жодних href/URL від моделі. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;

MTAI.cards = (function(){
  function normalize(list){
    if(!Array.isArray(list)) return [];
    const out = [];
    for(const item of list){
      if(!item || typeof item !== 'object') continue;
      const id = String(item.id == null ? '' : item.id).trim().slice(0, 64);
      if(!id || !/^[0-9a-zA-Z_\-]{1,64}$/.test(id)) continue;
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

  return { normalize: normalize, render: render };
})();
})();

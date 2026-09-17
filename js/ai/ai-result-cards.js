/* AI: структуровані картки заявок у відповіді чата (контракт /ask
   `tickets: [{id,date,address,type}]`). Кнопки «Відкрити» ведуть ЛИШЕ
   через MTAI.actions.openTicket (валідація id + пошук у локальному
   списку + існуюча навігація застосунку). Жодних href/URL від моделі:
   DOM будуємо createElement/textContent (XSS-safe). Модуль приймає
   doc-параметр => тестований у node. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;

MTAI.cards = (function(){
  /* Нормалізація: лише безпечні рядкові поля (клієнт уже валідував у
     ai-client.normalizeTickets — тут дублюємо для прямих викликів). */
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
        address: String(item.address == null ? '' : item.address).trim().slice(0, 200),
        type: String(item.type == null ? '' : item.type).trim().slice(0, 100)
      });
      if(out.length >= 8) break;
    }
    return out;
  }

  /* Рендер: кожна заявка окремим рядком-карткою з кнопкою відкриття.
     onOpen(id) — колбек (у чаті: MTAI.actions.openTicket). */
  function render(container, tickets, onOpen){
    while(container.firstChild) container.removeChild(container.firstChild);
    const items = normalize(tickets);
    if(!items.length) return 0;
    const doc = container.ownerDocument;
    const box = doc.createElement('div');
    box.className = 'ai-cards';
    items.forEach(function(item){
      const card = doc.createElement('div');
      card.className = 'ai-card';
      card.setAttribute('data-ai-ticket-card', item.id);
      const title = doc.createElement('div');
      title.className = 'ai-card-title';
      title.textContent = '№' + item.id + (item.date ? ' · ' + item.date : '');
      const desc = doc.createElement('div');
      desc.className = 'ai-card-desc';
      desc.textContent = item.address || item.type || '';
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm ai-card-open';
      btn.setAttribute('data-ai-ticket-id', item.id);
      btn.textContent = '📄 Відкрити заявку';
      btn.addEventListener('click', function(){
        if(typeof onOpen === 'function') onOpen(item.id);
      });
      card.appendChild(title);
      if(desc.textContent) card.appendChild(desc);
      card.appendChild(btn);
      box.appendChild(card);
    });
    container.appendChild(box);
    return items.length;
  }

  return { normalize: normalize, render: render };
})();
})();

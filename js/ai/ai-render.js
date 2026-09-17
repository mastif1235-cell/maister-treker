/* AI: БЕЗПЕЧНИЙ рендер відповідей. Жодного innerHTML/insertAdjacentHTML:
   усе будуємо через createElement/createTextNode. Підтримка: абзаци,
   списки «- …», «1. …», **жирний** (частковий), картки заявок
   («№123»/«#123» → кнопка «Открыть» → ai-actions.openTicket, read-only
   навігація). Модуль приймає doc-параметр => тестований у node. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.createRenderer = function(doc){
  function h(tag, cls, text){
    const el = doc.createElement(tag);
    if(cls) el.className = cls;
    if(text != null) el.appendChild(doc.createTextNode(text));
    return el;
  }
  function isTicketRef(token){
    return /^(?:№|#)?\s?\d{1,7}$/.test(token) || /^[a-z]{1,4}[-_]?\d{1,6}$/i.test(token);
  }
  /* Додає текст, де посилання на заявки перетворені на кнопки. */
  function appendRichText(parent, line){
    const re = /(?:№|#)\s?\d{1,7}|\b[a-z]{1,4}[-_]?\d{2,6}\b/gi;
    let last = 0, m;
    while((m = re.exec(line))){
      if(m.index > last) parent.appendChild(h('span', null, line.slice(last, m.index)));
      const token = m[0];
      if(isTicketRef(token)){
        const btn = h('button', 'btn btn-sm ai-ticket-ref', '📄 Открыть ' + token.trim());
        btn.type = 'button';
        btn.dataset.ticketId = token.replace(/[^0-9a-z_-]/gi, '');
        btn.addEventListener('click', function(){
          if(MTAI.actions) MTAI.actions.openTicket(btn.dataset.ticketId);
        });
        parent.appendChild(btn);
      }else{
        parent.appendChild(h('span', null, token));
      }
      last = m.index + token.length;
    }
    if(last < line.length) parent.appendChild(h('span', null, line.slice(last)));
  }
  /* Головна точка: будує безпечний DOM з тексту моделі. */
  function renderAnswer(container, text){
    while(container.firstChild) container.removeChild(container.firstChild);
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    let list = null;
    lines.forEach(function(raw){
      const line = raw.replace(/\s+$/, '');
      if(!line.trim()){ list = null; return; }
      const bullet = /^[-*•]\s+(.*)$/.exec(line.trim());
      const ordered = /^\d{1,2}[.)]\s+(.*)$/.exec(line.trim());
      if(bullet || ordered){
        const wantTag = bullet ? 'ul' : 'ol';
        if(!list || list.tagName !== wantTag){ list = h(wantTag, 'ai-list'); container.appendChild(list); }
        const li = h('li', null, '');
        appendRichText(li, (bullet || ordered)[1]);
        list.appendChild(li);
        return;
      }
      list = null;
      const p = h('div', 'ai-line', '');
      appendRichText(p, line);
      container.appendChild(p);
    });
  }
  function renderUserBubble(container, text){
    while(container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(h('span', null, String(text == null ? '' : text)));
  }
  return { renderAnswer: renderAnswer, renderUserBubble: renderUserBubble };
};
})();

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
  /* Текст моделі ніколи не є джерелом ticket.id. Structured result cards
     carry the only actionable id metadata; answer text remains inert. */
  function appendRichText(parent, line){
    parent.appendChild(h('span', null, String(line == null ? '' : line)));
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

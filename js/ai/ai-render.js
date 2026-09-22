/* AI: БЕЗПЕЧНИЙ рендер відповідей. Жодного innerHTML/insertAdjacentHTML:
   усе будуємо через createElement/createTextNode. Підтримка: абзаци,
   списки «- …», «1. …», **жирний** (частковий), картки заявок
   («№123»/«#123» → кнопка «Открыть» → ai-actions.openTicket, read-only
   навігація). Модуль приймає doc-параметр => тестований у node.

   v91.48: виправлено нумерацію 1,1,1. Причина була тут, а не в тексті
   моделі: порожній рядок і рядок-продовження закривали поточний <ol>
   (list = null), тож наступний пункт створював НОВИЙ <ol> — а браузер
   нумерує кожен <ol> з 1. Реальний вихід DeepSeek має між пунктами і
   порожні рядки, і рядки-продовження («— ремонт, 300 грн» з відступом),
   тому кожен пункт ставав окремим списком → «1. 1. 1.». Тепер:
   - порожній рядок НЕ закриває список;
   - рядок-продовження (з відступом або маркером —/–/•/·, а всередині
     нумерованого списку також «-») лишається всередині свого пункту;
   - список закриває лише звичайний текстовий рядок, тож два справді різні
     списки не склеюються;
   - номери пунктів малює сам <ol> (1,2,3…), незалежно від того, що
     написала модель. */
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
  /* Текст моделі ніколи не є джерелом ticket.id. Structured result cards
     carry the only actionable id metadata; answer text remains inert.
     **жирний** рендеримо як <strong> з текстових вузлів — без HTML. */
  function appendRichText(parent, line){
    const text = String(line == null ? '' : line);
    const parts = text.split('**');
    if(parts.length === 1){
      parent.appendChild(doc.createTextNode(text));
      return;
    }
    for(let i = 0; i < parts.length; i++){
      if(!parts[i]) continue;
      if(i % 2 === 1) parent.appendChild(h('strong', null, parts[i]));
      else parent.appendChild(doc.createTextNode(parts[i]));
    }
  }
  const ORDERED_RE = /^\d{1,2}[.)]\s+(.*)$/;
  const BULLET_RE = /^[-*•·]\s+(.*)$/;
  const DECORATIVE_RE = /^[—–•·]\s/;
  /* tagName у DOM — верхній регістр, у тестовому fake DOM — як створено:
     порівнюємо без регістру, щоб обидва середовища поводились однаково. */
  function isTag(el, tag){ return !!el && String(el.tagName).toLowerCase() === tag; }
  function isContinuation(line, list){
    if(/^\s/.test(line)) return true;                 /* відступ = продовження */
    const trimmed = line.trim();
    if(DECORATIVE_RE.test(trimmed)) return true;      /* —, –, •, · */
    /* «-» на початку рядка всередині НУМЕРОВАНОГО списку — це продовження
       пункту, а не новий маркований список (реальний формат DeepSeek). */
    return isTag(list, 'ol') && /^[-]\s/.test(trimmed);
  }
  /* Головна точка: будує безпечний DOM з тексту моделі. */
  function renderAnswer(container, text){
    while(container.firstChild) container.removeChild(container.firstChild);
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    let list = null;      /* відкритий <ul>/<ol> */
    let lastItem = null;  /* його останній <li> */
    lines.forEach(function(raw){
      const line = raw.replace(/\s+$/, '');
      if(!line.trim()) return;                        /* порожній рядок список НЕ закриває */
      const trimmed = line.trim();
      const indented = /^\s/.test(line);
      const ordered = indented ? null : ORDERED_RE.exec(trimmed);
      const bullet = indented ? null : BULLET_RE.exec(trimmed);
      if(ordered){
        if(!isTag(list, 'ol')){ list = h('ol', 'ai-list'); container.appendChild(list); }
        lastItem = h('li', null, '');
        appendRichText(lastItem, ordered[1]);
        list.appendChild(lastItem);
        return;
      }
      if(bullet){
        if(!isTag(list, 'ul')){ list = h('ul', 'ai-list'); container.appendChild(list); }
        lastItem = h('li', null, '');
        appendRichText(lastItem, bullet[1]);
        list.appendChild(lastItem);
        return;
      }
      if(list && lastItem && isContinuation(line, list)){
        const cont = h('div', 'ai-li-cont', '');
        appendRichText(cont, trimmed);
        lastItem.appendChild(cont);
        return;
      }
      list = null;
      lastItem = null;
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

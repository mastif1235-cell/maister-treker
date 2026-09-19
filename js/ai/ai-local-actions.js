/* AI: ЛОКАЛЬНІ дії, які неможливо виконати на backend'і. Мережеві точки
   (ФОБ/муфта/вузол/інше) живуть ЛИШЕ на пристрої (localStorage) і ніколи
   не синхронізуються у Worker чи Google Sheets — тому /ask повертає
   структурований запит (localQuery), а цей модуль виконує його по власних
   локальних даних і показує безпечну дію «На карті» через наявний
   toolsFocusNetworkPoint. Жодних координат чи карт від моделі. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;

/* Слова-паразити пошукового запиту: прибираємо, щоб довге природне питання
   не ставало голкою пошуку. «посадка» НЕ стоп-слово — це реальна ознака
   місця в нотатках точок. */
const STOP_RE = /^(фоб|фобу|фоба|фобі|муфт[ауі]?|муфты|вузол|вузла|вузлі|знайди|найди|покажи|покажіть|де|в|у|на|і|та|й|був|була|було|були|были|десь|приблизно|примерно|прибл|минулого|минулому|прошлом|прошлый|прошлую|місяці|месяце|тижні|неделе|мережева|мережеві|сетевая|точка|точки|точок|цього|цей|цю|цього|ета|етот|эту|был|была|было|где|я|якої|який|яка|які|какие|какая|какой|скільки|сколько|що|что|щось|тоді|потім|карті|карте|мапі)$/i;

function normUk(value){
  return String(value == null ? '' : value).toLocaleLowerCase('uk')
    .replace(/ё/g, 'е').replace(/ы/g, 'и').replace(/э/g, 'е');
}

const STEM_SUFFIXES = ['ями', 'ами', 'ому', 'ему', 'ому', 'ім', 'им', 'ого', 'его', 'ові', 'еві', 'ів', 'ев', 'ов', 'ій', 'ий', 'ой', 'ах', 'ях', 'ом', 'ем', 'у', 'ю', 'і', 'и', 'а', 'я', 'е', 'о', 'ь'];

/* Легкий детермінований стемінг: зрізаємо до двох закінчень, щоб природні
   відмінкові форми («посадке»/«посадці», «Таромском»/«Таромське»)
   збігалися без жодного вгадування. */
function stemUk(word){
  let w = normUk(word).replace(/[іїй]/g, 'и');
  for(let pass = 0; pass < 2; pass++){
    let stripped = false;
    for(const suf of STEM_SUFFIXES){
      if(w.length - suf.length >= 3 && w.endsWith(suf)){ w = w.slice(0, w.length - suf.length); stripped = true; break; }
    }
    if(!stripped) break;
  }
  return w;
}

function stemsMatch(a, b){
  if(!a || !b) return false;
  if(a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if(minLen >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if(minLen >= 5 && a.slice(0, 5) === b.slice(0, 5)) return true;
  return false;
}

function stemTokens(value){
  return normUk(value).split(/[^0-9a-zа-яїієґ']+/).filter(Boolean).map(stemUk);
}

function dateKeyToTime(value, endOfDay){
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value || ''));
  if(!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/* Чистий детермінований фільтр (тестується без DOM/глобалів застосунку). */
function filterPoints(points, query){
  const list = Array.isArray(points) ? points : [];
  const q = query || {};
  const wantedType = String(q.type || '').trim();
  const tokens = normUk(q.text || '').split(/[^0-9a-zа-яїієґ']+/)
    .filter(function(tok){ return tok.length >= 3 && !STOP_RE.test(tok); })
    .map(stemUk);
  const fromTs = dateKeyToTime(q.date_from, false);
  const toTs = dateKeyToTime(q.date_to, true);
  const out = [];
  for(const point of list){
    if(!point || typeof point !== 'object') continue;
    if(wantedType && String(point.type || '') !== wantedType) continue;
    if(fromTs != null || toTs != null){
      const created = Date.parse(String(point.createdAt == null ? '' : point.createdAt));
      if(!Number.isFinite(created)) continue;
      if(fromTs != null && created < fromTs) continue;
      if(toTs != null && created > toTs) continue;
    }
    if(tokens.length){
      const haystackStems = stemTokens([point.id, point.type, point.name, point.label, point.city, point.street, point.house, point.note].join(' '));
      if(!tokens.every(function(tok){ return haystackStems.some(function(h){ return stemsMatch(tok, h); }); })) continue;
    }
    out.push(point);
  }
  if(typeof MTAI !== 'undefined' && MTAI.localActions && MTAI.localActions._sortNewest){
    return MTAI.localActions._sortNewest(out);
  }
  return out;
}

MTAI.localActions = {
  filterPoints: filterPoints,

  /* Виконати запит /ask по ЛОКАЛЬНИХ точках мережі. Повертає компактну
     проєкцію (без координат) — для картки результату в чаті. */
  searchNetworkPoints: function(query){
    const source = (typeof toolsNetworkPoints !== 'undefined' && Array.isArray(toolsNetworkPoints)) ? toolsNetworkPoints : [];
    let points = source;
    if(typeof MTToolsCore !== 'undefined' && typeof MTToolsCore.sanitizeNetworkPoints === 'function'){
      points = MTToolsCore.sanitizeNetworkPoints(source);
    }
    const found = filterPoints(points, query).slice(0, 12);
    return found.map(function(point){
      const address = (typeof MTToolsCore !== 'undefined' && typeof MTToolsCore.networkPointAddress === 'function')
        ? MTToolsCore.networkPointAddress(point)
        : [point.city, point.street, point.house].filter(Boolean).join(', ');
      return {
        id: String(point.id == null ? '' : point.id).slice(0, 64),
        type: String(point.type || '').slice(0, 20),
        name: String(point.name || '').slice(0, 120),
        address: String(address || '').slice(0, 160),
        note: String(point.note || '').slice(0, 120),
        createdAt: String(point.createdAt == null ? '' : point.createdAt).slice(0, 40)
      };
    });
  },

  /* Показати точку на карті застосунку — наявний безпечний механізм
     (фокус карти + деталі точки). Тільки за валідним локальним id. */
  focusNetworkPoint: function(id){
    const clean = String(id || '').replace(/[^0-9a-zа-яіїєг_-]/gi, '');
    if(!clean) return false;
    if(typeof toolsFocusNetworkPoint === 'function'){
      try{ toolsFocusNetworkPoint(clean); return true; }catch(_e){ return false; }
    }
    return false;
  },

  _sortNewest: function(list){
    if(typeof MTToolsCore !== 'undefined' && typeof MTToolsCore.sortNewestFirst === 'function'){
      return MTToolsCore.sortNewestFirst(list);
    }
    return list.slice().sort(function(a, b){
      return Date.parse(String(b.createdAt || '')) - Date.parse(String(a.createdAt || ''));
    });
  },

  /* Рендер результату локального пошуку в бульбашці відповіді. */
  renderResults: function(container, query){
    if(!container || !query) return 0;
    const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if(!doc) return 0;
    const results = MTAI.localActions.searchNetworkPoints(query);
    const box = doc.createElement('div');
    box.className = 'ai-cards';
    const title = doc.createElement('div');
    title.className = 'ai-local-note';
    title.style.cssText = 'font-size:12px;opacity:.8;margin-top:6px;';
    if(!results.length){
      title.textContent = '📡 Серед локальних точок мережі нічого не знайдено за цим запитом.' + (query.period_note ? ' (' + query.period_note + ')' : '');
      box.appendChild(title);
      container.appendChild(box);
      return 0;
    }
    title.textContent = '📡 Локальний пошук мережевих точок на пристрої:' + (query.period_note ? ' (' + query.period_note + ')' : '');
    box.appendChild(title);
    results.forEach(function(point){
      const card = doc.createElement('div');
      card.className = 'ai-card';
      card.setAttribute('data-ai-network-point', point.id);
      const head = doc.createElement('div');
      head.className = 'ai-card-title';
      head.textContent = [point.type, point.name].filter(Boolean).join(' · ');
      card.appendChild(head);
      if(point.address){
        const addr = doc.createElement('div');
        addr.className = 'ai-card-addr';
        addr.textContent = point.address;
        card.appendChild(addr);
      }
      const facts = [point.note, point.createdAt ? new Date(point.createdAt).toLocaleString('uk-UA') : ''].filter(Boolean).join(' · ');
      if(facts){
        const f = doc.createElement('div');
        f.className = 'ai-card-facts';
        f.textContent = facts;
        card.appendChild(f);
      }
      const actions = doc.createElement('div');
      actions.className = 'ai-card-actions';
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm ai-point-map';
      btn.setAttribute('data-ai-point-id', point.id);
      btn.textContent = '📍 Показати на карті';
      btn.addEventListener('click', function(){ MTAI.localActions.focusNetworkPoint(point.id); });
      actions.appendChild(btn);
      card.appendChild(actions);
      box.appendChild(card);
    });
    container.appendChild(box);
    return results.length;
  }
};
})();

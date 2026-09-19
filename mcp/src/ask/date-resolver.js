/* Детермінований резолвер дат для /ask (RU + UA, змішана мова).
   Модель отримує обчислені діапазони разом із контекстом дати — їй НЕ
   треба ні питати користувача про поточну дату, ні рахувати «прошлый
   месяц» самостійно. Підтримувані вирази:
     сегодня/сьогодні, вчера/вчора, позавчера/позавчора,
     эта неделя/цей тиждень, прошлая неделя/минулий тиждень,
     этот месяц/цей місяць, прошлый месяц/минулий місяць,
     за месяц/за місяць, с начала месяца/з початку місяця,
     последние N дней/останні N днів (7/14/30…),
     назви місяців UA/RU (+ відмінки) з опціональним роком.
   Правило року для місяця без року: поточний рік; якщо цей місяць ще
   не настав — попередній рік (у майбутньому даних немає). */

function pad(n){ return String(n).padStart(2, '0'); }
function fmt(d){ return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); }
function addDays(d, days){ return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days); }
function monthRange(year, monthIdx){
  return { from: new Date(year, monthIdx, 1), to: new Date(year, monthIdx + 1, 0) };
}
function mondayOf(d){
  const day = (d.getDay() + 6) % 7; // 0 = понеділок
  return addDays(d, -day);
}

/* Стебли назв місяців (індекс = номер місяця - 1). Змінювані UA/RU
   закінчення (серпень/серпня/август/августа) покриваються стеблом. */
const MONTH_STEMS = [
  ['січн', 'январ'],
  ['лют', 'феврал'],
  ['берез', 'март'],
  ['квіт', 'апрел'],
  ['трав', 'ма[ейя]'],
  ['черв', 'июн'],
  ['лип', 'июл'],
  ['серп', 'август'],
  ['верес', 'сентябр'],
  ['жовт', 'октябр'],
  ['листопад', 'ноябр'],
  ['груд', 'декабр']
];

/* Межі слова: \b у JS не працює з кирилицею — власні guard-и. */
const L = '(?<![a-zа-яїієґ0-9])';
const R = '(?![a-zа-яїієґ0-9])';
const MONTH = '(місяц|месяц)'; // UA «місяць/місяця» + RU «месяц/месяца»

function pushRange(out, phrase, from, to, meta){
  for(const item of out){
    if(item.from === fmt(from) && item.to === fmt(to) && !item.approximate) return; // без дублів
  }
  const entry = { phrase, from: fmt(from), to: fmt(to) };
  if(meta && meta.approximate){
    entry.approximate = true;
    entry.note = meta.note || 'розширено ±' + APPROX_PAD_DAYS + ' дні (приблизно)';
  }
  out.push(entry);
}

/* «Приблизно/примерно» expands any resolved window by a deterministic,
   documented padding — the model never invents its own fuzzy range. */
const APPROX_PAD_DAYS = 3;
const APPROX_RE = /(приблизно|примерно|прибл\.?|десь|ориентовно|примерн)/;

function expandApprox(from, to){
  return { from: addDays(from, -APPROX_PAD_DAYS), to: addDays(to, APPROX_PAD_DAYS) };
}

/* Sub-month phases: deterministic documented windows.
   начало/початок = 1..10; середина = 11..20; кінець/конец = 21..останній день. */
const PHASE_RE = /(початок|початку|середин[аиу]|кінець|кінці|конец|конце|начала|начало)/;
function phaseBounds(phaseText, year, monthIdx){
  const first = new Date(year, monthIdx, 1);
  const last = new Date(year, monthIdx + 1, 0);
  if(/початок|початку|начала|начало/.test(phaseText)) return { from: first, to: new Date(year, monthIdx, 10) };
  if(/середин/.test(phaseText)) return { from: new Date(year, monthIdx, 11), to: new Date(year, monthIdx, 20) };
  return { from: new Date(year, monthIdx, 21), to: last };
}

/* Month (index) mentioned anywhere in the text via MONTH_STEMS, else null. */
function findMonthInText(t, now){
  const yearRe = new RegExp('(20\\d{2})');
  for(let idx = 0; idx < MONTH_STEMS.length; idx++){
    for(const stem of MONTH_STEMS[idx]){
      const re = new RegExp(L + '(' + stem + '[а-яїієґ]*)' + R);
      const m = re.exec(t);
      if(!m) continue;
      const ym = yearRe.exec(t.slice(m.index));
      let year = now.getFullYear();
      if(ym) year = parseInt(ym[1], 10);
      else if(idx > now.getMonth()) year = now.getFullYear() - 1;
      return {idx, year, word:m[1]};
    }
  }
  return null;
}

export function resolveDateRanges(text, now){
  const t = String(text == null ? '' : text).toLowerCase().replace(/ё/g, 'е');
  const out = [];

  if(new RegExp(L + '(сьогодні|сегодня)' + R).test(t)) pushRange(out, 'сьогодні/сегодня', now, now);
  if(new RegExp(L + '(вчора|вчера)' + R).test(t)) pushRange(out, 'вчора/вчера', addDays(now, -1), addDays(now, -1));
  if(new RegExp(L + '(позавчора|позавчера)' + R).test(t)) pushRange(out, 'позавчора/позавчера', addDays(now, -2), addDays(now, -2));

  if(new RegExp(L + '(цей|цью|этот|эту)\\s+недел').test(t) || new RegExp(L + 'на\\s+(цому|этой)\\s+недел').test(t)){
    const mon = mondayOf(now);
    pushRange(out, 'цей тиждень/эта неделя', mon, addDays(mon, 6));
  }
  if(new RegExp(L + '(минулий|минулого|минулої|прошлый|прошлого|прошлую|прошлой)\\s+недел').test(t)){
    const mon = addDays(mondayOf(now), -7);
    pushRange(out, 'минулий тиждень/прошлая неделя', mon, addDays(mon, 6));
  }

  if(new RegExp(L + '(цей|цого|этот|этого|поточний|поточного|текущий|текущего)\\s+' + MONTH).test(t)){
    const r = monthRange(now.getFullYear(), now.getMonth());
    pushRange(out, 'цей місяць/этот месяц', r.from, r.to);
  }
  if(new RegExp(L + '(минулий|минулого|минулому|прошлый|прошлого|прошлом|прошлым)\\s+' + MONTH).test(t)){
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const r = monthRange(prev.getFullYear(), prev.getMonth());
    pushRange(out, 'минулий місяць/прошлый месяц', r.from, r.to);
  }
  /* «за місяць/за месяц» без «прошлый/цей» = поточний місяць */
  if(new RegExp(L + 'за\\s+' + MONTH).test(t) &&
     !new RegExp(L + '(минулий|минулого|прошлый|прошлого|цей|цого|этот|этого)\\s+' + MONTH).test(t)){
    const r = monthRange(now.getFullYear(), now.getMonth());
    pushRange(out, 'за місяць/за месяц', r.from, r.to);
  }

  if(new RegExp(L + '(з початку|с начала)\\s+' + MONTH).test(t)){
    pushRange(out, 'з початку місяця/с начала месяца', new Date(now.getFullYear(), now.getMonth(), 1), now);
  }

  const lastDays = new RegExp(L + '(останні|последние)\\s+(\\d{1,3})\\s+(днів|дней|дня)').exec(t) ||
                   new RegExp(L + 'за\\s+(останні|последние)\\s+(\\d{1,3})\\s+(дні|дня|дней)').exec(t);
  if(lastDays){
    const n = Math.min(Math.max(parseInt(lastDays[2], 10), 1), 365);
    pushRange(out, 'останні/последние ' + n + ' дн.', addDays(now, -(n - 1)), now);
  }
  if(new RegExp(L + 'за\\s+(тиждень|неделю)' + R).test(t)){
    pushRange(out, 'за тиждень/за неделю', addDays(now, -6), now);
  }

  /* «Приблизно/примерно Н тижнів тому» — детерміноване вікно: рівно Н
     тижнів тому, розширене ±3 дні (документований запас). */
  const approxWeeksAgo = new RegExp(L + '(?:приблизно|примерно|десь)\\s+(?:один|одну|два|две|дві|1|2)\\s+(?:тижн|недел)[а-яїієґ]*\\s+(?:тому|назад)').exec(t);
  if(approxWeeksAgo){
    const weeks = /два|две|дві|2/.test(approxWeeksAgo[0]) ? 2 : 1;
    const from = addDays(now, -(weeks * 7 + APPROX_PAD_DAYS));
    const to = addDays(now, -(weeks * 7 - 1) + APPROX_PAD_DAYS);
    pushRange(out, 'приблизно ' + weeks + ' тиж. тому', from, to, {approximate:true});
  }

  /* Фази місяця: «початок/середина/кінець місяця», «в конце августа».
     Межі фіксовані й документовані: 1–10 / 11–20 / 21–останній день;
     «приблизно» розширює вікно ±3 дні. */
  const phaseMatch = PHASE_RE.exec(t);
  if(phaseMatch){
    const mentioned = findMonthInText(t, now);
    const year = mentioned ? mentioned.year : now.getFullYear();
    const monthIdx = mentioned ? mentioned.idx : now.getMonth();
    const bounds = phaseBounds(phaseMatch[0], year, monthIdx);
    const approximate = APPROX_RE.test(t);
    const window = approximate ? expandApprox(bounds.from, bounds.to) : bounds;
    const label = mentioned ? '«' + phaseMatch[0] + '» ' + mentioned.word + ' ' + year : '«' + phaseMatch[0] + '» поточного місяця';
    pushRange(out, label, window.from, window.to, approximate ? {approximate:true} : null);
  }

  /* Назви місяців (+ рік). Рік: з тексту, інакше поточний; якщо місяць ще
     не настав цього року — попередній рік (даних у майбутньому немає).
     Якщо поруч указана фаза («в конце августа») — повний місяць не
     дублюємо: діапазон фази точніший. */
  const yearRe = new RegExp('(20\\d{2})');
  MONTH_STEMS.forEach(function(stems, idx){
    for(const stem of stems){
      const re = new RegExp(L + '(' + stem + '[а-яїієґ]*)' + R);
      const m = re.exec(t);
      if(!m) continue;
      if(phaseMatch) break; /* фазове вікно вже покриває цей місяць */
      const ym = yearRe.exec(t.slice(m.index));
      let year = now.getFullYear();
      if(ym) year = parseInt(ym[1], 10);
      else if(idx > now.getMonth()) year = now.getFullYear() - 1; // цього року ще не настав
      const r = monthRange(year, idx);
      pushRange(out, m[1] + ' ' + year, r.from, r.to);
      break;
    }
  });

  return out;
}

/* Рядок-підказка для системного повідомлення: знайдені вирази з діапазонами. */
export function dateHintsLine(text, now){
  const ranges = resolveDateRanges(text, now);
  if(!ranges.length) return '';
  return 'Обчислені періоди із запиту: ' +
    ranges.map(function(r){ return '«' + r.phrase + '» = ' + r.from + '–' + r.to + (r.note ? ' (' + r.note + ')' : ''); }).join('; ') + '.';
}

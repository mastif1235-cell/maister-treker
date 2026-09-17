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

function pushRange(out, phrase, from, to){
  for(const item of out){
    if(item.from === fmt(from) && item.to === fmt(to)) return; // без дублів
  }
  out.push({ phrase, from: fmt(from), to: fmt(to) });
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
  if(new RegExp(L + '(минулий|минулого|прошлый|прошлого|прошлую)\\s+недел').test(t)){
    const mon = addDays(mondayOf(now), -7);
    pushRange(out, 'минулий тиждень/прошлая неделя', mon, addDays(mon, 6));
  }

  if(new RegExp(L + '(цей|цого|этот|этого|поточний|поточного|текущий|текущего)\\s+' + MONTH).test(t)){
    const r = monthRange(now.getFullYear(), now.getMonth());
    pushRange(out, 'цей місяць/этот месяц', r.from, r.to);
  }
  if(new RegExp(L + '(минулий|минулого|прошлый|прошлого)\\s+' + MONTH).test(t)){
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

  /* Назви місяців (+ рік). Рік: з тексту, інакше поточний; якщо місяць ще
     не настав цього року — попередній рік (даних у майбутньому немає). */
  const yearRe = new RegExp('(20\\d{2})');
  MONTH_STEMS.forEach(function(stems, idx){
    for(const stem of stems){
      const re = new RegExp(L + '(' + stem + '[а-яїієґ]*)' + R);
      const m = re.exec(t);
      if(!m) continue;
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
    ranges.map(function(r){ return '«' + r.phrase + '» = ' + r.from + '–' + r.to; }).join('; ') + '.';
}

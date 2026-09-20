/* Address normalization, extraction and resolution for MCP and /ask.
   Pure functions, no I/O, no network, deterministic.

   Security & Safety:
   - Real candidate places ALWAYS come from the user data (tickets).
   - Normalization bridges common Ukrainian ↔ Russian spelling differences
     and common typos without inventing new entities.
   - Confidence scoring ensures high precision: ambiguous or uncertain
     queries return candidate suggestions for clarification rather than
     falsely matching an arbitrary street. */

export function cleanStr(s){
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/["'`’]/g, '').trim();
}

/* v91.45: single deterministic city IDENTITY key. Built from the same
   normalization cityMatches/normalizeStem already use (UA↔RU bridges), so
   «Таромське» and «Таромское» collapse into one key. Trailing-digit guard:
   pure-digit tokens are kept verbatim in the key — «Миколаївка 1» and
   «Миколаївка 2» must NEVER merge. The key is internal only; UI display
   always stays a real human variant from the data. */
export function canonicalCityKey(city){
  return placeIdentity(city);
}

/* Deterministic UA↔RU toponym root aliases. These are the SAME place name
   in two languages, not similar names: applied only to whole reduced stems
   («Новомиколаївка» → stem «новомикола» is untouched). */
const CITY_STEM_ALIASES = [
  ['никола', 'микола'],       /* Николаевка ↔ Миколаївка */
  ['александр', 'олександр'], /* Александровка ↔ Олександрівка */
  ['елизавет', 'єлизавет'],
  ['екатерин', 'катерин']
];

/* Explicit UA↔RU root pairs (ROOT_TRANSLATIONS) are the same kind of proof
   as CITY_STEM_ALIASES: the two spellings are one name in two languages. */
function rootTranslationApplies(word){
  const w = cleanStr(word);
  for(const [pat] of ROOT_TRANSLATIONS){
    if(pat.test(w)) return true;
  }
  return false;
}

function aliasStem(stem){
  for(const pair of CITY_STEM_ALIASES){
    if(stem === pair[0]) return pair[1];
  }
  return stem;
}

/* Textual ordinals → digit part. Explicit closed list (1..10, UA+RU common
   forms); anything else stays a plain word and never becomes a digit. */
const ORDINAL_TO_DIGIT = Object.create(null);
(function(){
  const table = {
    1: ['перша','перший','перше','першою','першому','першій','першого','першу','первая','первый','первое','первой','первую','первом','перві'],
    2: ['друга','другий','друге','другою','другому','другій','другого','другу','вторая','второй','второе','втором'],
    3: ['третя','третій','третє','третьою','третьому','третьої','третю','третья','третье','третьей','третью','третьему'],
    4: ['четверта','четвертий','четверте','четверту','четвертая','четвертый','четвертое','четвертой','четвертую'],
    5: ['пята','пятий','пяте','пятою','пятая','пятый','пятое','пятой','пятую'],
    6: ['шоста','шостий','шосте','шосту','шестая','шестой','шестое','шестую'],
    7: ['сьома','сьомий','сьоме','сьому','семая','семой','семый','семое','седьмая','седьмой','седьмое'],
    8: ['восьма','восьмий','восьме','восьму','восьмая','восьмой','восьмое','восьмую'],
    9: ['девята','девятий','девять','девятая','девятой','девятую'],
    10: ['десята','десятий','десяте','десяту','десятая','десятый','десятое','десятой','десятую']
  };
  for(const digit of Object.keys(table)){
    for(const word of table[digit]) ORDINAL_TO_DIGIT[word] = digit;
  }
})();

export function ordinalToDigit(word){
  return ORDINAL_TO_DIGIT[cleanStr(word)] || null;
}

/* Split a place value into letter stems and digit parts. Handles:
   «Миколаївка1» (no space) → [миколаївка]+[1]; «Миколаївка перша»
   (ordinal) → [миколаївка]+[1]; «Николаевка 1» (RU) → [микола]+[1];
   «Николаевке» (case form) → [микола]. Digits are identity-bearing. */
const NOISE_TOKENS = new Set(['в','у','во','на','с','из','до','от','із','та','и','й']);
const STREET_PREFIX_TOKENS = new Set(['вул','вулиця','улица','ул','просп','проспект','пр','пров','переулок','пер','бул','бульвар','наб','набережна','набережная','шосе','шоссе','спуск','узвіз','тракт','алея','площа','площадь','майдан']);

export function placeTokens(value){
  const letters = [];
  const digits = [];
  const state = {aliased: false};
  const cleaned = cleanStr(value);
  if(!cleaned) return {letters, digits};
  const tokens = cleaned.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for(const tok of tokens){
    if(/^\d+$/.test(tok)){ digits.push(String(Number(tok))); continue; }
    const ordinal = ORDINAL_TO_DIGIT[tok];
    if(ordinal){ digits.push(ordinal); continue; }
    if(NOISE_TOKENS.has(tok) || STREET_PREFIX_TOKENS.has(tok)) continue;
    const glued = /^(\p{L}+?)(\d{1,4})$/u.exec(tok);
    if(glued){
      const stem = normalizeStem(glued[1]);
      const aliased = aliasStem(stem);
      if(aliased !== stem) state.aliased = true;
      if(stem) letters.push(aliased);
      digits.push(String(Number(glued[2])));
      continue;
    }
    const stem = normalizeStem(tok);
    const aliased = aliasStem(stem);
    if(aliased !== stem) state.aliased = true;
    else if(rootTranslationApplies(tok)) state.aliased = true;
    if(stem) letters.push(aliased);
  }
  return {letters, digits, aliased: state.aliased};
}

/* True when a UA↔RU alias translation took part in reducing this value:
   direct evidence that the value is the OTHER language's spelling of a
   name, which is exactly when two different-looking surfaces are allowed
   to be the same place. */
export function aliasApplied(value){
  return placeTokens(value).aliased;
}

/* Readable surface of a place value: service words («вул», «ул.») dropped,
   textual ordinals folded to their digit, number tokens normalized, the
   remaining spelling kept AS WRITTEN. Used only to verify that two values
   with one identity key really look like the same name. */
export function placeSurface(value){
  const tokens = cleanStr(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = [];
  for(const tok of tokens){
    if(/^\d+$/.test(tok)){ out.push(String(Number(tok))); continue; }
    const ordinal = ORDINAL_TO_DIGIT[tok];
    if(ordinal){ out.push(ordinal); continue; }
    if(NOISE_TOKENS.has(tok) || STREET_PREFIX_TOKENS.has(tok)) continue;
    out.push(tok);
  }
  return out.join(' ');
}

/* Two values are the SAME place when the identity keys agree AND the
   surface forms are compatible: identical, explained by the UA↔RU alias
   table, prefix-related, or within a tiny edit distance (typos, inflected
   forms). Genuinely different derivations that merely share a stem
   («Виноградна» vs «Виноградівська») are NOT merged — identity equality
   alone is never enough to fuse two readable names. */
export function placeCompatible(a, b){
  const ia = placeIdentity(a), ib = placeIdentity(b);
  if(!ia || !ib || ia !== ib) return false;
  const ra = placeSurface(a), rb = placeSurface(b);
  if(!ra || !rb) return false;
  if(ra === rb) return true;
  if(aliasApplied(cleanStr(a)) || aliasApplied(cleanStr(b))) return true;   /* explicit RU↔UA pair */
  const maxLen = Math.max(ra.length, rb.length);
  if(ra.startsWith(rb) || rb.startsWith(ra)){
    const minLen = Math.min(ra.length, rb.length);
    if(minLen >= 4 && (minLen / maxLen) >= 0.7) return true;
  }
  /* Same word stem, difference confined to the ENDING, and the whole word
     barely longer/shorter — that is a UA↔RU ending pair («Таромське» /
     «Таромское») or a case form. Encoded derivations that change the word
     («Виноградна» / «Виноградівська») differ too much in length: rejected. */
  if(stemSurface(ra) === stemSurface(rb) && Math.abs(ra.length - rb.length) <= 2) return true;
  const dist = damerauLevenshtein(ra, rb);
  if(maxLen >= 10) return dist <= 2;
  if(maxLen >= 6) return dist <= 1;
  return dist === 0;
}

/* The surface with the language/case ending removed from every token. */
export function stemSurface(surface){
  return String(surface || '').split(' ').map(function(tok){
    if(/^\d+$/.test(tok)) return tok;
    return tok.replace(SUFFIX_RE, '');
  }).join(' ');
}

/* Deterministic identity key of a city or street value. Equal key = the
   same place under catalog semantics; different key = a different place. */
export function placeIdentity(value){
  const t = placeTokens(value);
  if(!t.letters.length && !t.digits.length) return '';
  return t.letters.join(' ') + (t.digits.length ? '#' + t.digits.join('#') : '');
}

const PREFIX_RE = /^(?:вул(?:иця|\.)?|ул(?:ица|\.)?|просп(?:ект|\.)?|пр(?:-кт|\.)?|пров(?:улок|\.)?|пер(?:еулок|\.)?|бул(?:ьвар|\.)?|наб(?:ережна|\.)?|тупик|узвіз|спуск|шосе|тракт|алея)\s+/i;
const SUFFIX_RE = /(?:івською|івської|івському|івська|івську|івські|івське|івський|евскою|евской|евском|евского|евскому|евская|евскую|евские|евское|евский|євскою|євской|євском|євского|євскому|євская|євскую|євские|євское|євский|овською|овської|овському|овська|овську|овські|овське|овський|овскою|овской|овском|овского|овскому|овская|овскую|овские|овское|овский|ського|ского|ському|скому|ськом|ском|ський|ский|ська|ская|ське|ское|ські|ские|ських|ских|ської|ской|ового|евого|євого|овому|евому|євому|овою|евою|євою|овой|евой|євой|овую|евую|євую|овая|евая|євая|ївками|івками|евками|овками|ївках|івках|евках|овках|ївкою|івкою|евкою|овкою|евке|овке|ївці|івці|евці|овці|ївок|івок|евок|овок|ївки|івки|евки|овки|ївка|ївку|івку|евку|овку|евої|ової|евій|овій|евому|овому|евим|овим|еві|ові|еве|ове|еву|ову|івка|овка|евка|євка|ова|ева|єва|ову|еву|єву|ное|не|ном|ним|нем|ная|на|ний|ный|ного|ному|ної|ной|ої|ой|ями|ами|ях|ах|ям|ам|ому|ем|єм|ом|ая|яя|ий|ій|ый|ой|ка|ко|ів|ев|ов|а|я|е|є|о|у|ю|і|ы|и)$/i;

const ROOT_TRANSLATIONS = [
  [/^ліс/i, 'лес'],
  [/^лес/i, 'лес'],
  [/^підгород/i, 'подгород'],
  [/^подгород/i, 'подгород'],
  [/^молодіж/i, 'молодеж'],
  [/^молодеж/i, 'молодеж'],
  [/^залізнич/i, 'железнодорож'],
  [/^железнодорож/i, 'железнодорож'],
  [/^півден/i, 'южн'],
  [/^южн/i, 'южн'],
  [/^північ/i, 'северн'],
  [/^северн/i, 'северн'],
  [/^схід/i, 'восточн'],
  [/^восточн/i, 'восточн'],
  [/^захід/i, 'западн'],
  [/^западн/i, 'западн'],
  [/^степов/i, 'степн'],
  [/^степн/i, 'степн'],
  [/^польов/i, 'полев'],
  [/^полев/i, 'полев'],
  [/^шкільн/i, 'школьн'],
  [/^школьн/i, 'школьн'],
  [/^сонячн/i, 'солнечн'],
  [/^солнечн/i, 'солнечн'],
  [/^яблун/i, 'яблочн'],
  [/^яблочн/i, 'яблочн'],
  [/^квітков/i, 'цветочн'],
  [/^цветочн/i, 'цветочн'],
  [/^вишнев/i, 'вишнев'],
  [/^дніпр/i, 'днепр'],
  [/^днепр/i, 'днепр']
];

export function normalizeStem(word){
  let w = cleanStr(word);
  w = w.replace(PREFIX_RE, '').trim();
  for(const [pat, repl] of ROOT_TRANSLATIONS){
    if(pat.test(w)){
      w = w.replace(pat, repl);
      break;
    }
  }
  w = w.replace(SUFFIX_RE, '');
  w = w.replace(/і/g, 'и').replace(/ї/g, 'и').replace(/ы/g, 'и').replace(/э/g, 'е').replace(/ь/g, '');
  return w;
}

export function damerauLevenshtein(a, b){
  const al = a.length, bl = b.length;
  if(!al) return bl;
  if(!bl) return al;
  const matrix = [];
  for(let i = 0; i <= al; i++){
    matrix[i] = [i];
    for(let j = 1; j <= bl; j++){
      if(i === 0) matrix[i][j] = j;
      else matrix[i][j] = 0;
    }
  }
  for(let i = 1; i <= al; i++){
    for(let j = 1; j <= bl; j++){
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
      if(i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]){
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
      }
    }
  }
  return matrix[al][bl];
}

export function matchScore(candidate, query){
  const cNorm = normalizeStem(candidate);
  const qNorm = normalizeStem(query);
  if(!cNorm || !qNorm) return 0;
  if(cNorm === qNorm) return 1.0;
  if(cNorm.startsWith(qNorm) || qNorm.startsWith(cNorm)){
    const minLen = Math.min(cNorm.length, qNorm.length);
    const maxLen = Math.max(cNorm.length, qNorm.length);
    if(minLen >= 3 && (minLen / maxLen) >= 0.7) return 0.92;
  }
  const dist = damerauLevenshtein(cNorm, qNorm);
  const maxLen = Math.max(cNorm.length, qNorm.length);
  if(maxLen <= 3) return dist === 0 ? 1.0 : 0.0;
  if(maxLen <= 5){
    if(dist === 1) return 0.82;
    return 0.0;
  }
  if(dist === 1) return 0.88;
  if(dist === 2 && maxLen >= 7) return 0.75;
  return 0.0;
}

export function normalizeHouse(h){
  if(!h) return '';
  return String(h).toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[-_]/g, '')
    .replace(/корп(?:ус|\.)?/i, 'к')
    .replace(/кв(?:артира|\.)?/i, '')
    .trim();
}

/* v91.51-arg-hygiene: apartment numbers arrive from the LLM in several shapes
   («1», «кв. 1», «кв.1», «квартира 1», «КВ 1»). The filter must compare ONE
   canonical value on both sides instead of a literal string. Same approach as
   normalizeHouse (close the service word, drop spaces) but with an explicit
   apartment-only prefix list — a house number like «3-б» keeps its letter. */
const APARTMENT_PREFIX_RE = /^(?:квартир[аиуе]?|кварт\.?|апартаменти|апарт\.?|кв\.?)\s*/i;
export function normalizeApartment(value){
  if(value == null) return '';
  let s = cleanStr(value).replace(APARTMENT_PREFIX_RE, '');
  s = s.replace(/[\s._-]+/g, '').replace(/[№#]/g, '');
  return s;
}

/* ONE builder for the human address line of a row, shared by every projection
   (AI rows, result-set items, chat cards). Structured parts are authoritative;
   the raw free-text `address` is used only as a fallback (or as an extra tail
   when it carries information the structured parts do not). This removes the
   «city/street filled but address empty» contradiction the model used to see. */
export function buildAddressLine(row){
  const r = row || {};
  const street = String(r.street || '').trim();
  const streetHouse = [street, String(r.house || '').trim()].filter(Boolean).join(' ');
  const parts = [];
  const push = function(value){ const s = String(value == null ? '' : value).trim(); if(s && parts.indexOf(s) === -1) parts.push(s); };
  push(r.city);
  push(streetHouse);
  if(String(r.apartment || '').trim()) push('кв. ' + String(r.apartment).trim());
  /* The raw free-text address is never a substitute for structured parts: it is
     appended only when it carries something the line does not already show. */
  const raw = String(r.address == null ? '' : r.address).trim();
  if(raw && !(street && raw.includes(street)) && parts.indexOf(raw) === -1) push(raw);
  return parts.join(', ').slice(0, 200);
}

export function parseAddressQuery(raw){
  let text = String(raw || '').trim();
  text = text.replace(/^(?:можешь\s+открыть\s+профиль|открой\s+профиль|покажи\s+профиль|відкрий\s+профіль|покажи\s+заявку|знайди\s+адресу|найди\s+адрес|найди\s+заявку|знайди\s+заявку|найди|знайди|по\s+адресу|за\s+адресою|а\s+по\s+адресу|а\s+за\s+адресою)\s+/i, '');

  let house = null;
  const houseMatch = text.match(/(?:(?:буд(?:инок|\.)?|дом|д\.)\s*)?(\b\d{1,4}\s*(?:[\/-]\s*\d{1,4}|[а-яa-z]|(?:\s*к(?:орп)?\.?\s*\d{1,2}))?)(?:\s*(?:кв(?:артира|\.)?)\s*(\d{1,4}))?$/i);
  if(houseMatch){
    house = normalizeHouse(houseMatch[1]);
    text = text.slice(0, houseMatch.index).trim().replace(/,\s*$/, '');
  }
  return { raw, text, house };
}

export function extractPlaces(tickets){
  const cityMap = new Map();
  for(const t of (tickets || [])){
    const city = String(t && t.city || '').trim();
    const street = String(t && t.street || '').trim();
    const house = String(t && t.house || '').trim();
    if(!city && !street) continue;
    const cKey = city || '(не вказано)';
    if(!cityMap.has(cKey)) cityMap.set(cKey, new Map());
    const streetMap = cityMap.get(cKey);
    if(street){
      const stem = normalizeStem(street);
      let targetKey = null;
      for(const existingStreet of streetMap.keys()){
        if(normalizeStem(existingStreet) === stem){
          targetKey = existingStreet;
          break;
        }
      }
      if(!targetKey){
        targetKey = street;
        streetMap.set(targetKey, { canonicalStreet: street, rawVariants: new Set(), houses: new Set() });
      }
      const entry = streetMap.get(targetKey);
      entry.rawVariants.add(street);
      if(house) entry.houses.add(house);
    }
  }
  const result = [];
  for(const [city, streetMap] of cityMap.entries()){
    const streets = [];
    let cityTicketCount = 0;
    for(const [, entry] of streetMap.entries()){
      const houses = Array.from(entry.houses).sort(function(a, b){
        const na = parseInt(a, 10), nb = parseInt(b, 10);
        if(!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return a.localeCompare(b, 'uk');
      });
      const count = tickets.filter(function(t){
        const tCity = t.city || '(не вказано)';
        if(tCity !== city) return false;
        return entry.rawVariants.has(t.street) || normalizeStem(t.street) === normalizeStem(entry.canonicalStreet);
      }).length;
      cityTicketCount += count;
      streets.push({ street: entry.canonicalStreet, ticket_count: count, houses, raw_variants: Array.from(entry.rawVariants) });
    }
    result.push({
      city: city === '(не вказано)' ? '' : city,
      ticket_count: cityTicketCount,
      streets: streets.sort(function(a, b){ return b.ticket_count - a.ticket_count || a.street.localeCompare(b.street, 'uk'); })
    });
  }
  return result.sort(function(a, b){ return b.ticket_count - a.ticket_count || a.city.localeCompare(b.city, 'uk'); });
}

export function resolveAddress(queryStr, places){
  const parsed = parseAddressQuery(queryStr);
  const text = parsed.text;
  const house = parsed.house;

  if(!text && !house) return { resolved: null, candidates: [], confidence: 0 };

  const tokens = text.split(/[\s,;\/]+/).filter(Boolean);
  const candidates = [];

  for(const p of places){
    const city = p.city;
    let bestCityScore = 0;
    let cityTokenIdx = -1;
    for(let i = 0; i < tokens.length; i++){
      const sc = matchScore(city, tokens[i]);
      if(sc > bestCityScore){
        bestCityScore = sc;
        cityTokenIdx = i;
      }
    }

    for(const s of p.streets){
      const street = s.street;
      const streetTokens = tokens.filter(function(_, idx){ return idx !== cityTokenIdx; });
      const streetQuery = streetTokens.join(' ');

      let streetScore = 0;
      if(streetTokens.length === 1){
        streetScore = matchScore(street, streetTokens[0]);
      } else if(streetTokens.length > 1){
        const scores = streetTokens.map(function(t){ return matchScore(street, t); });
        scores.push(matchScore(street, streetQuery));
        streetScore = Math.max.apply(Math, scores);
      } else if(cityTokenIdx !== -1 && tokens.length === 1){
        streetScore = 0;
      }

      let combinedScore = 0;
      if(bestCityScore >= 0.75 && streetScore >= 0.75){
        combinedScore = (bestCityScore * 0.4) + (streetScore * 0.6);
      } else if(streetScore >= 0.75 && bestCityScore < 0.75){
        combinedScore = streetScore * 0.9;
      } else if(bestCityScore >= 0.75 && !streetTokens.length){
        combinedScore = bestCityScore * 0.8;
      }

      if(combinedScore >= 0.70){
        let houseScore = 1.0;
        if(house){
          const houseExists = s.houses.some(function(h){ return normalizeHouse(h) === house; });
          if(houseExists) houseScore = 1.0;
          else houseScore = 0.95;
        }
        candidates.push({
          city: city,
          street: street,
          houses: s.houses,
          score: combinedScore * houseScore,
          house: house || null
        });
      }
    }
  }

  candidates.sort(function(a, b){ return b.score - a.score; });

  if(!candidates.length){
    return { resolved: null, candidates: [], confidence: 0 };
  }

  const top = candidates[0];
  const second = candidates[1];

  if(second && (top.score - second.score < 0.08) && (top.city !== second.city || top.street !== second.street)){
    return {
      resolved: null,
      ambiguous: true,
      candidates: candidates.slice(0, 3).map(function(c){
        return {
          city: c.city,
          street: c.street,
          label: [c.city, c.street].filter(Boolean).join(', '),
          score: Math.round(c.score * 100) / 100
        };
      }),
      confidence: Math.round(top.score * 100) / 100
    };
  }

  return {
    resolved: {
      city: top.city,
      street: top.street,
      house: top.house,
      confidence: Math.round(top.score * 100) / 100
    },
    candidates: [],
    ambiguous: false,
    houses: top.houses,
    confidence: Math.round(top.score * 100) / 100
  };
}

/* ---------- legacy / restored address resolution (v91.45) ----------
   Старі відновлені заявки часто мають лише текстове поле address (або рядки
   «️ Місто:» / «📍 Адреса:» у legacy content), без структурованих
   city/street/house. Звичайний пошук застосунку знаходить їх текстово; щоб
   AI-рушій не розходився з ним, тут — спільний ДЕТЕРМІНОВАНИЙ розбір такого
   тексту на частини. Жодних хардкодів назв: лише синтаксис адреси.
   Structured-поля завжди пріоритетні — цей розбір лише заповнює ВІДСУТНІ. */

/* \b is ASCII-only and never fires after Cyrillic letters, so the guard is an
   explicit lookahead: the prefix must end the token (space/punct/end). */
const LEGACY_STREET_PREFIX_RE = /^(?:проспект|провулок|вулиця|улица|площа|майдан|шосе|спуск|узвіз|тракт|алея|просп|бул|пров|пер|вул|ул|пр)(?=$|[\s.,])/i;

export function legacyAddressFromText(text){
  const s = String(text || '');
  if(!s) return '';
  /* Lazy capture stopped at the NEXT service marker/emoji/newline, so a
     marker never swallows the rest of the line (in old content markers are
     often separated by spaces, not newlines). */
  const cityM = s.match(/(?:🏙️\s*)?(?:місто|город)\s*[:：]\s*(.+?)(?=\s*(?:📍|🔒|📅|📞|👤|\n|$|адрес(?:а|у)?\s*[:：]))/i);
  const addrM = s.match(/(?:📍\s*)?адрес(?:а|у)?\s*[:：]\s*(.+?)(?=\s*(?:🏙️|🔒|📅|📞|👤|\n|$|(?:місто|город)\s*[:：]))/i);
  const city = cityM ? cityM[1].trim() : '';
  const addr = addrM ? addrM[1].trim() : '';
  if(city && addr) return city + ', ' + addr;
  return addr || city || '';
}

export function parseLegacyAddress(text){
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if(!s) return null;
  let city = '';
  const comma = s.indexOf(',');
  if(comma > 0){
    const head = s.slice(0, comma).trim();
    const tail = s.slice(comma + 1).trim();
    if(tail && head && !LEGACY_STREET_PREFIX_RE.test(head)){
      city = head;
      s = tail;
    }
  }
  let street = s.replace(/,+$/, '').trim();
  let house = '';
  const hm = street.match(/^(.*?)[,\s]+(\d{1,4}(?:[\/-]\d{1,4})?[а-яa-z]?)$/i);
  if(hm && hm[1].trim()){
    street = hm[1].trim().replace(/,+$/, '').trim();
    house = hm[2];
  }
  if(!city && !street) return null;
  return {city: city, street: street, house: house};
}

/* Ефективні адресні частини заявки: structured пріоритетні, legacy-розбір
   заповнює лише порожні. Повертає {city, street, house, via:{...}}, де via
   позначає походження кожної частини ('structured' | 'legacy' | null). */
export function effectiveAddressParts(ticket, legacyText){
  const t = ticket || {};
  const sCity = String(t.city || '').trim();
  const sStreet = String(t.street || '').trim();
  const sHouse = String(t.house || '').trim();
  let parts = null;
  if(!sCity || !sStreet || !sHouse){
    const source = String(t.address || '').trim() || legacyAddressFromText(legacyText);
    parts = parseLegacyAddress(source);
  }
  return {
    city: sCity || (parts && parts.city) || '',
    street: sStreet || (parts && parts.street) || '',
    house: sHouse || (parts && parts.house) || '',
    via: {
      city: sCity ? 'structured' : (parts && parts.city ? 'legacy' : null),
      street: sStreet ? 'structured' : (parts && parts.street ? 'legacy' : null),
      house: sHouse ? 'structured' : (parts && parts.house ? 'legacy' : null)
    }
  };
}

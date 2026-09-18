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

const PREFIX_RE = /^(?:вул(?:иця|\.)?|ул(?:ица|\.)?|просп(?:ект|\.)?|пр(?:-кт|\.)?|пров(?:улок|\.)?|пер(?:еулок|\.)?|бул(?:ьвар|\.)?|наб(?:ережна|\.)?|тупик|узвіз|спуск|шосе|тракт|алея)\s+/i;
const SUFFIX_RE = /(?:івська|евская|євская|овська|овская|ського|ского|ському|скому|ський|ский|ська|ская|ське|ское|ські|ские|овая|евая|євая|ова|ева|єва|ная|на|ний|ный|ного|ному|ної|ной|ої|ой|івка|овка|евка|євка|ая|яя|ий|ій|ый|ой|ка|ко|ів|ев|ов|а|я|е|є|о|у|ю|і|ы|и)$/i;

const ROOT_TRANSLATIONS = [
  [/^ліс/i, 'лес'],
  [/^лес/i, 'лес'],
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
      if(!streetMap.has(street)) streetMap.set(street, new Set());
      if(house) streetMap.get(street).add(house);
    }
  }
  const result = [];
  for(const [city, streetMap] of cityMap.entries()){
    const streets = [];
    let cityTicketCount = 0;
    for(const [street, houseSet] of streetMap.entries()){
      const houses = Array.from(houseSet).sort();
      const count = tickets.filter(function(t){ return (t.city || '(не вказано)') === city && t.street === street; }).length;
      cityTicketCount += count;
      streets.push({ street, ticket_count: count, houses });
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

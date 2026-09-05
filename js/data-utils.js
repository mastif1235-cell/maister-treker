/*
 * Чисті функції нормалізації, парсингу та перетворення даних.
 *
 * Це класичний script, а не ES-модуль: глобальні імена збережені для
 * зворотної сумісності з app.js. Тут немає DOM, storage, мережі або
 * змінюваного стану застосунку.
 */

function catalogTagFor(label){ return String(label||'').trim().toLowerCase(); }

const ADDRESS_STOPWORDS = new Set(['м','місто','город','вул','вулиця','ул','улица','буд','будинок','дом','кв','квартира','б','просп','проспект','с','село','селище','смт']);

function extractAddressTokens(text){
  return String(text||'')
    .toLowerCase()
    .replace(/[.,№\/]/g,' ')
    .split(/\s+/)
    .filter(tok => tok && tok.length>1 && !ADDRESS_STOPWORDS.has(tok));
}

function naturalSortStrings(arr){
  return arr.slice().sort((a,b)=>a.localeCompare(b, 'uk', {numeric:true, sensitivity:'base'}));
}

function ticketApartmentKey(t){ return (t.apartment||'').trim() || '(без кв.)'; }

function isoToDdmmyyyy(dateStr){
  const s = String(dateStr);
  if(s.includes('.')) return s;
  const parts = s.split('-');
  if(parts.length<3) return s;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function parseCredentials(raw){
  const lines = String(raw||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(lines.length >= 2) return {login: lines[0], password: lines[1]};
  if(lines.length === 1){
    const parts = lines[0].split(/\s+/).filter(Boolean);
    if(parts.length >= 2) return {login: parts[0], password: parts[1]};
    return {login: parts[0]||'', password: ''};
  }
  return {login:'', password:''};
}

function parseMapsLink(text){
  if(!text) return null;
  const patterns = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/, /^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/];
  for(const re of patterns){
    const m = text.match(re);
    if(m) return {lat:m[1], lng:m[2]};
  }
  return null;
}

function isGoogleMapsShortLink(text){
  try{
    const url = new URL(String(text||'').trim());
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'maps.app.goo.gl';
  }catch(_e){
    return false;
  }
}

function prepareGeoInput(text){
  const raw = String(text||'').trim();
  const parsed = parseMapsLink(raw);
  const coords = parsed ? {lat:Number(parsed.lat),lng:Number(parsed.lng)} : null;
  return {
    raw,
    coords,
    link: coords ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}` : raw,
    needsPicker: !coords && isGoogleMapsShortLink(raw)
  };
}

function ticketSortKey(t){
  const d = parseDate(t.date);
  const m = String(t.time||'').match(/^(\d{1,2}):(\d{2})/);
  const minutes = m ? (Number(m[1])*60 + Number(m[2])) : 0;
  return d.getTime() + minutes*60000;
}

/* /ask ARGUMENT HYGIENE (v91.51 fixing pass, Stage 1).

   The model passes structured tool arguments the way the human phrase sounded:
   `street: "Привокзальная 3Б"`, `apartment: "кв. 1"`, `city: "посёлок Шевченко"`.
   The READ tools expect the parts separately and compare them canonically, so
   those shapes silently produced zero rows. This module normalises the MODEL's
   arguments inside the /ask orchestration layer only:

   - the public /mcp contract is untouched (tools keep their own semantics);
   - no search-engine behaviour is re-implemented here (house/apartment/city
     normalisation is delegated to the existing helpers from address.js);
   - nothing is guessed: every rule is a closed list plus a structural check,
     and an ambiguous value stays exactly as the model sent it.

   What it fixes (proven by the v91.51 audit):
   1) `street` + house in one argument  → street/house split;
   2) `apartment` shapes ("кв. 1", "квартира 1", "КВ 1") → "1";
   3) `city` with a service prefix ("посёлок Шевченко") → "Шевченко". */

import {normalizeHouse, normalizeApartment} from './address.js';

/* Service prefixes of a settlement name: closed list, whole word (with an
   optional dot) plus a space. A real name that merely starts with these
   letters («Счастливое», «Мирное», «Підгородне») is never touched. */
const CITY_PREFIX_RE = /^(?:пос[её]лок|пос[её]лки|селище|село|смт|пгт|місто|город|станиця|станица|хутір|хутор|аул|смт\.|пгт\.|с\.|м\.|сел\.)\s+/iu;

export function normalizeCityArg(value){
  if(value == null) return value;
  const original = String(value).trim();
  let s = original;
  /* three passes cover «смт. Шевченко», «посёлок с. Шевченко»-style doubles */
  for(let i = 0; i < 3; i++){
    const next = s.replace(CITY_PREFIX_RE, '').trim();
    if(next === s) break;
    s = next;
  }
  return s || original;
}

/* Numbers that mean money/quantity/time rather than a house number. Kept in
   sync with the same guard used by the F4 exact-address path. */
const NOT_A_HOUSE_TAIL = /^(?:грн|грив|гривен|гривень|uah|₴|шт|штук|штуки|тонн|метров|метрів|заявок|замовлень|раз|разів|роутер|роутера|роутерів|годин|години|годину|часа|часов|хвилин|днів|дней|дня|місяць|місяця|січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)$/iu;

/* A house token: 1..3 digits, optional letter («3б»), optional separator form
   («3-б», «3/14»). Four-digit tails (prices, years, phone fragments) never
   qualify. */
function isHouseToken(token){
  const canon = normalizeHouse(token);
  if(!canon) return false;
  return /^\d{1,3}[а-яіїєґa-z]?$/u.test(canon) || /^\d{1,3}\/\d{1,3}[а-яіїєґa-z]?$/u.test(canon);
}

const STREET_PREFIX_STRIP_RE = /^(?:вул|вулиця|улица|ул|просп|проспект|пр|пров|переулок|пер|бул|бульвар|наб|набережна|набережная|шосе|шоссе|спуск|узвіз|тракт|алея|площа|площадь|майдан)\.?\s*/i;

/* «Привокзальная 3Б» → {street: "Привокзальная", house: "3Б"}.
   Returns null when the value is not a street with a trailing house number:
   - the tail must be a house token (see above; «1500» never is);
   - the rest must still contain a street name (at least two letters after the
     «вул./ул.» prefix) — «за 1500» therefore never becomes a house;
   - a number followed by a money/quantity/time word cancels the split as well
     (defence in depth for phrases like «Лесная 5 грн»). */
export function splitStreetHouse(value){
  const raw = String(value == null ? '' : value).trim();
  if(!raw) return null;
  const words = raw.split(/\s+/).filter(Boolean);
  if(words.length < 2) return null;
  const tail = words[words.length - 1];
  if(/^[+-]/.test(tail)) return null;
  if(NOT_A_HOUSE_TAIL.test(tail)) return null;
  if(!isHouseToken(tail)) return null;
  const street = words.slice(0, -1).join(' ').trim();
  const streetLetters = street.replace(STREET_PREFIX_STRIP_RE, '').trim();
  if(!/[а-яіїєґa-z]{2}/iu.test(streetLetters)) return null;
  return {street: street, house: tail};
}

/* Tools whose address arguments the model may fill in "human" form. The public
   /mcp input schemas are unchanged: this runs on the /ask path only. */
const CITY_ARG_TOOLS = {query_tickets:1, list_tickets:1};
const ADDRESS_ARG_TOOLS = {query_tickets:1};

export function hygieneArgs(toolName, args){
  if(!args || typeof args !== 'object' || Array.isArray(args)) return args;
  if(!CITY_ARG_TOOLS[toolName]) return args;
  const out = Object.assign({}, args);
  if(typeof out.city === 'string' && out.city.trim()) out.city = normalizeCityArg(out.city);
  if(ADDRESS_ARG_TOOLS[toolName]){
    const explicitHouse = out.house == null ? '' : String(out.house).trim();
    if(typeof out.street === 'string' && out.street.trim()){
      const split = splitStreetHouse(out.street);
      if(split){
        /* street must never carry the house number; an explicitly given house
           wins over the tail (no silent overwrite of the model's own field). */
        out.street = split.street;
        if(!explicitHouse) out.house = split.house;
      }
    }
    if(out.apartment != null && String(out.apartment).trim() !== ''){
      out.apartment = normalizeApartment(out.apartment);
    }
  }
  return out;
}

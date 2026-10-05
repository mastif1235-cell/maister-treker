/* v91.46: structured follow-up query context (COUNT → «покажи их»).

   Source of truth = the deterministic query_tickets envelope of the PREVIOUS
   turn, never the text the model wrote. The envelope's resolved_filters are
   the exact structured filters the authoritative query ran with; a follow-up
   turn re-runs a FRESH READ with those same filters (no cached rows).

   Privacy: this context is a strict WHITELIST. Raw notes, backupNote,
   abonentNote, otherNote, masterNote, phones, clientName, MAC, contract,
   coordinates, searchableText or secrets can never be represented here —
   unknown keys are dropped on projection AND on intake. Phone digits and
   contract/MAC values are deliberately NOT inheritable (only their presence
   flags exist in resolved_filters). */

/* Filter keys that are safe to carry between turns (mirror of
   buildResolvedFilters output, minus value-less presence flags). */
import {validateSemantic} from './work-events.js';

const INHERITABLE_KEYS = [
  'date_from', 'date_to', 'city', 'street', 'city_id', 'street_id', 'house', 'apartment',
  'type', 'tags', 'payment', 'sum_min', 'sum_max',
  'signal_worse_than', 'signal_worse_or_equal', 'signal_better_than',
  'has_signal', 'coworker', 'coworker_exclude', 'items', 'semantic'
];

/* Stage 2D: directory identity of a resolved place — carried between turns
   so a follow-up filters by UUID, never by a second text resolution. Only the
   canonical UUID shape passes (the same rule every other id path uses). */
const DIRECTORY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Keys that, when present in the INCOMING call, make it a NEW independent
   question — inheritance is refused (strict signal semantics preserved). */
const STRUCTURAL_PARAM_KEYS = INHERITABLE_KEYS.concat([
  'phone_digits', 'contract', 'mac'
]);

function clip(value, max){
  return String(value == null ? '' : value).slice(0, max);
}

function isPlainObject(value){
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value){
  const s = String(value == null ? '' : value);
  return /^\d{2}\.\d{2}\.\d{4}$/.test(s) ? s : null;
}

const ITEM_KIND_ENUM = ['equipment', 'cable', 'preset_work', 'additional_work'];

/* Carry the ORIGINAL condition only: text + pool kind + attribute binding.
   kind restricts the pool — dropping it would widen the follow-up search;
   resolved_labels/concept are re-derived deterministically by the engine. */
function projectItems(raw){
  if(!Array.isArray(raw)) return [];
  const out = [];
  for(const item of raw.slice(0, 8)){
    if(!isPlainObject(item)) continue;
    const text = clip(item.text, 80).trim();
    if(!text) continue;
    const clean = {text: text};
    if(ITEM_KIND_ENUM.indexOf(item.kind) !== -1) clean.kind = item.kind;
    for(const k of ['unit_price', 'quantity', 'total']){
      const n = Number(item[k]);
      if(Number.isFinite(n) && item[k] !== null && item[k] !== '') clean[k] = n;
    }
    out.push(clean);
  }
  return out;
}

/* Project one resolved_filters object through the whitelist. Used both for
   the outgoing context (server → client) and for validating the incoming
   context (client → server), so both directions share one definition. */
export function projectQueryFilters(filters){
  if(!isPlainObject(filters)) return {};
  if(filters.coworker_exclude!==undefined && (typeof filters.coworker_exclude!=='string' ||
    !filters.coworker_exclude.trim() || filters.coworker_exclude.length>60 || filters.coworker!==undefined || !filters.semantic))return null;
  const out = {};
  for(const key of INHERITABLE_KEYS){
    const v = filters[key];
    if(v === undefined || v === null || v === '') continue;
    switch(key){
      case 'date_from':
      case 'date_to': {
        const d = validDate(v);
        if(d) out[key] = d;
        break;
      }
      case 'city': out.city = clip(v, 100); break;
      case 'street': out.street = clip(v, 100); break;
      case 'city_id':
      case 'street_id':
        if(typeof v === 'string' && DIRECTORY_ID_RE.test(v)) out[key] = v.toLowerCase();
        break;
      case 'house': out.house = clip(v, 16); break;
      case 'apartment': out.apartment = clip(v, 16); break;
      case 'type': out.type = clip(v, 80); break;
      case 'payment': out.payment = clip(v, 80); break;
      case 'coworker': out.coworker = clip(v, 60); break;
      case 'coworker_exclude': out.coworker_exclude = v.trim(); break;
      case 'tags':
        if(Array.isArray(v)) out.tags = v.slice(0, 20).map(function(t){ return clip(t, 60); }).filter(Boolean);
        break;
      case 'sum_min':
      case 'sum_max':
      case 'signal_worse_than':
      case 'signal_worse_or_equal':
      case 'signal_better_than': {
        const n = Number(v);
        if(Number.isFinite(n)) out[key] = n;
        break;
      }
      case 'has_signal':
        if(typeof v === 'boolean') out.has_signal = v;
        break;
      case 'semantic': {
        const semantic=validateSemantic(v);
        if(!semantic) return null; // never drop a bad work filter and widen it
        out.semantic=semantic;
        break;
      }
      case 'items': {
        const items = projectItems(v);
        if(items.length) out.items = items;
        break;
      }
    }
  }
  return out;
}

/* The full outgoing context for one answered turn. */
export function projectQueryContext(envelope){
  if(!isPlainObject(envelope)) return null;
  const filters = projectQueryFilters(envelope.resolved_filters);
  if(!filters || !Object.keys(filters).length) return null;
  return {
    resolved_filters: filters,
    mode: typeof envelope.mode === 'string' ? clip(envelope.mode, 12) : 'list',
    ...(envelope.mode==='group' && typeof envelope.group_by==='string'?{group_by:clip(envelope.group_by,16)}:{}),
    total_matched: Number.isFinite(Number(envelope.total_matched)) ? Number(envelope.total_matched) : null
  };
}

/* Validate what the client echoes back on the NEXT turn. */
export function sanitizeIncomingQueryContext(raw){
  if(!isPlainObject(raw)) return null;
  if(Object.hasOwn(raw,'comparison')) return projectComparisonContext(raw);
  const filters = projectQueryFilters(raw.resolved_filters);
  if(!filters || !Object.keys(filters).length) return null;
  return {
    resolved_filters: filters,
    mode: typeof raw.mode === 'string' ? clip(raw.mode, 12) : 'list',
    ...(raw.mode==='group' && typeof raw.group_by==='string'?{group_by:clip(raw.group_by,16)}:{}),
    total_matched: Number.isFinite(Number(raw.total_matched)) ? Number(raw.total_matched) : null
  };
}

/* Additive count-comparison context: common filters + TWO ordered periods.
 * No rows, totals, navigation or arbitrary serialized QueryState. Invalid
 * comparison intake is rejected as a whole, never reduced to one period. */
export function projectComparisonContext(raw){
  if(!isPlainObject(raw)||raw.mode!=='count'||!isPlainObject(raw.comparison))return null;
  const filters=projectQueryFilters(raw.resolved_filters);
  if(!filters?.semantic||filters.date_from||filters.date_to)return null;
  const periods=raw.comparison.periods;
  if(!Array.isArray(periods)||periods.length!==2)return null;
  const calendar=d=>{
    if(typeof d!=='string'||!validDate(d))return false;
    const [day,month,year]=d.split('.').map(Number),v=new Date(Date.UTC(year,month-1,day));
    return v.getUTCFullYear()===year&&v.getUTCMonth()===month-1&&v.getUTCDate()===day;
  };
  for(const p of periods){
    if(!isPlainObject(p)||!calendar(p.from)||!calendar(p.to)||p.from.split('.').reverse().join('-')>p.to.split('.').reverse().join('-'))return null;
  }
  if(periods[0].from===periods[1].from&&periods[0].to===periods[1].to)return null;
  return {mode:'count',resolved_filters:filters,comparison:{periods:periods.map(p=>({from:p.from,to:p.to}))}};
}

/* ---------- explicit anaphoric follow-up detection (v91.46) ----------
   SMALL deterministic detector (not a phrase router): explicit «show/list
   THEM» formulations in UA/RU. Used only as a safety net — inheritance is
   still refused when the model call carries its own structural filters. */
const ANAPHORA_TOKENS = new Set(['их', 'їх', 'этих', 'ці', 'эти', 'такие', 'такі', 'усі', 'всі', 'все', 'список', 'списком', 'поіменно', 'поименно']);
const SHOW_VERB_RE = /покаж|показ(?:ат|ати)|перечисл|перераху|вивед|розпиш|напиш(?:іть|ите)?|дай(?:те)?[\s?!]|список|списком/;
const WHICH_EXACTLY_RE = /(?:які|какие|що|что)\s+(?:саме|именно|конкретно)/;

export function isAnaphoricListFollowUp(question){
  const q = String(question == null ? '' : question).toLowerCase().replace(/ё/g, 'е').replace(/[?!….\s]+$/, '').trim();
  if(!q || q.length > 60) return false;
  if(!SHOW_VERB_RE.test(q) && !WHICH_EXACTLY_RE.test(q)) return false;
  const tokens = q.split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  if(tokens.some(function(t){ return ANAPHORA_TOKENS.has(t); })) return true;
  if(WHICH_EXACTLY_RE.test(q)) return true;
  return false;
}

export function hasStructuralParams(args){
  if(!isPlainObject(args)) return false;
  for(const key of STRUCTURAL_PARAM_KEYS){
    if(args[key] !== undefined && args[key] !== null && args[key] !== '') return true;
  }
  return false;
}

/* Merge inherited resolved_filters into a follow-up call. Deterministic
   rules:
   - applied ONLY when the new call carries no structural filters of its own
     (a call with its own filters is a new question — no stale inheritance);
   - inherited values are exactly the previous resolved_filters (fresh READ
     runs against the CURRENT database with them);
   - the new call's mode/group_by/limit/offset always win. */
export function mergeInheritedFilters(args, inheritedFilters){
  const merged = Object.assign({}, args || {});
  delete merged.inherit_previous_filters;
  if(hasStructuralParams(args)) return merged;
  const safe = projectQueryFilters(inheritedFilters);
  if(!safe) return Object.assign(merged,{semantic:inheritedFilters.semantic});
  for(const key of Object.keys(safe)){
    if(merged[key] === undefined) merged[key] = safe[key];
  }
  return merged;
}

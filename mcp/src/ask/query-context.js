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
const INHERITABLE_KEYS = [
  'date_from', 'date_to', 'city', 'street', 'house', 'apartment',
  'type', 'tags', 'payment', 'sum_min', 'sum_max',
  'signal_worse_than', 'signal_worse_or_equal', 'signal_better_than',
  'has_signal', 'coworker', 'items'
];

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

function projectItems(raw){
  if(!Array.isArray(raw)) return [];
  const out = [];
  for(const item of raw.slice(0, 8)){
    if(!isPlainObject(item)) continue;
    const text = clip(item.text, 80).trim();
    if(!text) continue;
    const clean = {text: text};
    if(typeof item.concept === 'string') clean.concept = clip(item.concept, 40);
    if(Array.isArray(item.resolved_labels)){
      clean.resolved_labels = item.resolved_labels.slice(0, 6).map(function(l){ return clip(l, 80); });
    }
    if(typeof item.in_catalog === 'boolean') clean.in_catalog = item.in_catalog;
    for(const k of ['unit_price', 'quantity', 'total']){
      const n = Number(item[k]);
      if(Number.isFinite(n)) clean[k] = n;
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
      case 'house': out.house = clip(v, 16); break;
      case 'apartment': out.apartment = clip(v, 16); break;
      case 'type': out.type = clip(v, 80); break;
      case 'payment': out.payment = clip(v, 80); break;
      case 'coworker': out.coworker = clip(v, 60); break;
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
  if(!Object.keys(filters).length) return null;
  return {
    resolved_filters: filters,
    mode: typeof envelope.mode === 'string' ? clip(envelope.mode, 12) : 'list',
    total_matched: Number.isFinite(Number(envelope.total_matched)) ? Number(envelope.total_matched) : null
  };
}

/* Validate what the client echoes back on the NEXT turn. */
export function sanitizeIncomingQueryContext(raw){
  if(!isPlainObject(raw)) return null;
  const filters = projectQueryFilters(raw.resolved_filters);
  if(!Object.keys(filters).length) return null;
  return {
    resolved_filters: filters,
    mode: typeof raw.mode === 'string' ? clip(raw.mode, 12) : 'list',
    total_matched: Number.isFinite(Number(raw.total_matched)) ? Number(raw.total_matched) : null
  };
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
  for(const key of Object.keys(safe)){
    if(merged[key] === undefined) merged[key] = safe[key];
  }
  return merged;
}

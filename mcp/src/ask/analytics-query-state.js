/* Foundation only: NOT imported by the runtime. No I/O, parsing of natural
 * language, execution, persistence, navigation or response formatting. */
import {projectQueryFilters} from './query-context.js';
import {validateSemantic} from './work-events.js';

export const STATE_VERSION = 1;
export const STATE_FIELDS = ['periods','entity','measure','action','category','profile',
  'signalContext','coworker','workType','aggregation','groupBy','filters'];
const MODES = ['exists','count','list','group','stats'];
const GROUPS = ['city','street','house','date','month','type','payment','item','coworker','entity','action'];
const FILTERS = ['city','street','city_id','street_id','house','apartment','tags','payment',
  'sum_min','sum_max','signal_worse_than','signal_worse_or_equal','signal_better_than','has_signal','items'];
const EXISTING = ['date_from','date_to','semantic','coworker','type',...FILTERS];
const own = (obj,key) => Object.hasOwn(obj,key);
const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
function clone(value){
  // Reject lossy JSON conversions (undefined, non-finite, exotic objects).
  // In particular, a malformed REPLACE must not turn into a valid removal.
  function check(v){
    if(v===undefined || typeof v==='function' || typeof v==='symbol' || typeof v==='bigint' ||
      (typeof v==='number'&&!Number.isFinite(v))) reject('Non-JSON value');
    if(v!==null && typeof v==='object'){
      if(!Array.isArray(v)&&!plain(v)) reject('Non-JSON object');
      for(const child of Object.values(v)) check(child);
    }
  }
  check(value);
  return JSON.parse(JSON.stringify(value));
}
function comparable(value){
  if(Array.isArray(value)) return value.map(comparable);
  if(plain(value)) return Object.fromEntries(Object.keys(value).sort().map(k=>[k,comparable(value[k])]));
  return value;
}
function reject(message){ throw new TypeError(message); }
function keys(value,allowed){
  if(!plain(value) || Object.keys(value).some(k=>!allowed.includes(k))) reject('Unsupported fields');
}
function text(value,max){
  if(typeof value!=='string' || !value.trim() || value.length>max) reject('Invalid text');
  return value.trim();
}
function date(value){
  if(typeof value!=='string' || !/^\d{2}\.\d{2}\.\d{4}$/.test(value)) reject('Invalid date');
  const [d,m,y]=value.split('.').map(Number), n=new Date(Date.UTC(y,m-1,d));
  if(n.getUTCFullYear()!==y || n.getUTCMonth()!==m-1 || n.getUTCDate()!==d) reject('Invalid calendar date');
  return value;
}
const stamp = value => value.split('.').reverse().join('-');
function periods(values){
  if(!Array.isArray(values) || values.length>8) reject('Invalid periods');
  return values.map(p=>{
    keys(p,['from','to']);
    if(!own(p,'from') && !own(p,'to')) reject('Empty period');
    const out={};
    if(own(p,'from')) out.from=date(p.from);
    if(own(p,'to')) out.to=date(p.to);
    if(out.from && out.to && stamp(out.from)>stamp(out.to)) reject('Reversed period');
    return out;
  });
}
function safeFilters(raw){
  keys(raw,FILTERS);
  // The existing whitelist defines semantics; reject any loss/truncation,
  // instead of silently broadening a query. Normal UUID case is equivalent.
  const out=projectQueryFilters(raw);
  for(const k of Object.keys(raw)){
    if(!own(out,k)) reject('Unrepresentable filter: '+k);
    if(k==='city_id'||k==='street_id') continue;
    if(JSON.stringify(comparable(out[k]))!==JSON.stringify(comparable(raw[k]))) reject('Lossy filter: '+k);
  }
  return out;
}
export function normalizeAnalyticsState(raw){
  keys(raw,['version',...STATE_FIELDS]);
  if(raw.version!==STATE_VERSION) reject('Unsupported state version');
  const out={version:STATE_VERSION,periods:periods(own(raw,'periods')?raw.periods:[])};
  const semantic={};
  for(const [s,k] of [['entity','entity'],['action','action'],['category','category'],['profile','profile'],['signalContext','signal_context']]){
    if(own(raw,s)) semantic[k]=raw[s];
  }
  if(Object.keys(semantic).length){
    const normalized=validateSemantic(semantic);
    if(!normalized) reject('Incompatible semantic fields');
    for(const [s,k] of [['entity','entity'],['action','action'],['category','category'],['profile','profile'],['signalContext','signal_context']]){
      if(own(normalized,k)) out[s]=normalized[k];
    }
  }
  const expectedMeasure=['onu_physical','physical_consumption'].includes(out.profile)?'quantity':'tickets';
  out.measure=own(raw,'measure')?raw.measure:expectedMeasure;
  if(!['tickets','quantity'].includes(out.measure) || out.measure!==expectedMeasure) reject('Measure not supported by legacy contract');
  const c=own(raw,'coworker')?raw.coworker:{kind:'any'};
  if(!plain(c)) reject('Invalid coworker predicate');
  keys(c,c.kind==='any'?['kind']:['kind','name']);
  if(!['any','include','exclude'].includes(c.kind)) reject('Invalid coworker predicate');
  out.coworker=c.kind==='any'?{kind:'any'}:{kind:c.kind,name:text(c.name,60)};
  if(own(raw,'workType')) out.workType=text(raw.workType,80);
  out.aggregation=own(raw,'aggregation')?raw.aggregation:'list';
  if(!MODES.includes(out.aggregation)) reject('Invalid aggregation');
  if(own(raw,'groupBy')){
    if(!GROUPS.includes(raw.groupBy)) reject('Invalid groupBy');
    out.groupBy=raw.groupBy;
  }
  if(out.aggregation==='group' && !out.groupBy) reject('groupBy required');
  out.filters=safeFilters(own(raw,'filters')?raw.filters:{});
  return out;
}

// No last message text, rows or selection metadata are accepted by this adapter.
// Presence-only redacted phone/contract/MAC flags are intentionally rejected:
// their original values cannot be reconstructed safely.
export function fromExisting(filters,{mode='list',group_by}={}){
  keys(filters,EXISTING);
  const raw={version:STATE_VERSION,aggregation:mode,filters:{},periods:[]};
  const p={};
  if(own(filters,'date_from')) p.from=filters.date_from;
  if(own(filters,'date_to')) p.to=filters.date_to;
  if(Object.keys(p).length) raw.periods=[p];
  if(own(filters,'semantic')){
    keys(filters.semantic,['entity','action','category','profile','signal_context']);
    for(const k of ['entity','action','category','profile']) if(own(filters.semantic,k)) raw[k]=filters.semantic[k];
    if(own(filters.semantic,'signal_context')) raw.signalContext=filters.semantic.signal_context;
  }
  if(own(filters,'coworker')) raw.coworker={kind:'include',name:filters.coworker};
  if(own(filters,'type')) raw.workType=filters.type;
  if(group_by!==undefined) raw.groupBy=group_by;
  for(const k of FILTERS) if(own(filters,k)) raw.filters[k]=filters[k];
  return normalizeAnalyticsState(raw);
}

// Pure compilation, never execution. Multiple periods yield separate plans.
// Exclude is representable in state, NOT in today's query_tickets schema.
export function toExisting(state){
  const s=normalizeAnalyticsState(state);
  if(s.coworker.kind==='exclude') reject('Coworker exclusion requires Phase 2 execution support');
  const args={mode:s.aggregation,...clone(s.filters)};
  if(s.groupBy) args.group_by=s.groupBy;
  if(s.workType) args.type=s.workType;
  if(s.coworker.kind==='include') args.coworker=s.coworker.name;
  const sem={};
  for(const [k,v] of [['entity',s.entity],['action',s.action],['category',s.category],['profile',s.profile],['signal_context',s.signalContext]]) if(v!==undefined) sem[k]=v;
  if(Object.keys(sem).length) args.semantic=sem;
  return (s.periods.length?s.periods:[{}]).map(p=>({...clone(args),
    ...(p.from?{date_from:p.from}:{}),...(p.to?{date_to:p.to}:{})}));
}

/* FollowUpPatch = {changes:{field:{op:'KEEP'|'REMOVE'|'REPLACE',value?}},
 * clarification?:string}. Unspecified fields KEEP; whole-field replacements.
 * No natural-language interpretation in Phase 1. Invalid/ambiguous transitions
 * return the original state without partial updates or silently dropped fields. */
export function reduceAnalyticsState(previous,patch){
  try{
    const next=normalizeAnalyticsState(previous);
    keys(patch,['changes','clarification']);
    if(own(patch,'clarification')){
      text(patch.clarification,200);
      return {ok:false,code:'CLARIFICATION',state:previous};
    }
    const changes=own(patch,'changes')?patch.changes:{};
    keys(changes,STATE_FIELDS);
    for(const field of STATE_FIELDS){
      if(!own(changes,field)) continue;
      const change=changes[field];
      if(!plain(change)) reject('Invalid operation');
      keys(change,change.op==='REPLACE'?['op','value']:['op']);
      if(!['KEEP','REMOVE','REPLACE'].includes(change.op)) reject('Invalid operation');
      if(change.op==='REPLACE'){
        if(!own(change,'value')) reject('REPLACE requires value');
        next[field]=clone(change.value);
      } else if(change.op==='REMOVE') delete next[field];
    }
    // Do not guess incompatible dependent profiles away: reject atomically.
    // Caller must explicitly replace/remove a dependent ONU-only profile.
    return {ok:true,state:normalizeAnalyticsState(next)};
  } catch(error){return {ok:false,code:'INVALID_PATCH',state:previous};}
}

/* Computed READ-only semantics. No persistence and no LLM arithmetic.
   Dictionaries are data, not question-specific branches. A selected item is
   NOT proof of installation. Evidence exposes only matched vocabulary, never
   the surrounding note (which may contain customer information). */
import {reconcileWork} from './work-reconciliation.js';
import {publicBackupText} from '../gas/mappers.js';
import {physicalConsumption} from './physical-consumption.js';
export const ENTITIES = [
  {id:'onu_power_supply', pattern:'(?:бп|psu|блок\\s+(?:питания|живлення))\\s+(?:onu|ont|ону|онушк[а-я]*|оптичн[а-я]*\\s+термінал[а-я]*|оптическ[а-я]*\\s+терминал[а-я]*)|(?:onu|ont)\\s+psu'},
  {id:'router_power_supply', pattern:'(?:бп|psu|блок\\s+(?:питания|живлення))\\s+(?:роутер[а-я]*|маршрутизатор[а-я]*|router)|router\\s+psu'},
  {id:'power_supply', pattern:'бп|блок\\s+(?:питания|живлення)'},
  {id:'onu', pattern:'onu|ont|ону|онушк[а-я]*'},
  {id:'router', pattern:'router|роутер[а-я]*|маршрутизатор[а-я]*'},
  {id:'fiber', pattern:'(?:оптическ[а-я]*|оптичн[а-я]*)\\s+кабел[а-я]*|дроп[а-я]*|волс'},
  {id:'cable', pattern:'кабел[а-я]*|кабель|utp|утп|вита[яа]\\s+пара'},
  {id:'splice', pattern:'муфт[а-я]*'},
  {id:'splitter', pattern:'спл[иі]т[т]?ер[а-я]*'},
  {id:'patchcord', pattern:'патч[ -]?корд[а-я]*'},
  {id:'connector', pattern:'кон[н]?ектор[а-я]*'},
  {id:'box', pattern:'бокс[а-я]*|фоб[а-я]*'},
  {id:'connection', pattern:'абонент[а-я]*|п[оі]дключен[а-я]*'}
];
export const ACTIONS = [
  {id:'install', pattern:'установ[а-я]*|встанов[а-я]*|постав[а-я]*|ставил[а-я]*|ставили|монтаж|смонтир[а-я]*|змонт[а-я]*'},
  {id:'replace', pattern:'замен[а-я]*|зам[іи]н[а-я]*|менял[а-я]*|менять|міняв[а-я]*|міняти|поменял[а-я]*'},
  {id:'remove', pattern:'снял[а-я]*|зня[а-я]*|демонтаж|демонт[а-я]*'},
  {id:'check', pattern:'провер[а-я]*|перев[іи]р[а-я]*|д[іи]агност[а-я]*'},
  {id:'configure', pattern:'настро[а-я]*|налашту[а-я]*'},
  {id:'repair', pattern:'ремонт[а-я]*|почини[а-я]*|полагод[а-я]*'},
  {id:'restore', pattern:'восстанов[а-я]*|віднов[а-я]*'},
  {id:'lay', pattern:'протян[а-я]*|протяг[а-я]*|проклад[а-я]*|пролож[а-я]*'},
  {id:'weld', pattern:'свар[а-я]*|звар[а-я]*|пайка|спая[а-я]*'},
  {id:'move', pattern:'перен[ео][а-я]*'},
  {id:'connect', pattern:'подключ[а-я]*|підключ[а-я]*'},
  {id:'measure', pattern:'измер[а-я]*|вим[іи]р[а-я]*'}
];
export const EVENT_ACTIONS = ACTIONS.map(a => a.id).concat(['complete','mention','fault','measurement']);
export const CATEGORIES = ['definite','ambiguous','excluded','all'];
const BOUND_LEFT = '(?<![\\p{L}\\p{N}_])';
const BOUND_RIGHT = '(?![\\p{L}\\p{N}_])';
// Fixed dictionaries: compile once, not for every clause/item of every ticket.
const HIT_PATTERNS=new Map([ENTITIES,ACTIONS].map(defs=>[defs,defs.map(def=>({id:def.id,re:new RegExp(BOUND_LEFT+'(?:'+def.pattern.replaceAll('[а-я]','[а-яіїєґ]')+')'+BOUND_RIGHT,'giu')}))]));
function hits(text, defs){
  const out = [];
  for(const def of HIT_PATTERNS.get(defs)){
    for(const m of text.matchAll(def.re)) out.push({id:def.id,start:m.index,end:m.index+m[0].length,text:m[0]});
  }
  // Long compound wins over its components; no ONU event from «БП ONU».
  out.sort((a,b) => a.start-b.start || (b.end-b.start)-(a.end-a.start));
  return out.filter((h,i) => !out.slice(0,i).some(p => p.start<=h.start && p.end>=h.end));
}
export function normalizeEntity(value){
  const s = String(value || '').trim().toLowerCase();
  if(ENTITIES.some(e => e.id===s)) return s;
  const match = hits(s,ENTITIES);
  return match.length===1 && match[0].start===0 && match[0].end===s.length ? match[0].id : null;
}
export function validateSemantic(raw){
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) return null;
  if(Object.keys(raw).some(k => !['entity','action','category','signal_context','profile'].includes(k))) return null;
  const out = {};
  if(raw.entity!==undefined){ out.entity=normalizeEntity(raw.entity); if(!out.entity) return null; }
  if(raw.action!==undefined){ if(!EVENT_ACTIONS.includes(raw.action)) return null; out.action=raw.action; }
  if(raw.category!==undefined && !CATEGORIES.includes(raw.category)) return null;
  out.category=raw.category || 'definite';
  if(raw.signal_context!==undefined && !['subscriber','input','any'].includes(raw.signal_context)) return null;
  out.signal_context=raw.signal_context || 'subscriber';
  if(raw.profile!==undefined){
    if(!['work_v2','onu_physical','physical_consumption'].includes(raw.profile))return null;
    if(raw.profile==='onu_physical'&&(out.entity!=='onu'||out.action!=='install'))return null;
    if(raw.profile==='physical_consumption'&&(out.entity==='connection'||(out.action&&!['install','replace','lay'].includes(out.action))))return null;
    out.profile=raw.profile;
  }
  return out;
}
function publicText(value){
  return publicBackupText(String(value || '').replace(/\\n|\r\n?/g,'\n'));
}

/* Optical subscriber and input readings never collapse into one value.
   Unlabelled dBm is ambiguous, and plain negative numbers are not metrics. */
export function extractSignals(text){
  const out=[];
  const safeText=publicText(text);
  let previousEnd=0;
  const re=/(?:(сигнал\s*(?:onu|ону|ont)?|(?:onu|ону|ont)|вход(?:ной\s+сигнал)?|вхід(?:ний\s+сигнал)?)\s*[:=]?\s*)?(-\d+(?:[.,]\d+)?)\s*(d\s*bm|д\s*бм)?/giu;
  for(const m of safeText.matchAll(re)){
    const previous=out.at(-1);
    const continuation=!m[1] && previous && /^[\s,;]*(?:потом|затем|потім|далі)?\s*$/iu.test(safeText.slice(previousEnd,m.index));
    if(!m[1] && !m[3] && !continuation) continue;
    const value=Number(m[2].replace(',','.'));
    if(value < -100 || value > 0) continue;
    const context=m[1] ? (/вход|вхід/i.test(m[1]) ? 'input' : 'subscriber') : 'unknown';
    if(continuation && previous.value!==value) previous.category='ambiguous';
    out.push({value,unit:'dBm',context,category:context==='unknown'?'ambiguous':'definite'});
    previousEnd=m.index+m[0].length;
  }
  return out;
}
export function directCoworkers(ticket){
  return [...new Set((ticket.connectMasters || []).map(n => String(typeof n==='string'?n:n&&n.name||'').trim()).filter(Boolean))];
}
export function workEvents(ticket, legacyText, options={}){
  const coworkers=directCoworkers(ticket);
  const sources=[{kind:'public_text',text:legacyText}];
  for(const k of ['note','abonentNote','otherNote']) sources.push({kind:k,text:ticket[k]});
  for(const w of ticket.presetWorks || []) sources.push({kind:'preset_work',text:w.label,quantity:Number(w.qty)>0?Number(w.qty):null});
  for(const w of ticket.additionalWork || []) sources.push({kind:'additional_work',text:w.desc});
  const events=[];
  const add=(entity,action,category,evidence,source,quantity) => {
    const row={ticket_id:String(ticket.id),date:String(ticket.date||''),entity,action,category,quantity:quantity??null,coworkers: coworkers.slice(0,10),evidence:evidence.slice(0,120),reason:category==='definite'?'explicit_action':category==='excluded'?'negated_or_planned':'no_explicit_completed_action',source};
    // Public text and selected work can describe the same event. Dedupe,
    // never add their quantities together. Conflicts become ambiguous.
    const same=events.find(e => e.entity===entity && e.action===action && (e.category===category || e.reason==='conflicting_quantity'));
    if(same){
      if(same.reason==='conflicting_quantity') return;
      if(quantity!=null && same.quantity!=null && same.quantity!==quantity){same.category='ambiguous';same.quantity=null;same.reason='conflicting_quantity';}
      else if(quantity!=null) same.quantity=quantity;
      return;
    }
    events.push(row);
  };
  for(const source of sources){
    const text=publicText(source.text);
    for(const clause of text.split(/[\n;.!?]+/)){
      const objects=hits(clause,ENTITIES), verbs=hits(clause,ACTIONS);
      for(const object of objects){
        // Closest preceding verb, or a following noun-form («ONU монтаж»).
        const before=verbs.filter(v => v.start<object.start);
        const verb=before[before.length-1] || verbs.find(v => v.start>=object.end);
        let action=verb ? verb.id : 'mention';
        if(object.id==='connection' && action==='connect') action='complete';
        const lead=clause.slice(0,verb?verb.start:object.start);
        // Infinitive/future in a free note is not completed work. A selected
        // preset work is a structured performed-work row, so its catalogue
        // label may legitimately use an infinitive.
        const notCompleted=verb && source.kind!=='preset_work' && /(?:ть|ти|лю|им|имо)$/iu.test(verb.text);
        const blocked=notCompleted || /(?:^|\s)(?:не|нет|ні|без)\s*(?:\p{L}+\s+){0,1}$/iu.test(lead) || /(?:нужно|надо|треба|план|будем|будемо|будет|завтра|хотел|хочу|якщо|если)/iu.test(clause);
        // A verb on the other side of a comma belongs to another clause.
        const between=verb?clause.slice(Math.min(verb.end,object.end),Math.max(verb.start,object.start)):'';
        if(between.includes(',')) action='mention';
        let category=action==='mention'?'ambiguous':blocked?'excluded':'definite';
        if(!verb && /не\s*(?:работает|працює)|неисправ|несправ/iu.test(clause)){action='fault';category='definite';}
        // Bare measurement/fault mentions are excluded from installs, not
        // interpreted as events with a made-up installation action.
        const quantityLead=verb && clause.slice(verb.end<=object.start?verb.end:0,object.start);
        const quantityMatch=verb && /(?:^|\s)(\d+(?:[.,]\d+)?)\s*$/.exec(quantityLead);
        const quantity=quantityMatch?Number(quantityMatch[1].replace(',','.')):source.quantity;
        if(quantity===0) category='excluded';
        add(object.id,action,category,(verb?verb.text+' ':'')+object.text,source.kind,quantity);
      }
    }
  }
  // Selected hardware is mention evidence ONLY, never install evidence.
  for(const item of ticket.equipment || []){
    for(const object of hits(String(item.label||''),ENTITIES)){
      if(!events.some(e => e.entity===object.id)) add(object.id,'mention','ambiguous',object.text,'equipment',null);
    }
  }
  const signals=[];
  const structured=String(ticket.signal??'').trim();
  const textSignals=sources.flatMap(source=>extractSignals(source.text).map(metric=>({...metric,source:source.kind})));
  if(structured && Number.isFinite(Number(structured)) && Number(structured)>=-100 && Number(structured)<=0){
    // v3/v4 projections can derive signal from legacy text without preserving
    // provenance. A value evidenced ONLY as input must not become subscriber.
    const inputOnly=textSignals.some(s=>s.context==='input' && s.value===Number(structured)) && !textSignals.some(s=>s.context==='subscriber' && s.value===Number(structured));
    const uncertain=textSignals.some(s=>s.context==='subscriber' && s.category==='ambiguous') && textSignals.some(s=>s.value===Number(structured) && s.category==='ambiguous');
    if(!inputOnly) signals.push({value:Number(structured),unit:'dBm',context:'subscriber',category:uncertain?'ambiguous':'definite',source:'structured_signal'});
  }
  for(const metric of textSignals){
    if(signals.some(s => s.value===metric.value && s.context===metric.context)) continue;
    if(signals.some(s=>s.source==='structured_signal') && metric.context==='subscriber') continue; // structured wins
    signals.push({...metric});
  }
  // Multiple conflicting subscriber readings have no safe event association.
  if(new Set(signals.filter(s=>s.context==='subscriber').map(s=>s.value)).size>1){
    signals.forEach(s=>{if(s.context==='subscriber') s.category='ambiguous';});
  }
  const metric=signals.filter(s=>s.context==='subscriber' && s.category==='definite');
  const metricTargets=events.filter(e=>e.category==='definite' && ['onu','connection'].includes(e.entity));
  // A unique ticket reading cannot be assigned to several different actions
  // without timing/context proof. Ticket-level statistics still use it.
  if(metric.length===1 && metricTargets.length===1) metricTargets[0].metric=metric[0];
  const analysis={events,signals};
  if(!options.profile)return analysis;
  const explicit=events.map(e=>({...e})),texts=sources.map(s=>publicText(s.text));
  reconcileWork(ticket,analysis,texts);
  if(['onu_physical','physical_consumption'].includes(options.profile)){
    const physical=physicalConsumption(ticket,explicit,analysis,texts,label=>{const found=hits(label,ENTITIES);return found.length===1?found[0].id:null;},normalizeEntity,id=>ENTITIES.find(e=>e.id===id)?.pattern.replaceAll('[а-я]','[а-яіїєґ]'));
    analysis.events=physical.events;analysis.contexts=physical.contexts;
  }
  return analysis;
}

export function semanticMatches(event, filter){
  if(filter.entity && event.entity!==filter.entity && !(filter.profile==='physical_consumption'&&filter.entity==='cable'&&event.entity==='fiber')) return false;
  if(filter.profile==='onu_physical'){
    if(!['install','replace'].includes(event.action))return false;
  }else if(filter.profile==='physical_consumption'){
    if(!event.physical_consumption)return false;
    if(filter.action==='replace'&&event.action!=='replace'&&event.work_type!=='repair')return false;
  }else if(filter.action && filter.action!=='mention' && event.action!==filter.action) return false;
  return filter.category==='all' || event.category===filter.category;
}
export function semanticSignal(analysis, filter){
  const list=analysis.signals.filter(s=>s.category==='definite' && (filter.signal_context==='any' || s.context===filter.signal_context));
  return list.length===1?list[0].value:null;
}
export function aggregateWork(rows, byId, filter, groupBy){
  const events=rows.flatMap(t => (byId.get(t.id)?.events || []).filter(e=>semanticMatches(e,filter)));
  const numbers=rows.map(t=>semanticSignal(byId.get(t.id),filter)).filter(n=>n!==null);
  const quantity=events.filter(e=>e.quantity!==null);
  const groups=new Map();
  const physical=['onu_physical','physical_consumption'].includes(filter.profile),groupUnits=new Map();
  for(const t of rows){
    const matched=(byId.get(t.id)?.events||[]).filter(e=>semanticMatches(e,filter));
    let keys=[];
    if(groupBy==='entity') keys=matched.map(e=>e.entity);
    if(groupBy==='action') keys=matched.map(e=>e.action);
    if(groupBy==='date') keys=[String(t.date||'(без дати)')];
    if(groupBy==='month'){
      const parts=String(t.date||'').trim().split('.');
      keys=[parts.length===3?parts[2]+'-'+parts[1].padStart(2,'0'):'(без дати)'];
    }
    if(groupBy==='coworker'){keys=directCoworkers(t);if(!keys.length)keys=['(не вказано)'];}
    for(const key of new Set(keys)){
      if(!groups.has(key)) groups.set(key,{key,tickets:0,events:0,quantity_sum:0,quantity_known_events:0,quantity_unknown_events:0,money_sum:0});
      const group=groups.get(key), scoped=matched.filter(e=>groupBy==='entity'?e.entity===key:groupBy==='action'?e.action===key:true);
      group.tickets++;group.events+=scoped.length;group.money_sum+=Number(t.sum)||0;
      if(physical){if(!groupUnits.has(key))groupUnits.set(key,new Set());for(const e of scoped)if(e.quantity!==null)groupUnits.get(key).add(e.unit);}
      for(const e of scoped){if(e.quantity===null)group.quantity_unknown_events++;else{group.quantity_known_events++;group.quantity_sum+=e.quantity;}}
    }
  }
  const out={tickets:rows.length,events:events.length,quantity_sum:quantity.reduce((s,e)=>s+e.quantity,0),quantity_known_events:quantity.length,quantity_unknown_events:events.length-quantity.length,money_sum:rows.reduce((s,t)=>s+(Number(t.sum)||0),0),signal:{count:numbers.length,min:numbers.length?Math.min(...numbers):null,max:numbers.length?Math.max(...numbers):null,average:numbers.length?numbers.reduce((s,n)=>s+n,0)/numbers.length:null},groups:Array.from(groups.values()).sort((a,b)=>b.tickets-a.tickets||a.key.localeCompare(b.key)).slice(0,100)};
  if(physical){
    const totals=new Map(),units=new Set();
    for(const e of quantity){
      const key=e.entity+'|'+e.unit;units.add(e.unit);
      if(!totals.has(key))totals.set(key,{entity:e.entity,unit:e.unit,quantity:0,connection:0,repair:0,other:0});
      const total=totals.get(key);total.quantity+=e.quantity;total[e.work_type||'other']+=e.quantity;
    }
    out.consumption_totals=[...totals.values()].sort((a,b)=>a.entity.localeCompare(b.entity)||a.unit.localeCompare(b.unit));
    if(units.size>1)out.quantity_sum=null; // meters and pieces are not summable
    for(const group of out.groups){const scopedUnits=groupUnits.get(group.key)||new Set();if(scopedUnits.size>1)group.quantity_sum=null;else group.unit=[...scopedUnits][0]||null;}
  }
  return out;
}

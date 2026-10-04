/* Opt-in computed reconciliation. Never mutates a ticket or writes storage.
   Structured business rules are entity-specific, not hardware selection rules. */
import {onuReuseContext} from './physical-consumption.js';
export const CONTEXT_PATTERNS = {
  customer_owned_onu: /(?:onu|ону|ont|онушк[\p{L}]*)\s+(?:абонент[\p{L}]*|клиент[\p{L}]*|клієнт[\p{L}]*)|(?:сво[яєійю]|власн[\p{L}]*|клиентск[\p{L}]*|клієнтськ[\p{L}]*|абонентск[\p{L}]*|абонентськ[\p{L}]*)\s+(?:onu|ону|ont|онушк[\p{L}]*)|(?:оборудован[\p{L}]*|обладнан[\p{L}]*)\s+(?:абонент[\p{L}]*|клієнт[\p{L}]*|клиент[\p{L}]*)/iu,
  reused_onu_transfer: {test:onuReuseContext}
};
const NEW_ONU = /(?:постав[\p{L}]*|установ[\p{L}]*|встанов[\p{L}]*|замен[\p{L}]*|зам[іи]н[\p{L}]*)\s+(?:(?:на|нов[\p{L}]*|новеньк[\p{L}]*)\s+){1,3}(?:onu|ону|ont|онушк[\p{L}]*)|(?:постав[\p{L}]*|установ[\p{L}]*|встанов[\p{L}]*|замен[\p{L}]*|зам[іи]н[\p{L}]*)\s+(?:onu|ону|ont)\s+(?:на\s+)?нов[\p{L}]*/iu;
export function reconcileWork(ticket, analysis, texts){
  const events=analysis.events;
  const text=texts.join('\n');
  // Ownership of a PSU is not ownership of a separate ONU beside it.
  const contextText=text.replace(/(?:бп|блок\s+(?:питания|живлення))\s+(?:onu|ону|ont)\s+(?:абонент[\p{L}]*|клиент[\p{L}]*|клієнт[\p{L}]*)/giu,' ');
  const clauses=contextText.split(/[\n;,.!?]+/);
  const customer=clauses.some(clause=>CONTEXT_PATTERNS.customer_owned_onu.test(clause)),reuse=CONTEXT_PATTERNS.reused_onu_transfer.test(contextText);
  const connection=/^п[іо]дключен(?:ня|ие)$/iu.test(String(ticket.type||'').trim());
  const macPresent=/^(?:[\da-f]{12}|(?:[\da-f]{2}:){5}[\da-f]{2}|(?:[\da-f]{2}-){5}[\da-f]{2}|(?:[\da-f]{4}\.){2}[\da-f]{4})$/iu.test(String(ticket.macAddress||'').trim());
  const newActions=new Set();
  for(const clause of text.split(/[\n;,.!?]+/)){
    const match=NEW_ONU.exec(clause);
    if(match&&!/(?:^|\s)(?:не|ні|надо|треба|нужно|будем|будемо|завтра)\s/iu.test(clause)){
      newActions.add(/^зам/iu.test(match[0])?'replace':'install');
    }
  }
  const newExplicit=newActions.size>0;
  const reason=customer?'customer_owned_onu':reuse?'reused_onu_transfer':null;
  for(const event of events){
    event.quantity_source=event.quantity==null?'unknown':'explicit';
    if(event.entity==='onu'&&['install','replace'].includes(event.action)&&event.category==='definite'){
      event.reason=event.action==='replace'?'explicit_replace':'explicit_install';
      // New installation cannot turn a separate reused replacement into new hardware.
      if(reason&&!newActions.has(event.action)){event.category='excluded';event.reason=reason;}
    }
  }
  const coworkers=(ticket.connectMasters||[]).map(n=>String(typeof n==='string'?n:n?.name||'').trim()).filter(Boolean).slice(0,10);
  const add=(entity,action,category,source,quantity,evidence)=>events.push({ticket_id:String(ticket.id),date:String(ticket.date||''),entity,action,category,quantity,coworkers,reason:source,source,evidence,quantity_source:quantity==null?'unknown':'business_derived'});
  const blocked=events.some(e=>e.entity==='onu'&&['install','replace'].includes(e.action)&&e.category==='excluded'&&e.reason==='negated_or_planned');
  const plannedConnection=events.some(e=>e.entity==='connection'&&e.category==='excluded')||/(?:завтра|будем|будемо|надо|треба|нужно)\s+(?:подключ|підключ)/iu.test(text);
  if(connection&&!plannedConnection&&!events.some(e=>e.entity==='connection'&&e.action==='complete'&&e.category==='definite'))add('connection','complete','definite','structured_job_type',null,'type=Підключення');
  if(reason){
    analysis.contexts=[{entity:'onu',reason,category:'excluded',evidence:'MAC present='+(macPresent?'yes':'no')+'; '+reason+'=yes'}];
    if(!events.some(e=>e.entity==='onu'&&e.category==='excluded'&&e.reason===reason))add('onu','install','excluded',reason,null,'MAC present='+(macPresent?'yes':'no')+'; '+reason+'=yes');
  }else analysis.contexts=[];
  const placements=events.filter(e=>e.entity==='onu'&&['install','replace'].includes(e.action)&&e.category==='definite');
  // Adjectives/number words can hide a quantity from the legacy extractor.
  // A visible multi-unit claim must not be relabelled as the one-connection rule.
  const multiUnitClaim=[...text.matchAll(/(?<![\p{L}\p{N}])([\d]+(?:[.,]\d+)?|два|две|дві|двох|три|чотири|четыре)\s+(?:нов[\p{L}]*\s+)?(?:onu|ону|ont|онушк[\p{L}]*)(?![\p{L}\p{N}])/giu)].some(m=>!Number.isFinite(Number(m[1]))||Number(m[1])!==1);
  if(connection&&macPresent&&!blocked&&!plannedConnection&&(!reason||newExplicit)){
    const replacement=placements.find(e=>e.action==='replace');
    if(replacement){
      // One connection's ONU cannot be counted again as both install and replace.
      for(const e of placements)if(e!==replacement){e.category='excluded';e.reason='same_connection_onu_dedup';}
    }else if(placements.length){
      const install=placements[0];install.provenance=['explicit_install','derived_from_connection'];
      if(install.quantity==null&&multiUnitClaim){install.category='ambiguous';install.reason='conflicting_connection_quantity';}
      else if(install.quantity==null){install.quantity=1;install.quantity_source='business_derived';}
      else if(install.quantity!==1){install.category='ambiguous';install.reason='conflicting_connection_quantity';}
      install.install_origin='connection';
    }else if(!reason){
      add('onu','install','definite','derived_from_connection',1,'type=Підключення; MAC present=yes; customer-owned=no; transfer/reuse=no');
      events.at(-1).install_origin='connection';
    }
  }
  // Recompute unique metric attachment after derived events/deduplication.
  for(const event of events)delete event.metric;
  const metrics=analysis.signals.filter(s=>s.context==='subscriber'&&s.category==='definite');
  const targets=events.filter(e=>e.category==='definite'&&['onu','connection'].includes(e.entity));
  if(metrics.length===1&&targets.length===1)targets[0].metric=metrics[0];
  return analysis;
}

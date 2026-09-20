/* Stage 2C: conservative one-shot linker for LEGACY tickets.
   Builds a plan, never applies anything by itself, never guesses:
     EXACT / ALIAS_EXACT  → one action, applied only through the UI confirm
     AMBIGUOUS            → review only (two or more candidates)
     NO_MATCH / MALFORMED → left untouched (legacy stays legacy)
     already linked       → skipped, so a second run changes nothing
   Only cityId/streetId of a ticket are ever written: no text field, no house,
   no apartment, no ticket.id, no revision, no tombstones. */
(function(root,factory){
  const link = (typeof module==='object'&&module.exports)?require('./address-book-link'):(root&&root.MTTicketAddressLink);
  const api = factory(link);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTTicketAddressLinker=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(LINK){
  'use strict';
  const SAMPLE_LIMIT=20;
  const CATEGORY_ORDER=['already_linked','exact','alias_exact','ambiguous','no_match','malformed','foreign','stale'];
  function blankCounts(){
    const counts={};
    for(const key of CATEGORY_ORDER)counts[key]=0;
    counts.total=0;counts.actionable=0;
    return counts;
  }
  function sample(ticket){
    return {id:String((ticket&&ticket.id)||''),city:String((ticket&&ticket.city)||''),street:String((ticket&&ticket.street)||''),house:String((ticket&&ticket.house)||'')};
  }
  /* Deterministic category of ONE ticket. No fuzzy matching anywhere. */
  function categorize(book,ticket){
    const state=LINK.linkState(book,ticket);
    if(state==='linked')return 'already_linked';
    if(state==='foreign')return 'foreign';
    if(state==='stale')return 'stale';
    if(state==='partial')return 'malformed';
    const resolved=LINK.linkResolution(book,(ticket||{}).city,(ticket||{}).street);
    if(resolved.status==='EXACT')return 'exact';
    if(resolved.status==='ALIAS_EXACT')return 'alias_exact';
    if(resolved.status==='AMBIGUOUS')return 'ambiguous';
    if(resolved.status==='MALFORMED')return 'malformed';
    return 'no_match';
  }
  /* plan() is READ-ONLY: it inspects tickets and the directory and returns a
     description of what MAY be applied. */
  function plan(tickets,book,options){
    const list=Array.isArray(tickets)?tickets:[];
    const limit=Math.max(1,Math.min(100000,Number((options||{}).limit)||100000));
    const sampleLimit=Math.max(1,Math.min(200,Number((options||{}).sampleLimit)||SAMPLE_LIMIT));
    const counts=blankCounts();
    const actions=[];
    const review={ambiguous:[],no_match:[],malformed:[],stale:[],foreign:[]};
    for(const ticket of list){
      if(!ticket||typeof ticket!=='object')continue;
      counts.total++;
      const category=categorize(book,ticket);
      counts[category]=(counts[category]||0)+1;
      if(category==='exact'||category==='alias_exact'){
        const resolved=LINK.linkResolution(book,ticket.city,ticket.street);
        if(actions.length<limit){
          actions.push({id:String(ticket.id||''),cityId:resolved.cityId,streetId:resolved.streetId,category});
          counts.actionable++;
        }
      }else if(review[category]&&review[category].length<sampleLimit){
        review[category].push(sample(ticket));
      }
    }
    counts.reviewOnly=counts.ambiguous+counts.no_match+counts.malformed+counts.stale;
    return {counts,actions,review,generatedAt:new Date().toISOString()};
  }
  /* Applies a plan to the live array: only cityId/streetId, only the listed
     tickets, and only when the link is still valid at apply time (a ticket that
     changed in between is skipped instead of forced). Returns what changed so
     the caller can roll back when its durable write fails. */
  function apply(tickets,book,planData){
    const list=Array.isArray(tickets)?tickets:[];
    const byId=new Map(list.filter(t=>t&&typeof t==='object').map(t=>[String(t.id),t]));
    const applied=[],skipped=[];
    for(const action of ((planData&&planData.actions)||[])){
      const ticket=byId.get(String(action.id));
      if(!ticket||LINK.linkState(book,ticket)!=='none'){skipped.push(String(action.id));continue;}
      const resolved=LINK.linkResolution(book,ticket.city,ticket.street);
      if(!resolved.cityId||!resolved.streetId){skipped.push(String(action.id));continue;}
      applied.push({ticket,previous:{cityId:ticket.cityId,streetId:ticket.streetId}});
      ticket.cityId=resolved.cityId;
      ticket.streetId=resolved.streetId;
    }
    return {applied,skipped};
  }
  function rollback(applied){
    for(const entry of (applied||[])){
      const ticket=entry&&entry.ticket;
      if(!ticket)continue;
      const previous=entry.previous||{};
      if(previous.cityId===undefined)delete ticket.cityId;else ticket.cityId=previous.cityId;
      if(previous.streetId===undefined)delete ticket.streetId;else ticket.streetId=previous.streetId;
    }
  }
  return {CATEGORY_ORDER,plan,apply,rollback};
});

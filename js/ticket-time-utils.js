/* Ticket identity is never a clock: shared safe ordering/dedup helpers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MTTicketTime=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MIN_TIME=Date.UTC(2000,0,1),IMPORTANT=['photos','photo','masterNote','diagnosticHistory','geoLat','geoLng','geoLink','signal','equipment','cables','presetWorks','additionalWork','macAddress','login','password','clientName','phone','abonentNote','extraPhones','note','otherNote','networkPointIds'];
  const validTime=(value,now)=>Number.isFinite(value)&&value>=MIN_TIME&&value<=now+86400000;
  function ticketCreatedAtMs(ticket,now=Date.now()){
    const explicit=Number(ticket?.createdAtMs);if(validTime(explicit,now))return explicit;
    const parsed=Date.parse(String(ticket?.createdAt||''));if(validTime(parsed,now))return parsed;
    const legacy=Number(ticket?.id);return validTime(legacy,now)?legacy:null;
  }
  const normalized=value=>String(value||'').trim().toLocaleLowerCase('uk-UA');
  function isRecentDuplicateCandidate(ticket,{city,address,now=Date.now(),windowMs=10800000}={}){const created=ticketCreatedAtMs(ticket,now);return created!==null&&now>=created&&now-created<windowMs&&normalized(ticket?.city)===normalized(city)&&normalized(ticket?.address)===normalized(address);}
  const stable=value=>{if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;};
  function tokens(ticket){const result=[];IMPORTANT.forEach(key=>{const value=ticket?.[key];if(value===null||value===undefined||value===''||(Array.isArray(value)&&!value.length))return;result.push(`${key}:${JSON.stringify(stable(value))}`);});return new Set(result);}
  const contains=(left,right)=>[...right].every(value=>left.has(value));
  function chooseDuplicate(left,right,now=Date.now()){
    const leftTime=ticketCreatedAtMs(left,now),rightTime=ticketCreatedAtMs(right,now),leftTokens=tokens(left),rightTokens=tokens(right);
    if(leftTime!==null&&rightTime!==null&&leftTime!==rightTime){const older=leftTime<rightTime?left:right,newer=older===left?right:left,olderTokens=older===left?leftTokens:rightTokens,newerTokens=older===left?rightTokens:leftTokens;return contains(olderTokens,newerTokens)?{keep:older,remove:newer,ambiguous:false}:{keep:null,remove:null,ambiguous:true};}
    if(contains(leftTokens,rightTokens)&&!contains(rightTokens,leftTokens))return{keep:left,remove:right,ambiguous:false};
    if(contains(rightTokens,leftTokens)&&!contains(leftTokens,rightTokens))return{keep:right,remove:left,ambiguous:false};
    if(contains(leftTokens,rightTokens)&&contains(rightTokens,leftTokens)){const ordered=[left,right].sort((a,b)=>String(a?.id||'').localeCompare(String(b?.id||'')));return{keep:ordered[0],remove:ordered[1],ambiguous:false};}
    return{keep:null,remove:null,ambiguous:true};
  }
  function deduplicateTickets(items=[],now=Date.now()){
    const seen=new Map(),removed=new Set();let ambiguousCount=0;
    items.forEach(ticket=>{const key=`${ticket?.date||''}|${ticket?.time||''}|${ticket?.content||''}`,existing=seen.get(key);if(!existing){seen.set(key,ticket);return;}const choice=chooseDuplicate(existing,ticket,now);if(choice.ambiguous){ambiguousCount++;return;}removed.add(String(choice.remove.id));seen.set(key,choice.keep);});
    return{tickets:items.filter(ticket=>!removed.has(String(ticket?.id))),removedIds:[...removed],ambiguousCount};
  }
  return{ticketCreatedAtMs,isRecentDuplicateCandidate,chooseDuplicate,deduplicateTickets};
});

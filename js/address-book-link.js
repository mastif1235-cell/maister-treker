/* Stage 2B: additive ticket → AddressBook links.
   A ticket gets cityId/streetId ONLY when its own text resolves to exactly one
   directory identity (EXACT or ALIAS_EXACT). Nothing else is ever written:
   the historical city/street/house/apartment text and ticket.id stay untouched.
   Ids the local directory does not know (another device's directory) are never
   judged, never rewritten and never deleted. */
(function(root,factory){
  const book = (typeof module==='object'&&module.exports)?require('./address-book'):(root&&root.MTAddressBook);
  const api = factory(book);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTTicketAddressLink=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(AB){
  'use strict';
  const LINKABLE={EXACT:true,ALIAS_EXACT:true};
  const str=value=>typeof value==='string'?value:'';
  /* The SAME shape the Worker's projection accepts (mcp/src/gas/mappers.js ident):
   a directory id is a UUID or it is not an identity at all. */
  const ID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const shape=value=>typeof value==='string'&&ID_RE.test(value)?value:null;
  function has(book,kind,id){return !!(id&&book&&Array.isArray(book[kind])&&book[kind].some(item=>item&&item.id===id));}
  /* Resolution used for linking. Any non-unique outcome gives null ids. */
  function linkResolution(book,city,street){
    if(!AB||typeof AB.resolve!=='function'||!book)return {status:'MALFORMED',cityId:null,streetId:null};
    let resolved;
    try{resolved=AB.resolve(book,city,street);}
    catch(_error){return {status:'MALFORMED',cityId:null,streetId:null};}
    if(!resolved||!LINKABLE[resolved.status])return {status:(resolved&&resolved.status)||'MALFORMED',cityId:null,streetId:null};
    return {status:resolved.status,cityId:resolved.cityId,streetId:resolved.streetId};
  }
  /* none      — no ids at all (legacy row)
     partial   — only one of the two ids is present
     foreign   — ids unknown to THIS directory (another device): leave alone
     linked    — both ids known AND the ticket text still resolves to them
     stale     — both ids known but the text resolves elsewhere/nowhere */
  function linkState(book,ticket){
    const t=ticket||{};
    const hasCity=!!str(t.cityId),hasStreet=!!str(t.streetId);
    if(!hasCity&&!hasStreet)return 'none';
    const cityId=shape(str(t.cityId)),streetId=shape(str(t.streetId));
    if(!cityId||!streetId)return 'partial';
    if(!has(book,'cities',cityId)||!has(book,'streets',streetId))return 'foreign';
    const resolved=linkResolution(book,t.city,t.street);
    return (resolved.cityId===cityId&&resolved.streetId===streetId)?'linked':'stale';
  }
  /* Same normalization as the resolver: an address is "unchanged" when only
     case, whitespace or Unicode form differs. */
  const textKey=value=>str(value).normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
  function sameAddressText(ticket,previous){
    return textKey(ticket.city)===textKey(previous.city)&&textKey(ticket.street)===textKey(previous.street);
  }
  /* Writes the unique resolution of the ticket text, if any. */
  function resolveInto(ticket,book){
    const resolved=linkResolution(book,ticket.city,ticket.street);
    if(!resolved.cityId||!resolved.streetId)return false;
    if(ticket.cityId===resolved.cityId&&ticket.streetId===resolved.streetId)return false;
    ticket.cityId=resolved.cityId;
    ticket.streetId=resolved.streetId;
    return true;
  }
  /* Sets or clears the link of ONE ticket. Returns true when the ticket changed.
     Never touches another field, never rewrites text, never links an ambiguous
     or unknown address.
     `previous` (optional) is the stored version of the same ticket before this
     edit. With it the link follows the ADDRESS, not the directory of the day:
       • city/street text unchanged → the stored pair stays, even after a rename
         without alias, an archive, or when the ids belong to another phone's
         directory (an unrelated edit must never lose identity);
       • city/street text changed → the old pair no longer describes this ticket;
         ids this directory cannot re-validate (foreign/partial) are dropped and
         the new text is resolved like a new ticket. */
  function applyToTicket(ticket,book,previous){
    if(!ticket||typeof ticket!=='object'||Array.isArray(ticket))return false;
    const state=linkState(book,ticket);
    const hasPrevious=!!(previous&&typeof previous==='object'&&!Array.isArray(previous));
    if(hasPrevious&&sameAddressText(ticket,previous))return state==='none'?resolveInto(ticket,book):false;
    if(hasPrevious&&(state==='foreign'||state==='partial')){
      delete ticket.cityId;
      delete ticket.streetId;
      resolveInto(ticket,book);
      return true;
    }
    /* linked — already consistent; foreign — another directory's ids;
       partial — a half-written/garbage pair (imported file): all three are left
       exactly as they are, the master sees them on the check screen instead. */
    if(state==='linked'||state==='foreign'||state==='partial')return false;
    if(resolveInto(ticket,book))return true;
    /* Text no longer matches the stored link: keeping a wrong id would be worse
       than keeping none. Only ids this directory OWNS are dropped. */
    if(state==='stale'){
      let changed=false;
      if(ticket.cityId&&has(book,'cities',shape(str(ticket.cityId)))){delete ticket.cityId;changed=true;}
      if(ticket.streetId&&has(book,'streets',shape(str(ticket.streetId)))){delete ticket.streetId;changed=true;}
      return changed;
    }
    return false;
  }
  /* Canonical directory label for a LINKED ticket; null when the ticket keeps
     its own text as the source of display. */
  function labelFor(book,ticket){
    if(linkState(book,ticket)!=='linked')return null;
    const city=(book.cities||[]).find(item=>item.id===ticket.cityId);
    const street=(book.streets||[]).find(item=>item.id===ticket.streetId);
    if(!city||!street)return null;
    return [city.name,street.name].filter(Boolean).join(' · ');
  }
  /* Read-only diagnostic used by the "перевірка адрес" screen. */
  function describe(book,ticket){
    const resolved=linkResolution(book,(ticket||{}).city,(ticket||{}).street);
    return {state:linkState(book,ticket),status:resolved.status,cityId:resolved.cityId,streetId:resolved.streetId};
  }
  return {LINKABLE,linkResolution,linkState,sameAddressText,applyToTicket,labelFor,describe};
});

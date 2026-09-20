/* AI ticket identity contract. Ticket IDs are opaque sync-compatible strings:
   validate exactly, never clip/remove characters before a lookup. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
const TICKET_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function validateTicketId(value){
  const id = String(value == null ? '' : value).trim();
  return TICKET_ID_RE.test(id) ? id : null;
}

MTAI.ticketIds = Object.freeze({ validate:validateTicketId, pattern:TICKET_ID_RE });
})();

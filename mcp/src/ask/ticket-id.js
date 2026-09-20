/* Shared /ask-side ticket identity contract. Public /mcp schemas stay in
   tools/definitions.js; this helper only validates opaque IDs without ever
   truncating or rewriting them. */

export const TICKET_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function validateTicketId(value){
  const id = String(value == null ? '' : value).trim();
  return TICKET_ID_RE.test(id) ? id : null;
}

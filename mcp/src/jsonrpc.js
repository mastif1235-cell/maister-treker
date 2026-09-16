/* JSON-RPC 2.0 message handling for the stateless MCP transport.
   Batching was removed from MCP in spec 2025-06-18 — an array request is
   rejected as Invalid Request. */

export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};

export function makeResult(id, result){
  return {jsonrpc:'2.0', id, result};
}

export function makeError(id, code, message, data){
  const error = {code, message};
  if(data !== undefined) error.data = data;
  return {jsonrpc:'2.0', id, error};
}

/* Returns {ok:true, message} | {ok:false, errorResponse} (id null when
   unknowable) | {ok:false, parseError:true}. */
export function parseMessage(text){
  let parsed;
  try{ parsed = JSON.parse(text); }
  catch(_err){ return {ok:false, parseError:true}; }
  if(Array.isArray(parsed)) return {ok:false, errorResponse:makeError(null, ERROR_CODES.INVALID_REQUEST, 'JSON-RPC batching is not supported')};
  if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {ok:false, errorResponse:makeError(null, ERROR_CODES.INVALID_REQUEST, 'Not a JSON-RPC 2.0 message')};
  if(parsed.jsonrpc !== '2.0') return {ok:false, errorResponse:makeError(parsed.id == null ? null : parsed.id, ERROR_CODES.INVALID_REQUEST, 'jsonrpc must be exactly "2.0"')};
  if(typeof parsed.method !== 'string') return {ok:false, errorResponse:makeError(parsed.id == null ? null : parsed.id, ERROR_CODES.INVALID_REQUEST, 'Missing method')};
  return {ok:true, message:parsed};
}

export function isNotification(message){
  return message.id === undefined || message.id === null;
}

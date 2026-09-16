/* Signed read-only client for the existing Google Apps Script sync contract.
   Uses ONLY the signed GET actions the GAS deployment already exposes
   (`list`, `getTicketById`). It never performs writes and there is no code
   path that could: the fetch below is hard-wired to method GET with a signed
   URL, and the action allowlist is checked on every call (proven by tests). */

import {sign, VERSION} from './sync-contract.js';

export const GAS_READ_ACTIONS = ['list', 'getTicketById'];

function randomToken(random){
  return String(random()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}

export function createGasClient(options){
  const fetchImpl = options.fetchImpl;
  const baseUrl = String(options.url || '');
  const secret = String(options.secret || '');
  const now = options.now || Date.now;
  const random = options.random || function(){ return crypto.randomUUID() + crypto.randomUUID(); };
  const timeoutMs = Number(options.timeoutMs) || 8000;
  const listCacheTtlMs = options.listCacheTtlMs == null ? 15000 : Number(options.listCacheTtlMs);
  const cache = options.cache || new Map();

  async function signedGetUrl(action, entity, id){
    if(!GAS_READ_ACTIONS.includes(action)) throw new Error('ACTION_NOT_ALLOWED:' + action);
    const envelope = {v:VERSION, method:'GET', action, entity:String(entity), id:String(id),
      ts:String(now()), nonce:randomToken(random), requestId:'', body:''};
    envelope.sig = await sign(envelope, secret);
    return baseUrl + (baseUrl.includes('?') ? '&' : '?') + new URLSearchParams(envelope).toString();
  }

  async function rawGet(action, entity, id){
    let url;
    try{ url = await signedGetUrl(action, entity, id); }
    catch(err){ return {ok:false, code:'CONFIG', message:String(err && err.message || err)}; }
    const controller = new AbortController();
    const timer = setTimeout(function(){ controller.abort(); }, timeoutMs);
    let response;
    try{
      response = await fetchImpl(url, {method:'GET', signal:controller.signal});
    }catch(err){
      return {ok:false, code:'NETWORK', message:String(err && err.name || err)};
    }finally{
      clearTimeout(timer);
    }
    if(!response.ok) return {ok:false, code:'HTTP_' + response.status, message:'GAS responded ' + response.status};
    let data;
    try{ data = JSON.parse(await response.text()); }
    catch(_err){ return {ok:false, code:'DATA', message:'GAS returned non-JSON payload'}; }
    if(!data || typeof data !== 'object' || data.status !== 'ok'){
      return {ok:false, code:(data && typeof data === 'object' && data.code) ? String(data.code) : 'GAS_ERROR'};
    }
    return {ok:true, data};
  }

  function validateListShape(data){
    if(!data || !Array.isArray(data.tickets) || !Array.isArray(data.shifts)){
      return {ok:false, code:'DATA', message:'GAS list payload has unexpected shape'};
    }
    return null;
  }

  async function getList(){
    const cached = cache.get('list');
    if(cached && (listCacheTtlMs === 0 || (now() - cached.at) < listCacheTtlMs)) return cached.value;
    const result = await rawGet('list', 'system', '');
    if(!result.ok) return result;
    const shapeError = validateListShape(result.data);
    if(shapeError) return shapeError;
    cache.set('list', {at:now(), value:result});
    return result;
  }

  async function getTicketById(id){
    const ticketId = String(id == null ? '' : id).trim();
    if(!ticketId) return {ok:false, code:'INVALID_INPUT', message:'ticket_id is required'};
    const result = await rawGet('getTicketById', 'ticket', ticketId);
    if(!result.ok) return result;
    if(!('ticket' in result.data)) return {ok:false, code:'DATA', message:'GAS payload has no ticket field'};
    return result;
  }

  return {getList, getTicketById, signedGetUrl};
}

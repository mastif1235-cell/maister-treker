/* Canonical HMAC contract MT-SYNC-HMAC-V3 — Worker-side port of the app's
   js/sync-contract.js (byte-compatible canonical form; parity is proven by
   tests against the shared fixtures in tests/fixtures/ of the repo root and
   against the app module itself loaded in a vm sandbox).

   The server (Code.gs) validates: v=3, uppercase method, ts = 13-digit ms
   within ±5 min, nonce 16..128 chars of [A-Za-z0-9_-], unpadded base64url
   HMAC-SHA-256 over the length-prefixed canonical string below. */

const VERSION = 3;
const PREFIX = 'MT-SYNC-HMAC-V3';

function utf8Bytes(value){
  return new TextEncoder().encode(String(value == null ? '' : value));
}

function field(value){
  value = String(value == null ? '' : value);
  return utf8Bytes(value).length + ':' + value;
}

function canonical(request){
  return [
    PREFIX,
    field(String(Number(request.v))),
    field(String(request.method || '').toUpperCase()),
    field(String(request.action || '')),
    field(String(request.entity || '')),
    field(String(request.id || '')),
    field(String(request.ts || '')),
    field(String(request.nonce || '')),
    field(String(request.requestId || '')),
    field(String(request.body || ''))
  ].join('\n');
}

function base64Url(bytes){
  let binary = '';
  new Uint8Array(bytes).forEach(function(byte){ binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sign(request, secret){
  if(utf8Bytes(secret).length < 32) throw new Error('HMAC_SECRET_TOO_SHORT');
  const key = await crypto.subtle.importKey('raw', utf8Bytes(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return base64Url(await crypto.subtle.sign('HMAC', key, utf8Bytes(canonical(request))));
}

export {VERSION, PREFIX, utf8Bytes, field, canonical, base64Url, sign};

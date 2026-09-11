/* Canonical HMAC contract shared by the ticket/shift sync transport.
   This module IS wired into the production client: index.html loads it before
   js/sync-transport.js, which signs every mutation envelope with it. It must stay
   byte-compatible with the server copy in Code.gs (prefix MT-SYNC-HMAC-V3);
   parity is checked by tests/gas-contract.test.js and tests/secrets-static.test.js. */
(function(root, factory){
  var api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.MasterTrackerSyncContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  var VERSION = 3;
  var PREFIX = 'MT-SYNC-HMAC-V3';

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
    var binary = '';
    new Uint8Array(bytes).forEach(function(byte){ binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function sign(request, secret){
    if(utf8Bytes(secret).length < 32) throw new Error('HMAC_SECRET_TOO_SHORT');
    var key = await crypto.subtle.importKey('raw', utf8Bytes(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
    return base64Url(await crypto.subtle.sign('HMAC', key, utf8Bytes(canonical(request))));
  }

  return {VERSION:VERSION, PREFIX:PREFIX, utf8Bytes:utf8Bytes, field:field, canonical:canonical, sign:sign};
});

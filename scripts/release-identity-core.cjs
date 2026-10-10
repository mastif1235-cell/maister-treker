'use strict';
/* Release identity rule (v91.93 / runtime-138).
   The named Service Worker cache IS the release unit: any change to a
   runtime-proof asset between releases REQUIRES a new CACHE_NAME/runtime
   revision. Shipping changed cached JS under the same cache name is forbidden
   (v91.92 Android smoke: stale dispatcher-report-client.js kept executing from
   maister-treker-v67-runtime-137 while runtime-proof.json already expected the
   new bytes — runtime_verified stayed false until a cache bump).
   This module is the single implementation shared by the release build script
   and the regression tests. */
const crypto=require('node:crypto');
function fingerprint(assets){return crypto.createHash('sha256').update(JSON.stringify(assets)).digest('hex');}
function verifyReleaseIdentity({cacheName,assets,identity}){
  if(!cacheName||!assets||!identity||typeof identity!=='object'||Array.isArray(identity))throw new Error('RELEASE_IDENTITY_INVALID');
  const fp=fingerprint(assets),runtime=(String(cacheName).match(/runtime-\d+/)||[''])[0];
  if(!runtime)throw new Error('RELEASE_IDENTITY_NO_RUNTIME_TOKEN');
  const recorded=identity[cacheName];
  if(recorded&&recorded.fingerprint!==fp)throw new Error('RELEASE_IDENTITY_CHANGED: assets changed under cache name '+cacheName+' — bump CACHE_NAME/runtime revision');
  return {fingerprint:fp,runtime,recorded:!!recorded};
}
module.exports={fingerprint,verifyReleaseIdentity};

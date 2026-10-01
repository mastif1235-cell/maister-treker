/* Public secret-free manifest; PMTiles stays in PRIVATE R2.
   After separately authorized backend/auth setup, set manifestUrl and provide
   root.getOfflineMapDownloadUrl(mapId, version, {downloadId, sha256, size, signal}).
   It must use an authenticated signer and return matching identity plus
   {url, expiresAt, etag?}. URLs are ephemeral; no R2/admin credentials here.
   Allow only the exact manifest/signer/S3 HTTPS origins in index.html + _headers. */
(function(root){
  'use strict';
  root.MTOfflineMapCatalog=Object.freeze([
    Object.freeze({id:'dnipro-oblast',title:'Дніпропетровська область',size:114207260,manifestUrl:''})
  ]);
})(typeof globalThis!=='undefined'?globalThis:this);

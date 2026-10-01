/* Public secret-free GitHub Pages manifest; PMTiles stays in PRIVATE R2.
   root.getOfflineMapDownloadUrl(mapId, version, {downloadId, sha256, size, signal})
   uses the separately configured per-phone token and authenticated signer,
   returning matching identity plus
   {url, expiresAt, etag?}. URLs are ephemeral; no R2/admin credentials here.
   Allow only the exact manifest/signer/S3 HTTPS origins in index.html + _headers. */
(function(root){
  'use strict';
  root.MTOfflineMapCatalog=Object.freeze([
    Object.freeze({id:'dnipro-oblast',title:'Дніпропетровська область',size:114207260,manifestUrl:'https://mastif1235-cell.github.io/maister-treker/docs/offline-maps/dnipro-oblast/manifest.json'})
  ]);
})(typeof globalThis!=='undefined'?globalThis:this);

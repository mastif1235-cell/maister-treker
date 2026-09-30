/* Public read-only hosting only. Set manifestUrl after the owner configures R2
   and adds that exact HTTPS origin to connect-src in index.html + _headers.
   No credentials, temporary URLs, r2.dev or 114 MB file in the PWA shell. */
(function(root){
  'use strict';
  root.MTOfflineMapCatalog=Object.freeze([
    Object.freeze({id:'dnipro-oblast',title:'Дніпропетровська область',size:114207260,manifestUrl:''})
  ]);
})(typeof globalThis!=='undefined'?globalThis:this);

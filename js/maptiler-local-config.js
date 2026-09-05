/* Device-local MapTiler configuration. Never merged into application settings. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTMapTilerLocal=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const KEY_STORAGE='mt-maptiler-key-v1';
  const LAYER_STORAGE='mt-map-layer-v1';
  function storage(){try{return root.localStorage||null;}catch(_e){return null;}}
  function read(name){try{return String(storage()?.getItem(name)||'').trim();}catch(_e){return '';}}
  function write(name,value){try{storage()?.setItem(name,value);return true;}catch(_e){return false;}}
  function remove(name){try{storage()?.removeItem(name);return true;}catch(_e){return false;}}
  function getKey(){return read(KEY_STORAGE);}
  function saveKey(value){const key=String(value??'').trim();return key?write(KEY_STORAGE,key):false;}
  function clearKey(){return remove(KEY_STORAGE);}
  function getLayer(){return read(LAYER_STORAGE)==='satellite'?'satellite':'map';}
  function saveLayer(value){return write(LAYER_STORAGE,value==='satellite'?'satellite':'map');}
  return {KEY_STORAGE,LAYER_STORAGE,getKey,hasKey:()=>!!getKey(),saveKey,clearKey,getLayer,saveLayer};
});

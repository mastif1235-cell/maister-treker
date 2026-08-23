(function(){
  'use strict';
  const MAX_HASH_CHARS=8192;
  function bounded(v,max){return String(v==null?'':v).slice(0,max);}
  function decodeBase64Url(value){const raw=String(value||'');if(!raw||raw.length>MAX_HASH_CHARS||!/^[A-Za-z0-9_-]+$/.test(raw))throw new Error('bad');const normalized=raw.replace(/-/g,'+').replace(/_/g,'/'),padded=normalized+'='.repeat((4-normalized.length%4)%4),bin=atob(padded);if(bin.length>6144)throw new Error('large');return new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0)));}
  try{const hash=location.hash.slice(1);history.replaceState(null,'',location.pathname);if(hash.length>MAX_HASH_CHARS||!hash.startsWith('v1.'))throw new Error('bad');const data=JSON.parse(decodeBase64Url(hash.slice(3)));if(!data||data.v!==1||typeof data!=='object'||Array.isArray(data))throw new Error('bad');for(const [id,key,max] of [['addr','a',1000],['login','l',512],['pass','p',512],['number','n',256],['date','d',64]])document.getElementById(id).textContent=bounded(data[key],max)||'—';document.getElementById('content').classList.remove('hidden');}catch(_e){document.getElementById('error').classList.remove('hidden');}
})();

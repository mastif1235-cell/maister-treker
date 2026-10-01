import {authenticate} from '../auth/bearer.js';
import {loadMapConfig, MAP_CATALOG, MAP_ORIGIN} from './config.js';
import {signMapGet} from './sign.js';

async function boundedJson(request){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new Error('input');
  const reader=request.body?.getReader();if(!reader)throw new Error('input');
  let size=0, text='';const decoder=new TextDecoder();
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    if(size>2048)throw new Error('input');text+=decoder.decode(part.value,{stream:true});}
    return JSON.parse(text+decoder.decode());
  }finally{await reader.cancel().catch(()=>{});}
}

export function createMapGrantHandler(env, deps={}){
  let configPromise; // Lazy: unrelated routes never load map secrets.
  return async function grant(request){
    const origin=request.headers.get('Origin');
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Vary':'Origin'};
    if(origin===MAP_ORIGIN) Object.assign(headers, {'Access-Control-Allow-Origin':MAP_ORIGIN,
      'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'});
    const respond=(status, body, extra={})=>new Response(body===null?null:JSON.stringify(body),{status,headers:{...headers,...extra}});
    if(origin && origin!==MAP_ORIGIN)return respond(403,{error:'origin_denied'});
    if(request.method==='OPTIONS'){
      if(origin!==MAP_ORIGIN || request.headers.get('Access-Control-Request-Method')!=='POST')return respond(403,{error:'origin_denied'});
      const requested=(request.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      if(requested.some(h=>!['authorization','content-type'].includes(h)))return respond(403,{error:'origin_denied'});
      return respond(204,null);
    }
    if(request.method!=='POST')return respond(405,{error:'method_not_allowed'},{Allow:'POST, OPTIONS'});
    const loaded=await (configPromise ||= loadMapConfig(env));
    if(!loaded.ok)return respond(503,{error:'map_configuration'});
    const config=loaded.config;
    const auth=await authenticate(request.headers.get('Authorization'),config.tokens);
    if(!auth.ok)
      return respond(401,{error:'unauthorized'},{'WWW-Authenticate':'Bearer realm="offline-map"'});
    try{
      const rate=await config.limiter.limit({key:`map:${auth.client.name}:${MAP_CATALOG.mapId}`});
      if(!rate.success)return respond(429,{error:'rate_limited'},{'Retry-After':'60'});
      let body;
      try{body=await boundedJson(request);}catch(_error){return respond(400,{error:'invalid_input'});}
      const fields=['mapId','version','downloadId','sha256','size'];
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==fields.length||
        fields.some(key=>body[key]!==MAP_CATALOG[key]))return respond(409,{error:'map_mismatch'});
      const now=(deps.now||Date.now)();
      const url=await (deps.sign||signMapGet)(config,MAP_CATALOG,now);
      return respond(200,{...Object.fromEntries(fields.map(key=>[key,MAP_CATALOG[key]])),url,
        expiresAt:new Date(now+config.ttl*1000).toISOString()});
    }catch(_error){return respond(503,{error:'map_grant_unavailable'});}
  };
}

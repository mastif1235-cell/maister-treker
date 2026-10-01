import {parseBearerTokens, prepareTokens} from '../auth/bearer.js';

export const MAP_ORIGIN = 'https://mastif1235-cell.github.io';
export const MAP_CATALOG = Object.freeze({
  mapId:'dnipro-oblast', version:'2026-09-30', downloadId:'dnipro-oblast-2026-09-30',
  objectKey:'dnipro/2026-09-30/dnipro-oblast-z0-15.pmtiles', size:114207260,
  sha256:'4ebb26c99a51407dab3a1d45cdfaef9f2d176003a1bdb19579caa1d9001877da'
});

/* Independent of GAS/AI/KV. A missing map setting disables only this route. */
export async function loadMapConfig(env){
  try{
    const tokens = parseBearerTokens(env.MAP_BEARER_TOKENS);
    if(new Set(tokens.map(token=>token.raw)).size!==tokens.length)throw new Error('duplicate_device_credential');
    // A capability must never reuse a credential from another pool.
    for(const raw of [env.MCP_BEARER_TOKENS, env.ASK_BEARER_TOKENS]){
      if(!raw) continue;
      const other = String(raw).split(/[;\n]+/).map(entry=>entry.trim().split(':')[1]);
      if(tokens.some(token=>other.includes(token.raw))) throw new Error('overlapping_pool');
    }
    if(!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID || '') ||
       !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET || '') ||
       !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY ||
       String(env.MAP_SIGN_TTL_SECONDS) !== '900' ||
       env.MAP_ALLOWED_ORIGIN !== MAP_ORIGIN ||
       typeof env.MAP_GRANT_RATE_LIMIT?.limit !== 'function') throw new Error('map_configuration');
    return {ok:true, config:{tokens:await prepareTokens(tokens), accountId:env.R2_ACCOUNT_ID,
      bucket:env.R2_BUCKET, accessKeyId:env.R2_ACCESS_KEY_ID, secretAccessKey:env.R2_SECRET_ACCESS_KEY,
      ttl:900, origin:MAP_ORIGIN, limiter:env.MAP_GRANT_RATE_LIMIT}};
  }catch(_error){return {ok:false};} // Never emit parser errors or env values.
}

/* Environment parsing. Fail-closed: any missing/invalid piece of security
   configuration disables the data endpoint (HTTP 503) instead of falling
   back to permissive behavior. Secret values are never included in errors
   returned to clients (only field names). */

import {parseBearerTokens, prepareTokens} from './auth/bearer.js';

function intInRange(value, fallback, min, max){
  const parsed = Number(value);
  if(!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/* Returns a promise resolving to {ok:true, config} | {ok:false, reason}. */
export async function loadConfig(env){
  env = env || {};
  const gasSyncUrl = String(env.GAS_SYNC_URL || '').trim();
  if(!/^https:\/\/[^\s]+$/i.test(gasSyncUrl)) return {ok:false, reason:'GAS_SYNC_URL must be an https URL'};
  const gasHmacSecret = String(env.GAS_SYNC_HMAC_SECRET || '');
  if(gasHmacSecret.length < 32) return {ok:false, reason:'GAS_SYNC_HMAC_SECRET must be at least 32 chars'};
  let tokens;
  try{ tokens = await prepareTokens(parseBearerTokens(env.MCP_BEARER_TOKENS)); }
  catch(err){ return {ok:false, reason:String(err && err.message || err)}; }
  /* --- stage D: optional /ask auth (same token format; absence -> reuse the
     MCP tokens). A parse error here disables /ask only, never /mcp. --- */
  let askTokens = null;
  let askTokensError = null;
  if(env.ASK_BEARER_TOKENS != null && String(env.ASK_BEARER_TOKENS).trim() !== ''){
    try{ askTokens = await prepareTokens(parseBearerTokens(env.ASK_BEARER_TOKENS)); }
    catch(err){ askTokensError = String(err && err.message || err); }
  }
  return {
    ok: true,
    config: {
      gasSyncUrl,
      gasHmacSecret,
      tokens,
      rateLimitPerMin: intInRange(env.MCP_RATE_LIMIT_PER_MIN, 120, 1, 100000),
      listCacheTtlMs: intInRange(env.MCP_LIST_CACHE_TTL_MS, 15000, 0, 300000),
      gasTimeoutMs: intInRange(env.MCP_GAS_TIMEOUT_MS, 8000, 1000, 120000),
      maxBodyBytes: 1048576,
      /* --- stage A: KV snapshot cache knobs (optional, additive) --- */
      snapshotTtlMs: intInRange(env.MCP_SNAPSHOT_TTL_MS, 300000, 30000, 3600000),
      snapshotStaleMs: intInRange(env.MCP_SNAPSHOT_STALE_MS, 86400000, 60000, 604800000),
      /* --- stage D: /ask (optional; absence never disables /mcp) --- */
      groqApiKey: String(env.GROQ_API_KEY || '').trim(),
      askModel: String(env.ASK_MODEL || 'openai/gpt-oss-120b').trim() || 'openai/gpt-oss-120b',
      askTokens: askTokens,
      askTokensError: askTokensError
    }
  };
}

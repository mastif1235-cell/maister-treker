/* Bearer-token authentication for the MCP endpoint (stage E0/E1).
   - Tokens come from the MCP_BEARER_TOKENS secret; only SHA-256 digests are
     compared, in constant time; tokens are never logged.
   - Every token has a scope; this READ-ONLY stage accepts scope "read" only.
   - The auth layer is a single pluggable function so an OAuth 2.1 resource
     server (required by some cloud MCP clients, e.g. ChatGPT custom
     connectors) can be layered in front of the same handlers later without
     touching tool code. */

async function sha256Bytes(text){
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

function timingSafeEqual(a, b){
  if(a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* Config format: entries separated by ";" or newlines, fields by ":" —
   name:token:scope. Parsed by config.js; here we only validate the shape. */
export function parseBearerTokens(raw){
  const tokens = [];
  const seenNames = new Set();
  const entries = String(raw || '').split(/[;\n]+/);
  for(const entry of entries){
    const trimmed = entry.trim();
    if(!trimmed) continue;
    const parts = trimmed.split(':');
    if(parts.length !== 3) throw new Error('MCP_BEARER_TOKENS: entry must be name:token:scope');
    const name = parts[0], token = parts[1], scope = parts[2];
    if(!/^[a-z0-9_-]{1,32}$/.test(name)) throw new Error('MCP_BEARER_TOKENS: bad client name');
    if(!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('MCP_BEARER_TOKENS: token must be 32..128 chars of [A-Za-z0-9_-]');
    if(scope !== 'read') throw new Error('MCP_BEARER_TOKENS: only scope "read" is supported in this stage');
    if(seenNames.has(name)) throw new Error('MCP_BEARER_TOKENS: duplicate client name');
    seenNames.add(name);
    tokens.push({name, digest: null, raw: token, scope});
  }
  if(!tokens.length) throw new Error('MCP_BEARER_TOKENS: at least one token is required');
  return tokens;
}

/* Precompute digests once per config load. */
export async function prepareTokens(tokens){
  for(const token of tokens){
    token.digest = await sha256Bytes(token.raw);
    token.raw = '';
  }
  return tokens;
}

/* Returns {ok:true, client:{name, scope}} | {ok:false, reason}. */
export async function authenticate(headerValue, tokens){
  if(typeof headerValue !== 'string') return {ok:false, reason:'missing'};
  const m = /^Bearer\s+(\S+)$/i.exec(headerValue.trim());
  if(!m) return {ok:false, reason:'malformed'};
  const provided = await sha256Bytes(m[1]);
  for(const token of tokens){
    if(token.scope !== 'read') continue;
    if(timingSafeEqual(provided, token.digest)) return {ok:true, client:{name:token.name, scope:token.scope}};
  }
  return {ok:false, reason:'unknown_token'};
}

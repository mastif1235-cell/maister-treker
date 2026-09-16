/* Maister-Tracker READ-ONLY MCP server — Cloudflare Worker entry point.

   Endpoints:
     GET  /healthz — liveness, no data, no auth.
     POST /mcp     — the MCP endpoint (stateless JSON-RPC over Streamable
                     HTTP; single JSON responses, no SSE stream needed for
                     this tool-only server). Requires Bearer auth.
     Anything else — 404.

   The Worker stores NO application data: every answer is produced from a
   signed read against the existing GAS/Sheets sync contract at request time.
   There are no CORS headers on /mcp on purpose: browser-based callers are not
   a supported client kind in this stage, and cloud/CLI clients call the
   endpoint server-side. */

import {loadConfig} from './config.js';
import {createGasClient} from './gas/client.js';
import {createReadTools} from './tools/read.js';
import {createMcpServer} from './mcp/server.js';
import {authenticate} from './auth/bearer.js';
import {createRateLimiter} from './ratelimit.js';
import {parseMessage, makeError, ERROR_CODES, isNotification} from './jsonrpc.js';

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function jsonResponse(status, body, extraHeaders){
  return new Response(JSON.stringify(body), {status, headers: Object.assign({}, SECURITY_HEADERS, extraHeaders || {})});
}

export function createApp(env, deps){
  deps = deps || {};
  const appPromise = loadConfig(env).then(function(loaded){
    if(!loaded.ok) return {ok:false, reason:loaded.reason};
    const config = loaded.config;
    const gas = deps.gas || createGasClient({
      fetchImpl: deps.fetchImpl || fetch,
      url: config.gasSyncUrl,
      secret: config.gasHmacSecret,
      timeoutMs: config.gasTimeoutMs,
      listCacheTtlMs: config.listCacheTtlMs
    });
    const server = createMcpServer({tools: createReadTools({gas})});
    const limiter = deps.limiter || createRateLimiter({limitPerMin: config.rateLimitPerMin});
    return {ok:true, config, server, limiter};
  });

  async function handler(request){
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if(path === '/healthz'){
      return jsonResponse(200, {ok:true, service:'maister-tracker-mcp', read_only:true});
    }

    if(path !== '/mcp') return jsonResponse(404, {error:'not_found'});

    if(request.method !== 'POST'){
      return jsonResponse(405, {error:'method_not_allowed', hint:'POST JSON-RPC to /mcp'}, {Allow:'POST'});
    }

    const app = await appPromise;
    if(!app.ok){
      console.error('[mcp] config rejected:', app.reason);
      return jsonResponse(503, {error:'server_configuration'});
    }

    const auth = await authenticate(request.headers.get('Authorization'), app.config.tokens);
    if(!auth.ok) return jsonResponse(401, {error:'unauthorized'}, {'WWW-Authenticate':'Bearer realm="maister-tracker-mcp"'});

    const rate = app.limiter.check(auth.client.name);
    if(!rate.allowed) return jsonResponse(429, {error:'rate_limited', retry_after_sec:rate.retryAfterSec}, {'Retry-After':String(rate.retryAfterSec)});

    const bodyText = await request.text();
    if(bodyText.length > app.config.maxBodyBytes) return jsonResponse(413, {error:'payload_too_large'});

    const parsed = parseMessage(bodyText);
    if(parsed.parseError) return jsonResponse(400, makeError(null, ERROR_CODES.PARSE_ERROR, 'Invalid JSON'));
    if(!parsed.ok && parsed.errorResponse) return jsonResponse(400, parsed.errorResponse);

    const message = parsed.message;
    if(isNotification(message)) return new Response(null, {status:202});

    let outcome;
    try{ outcome = await app.server.handleMessage(message); }
    catch(err){
      return jsonResponse(200, makeError(message.id, ERROR_CODES.INTERNAL_ERROR, 'Internal error'));
    }
    if(outcome.notification) return new Response(null, {status:202});
    if(outcome.error) return jsonResponse(200, outcome.error);
    return jsonResponse(200, outcome.response);
  }

  return {fetch: handler, appPromise};
}

/* Isolate-level cache so the default export keeps rate-limit state across
   requests while staying compatible with the stateless protocol layer. */
const appCache = new WeakMap();

export default {
  async fetch(request, env, _ctx){
    let app = appCache.get(env);
    if(!app){
      app = createApp(env);
      appCache.set(env, app);
    }
    return app.fetch(request);
  }
};

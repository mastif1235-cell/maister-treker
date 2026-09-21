/* Maister-Tracker READ-ONLY MCP server + AI orchestrator — Cloudflare Worker.

   Endpoints:
     GET  /healthz — liveness, no data, no auth.
     POST /mcp     — the MCP endpoint (stateless JSON-RPC over Streamable
                     HTTP). Requires Bearer auth. READ-ONLY.
     POST /ask     — server-side AI orchestrator (stage D): Groq reasons, this
                     Worker executes the whitelisted READ tools itself and
                     returns the final natural-language answer. Requires
                     Bearer auth (ASK_BEARER_TOKENS when configured, otherwise
                     the MCP tokens). Requires the GROQ_API_KEY secret.
     POST /directory — Stage 2D: the PWA pushes its AddressBook projection
                     (cities/streets: id, name, aliases, active). Same Bearer
                     auth and rate limit as /ask. Stored in KV
                     (mt:directory:v1, UNION by UUID) next to the ticket
                     snapshot; never touches Google Sheets. Without the KV
                     binding the endpoint answers 503 and every tool keeps its
                     ticket-derived behaviour.
     Anything else — 404.

   Data path: every answer is produced from a signed read against the existing
   GAS/Sheets sync contract. The optional KV snapshot cache (stage A) stores
   ONLY the redacted projection for ~5 minutes (stale-while-revalidate) and is
   refreshed by a Cron Trigger; absence of the KV binding is a transparent
   passthrough. There are no CORS headers on purpose: browser-based callers
   are not a supported client kind in this stage.

   A Cron Trigger (crons in wrangler.toml) invokes scheduled() to keep the
   KV snapshot warm so that most tool calls never touch the slow GAS path. */

import {loadConfig} from './config.js';
import {createGasClient} from './gas/client.js';
import {createDataPipeline} from './tools/read.js';
import {createSnapshotProvider} from './data/snapshot.js';
import {createDirectoryStore, DIRECTORY_LIMITS} from './data/directory.js';
import {createReadTools} from './tools/read.js';
import {createMcpServer} from './mcp/server.js';
import {authenticate} from './auth/bearer.js';
import {createRateLimiter} from './ratelimit.js';
import {parseMessage, makeError, ERROR_CODES, isNotification} from './jsonrpc.js';
import {createGroqClient} from './ask/groq.js';
import {createDeepSeekClient} from './ask/deepseek.js';
import {createAskOrchestrator} from './ask/orchestrator.js';
import {TOOL_DEFINITIONS} from './tools/definitions.js';

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

/* Browser clients (the PWA) call /healthz, /ai/config and /ask from a
   different origin, so these public/ask routes need CORS — including an
   OPTIONS preflight (the /ask request carries Content-Type + Authorization).
   Scoped to these routes only; /mcp (native MCP clients) stays CORS-free.
   No secrets are involved: ACAO * is safe because auth is via a manual
   Authorization header, never cookies. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};
function withCors(response){
  for(const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
  return response;
}

/* Public, secret-free capability descriptor for onboarding in the PWA:
   mode, auth flag, providers/models with capabilities. NEVER includes keys,
   tokens, URLs of upstream providers or anything secret — safe to expose. */
function publicAiConfig(app){
  const deepseekConfigured = !!(app && app.ok && app.deepseekAsk);
  const groqConfigured = !!(app && app.ok && app.groqAsk);
  const anyConfigured = deepseekConfigured || groqConfigured;
  const defaultProvider = deepseekConfigured ? 'deepseek' : (groqConfigured ? 'groq' : 'deepseek');
  const groqModel = app && app.ok ? app.config.askModel : 'openai/gpt-oss-120b';
  const deepseekModel = app && app.ok ? app.config.deepseekModel : 'deepseek-flash';
  return {
    ok: true,
    mode: 'read-only',
    auth_required: true,
    ask_configured: anyConfigured,
    default_provider: defaultProvider,
    version: 2,
    providers: [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        enabled: deepseekConfigured,
        default_model: deepseekModel,
        models: [{ id: deepseekModel, label: 'deepseek-flash', capabilities: ['text', 'tools'] }]
      },
      {
        id: 'groq',
        name: 'Groq',
        enabled: groqConfigured,
        default_model: groqModel,
        models: [{ id: groqModel, capabilities: ['text', 'tools', 'reasoning'] }]
      }
    ]
  };
}

function jsonResponse(status, body, extraHeaders){
  return new Response(JSON.stringify(body), {status, headers: Object.assign({}, SECURITY_HEADERS, extraHeaders || {})});
}

export function createApp(env, deps){
  deps = deps || {};
  /* Per-request execution context holder: Cloudflare passes a fresh ctx to
     every fetch/scheduled invocation; the snapshot provider uses it for
     background writes (stale-while-revalidate). */
  const ctxHolder = {current:null};

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
    const pipeline = createDataPipeline(gas);
    const provider = createSnapshotProvider({
      fetchFn: function(){ return pipeline.getList(); },
      kv: (env && env.MT_SNAPSHOT_KV) || null,
      ttlMs: config.snapshotTtlMs,
      staleMs: config.snapshotStaleMs,
      waitUntil: function(promise){
        const ctx = ctxHolder.current;
        if(ctx && typeof ctx.waitUntil === 'function'){
          try{ ctx.waitUntil(promise); }
          catch(_err){ if(promise && typeof promise.catch === 'function') promise.catch(function(){}); }
        } else if(promise && typeof promise.catch === 'function'){
          promise.catch(function(){});
        }
      },
      log: function(message){ console.error('[mcp] ' + message); }
    });
    /* Stage 2D: the phone's directory (own KV key, own version) — read by the
       tools next to the ticket snapshot, written only by POST /directory. */
    const directory = createDirectoryStore({
      kv: (env && env.MT_SNAPSHOT_KV) || null,
      log: function(message){ console.error('[mcp] ' + message); }
    });
    const tools = createReadTools({gas, data: provider, directory});
    const server = createMcpServer({tools});
    const limiter = deps.limiter || createRateLimiter({limitPerMin: config.rateLimitPerMin});

    /* stage D: providers for /ask (DeepSeek and Groq).
       DeepSeek is the preferred default if configured. */
    let deepseekAsk = null;
    let deepseekDisabledReason = null;
    if(!config.deepseekApiKey) deepseekDisabledReason = 'DEEPSEEK_API_KEY is not configured';
    else if(config.askTokensError) deepseekDisabledReason = 'ASK_BEARER_TOKENS is invalid';
    else {
      const deepseekClient = createDeepSeekClient({
        fetchImpl: deps.fetchImpl || fetch,
        apiKey: config.deepseekApiKey,
        model: config.deepseekModel
      });
      deepseekAsk = createAskOrchestrator({groq: deepseekClient, tools, toolDefs: TOOL_DEFINITIONS});
    }

    let groqAsk = null;
    let groqDisabledReason = null;
    if(!config.groqApiKey) groqDisabledReason = 'GROQ_API_KEY is not configured';
    else if(config.askTokensError) groqDisabledReason = 'ASK_BEARER_TOKENS is invalid';
    else {
      const groqClient = createGroqClient({
        fetchImpl: deps.fetchImpl || fetch,
        apiKey: config.groqApiKey,
        model: config.askModel
      });
      groqAsk = createAskOrchestrator({groq: groqClient, tools, toolDefs: TOOL_DEFINITIONS});
    }

    const defaultAsk = deepseekAsk || groqAsk;
    const ask = defaultAsk;
    const askDisabledReason = (config.askTokensError ? 'ASK_BEARER_TOKENS is invalid' : (!defaultAsk ? 'No AI provider (DEEPSEEK_API_KEY or GROQ_API_KEY) configured' : null));
    const askAuthTokens = (config.askTokens && config.askTokens.length) ? config.askTokens : config.tokens;

    return {ok:true, config, server, limiter, provider, directory, tools, ask, deepseekAsk, groqAsk, deepseekDisabledReason, groqDisabledReason, askDisabledReason, askAuthTokens};
  });

  /* Stage 2D: POST /directory — the PWA's AddressBook projection into KV.
     Fail-closed order: method → config → auth → rate limit → size → shape.
     The response carries counts only (never the stored names). */
  async function directoryHandler(request){
    if(request.method !== 'POST'){
      return jsonResponse(405, {error:'method_not_allowed', hint:'POST {"v":1,"cities":[...],"streets":[...]} to /directory'}, {Allow:'POST'});
    }
    const app = await appPromise;
    if(!app.ok){
      console.error('[mcp] config rejected:', app.reason);
      return jsonResponse(503, {error:'server_configuration'});
    }
    const auth = await authenticate(request.headers.get('Authorization'), app.askAuthTokens);
    if(!auth.ok) return jsonResponse(401, {error:'unauthorized'}, {'WWW-Authenticate':'Bearer realm="maister-tracker-mcp", scope="ask"'});
    const rate = app.limiter.check('directory:' + auth.client.name);
    if(!rate.allowed) return jsonResponse(429, {error:'rate_limited', retry_after_sec:rate.retryAfterSec}, {'Retry-After':String(rate.retryAfterSec)});
    const bodyText = await request.text();
    if(bodyText.length > DIRECTORY_LIMITS.maxBodyBytes) return jsonResponse(413, {error:'payload_too_large'});
    let body;
    try{ body = JSON.parse(bodyText); }
    catch(_err){ return jsonResponse(400, {error:'invalid_json'}); }
    const outcome = await app.directory.put(body);
    if(!outcome.ok){
      const code = String(outcome.code || 'INVALID_DIRECTORY');
      if(code === 'KV_UNAVAILABLE' || code === 'KV_WRITE_FAILED') return jsonResponse(503, {error:'directory_unavailable', code});
      return jsonResponse(400, {error:'invalid_directory', code});
    }
    return jsonResponse(200, {ok:true, cities:outcome.cities, streets:outcome.streets, dropped:outcome.dropped, saved_at:new Date(outcome.savedAt).toISOString()});
  }

  async function askHandler(request){
    if(request.method !== 'POST'){
      return jsonResponse(405, {error:'method_not_allowed', hint:'POST {"question":"..."} to /ask'}, {Allow:'POST'});
    }
    const app = await appPromise;
    if(!app.ok){
      console.error('[mcp] config rejected:', app.reason);
      return jsonResponse(503, {error:'server_configuration'});
    }
    const auth = await authenticate(request.headers.get('Authorization'), app.askAuthTokens);
    if(!auth.ok) return jsonResponse(401, {error:'unauthorized'}, {'WWW-Authenticate':'Bearer realm="maister-tracker-mcp", scope="ask"'});

    const rate = app.limiter.check('ask:' + auth.client.name);
    if(!rate.allowed) return jsonResponse(429, {error:'rate_limited', retry_after_sec:rate.retryAfterSec}, {'Retry-After':String(rate.retryAfterSec)});

    if(!app.ask){
      console.error('[ask] disabled:', app.askDisabledReason);
      return jsonResponse(503, {error:'ask_not_configured'});
    }

    const bodyText = await request.text();
    if(bodyText.length > 32768) return jsonResponse(413, {error:'payload_too_large'});
    let body;
    try{ body = JSON.parse(bodyText); }
    catch(_err){ return jsonResponse(400, {error:'invalid_json'}); }
    const question = body && typeof body.question === 'string' ? body.question.trim() : '';
    if(!question || question.length > 2000){
      return jsonResponse(400, {error:'invalid_question', hint:'question must be a non-empty string of at most 2000 chars'});
    }

    // Determine target provider with strict allowlist
    const requestedProvider = String((body && body.provider) || '').trim().toLowerCase() || (app.deepseekAsk ? 'deepseek' : 'groq');
    if(requestedProvider !== 'deepseek' && requestedProvider !== 'groq'){
      return jsonResponse(400, {error:'invalid_provider', hint:'provider must be "deepseek" or "groq"'});
    }

    let targetAsk = null;
    if(requestedProvider === 'deepseek'){
      if(!app.deepseekAsk){
        return jsonResponse(503, {error:'deepseek_not_configured', message:'DEEPSEEK_API_KEY is not configured on Worker'});
      }
      targetAsk = app.deepseekAsk;
    } else if(requestedProvider === 'groq'){
      if(!app.groqAsk){
        return jsonResponse(503, {error:'groq_not_configured', message:'GROQ_API_KEY is not configured on Worker'});
      }
      targetAsk = app.groqAsk;
    } else {
      targetAsk = app.ask;
    }

    if(!targetAsk){
      console.error('[ask] disabled:', app.askDisabledReason);
      return jsonResponse(503, {error:'ask_not_configured'});
    }

    /* Обмежена історія поточної AI-сесії з PWA (follow-up «а за август?»,
       «там» тощо). Тільки user/assistant-рядки — див. sanitizeHistory. */
    const history = Array.isArray(body.history) ? body.history : [];
    /* Referent context: структуровані заявки з ПОПЕРЕДНЬОЇ відповіді — щоб
       «відкрий цю заявку» мало реальний обʼєкт дії без повторного пошуку.
       Тільки безпечна проєкція (див. normalizeContextTickets). */
    const contextTickets = body && body.context && Array.isArray(body.context.tickets) ? body.context.tickets : [];
    /* v91.46: structured follow-up context (resolved_filters of the previous
       turn's authoritative query_tickets) — echoed back by the PWA so
       «покажи их» re-runs the SAME structured filters on a fresh READ. */
    const queryContext = body && body.context && body.context.queryContext ? body.context.queryContext : null;
    const chatSessionId = body && body.context ? body.context.chatSessionId : null;
    const resultSet = body && body.context ? body.context.resultSet : null;
    const selectedTicketId = body && body.context ? body.context.selectedTicketId : null;
    let outcome;
    try{ outcome = await targetAsk.handle(question, {history: history, contextTickets, queryContext, chatSessionId, resultSet, selectedTicketId}); }
    catch(_err){ outcome = {ok:false, code:'INTERNAL'}; }
    if(!outcome.ok){
      const code = String(outcome.code || 'INTERNAL');
      const upstream = code === 'GROQ_ERROR' || code === 'DEEPSEEK_ERROR' || code === 'NETWORK' || code === 'MALFORMED' || code === 'TOKEN_BUDGET' || code.indexOf('HTTP_') === 0;
      const payload = {ok:false, error:'ask_failed', code};
      if(typeof outcome.detail === 'string' && outcome.detail) payload.detail = outcome.detail;

      /* v91.60: Groq's HTTP 413 «Request too large … on tokens per minute
         (TPM)» is a per-minute TOKEN BUDGET refusal (prompt + declared
         completion reserve against the org's TPM limit) — it used to surface
         as an opaque 502 HTTP_413 «server error». It is answered as an honest
         429 rate-limit with the numbers Groq named (limit/requested) and the
         wait when Groq gave one; the organization id never leaves the Worker. */
      if(code === 'TOKEN_BUDGET'){
        payload.error = 'rate_limited';
        payload.code = 'token_budget';
        payload.provider = requestedProvider;
        if(outcome.tokenBudget && typeof outcome.tokenBudget === 'object'){
          const budget = {};
          if(Number.isFinite(outcome.tokenBudget.limit)) budget.limit = outcome.tokenBudget.limit;
          if(Number.isFinite(outcome.tokenBudget.requested)) budget.requested = outcome.tokenBudget.requested;
          payload.tokenBudget = budget;
        }
        const headers = {};
        if(typeof outcome.retryAfterSeconds === 'number' && isFinite(outcome.retryAfterSeconds) && outcome.retryAfterSeconds > 0){
          payload.retryAfterSeconds = outcome.retryAfterSeconds;
          payload.retry_after_sec = outcome.retryAfterSeconds;
          headers['Retry-After'] = String(outcome.retryAfterSeconds);
        }
        return jsonResponse(429, payload, headers);
      }

      if(code === 'HTTP_402'){
        payload.error = 'insufficient_balance';
        payload.code = 'insufficient_balance';
        return jsonResponse(402, payload);
      }
      if(code === 'HTTP_429'){
        payload.error = 'rate_limited';
        payload.code = 'rate_limit';
        const headers = {};
        if(typeof outcome.retryAfterSeconds === 'number' && isFinite(outcome.retryAfterSeconds) && outcome.retryAfterSeconds > 0){
          payload.retryAfterSeconds = outcome.retryAfterSeconds;
          payload.retry_after_sec = outcome.retryAfterSeconds; // back-compat
          headers['Retry-After'] = String(outcome.retryAfterSeconds);
        }
        return jsonResponse(429, payload, headers);
      }
      return jsonResponse(upstream ? 502 : 500, payload);
    }
    const okPayload = {ok:true, answer:outcome.answer, meta:{rounds:outcome.meta.rounds, tool_calls:outcome.meta.toolCallsMade}};
    if(Number.isFinite(Number(outcome.total))) okPayload.total = Number(outcome.total);
    /* Структурований контракт: знайдені заявки для кнопок «Відкрити заявку»
       (безпечна проєкція без URL; фронтенд відкриває лише свій локальний
       список через власну навігацію). Відсутні, якщо заявок не знайдено. */
    if(Array.isArray(outcome.tickets) && outcome.tickets.length) okPayload.tickets = outcome.tickets;
    /* Прихований referent-контекст для НАСТУПНОГО turn: безпечна проєкція
       активного результату цього turn. Клієнт зберігає його для «відкрий цю
       заявку», але НЕ рендерить картками при звичайному пошуку. */
    if(Array.isArray(outcome.referentTickets) && outcome.referentTickets.length) okPayload.referentTickets = outcome.referentTickets;
    /* v91.46: whitelist projection of the last authoritative query_tickets
       filters of this turn — the PWA echoes it back so follow-ups («покажи
       их») inherit the SAME structured filters on a fresh READ. */
    if(outcome.queryContext && typeof outcome.queryContext === 'object') okPayload.queryContext = outcome.queryContext;
    if(outcome.resultSet && typeof outcome.resultSet === 'object') okPayload.resultSet = outcome.resultSet;
    if(Array.isArray(outcome.resultItems)) okPayload.resultItems = outcome.resultItems;
    if(outcome.selectedTicketId) okPayload.selectedTicketId = outcome.selectedTicketId;
    if(outcome.presentation && typeof outcome.presentation === 'object') okPayload.presentation = outcome.presentation;
    if(Number.isFinite(Number(outcome.shown))) okPayload.shown = Number(outcome.shown);
    if(outcome.resultSetStatus && typeof outcome.resultSetStatus === 'object') okPayload.resultSetStatus = outcome.resultSetStatus;
    /* Локальний пошук мережевих точок (ФОБ/муфта/вузол): точки живуть ЛИШЕ
       на пристрої, тож Worker повертає структурований запит, а PWA виконує
       його по власних локальних даних і показує дію «На карті». */
    if(outcome.localQuery && typeof outcome.localQuery === 'object') okPayload.localQuery = outcome.localQuery;
    return jsonResponse(200, okPayload);
  }

  async function handler(request){
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if(request.method === 'OPTIONS' && (path === '/ask' || path === '/ai/config' || path === '/healthz' || path === '/directory')){
      return new Response(null, {status:204, headers:Object.assign({}, CORS_HEADERS)});
    }

    if(path === '/healthz'){
      return withCors(jsonResponse(200, {ok:true, service:'maister-tracker-mcp', read_only:true}));
    }

    if(path === '/ai/config'){
      if(request.method !== 'GET'){
        return withCors(jsonResponse(405, {error:'method_not_allowed', hint:'GET /ai/config'}, {Allow:'GET'}));
      }
      const app = await appPromise;
      return withCors(jsonResponse(200, publicAiConfig(app)));
    }

    if(path === '/ask') return withCors(await askHandler(request));

    if(path === '/directory') return withCors(await directoryHandler(request));

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

  return {fetch: handler, appPromise, ctxHolder};
}

/* Isolate-level cache so the default export keeps rate-limit state across
   requests while staying compatible with the stateless protocol layer. */
const appCache = new WeakMap();

function appFor(env, deps){
  let app = appCache.get(env);
  if(!app){
    app = createApp(env, deps);
    appCache.set(env, app);
  }
  return app;
}

export default {
  async fetch(request, env, ctx){
    const app = appFor(env);
    app.ctxHolder.current = ctx || null;
    return app.fetch(request);
  },
  /* Cron Trigger: refresh the KV snapshot (warm cache). Failures are logged
     by name only and never affect request serving. */
  async scheduled(controller, env, ctx){
    return scheduledHandler(controller, env, ctx);
  }
};

/* Named export so tests can inject a fetch mock via deps (Cloudflare itself
   always passes only controller/env/ctx). */
export async function scheduledHandler(_controller, env, ctx, deps){
  const app = deps && deps.app ? deps.app : appFor(env, deps);
  app.ctxHolder.current = ctx || null;
  const loaded = await app.appPromise;
  if(!loaded.ok){
    console.error('[mcp] snapshot refresh skipped: config rejected');
    return false;
  }
  const ok = await loaded.provider.refresh();
  if(!ok) console.error('[mcp] snapshot refresh failed');
  return ok;
}

/* Smoke v2 for the DEV Worker (branch feat/ai-groq-orchestrator, commit 6a0a9b0+).
   9 points: healthz / mcp-401 / tools-list(7 READ) / get_statistics /
   ask-401 / ask cold / ask KV-hit / real Groq answer.

   Usage:  node smoke-v2.mjs <BASE_URL> [MCP_token|@file] [ASK_token|@file]

   Tokens are resolved automatically, in this order:
     1) CLI args (optional): @C:\path\to\file.txt or the value itself;
     2) env vars SMOKE_MCP_FILE / SMOKE_ASK_FILE (file paths);
     3) default local files: C:\mcp\dev-mcp-token.txt, C:\mcp\dev-ask-token.txt.
   Accepted contents: a bare token OR the full "name:token:scope" line.
   Token values are NEVER printed by this script. No secrets are stored here. */

import fs from 'node:fs';

const BASE = (process.argv[2] || '').replace(/\/+$/, '');
if (typeof fetch !== 'function') { console.error('Node 18+ is required (global fetch missing).'); process.exit(2); }

function readTokenFile(path) {
  try {
    let s = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '\n').trim();
    if (s.includes('\u0000')) return ''; // UTF-16 file: ask user to re-save as UTF-8
    return s;
  } catch (_) { return ''; }
}
function resolveToken(cliValue, envVar, defaultFile) {
  const v = (cliValue || '').trim();
  if (v.startsWith('@')) return { value: readTokenFile(v.slice(1)), source: v.slice(1) };
  if (v) return { value: v, source: 'argv' };
  const envFile = (process.env[envVar] || '').trim();
  if (envFile) return { value: readTokenFile(envFile), source: 'env ' + envVar };
  return { value: readTokenFile(defaultFile), source: defaultFile };
}
if (!BASE) {
  console.error('Usage: node smoke-v2.mjs <BASE_URL> [MCP_token|@file] [ASK_token|@file]');
  console.error('Tokens default to C:\\mcp\\dev-mcp-token.txt and C:\\mcp\\dev-ask-token.txt');
  process.exit(2);
}
const mid = (s) => { const p = String(s).trim().split(':'); return p.length >= 3 ? p[p.length - 2] : String(s).trim(); };
const mcpTok = resolveToken(process.argv[3], 'SMOKE_MCP_FILE', 'C:\\mcp\\dev-mcp-token.txt');
const askTok = resolveToken(process.argv[4], 'SMOKE_ASK_FILE', 'C:\\mcp\\dev-ask-token.txt');
if (!mcpTok.value) { console.error('ERROR: MCP token is empty (checked argv, SMOKE_MCP_FILE, C:\\mcp\\dev-mcp-token.txt). Re-save the file as UTF-8 if needed.'); process.exit(2); }
if (!askTok.value) { console.error('ERROR: ASK token is empty (checked argv, SMOKE_ASK_FILE, C:\\mcp\\dev-ask-token.txt). Re-save the file as UTF-8 if needed.'); process.exit(2); }
console.log('MCP token source: ' + mcpTok.source + ' | ASK token source: ' + askTok.source + ' (values not shown)');
const MT = mid(mcpTok.value), AT = mid(askTok.value);

let pass = 0, fail = 0;
const ok = (cond, label, extra) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + label + (extra ? ' | ' + extra : '')); cond ? pass++ : fail++; };

async function req(path, opts = {}, timeoutMs = 150000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, Object.assign({ signal: ac.signal }, opts));
    const text = await res.text();
    return { status: res.status, ms: (Date.now() - t0) / 1000, text, headers: res.headers };
  } catch (e) {
    return { status: 0, ms: (Date.now() - t0) / 1000, text: 'FETCH_ERROR: ' + (e && e.message || e), headers: new Headers() };
  } finally { clearTimeout(timer); }
}
const json = (t) => { try { return JSON.parse(t); } catch (_) { return null; } };
const mcp = (auth, body, sid) => req('/mcp', {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    auth ? { 'Authorization': 'Bearer ' + auth } : {}, sid ? { 'mcp-session-id': sid } : {}),
  body: JSON.stringify(body)
});

(async () => {
  console.log('DEV SMOKE v2 -> ' + BASE + '  (node ' + process.version + ')');

  // 1. healthz
  const h = await req('/healthz', {}, 20000);
  ok(h.status === 200 && /"ok"\s*:\s*true/.test(h.text), '1/9 GET /healthz', h.status + ' ' + h.ms + 's');

  // 2. /mcp without token -> 401
  const n1 = await mcp(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null);
  ok(n1.status === 401, '2/9 POST /mcp no token -> 401', 'got ' + n1.status);

  // 3. initialize + tools/list -> exactly 7 READ tools
  const ini = await mcp(MT, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dev-smoke-v2', version: '1.0' } } }, null);
  const sid = ini.headers.get('mcp-session-id') || '';
  const tl = await mcp(MT, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, sid);
  const tlj = json(tl.text) || {};
  const tools = (tlj.result && tlj.result.tools) || [];
  const names = tools.map(t => t.name);
  const allRead = tools.every(t => t.annotations && t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false);
  ok(tl.status === 200 && names.length === 7 && allRead, '3/9 tools/list -> exactly 7 READ tools', names.length + ' tools: ' + names.join(', '));

  // 4. get_statistics (real GAS data)
  const st = await mcp(MT, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_statistics', arguments: { period: 'all' } } }, sid);
  const stj = json(st.text) || {};
  const stTxt = stj.result && stj.result.content ? JSON.stringify(stj.result.content).slice(0, 300) : st.text.slice(0, 300);
  ok(st.status === 200 && stj.result, '4/9 get_statistics', st.status + ' ' + st.ms + 's | ' + stTxt);

  // 5. /ask without token -> 401
  const a0 = await req('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'тест' }) }, 30000);
  ok(a0.status === 401, '5/9 POST /ask no token -> 401', 'got ' + a0.status);

  // 6-9. /ask with ASK token: cold/stale first, then KV-hit.
  // Groq free tier is ~8000 TPM -> 429s are EXPECTED between consecutive
  // asks; they are quota, not backend errors. Retry with backoff, honoring
  // the wait suggested in the sanitized detail when present.
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const retryAfterFrom = (text) => {
    const t = String(text || '');
    let m = /(\d{1,3})\s*(секунд|секунди|сек|seconds?|sec)/i.exec(t);
    if (!m) m = /retry[-\s]?after\D{0,12}(\d{1,3})/i.exec(t);
    return m ? Math.min(150, Number(m[1]) + 3) : null;
  };
  const ask = async (q) => req('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AT }, body: JSON.stringify({ question: q }) });
  const askWithRetry = async (q, label) => {
    let r, j;
    for (let attempt = 1; attempt <= 4; attempt++) {
      r = await ask(q);
      j = json(r.text) || {};
      if (j.ok === true) return { r, j, attempts: attempt };
      const rateLimited = j.code === 'HTTP_429' || /rate limit/i.test(String(j.detail || ''));
      if (!rateLimited || attempt === 4) return { r, j, attempts: attempt };
      // never retry sooner than Groq asked: wait >= suggested, min 25s
      const waitSec = Math.max(retryAfterFrom(j.detail) || 0, 25);
      console.log('[wait] ' + label + ': Groq rate limit (attempt ' + attempt + '/3), retrying in ~' + waitSec + 's...');
      await sleep(waitSec * 1000);
    }
    return { r, j, attempts: 3 };
  };

  const q1 = await askWithRetry('Сколько всего заявок и какая общая сумма по всем данным? Ответь одной короткой строкой.', 'Q1');
  const q1j = q1.j;
  ok(q1j.ok === true, '6-7/9 /ask Q1 (cold/stale path + real Groq)', q1.r.status + ' ' + q1.r.ms + 's attempts=' + q1.attempts + ' | ' + (q1j.ok ? 'rounds=' + (q1j.meta && q1j.meta.rounds) + ' tool_calls=' + JSON.stringify(q1j.meta && q1j.meta.tool_calls) + ' | ' + String(q1j.answer).slice(0, 250) : JSON.stringify(q1j).slice(0, 400)));

  console.log('[wait] pausing ~25s before the KV-warm repeat (Groq TPM window clears)...');
  await sleep(25000);
  const q2 = await askWithRetry('Разбей заявки по статусам с количеством. Ответь одной короткой строкой.', 'Q2');
  const q2j = q2.j;
  const faster = q2j.ok === true && q2.r.ms < q1.r.ms;
  ok(q2j.ok === true, '8-9/9 /ask Q2 (KV snapshot warm + real Groq)', q2.r.status + ' ' + q2.r.ms + 's attempts=' + q2.attempts + ' (Q1 GAS-inclusive was ' + q1.r.ms + 's' + (faster ? ', faster => KV hit likely' : '') + ') | ' + (q2j.ok ? 'rounds=' + (q2j.meta && q2j.meta.rounds) + ' | ' + String(q2j.answer).slice(0, 250) : JSON.stringify(q2j).slice(0, 400)));

  console.log('\n===== SUMMARY: ' + pass + ' PASS, ' + fail + ' FAIL =====');
  process.exit(fail ? 1 : 0);
})();

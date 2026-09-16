/* Shared integration helpers: env builder, mock GAS transport with request
   capture, and JSON-RPC call helpers driving the Worker entry point. */

import {createApp} from '../../src/index.js';
import {FIXTURES} from '../fixtures/data.js';

export const BEARER_TOKEN = 'mt_test_cli_0123456789abcdef0123456789abcdef';

export const TEST_URL = 'https://mcp.example.test/mcp';

export function testEnv(overrides){
  return Object.assign({
    GAS_SYNC_URL: 'https://script.google.com/macros/s/TESTDEPLOY/exec',
    GAS_SYNC_HMAC_SECRET: '0123456789abcdef0123456789abcdef',
    MCP_BEARER_TOKENS: 'test-cli:' + BEARER_TOKEN + ':read'
  }, overrides || {});
}

/* Behavior values: 'ok' | 'network' | 'http502' | 'badjson' | 'gaserror' |
   'badshape' | 'badshape-ticket' | 'empty'. */
export function mockGasFetch(behavior, payload){
  const calls = [];
  async function fetchImpl(url, init){
    const parsed = new URL(url);
    const action = parsed.searchParams.get('action');
    calls.push({url, method:init.method, action, params:Object.fromEntries(parsed.searchParams.entries())});
    switch(behavior){
      case 'network': {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      case 'http502':
        return new Response('Bad Gateway', {status:502});
      case 'badjson':
        return new Response('not json at all', {status:200});
      case 'gaserror':
        return new Response(JSON.stringify({status:'error', code:'AUTH_FAILED'}), {status:200});
      case 'badshape':
        return new Response(JSON.stringify({status:'ok', tickets:'nope', shifts:null}), {status:200});
      case 'badshape-ticket':
        return new Response(JSON.stringify({status:'ok', nope:1}), {status:200});
      case 'empty':
        if(action === 'getTicketById') return new Response(JSON.stringify({status:'ok', ticket:null}), {status:200});
        return new Response(JSON.stringify({status:'ok', tickets:[], shifts:[], states:{ticket:[], shift:[]}}), {status:200});
      default: {
        if(action === 'getTicketById'){
          const id = parsed.searchParams.get('id');
          const found = (payload || FIXTURES.baseListPayload).tickets.find(function(row){ return String(row.id) === id; });
          return new Response(JSON.stringify({status:'ok', ticket: found || null}), {status:200});
        }
        return new Response(JSON.stringify(payload || FIXTURES.baseListPayload), {status:200});
      }
    }
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}

export async function makeApp(env, fetchImpl){
  const app = createApp(env || testEnv(), {fetchImpl: fetchImpl || mockGasFetch('ok')});
  await app.appPromise; // settle config before the first call
  return app;
}

export async function post(app, bodyText, headers){
  return app.fetch(new Request(TEST_URL, {
    method:'POST',
    headers: Object.assign({'Content-Type':'application/json', Authorization:'Bearer ' + BEARER_TOKEN}, headers || {}),
    body: bodyText
  }));
}

export async function rpc(app, method, params, id){
  return post(app, JSON.stringify(Object.assign(
    {jsonrpc:'2.0', method},
    params !== undefined ? {params} : {},
    id === undefined ? {id:1} : {id}
  )));
}

export async function rpcResult(app, method, params){
  const response = await rpc(app, method, params);
  assert.equal(response.status, 200);
  return (await response.json()).result;
}

export async function toolCall(app, name, args){
  const response = await rpc(app, 'tools/call', {name, arguments:args || {}});
  const body = await response.json();
  return {response, body, result:body.result, text:body.result && body.result.content && body.result.content[0] && body.result.content[0].text};
}

export function toolData(result){
  return JSON.parse(result.content[0].text);
}

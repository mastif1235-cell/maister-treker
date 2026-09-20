/* Protocol/transport tests: stateless MCP over Streamable HTTP, backward
   compatible with session-era clients (initialize), strict JSON-RPC errors. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {SUPPORTED_PROTOCOL_VERSIONS} from '../../src/mcp/server.js';
import {makeApp, mockGasFetch, post, rpc, toolCall, toolData} from '../helpers/mcpapp.js';

async function rawRpc(app, payloadText){
  const response = await post(app, payloadText);
  return {response, body: await response.json()};
}

test('initialize echoes a supported requested version; falls back to the newest', async () => {
  const app = await makeApp();
  for(const version of SUPPORTED_PROTOCOL_VERSIONS){
    const {body} = await rawRpc(app, JSON.stringify({jsonrpc:'2.0', method:'initialize', params:{protocolVersion:version}, id:1}));
    assert.equal(body.result.protocolVersion, version);
  }
  const fallback = await rawRpc(app, JSON.stringify({jsonrpc:'2.0', method:'initialize', params:{protocolVersion:'1999-01-01'}, id:1}));
  assert.equal(fallback.body.result.protocolVersion, '2026-07-28');
  const noVersion = await rawRpc(app, JSON.stringify({jsonrpc:'2.0', method:'initialize', id:2}));
  assert.equal(noVersion.body.result.protocolVersion, '2026-07-28');
  assert.deepEqual(noVersion.body.result.capabilities.tools, {listChanged:false});
  assert.equal(noVersion.body.result.serverInfo.name, 'maister-tracker-mcp');
});

test('tools/list advertises exactly the READ toolset with input schemas', async () => {
  const app = await makeApp();
  const {body} = await rawRpc(app, JSON.stringify({jsonrpc:'2.0', method:'tools/list', id:1}));
  const tools = body.result.tools;
  assert.equal(tools.length, 12);
  for(const tool of tools){
    assert.equal(typeof tool.name, 'string');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.annotations.readOnlyHint, true);
  }
});

test('tools/call end-to-end: list_tickets through JSON-RPC', async () => {
  const fetchImpl = mockGasFetch('ok');
  const app = await makeApp(null, fetchImpl);
  const call = await toolCall(app, 'list_tickets', {limit:3});
  assert.equal(call.response.status, 200);
  assert.equal(call.result.isError, undefined);
  assert.equal(call.result.content[0].type, 'text');
  const data = JSON.parse(call.text);
  assert.equal(data.returned, 3);
  assert.ok(fetchImpl.calls.length >= 1);
});

test('ping returns an empty result; notifications get 202 with empty body', async () => {
  const app = await makeApp();
  const {body} = await rawRpc(app, JSON.stringify({jsonrpc:'2.0', method:'ping', id:9}));
  assert.deepEqual(body.result, {});
  const notification = await post(app, JSON.stringify({jsonrpc:'2.0', method:'notifications/initialized'}));
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
});

test('protocol errors: -32601 unknown method, -32700 parse, -32600 batch/shape', async () => {
  const app = await makeApp();
  const unknown = await rawRpc(app, JSON.stringify({jsonrpc:'2.0', method:'resources/list', id:5}));
  assert.equal(unknown.body.error.code, -32601);

  const parse = await post(app, '{definitely not json');
  assert.equal(parse.status, 400);
  assert.equal((await parse.json()).error.code, -32700);

  const batch = await post(app, '[{"jsonrpc":"2.0","method":"tools/list","id":1}]');
  assert.equal(batch.status, 400);
  assert.equal((await batch.json()).error.code, -32600);

  const wrongVersion = await rawRpc(app, JSON.stringify({jsonrpc:'1.0', method:'tools/list', id:6}));
  assert.equal(wrongVersion.body.error.code, -32600);

  const noMethod = await rawRpc(app, JSON.stringify({jsonrpc:'2.0', id:7}));
  assert.equal(noMethod.body.error.code, -32600);
});

test('health endpoint exposes no data and requires no auth', async () => {
  const app = await makeApp(null, mockGasFetch('empty'));
  const response = await app.fetch(new Request('https://mcp.example.test/healthz'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok:true, service:'maister-tracker-mcp', read_only:true});
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('error responses carry security headers and no-store', async () => {
  const app = await makeApp();
  const unauthorized = await app.fetch(new Request('https://mcp.example.test/mcp', {method:'POST', body:'{}'}));
  assert.equal(unauthorized.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(unauthorized.headers.get('Cache-Control'), 'no-store');
});

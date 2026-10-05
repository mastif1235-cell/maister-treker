import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../../src/index.js';
import {AI_CONTRACT_VERSION, preservesAIContext} from '../../src/ask/contract.js';
import {sanitizeIncomingQueryContext} from '../../src/ask/query-context.js';
import {BEARER_TOKEN,testEnv} from '../helpers/mcpapp.js';

function setup(){
 const calls={upstream:0,kv:0};
 const app=createApp(testEnv({DEEPSEEK_API_KEY:'synthetic-key',MT_SNAPSHOT_KV:{get(){calls.kv++;throw Error('Must not read');}}}),{fetchImpl:async()=>{calls.upstream++;throw Error('Must not call');}});
 return {app,calls};
}
function request(body){return new Request('https://synthetic.invalid/ask',{method:'POST',headers:{Authorization:'Bearer '+BEARER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)});}
for(const version of [undefined,null,0,2,'1',true,{},[]])test('contract mismatch rejects before analytics: '+JSON.stringify(version),async()=>{
 const {app,calls}=setup();
 const response=await app.fetch(request({question:'А в августе?',ai_contract_version:version,history:[{role:'assistant',content:'PRIVATE_SENTINEL'}],context:{queryContext:{resolved_filters:{coworker_exclude:'Женя'}},selectedTicketId:'PRIVATE_SENTINEL'}}));
 assert.equal(response.status,409);assert.match(response.headers.get('content-type'),/application\/json/);assert.equal(response.headers.get('access-control-allow-origin'),'*');
 const body=await response.json();assert.equal(body.code,'AI_CLIENT_UPDATE_REQUIRED');assert.equal(body.ai_contract_version,AI_CONTRACT_VERSION);assert.equal(body.ok,false);
 assert.ok(!JSON.stringify(body).includes('PRIVATE_SENTINEL'));assert.ok(!JSON.stringify(body).includes(BEARER_TOKEN));assert.deepEqual(calls,{upstream:0,kv:0});
});
test('guard-preserving old-logic rollback refuses unsupported EXCLUDE/comparison/group state',async()=>{
 for(const qc of [
  {mode:'count',resolved_filters:{coworker_exclude:'Женя',semantic:{entity:'onu',action:'install',profile:'onu_physical'}}},
  {mode:'count',resolved_filters:{coworker:'Женя'},comparison:{periods:[{from:'01.09.2026',to:'30.09.2026'},{from:'01.08.2026',to:'31.08.2026'}]}},
  {mode:'group',group_by:'coworker',resolved_filters:{coworker:'Женя'}}]){
  if(preservesAIContext(qc,sanitizeIncomingQueryContext(qc))) continue; // Integrated projection supports this context; frozen full-boundary replay covers acceptance.
  const {app,calls}=setup();const response=await app.fetch(request({question:'А в августе?',ai_contract_version:AI_CONTRACT_VERSION,context:{queryContext:qc}}));
  assert.equal(response.status,409);assert.equal((await response.json()).code,'AI_CONTEXT_RESET_REQUIRED');assert.deepEqual(calls,{upstream:0,kv:0});
 }
});
test('compatible full Worker response echoes contract; public config advertises it; MCP unchanged',async()=>{
 let calls=0;const app=createApp(testEnv({DEEPSEEK_API_KEY:'synthetic-key'}),{fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'Сумісна відповідь'}}]}),{status:200});}});
 const response=await app.fetch(request({question:'Скажи привіт',ai_contract_version:AI_CONTRACT_VERSION}));const body=await response.json();
 assert.equal(response.status,200);assert.equal(body.ai_contract_version,AI_CONTRACT_VERSION);assert.equal(body.answer,'Сумісна відповідь');assert.equal(calls,1);
 const config=await(await app.fetch(new Request('https://synthetic.invalid/ai/config'))).json();assert.equal(config.ai_contract_version,AI_CONTRACT_VERSION);
 const mcp=await app.fetch(new Request('https://synthetic.invalid/mcp',{method:'POST',headers:{Authorization:'Bearer '+BEARER_TOKEN},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})}));assert.equal(mcp.status,200);assert.equal((await mcp.json()).result.tools.length,12);
});
test('critical context is accepted only if projection preserves it exactly',()=>{
 const qc={resolved_filters:{coworker_exclude:'Женя'},comparison:{periods:[{from:'01.09.2026',to:'30.09.2026'}]}};
 assert.equal(preservesAIContext(qc,structuredClone(qc)),true);assert.equal(preservesAIContext(qc,{resolved_filters:{}}),false);
 assert.equal(preservesAIContext(null,null),true);
 assert.equal(preservesAIContext({comparison:{}},null),false);
});

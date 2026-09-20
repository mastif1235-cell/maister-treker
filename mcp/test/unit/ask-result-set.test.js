import test from 'node:test';
import assert from 'node:assert/strict';

import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {createResultSet} from '../../src/ask/result-set.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';

function call(name, args, id='c1'){
  return {ok:true,content:'',toolCalls:[{id,name,argsRaw:JSON.stringify(args)}],assistantMessage:{role:'assistant',content:'',tool_calls:[]}};
}
function done(text='ok'){ return {ok:true,content:text,toolCalls:[],assistantMessage:{role:'assistant',content:text}}; }
function groq(steps){ let i=0; return {chat:async()=>steps[i++]}; }

test('one unique query_tickets list result is the only authoritative result source', async () => {
  const tools = {
    query_tickets:async()=>({ok:true,data:{mode:'list',resolved_filters:{city:'X'},total_matched:2,tickets:[{id:'A:1',date:'01.01.2026'},{id:'B.2',date:'02.01.2026'}]}})
  };
  const out = await createAskOrchestrator({groq:groq([call('query_tickets',{mode:'list',city:'X'}),done()]),tools,toolDefs:TOOL_DEFINITIONS})
    .handle('list',{chatSessionId:'chat-session-1',now:new Date('2026-09-20T12:00:00Z')});
  assert.equal(out.resultSetStatus.created,true);
  assert.deepEqual(out.resultSet.ticketIds,['A:1','B.2']);
  assert.equal(out.total,2);
  assert.equal(out.shown,2);
  assert.equal(out.resultItems.length,2);
});

test('distinct list filters in one turn are ambiguous and never mixed', async () => {
  let n=0;
  const tools = {query_tickets:async(args)=>({ok:true,data:{mode:'list',resolved_filters:{city:args.city},total_matched:1,tickets:[{id:++n===1?'A':'B'}]}})};
  const out = await createAskOrchestrator({groq:groq([call('query_tickets',{mode:'list',city:'X'},'c1'),call('query_tickets',{mode:'list',city:'Y'},'c2'),done()]),tools,toolDefs:TOOL_DEFINITIONS})
    .handle('two lists',{chatSessionId:'chat-session-1'});
  assert.equal(out.resultSet,null);
  assert.equal(out.resultItems.length,0);
  assert.equal(out.resultSetStatus.reason,'ambiguous_multiple_list_results');
});

test('ask-only result_index resolves exact id while public definition remains ticket_id-only', async () => {
  const active = createResultSet([{id:'A:1'},{id:'B.2'}],2,'chat-session-1',Date.parse('2026-09-20T12:00:00Z')).resultSet;
  const seen=[];
  const tools={get_ticket:async(args)=>{seen.push(args);return {ok:true,data:{found:true,ticket:{id:args.ticket_id}}};}};
  const out = await createAskOrchestrator({groq:groq([call('get_ticket',{result_index:2}),done()]),tools,toolDefs:TOOL_DEFINITIONS})
    .handle('show second',{chatSessionId:'chat-session-1',resultSet:active,now:new Date('2026-09-20T12:00:01Z')});
  assert.deepEqual(seen,[{ticket_id:'B.2'}]);
  assert.equal(out.selectedTicketId,'B.2');
  assert.deepEqual(out.presentation,{kind:'single_ticket',ticket_id:'B.2'});
  const publicDef=TOOL_DEFINITIONS.find(def=>def.name==='get_ticket');
  assert.deepEqual(publicDef.inputSchema.required,['ticket_id']);
  assert.equal(publicDef.inputSchema.properties.result_index,undefined);
});

test('open-it uses only selectedTicketId and bypasses both model and tools', async () => {
  let modelCalls=0, toolCalls=0;
  const out=await createAskOrchestrator({groq:{chat:async()=>{modelCalls++;return done();}},tools:{get_ticket:async()=>{toolCalls++;}},toolDefs:TOOL_DEFINITIONS})
    .handle('Открой её',{chatSessionId:'chat-session-1',selectedTicketId:'A:1'});
  assert.equal(modelCalls,0);
  assert.equal(toolCalls,0);
  assert.equal(out.selectedTicketId,'A:1');
  assert.deepEqual(out.presentation,{kind:'single_ticket',ticket_id:'A:1'});
  assert.equal(out.tickets.length,0);
});

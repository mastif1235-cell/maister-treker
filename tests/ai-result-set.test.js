'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function load(files,extra){
  const sb=Object.assign({console,setTimeout,clearTimeout,AbortController,Response,URL,globalThis:null,MTAI:{}},extra||{});
  sb.globalThis=sb;
  const ctx=vm.createContext(sb);
  for(const file of files) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
  return sb;
}

(async function(){
  const files=['js/ai/ai-config.js','js/ai/ai-ticket-id.js','js/ai/ai-client.js'];
  let request=null;
  const response={ok:true,answer:'ok',total:2,shown:2,resultSet:{version:1,id:'rs-1',chatSessionId:'chat-session-1',createdAt:1,expiresAt:2,total:2,ticketIds:['A:1','B.2']},resultItems:[{ticket_id:'A:1'},{ticket_id:'B.2'}],selectedTicketId:'B.2',presentation:{kind:'single_ticket',ticket_id:'B.2'}};
  const sb=load(files,{fetch:async function(_url,init){request=JSON.parse(init.body);return new Response(JSON.stringify(response),{status:200});}});
  const client=sb.MTAI.createClient({fetchImpl:sb.fetch,getConfig:()=>({backendUrl:'https://x',bearer:'t',provider:'groq',model:'m'}),timeoutMs:1000});
  const active={version:1,id:'old',chatSessionId:'chat-session-1',createdAt:1,expiresAt:2,total:2,ticketIds:['A:1','B.2']};
  const out=await client.ask('show 2',[],{chatSessionId:'chat-session-1',resultSet:active,selectedTicketId:'A:1'});
  assert.equal(out.ok,true);
  assert.deepEqual(Array.from(request.context.resultSet.ticketIds),['A:1','B.2']);
  assert.equal(request.context.selectedTicketId,'A:1');
  assert.equal(out.presentation.ticket_id,'B.2');
  assert.equal(sb.MTAI.ticketIds.validate('x'.repeat(129)),null);
  assert.equal(sb.MTAI.ticketIds.validate('A/B'),null);

  let degraded=0, emitted=null;
  const chatSb=load(['js/ai/ai-config.js','js/ai/ai-ticket-id.js','js/ai/ai-chat.js']);
  const chat=chatSb.MTAI.createChatController({client:{sanitizeResultSet:x=>x,ask:async()=>({ok:true,answer:'ok',meta:{},total:1,shown:1,resultSet:active,resultItems:[{ticket_id:'A:1'}],tickets:[],referentTickets:[]})},storage:{getItem:()=>null,setItem:()=>{throw new Error('quota');},removeItem:()=>{}},hooks:{state_degraded:()=>degraded++,assistant:x=>{emitted=x;}}});
  await chat.send('find');
  assert.ok(degraded>=1);
  assert.equal(emitted.resultItems.length,0,'unpersisted result list is not exposed as selectable state');
  console.log('PASS ai result-set: exact ids, request context, response projection, persistence degradation');
})().catch(function(err){console.error(err);process.exitCode=1;});

'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
function boot(){const sb={console,setTimeout,clearTimeout,AbortController,Response,Headers};sb.globalThis=sb;vm.createContext(sb);for(const f of ['ai-config.js','ai-client.js','ai-chat.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/ai',f),'utf8'),sb);return sb.MTAI;}
const clone=x=>JSON.parse(JSON.stringify(x));
const qc={mode:'count',resolved_filters:{date_from:'01.09.2026',date_to:'30.09.2026',coworker:'Женя',semantic:{entity:'onu',action:'install',profile:'onu_physical'}}};
function memory(seed){const data=new Map(Object.entries(seed||{})),changes=[];return {data,changes,getItem:k=>data.get(k)||null,setItem:(k,v)=>{changes.push(k);data.set(k,v);},removeItem:k=>{changes.push(k);data.delete(k);}};}
async function main(){
 let checks=0;
 for(const responseVersion of [undefined,0,2,'1',null]){
  const M=boot(),store=memory({settings:'UNCHANGED',tickets:'UNCHANGED',tokens:'UNCHANGED'}),sent=[];
  const client=M.createClient({getConfig:()=>({backendUrl:'https://synthetic.invalid',bearer:'synthetic'}),fetchImpl:async(u,i)=>{sent.push(JSON.parse(i.body));return new Response(JSON.stringify({ok:true,ai_contract_version:responseVersion,answer:'DO NOT DISPLAY',queryContext:qc}),{status:200});}});
  const errors=[],chat=M.createChatController({client,storage:store,hooks:{error:e=>errors.push(e)}});
  const r=await chat.send('исходный вопрос');assert.equal(r.ok,false);assert.equal(errors[0].kind,'compatibility');assert.equal(chat.history().length,0);assert.equal(chat.canRetry(),false);assert.equal((await chat.retry()).skipped,true);
  assert.equal(store.data.has('mtAiChatHistoryV1'),false);assert.equal(sent[0].ai_contract_version,1);
  const restored=M.createChatController({client,storage:store});await restored.send('новый исходный вопрос');assert.deepEqual(sent[1].history,[]);assert.equal(sent[1].context.queryContext,undefined);assert.notEqual(sent[0].context.chatSessionId,sent[1].context.chatSessionId);
  for(const k of ['settings','tickets','tokens'])assert.equal(store.data.get(k),'UNCHANGED');assert.ok(store.changes.every(k=>k==='mtAiChatHistoryV1'));checks++;
 }
 for(const marker of [undefined,0,2]){
  const M=boot(),store=memory({mtAiChatHistoryV1:JSON.stringify({ai_contract_version:marker,messages:[{role:'assistant',text:'OLD',queryContext:qc}],selectedTicketId:'SYN',chatSessionId:'old-session-123'})});let calls=0;
  const chat=M.createChatController({storage:store,client:{ask:async(q,h,c)=>{calls++;assert.equal(h.length,0);assert.equal(c.queryContext,null);assert.equal(c.selectedTicketId,null);assert.equal(c.resultSet,null);return {ok:true,answer:'fresh'};}}});
  assert.equal(chat.history().length,0);assert.equal((await chat.send('А в августе?')).error.kind,'compatibility');assert.equal(calls,0);await chat.send('новый исходный вопрос');assert.equal(calls,1);checks++;
 }
 {
  const M=boot(),store=memory(),sent=[];const client=M.createClient({getConfig:()=>({backendUrl:'https://synthetic.invalid',bearer:'synthetic'}),fetchImpl:async(u,i)=>{sent.push(JSON.parse(i.body));return new Response(JSON.stringify({ok:true,ai_contract_version:1,answer:'20 ONU',queryContext:qc}),{status:200});}});
  await M.createChatController({client,storage:store}).send('Q1');assert.equal(JSON.parse(store.data.get('mtAiChatHistoryV1')).ai_contract_version,1);
  await M.createChatController({client,storage:store}).send('А в августе?');assert.deepEqual(sent[1].context.queryContext,qc);assert.ok(sent[1].history.length>0);checks++;
 }
 {
  const M=boot(),client=M.createClient({getConfig:()=>({backendUrl:'https://synthetic.invalid',bearer:'synthetic'}),fetchImpl:async()=>new Response(JSON.stringify({ok:false,code:'AI_CONTEXT_RESET_REQUIRED',ai_contract_version:1,detail:'PRIVATE_SENTINEL'}),{status:409})});
  const r=await client.ask('q',[],{});assert.equal(r.error.kind,'compatibility');assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));checks++;
 }
 {
  const M=boot();let calls=0;
  const client=M.createClient({getConfig:()=>({backendUrl:'https://synthetic.invalid',bearer:'synthetic'}),fetchImpl:async()=>{calls++;throw Error('Must not send projected-away state');}});
  const r=await client.ask('q',[],{queryContext:{...qc,resolved_filters:{...qc.resolved_filters,coworker_exclude:'Женя'}}});
  assert.equal(r.error.kind,'compatibility');assert.equal(calls,0);checks++;
 }
 {
  const M=boot(),store=memory({mtAiChatHistoryV1:'{corrupt',settings:'UNCHANGED'});let calls=0;
  const chat=M.createChatController({storage:store,client:{ask:()=>{calls++;throw Error('Must restart first');}}});
  assert.equal((await chat.send('А в августе?')).error.kind,'compatibility');assert.equal(calls,0);assert.equal(store.data.get('settings'),'UNCHANGED');assert.equal(store.data.has('mtAiChatHistoryV1'),false);checks++;
 }
 console.log('PASS AI contract matrix '+checks+' cases: request/response/session/reload/non-AI isolation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

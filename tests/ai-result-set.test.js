'use strict';
/* Stage 1 client contract: exact ticket ids, request/response projection,
   result-set lifetime (TTL), subject-change invalidation, persistence
   degradation and the request-size guard. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function load(files,extra){
  const sb=Object.assign({console,setTimeout,clearTimeout,AbortController,Response,URL,globalThis:null,MTAI:{}},extra||{});
  sb.globalThis=sb;
  const ctx=vm.createContext(sb);
  for(const file of files) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
  return sb;
}
function memStorage(){
  const m=new Map();
  return {getItem:function(k){ return m.has(k)?m.get(k):null; },setItem:function(k,v){ m.set(k,String(v)); },removeItem:function(k){ m.delete(k); }};
}
const HOUR=3600*1000;
function validSet(overrides){
  const now=Date.now();
  return Object.assign({version:1,id:'rs-1',chatSessionId:'chat-session-1',createdAt:now-1000,expiresAt:now+12*HOUR,total:2,filtersKey:'{"city":"X"}',ticketIds:['A:1','B.2']},overrides||{});
}
function okResponse(extra){
  return Object.assign({ok:true,answer:'ok',meta:{},total:0,shown:0,tickets:[],referentTickets:[],resultSet:null,resultItems:[],selectedTicketId:null,presentation:null,resultSetStatus:null},extra||{});
}
const CFG=function(){ return {backendUrl:'https://x',bearer:'t',provider:'groq',model:'m'}; };

(async function(){
  const files=['js/ai/ai-config.js','js/ai/ai-ticket-id.js','js/ai/ai-client.js'];

  /* 1) live result set goes out with the request and comes back projected */
  let request=null;
  const response=okResponse({total:2,shown:2,resultSet:validSet(),resultItems:[{ticket_id:'A:1'},{ticket_id:'B.2'}],selectedTicketId:'B.2',presentation:{kind:'single_ticket',ticket_id:'B.2'}});
  const sb=load(files,{fetch:async function(_url,init){ request=JSON.parse(init.body); return new Response(JSON.stringify(response),{status:200}); }});
  const client=sb.MTAI.createClient({fetchImpl:sb.fetch,getConfig:CFG,timeoutMs:1000});
  const out=await client.ask('show 2',[],{chatSessionId:'chat-session-1',resultSet:validSet({id:'old'}),selectedTicketId:'A:1'});
  assert.equal(out.ok,true);
  assert.deepEqual(Array.from(request.context.resultSet.ticketIds),['A:1','B.2']);
  assert.equal(request.context.resultSet.filtersKey,'{"city":"X"}');
  assert.equal(request.context.selectedTicketId,'A:1');
  assert.equal(out.presentation.ticket_id,'B.2');
  assert.equal(out.resultItems.length,2);
  assert.equal(sb.MTAI.ticketIds.validate('x'.repeat(129)),null);
  assert.equal(sb.MTAI.ticketIds.validate('A/B'),null);

  /* 2) an expired set is never sent (and is not restored after a reload) */
  let expiredRequest=null;
  const expiredClient=sb.MTAI.createClient({fetchImpl:async function(_u,init){ expiredRequest=JSON.parse(init.body); return new Response(JSON.stringify(okResponse()),{status:200}); },getConfig:CFG,timeoutMs:1000});
  await expiredClient.ask('x',[],{chatSessionId:'chat-session-1',resultSet:validSet({expiresAt:Date.now()-1000})});
  assert.equal(expiredRequest.context.resultSet,undefined,'expired set is not sent to /ask');
  assert.equal(sb.MTAI.client.sanitizeResultSet(validSet({expiresAt:Date.now()-1})),null,'expired set sanitizes to null');

  /* 3) persistence degradation: unpersisted state is not offered as selectable */
  let degraded=0, emitted=null;
  const chatSb=load(['js/ai/ai-config.js','js/ai/ai-ticket-id.js','js/ai/ai-chat.js']);
  const chat=chatSb.MTAI.createChatController({
    client:{sanitizeResultSet:function(x){ return x; },ask:async function(){ return okResponse({answer:'ok',total:1,shown:1,resultSet:validSet(),resultItems:[{ticket_id:'A:1'}]}); }},
    storage:{getItem:function(){ return null; },setItem:function(){ throw new Error('quota'); },removeItem:function(){}},
    hooks:{state_degraded:function(){ degraded++; },assistant:function(x){ emitted=x; }}
  });
  await chat.send('find');
  assert.ok(degraded>=1);
  assert.equal(emitted.resultItems.length,0,'unpersisted result list is not exposed as selectable state');

  /* 4) L: expired stored set is dropped on load → the referent path stays alive */
  {
    const store=memStorage();
    store.setItem('mtAiChatHistoryV1', JSON.stringify({
      messages:[{role:'assistant',text:'Знайдено 1 заявку: №1, Вул Садова 19.',ts:Date.now()-2*HOUR,
        referentTickets:[{id:'t-sad19',address:'Миколаївка 1, Вул Садова 19',type:'Ремонт'}]}],
      chatSessionId:'chat-session-1',
      activeResultSet:validSet({expiresAt:Date.now()-HOUR,total:19,ticketIds:['t-01','t-02']}),
      selectedTicketId:null
    }));
    const reqs=[];
    const client2=sb.MTAI.createClient({fetchImpl:async function(_u,init){ reqs.push(JSON.parse(init.body)); return new Response(JSON.stringify(okResponse({answer:'ok',tickets:[{id:'t-sad19',address:'Миколаївка 1, Вул Садова 19'}]})),{status:200}); },getConfig:CFG,timeoutMs:1000});
    const chat2=chatSb.MTAI.createChatController({client:client2,hooks:{},storage:store});
    await chat2.send('Открой её карточку');
    assert.equal(reqs[0].context.resultSet,undefined,'a dead set is not resurrected from localStorage');
    assert.equal(reqs[0].context.tickets.length,1,'the ordinary referent path is not blocked');
    assert.equal(reqs[0].context.tickets[0].id,'t-sad19');
  }

  /* 4b) L2: the same set expires while the app is open (no reload) — the next
     turn neither sends it nor loses the referent path. */
  {
    const store=memStorage();
    store.setItem('mtAiChatHistoryV1', JSON.stringify({
      messages:[{role:'assistant',text:'Знайдено 1 заявку: №1, Вул Садова 19.',ts:Date.now()-2*HOUR,
        referentTickets:[{id:'t-sad19',address:'Миколаївка 1, Вул Садова 19'}]}],
      chatSessionId:'chat-session-1',
      activeResultSet:validSet({expiresAt:Date.now()+40}),
      selectedTicketId:null
    }));
    const reqs=[];
    const client2b=sb.MTAI.createClient({fetchImpl:async function(_u,init){ reqs.push(JSON.parse(init.body)); return new Response(JSON.stringify(okResponse({answer:'ok'})),{status:200}); },getConfig:CFG,timeoutMs:1000});
    const chat2b=chatSb.MTAI.createChatController({client:client2b,hooks:{},storage:store});
    await new Promise(function(r){ setTimeout(r, 60); });
    await chat2b.send('Открой её карточку');
    assert.equal(reqs[0].context.resultSet,undefined,'an expired in-memory set is not sent');
    assert.equal(reqs[0].context.tickets.length,1,'the referent path stays alive after expiry');
    assert.equal(reqs[0].context.tickets[0].id,'t-sad19');
    const stored=JSON.parse(store.getItem('mtAiChatHistoryV1'));
    assert.equal(stored.activeResultSet,null,'the expired set is dropped from storage too');
  }

  /* 5) §7: a turn with a different ticket context drops the stored list */
  {
    const store=memStorage();
    store.setItem('mtAiChatHistoryV1', JSON.stringify({messages:[],chatSessionId:'chat-session-1',activeResultSet:validSet({filtersKey:'{"city":"A"}'}),selectedTicketId:'A:1'}));
    const reqs=[];
    const answers=[
      okResponse({answer:'1',resultSetStatus:{created:false,reason:'non_list_mode',subjectChanged:true,filtersKey:'{"city":"B"}'}}),
      okResponse({answer:'2'})
    ];
    const client3=sb.MTAI.createClient({fetchImpl:async function(_u,init){ reqs.push(JSON.parse(init.body)); return new Response(JSON.stringify(answers.shift()),{status:200}); },getConfig:CFG,timeoutMs:1000});
    const chat3=chatSb.MTAI.createChatController({client:client3,hooks:{},storage:store});
    await chat3.send('Скільки заявок у Таромському?');
    assert.equal(reqs[0].context.resultSet.ticketIds.length,2,'the list was live for its own turn');
    await chat3.send('Покажи 11-ю');
    assert.equal(reqs[1].context.resultSet,undefined,'another ticket context dropped the old list');
    assert.equal(reqs[1].context.selectedTicketId,undefined,'stale selection was cleared');
  }

  /* 6) …but the same context (simple follow-up) keeps the list selectable */
  {
    const store=memStorage();
    store.setItem('mtAiChatHistoryV1', JSON.stringify({messages:[],chatSessionId:'chat-session-1',activeResultSet:validSet({filtersKey:'{"city":"A"}'}),selectedTicketId:null}));
    const reqs=[];
    const answers=[
      okResponse({answer:'7',resultSetStatus:{created:false,reason:'non_list_mode',subjectChanged:true,filtersKey:'{"city":"A"}'}}),
      okResponse({answer:'ok'})
    ];
    const client4=sb.MTAI.createClient({fetchImpl:async function(_u,init){ reqs.push(JSON.parse(init.body)); return new Response(JSON.stringify(answers.shift()),{status:200}); },getConfig:CFG,timeoutMs:1000});
    const chat4=chatSb.MTAI.createChatController({client:client4,hooks:{},storage:store});
    await chat4.send('Сколько их всего?');
    await chat4.send('Покажи 2-ю');
    assert.ok(reqs[1].context.resultSet,'same filters → the list survives for the ordinal');
  }

  /* 7) …and a turn that SELECTS from the stored state keeps it too */
  {
    const store=memStorage();
    store.setItem('mtAiChatHistoryV1', JSON.stringify({messages:[],chatSessionId:'chat-session-1',activeResultSet:validSet(),selectedTicketId:null}));
    const reqs=[];
    const answers=[
      okResponse({answer:'ok',selectedTicketId:'B.2',presentation:{kind:'single_ticket',ticket_id:'B.2'},resultSetStatus:{created:false,reason:'selected_ticket'}}),
      okResponse({answer:'ok'})
    ];
    const client5=sb.MTAI.createClient({fetchImpl:async function(_u,init){ reqs.push(JSON.parse(init.body)); return new Response(JSON.stringify(answers.shift()),{status:200}); },getConfig:CFG,timeoutMs:1000});
    const chat5=chatSb.MTAI.createChatController({client:client5,hooks:{},storage:store});
    await chat5.send('Покажи 2-ю');
    await chat5.send('Открой её карточку');
    assert.ok(reqs[1].context.resultSet,'selection turns keep the list they selected from');
    assert.equal(reqs[1].context.selectedTicketId,'B.2','the selection travels back');
  }

  /* 8) an active list is not duplicated by the 8-ticket referent in one request */
  {
    const store=memStorage();
    store.setItem('mtAiChatHistoryV1', JSON.stringify({
      messages:[{role:'assistant',text:'Знайдено 3 заявки.',ts:1,referentTickets:[{id:'A:1'},{id:'B.2'}]}],
      chatSessionId:'chat-session-1',activeResultSet:validSet(),selectedTicketId:null
    }));
    const reqs=[];
    const client6=sb.MTAI.createClient({fetchImpl:async function(_u,init){ reqs.push(JSON.parse(init.body)); return new Response(JSON.stringify(okResponse()),{status:200}); },getConfig:CFG,timeoutMs:1000});
    const chat6=chatSb.MTAI.createChatController({client:client6,hooks:{},storage:store});
    await chat6.send('Покажи 2-ю');
    assert.ok(reqs[0].context.resultSet,'list present');
    assert.equal(reqs[0].context.tickets,undefined,'no duplicate 8-ticket referent while the list covers the context');
  }

  /* 9) M: the request guard trims history first and keeps the payload bounded */
  {
    const longIds=[]; for(let i=0;i<100;i++) longIds.push(('t'+i).padEnd(128,'z'));
    const history=[]; for(let i=0;i<12;i++) history.push({role:(i%2?'assistant':'user'),content:'y'.repeat(1500)});
    let sent=null;
    const heavyClient=sb.MTAI.createClient({fetchImpl:async function(_u,init){ sent=init.body; return new Response(JSON.stringify(okResponse()),{status:200}); },getConfig:CFG,timeoutMs:1000});
    await heavyClient.ask('q'.repeat(2000),history,{chatSessionId:'chat-session-1',resultSet:validSet({ticketIds:longIds,total:400})});
    assert.ok(sent.length<=30000,'payload '+sent.length+' stays below the client guard');
    const body=JSON.parse(sent);
    assert.ok(body.history.length<12,'history is trimmed first');
    assert.equal(body.context.resultSet.ticketIds.length,100,'the active list itself is never trimmed away');
  }

  /* 10) M2: when even the minimal payload cannot fit, the error is honest */
  {
    let called=0;
    const tinyClient=sb.MTAI.createClient({fetchImpl:async function(){ called++; throw new Error('must not be called'); },getConfig:CFG,timeoutMs:1000,maxRequestChars:600});
    const out10=await tinyClient.ask('q'.repeat(1200),[],{chatSessionId:'chat-session-1'});
    assert.equal(called,0,'nothing is sent when the body cannot fit');
    assert.equal(out10.ok,false);
    assert.equal(out10.error.kind,'context_too_large');
  }

  console.log('PASS ai result-set: exact ids, TTL, subject change, size guard, persistence degradation');
})().catch(function(err){console.error(err);process.exitCode=1;});

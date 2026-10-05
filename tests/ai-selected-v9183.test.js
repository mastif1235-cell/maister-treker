'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sandbox={MTAI:{config:{AI_CONTRACT_VERSION:1,LIMITS:{questionMaxChars:2000},DEFAULT_PROVIDER:'groq',DEFAULT_MODEL:'test'}},setTimeout,clearTimeout,AbortController,console};sandbox.globalThis=sandbox;
for(const file of ['js/ai/ai-client.js','js/ai/ai-chat.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox);
const memory=new Map(),posted=[];
const id='SYNTHETIC_REPAIR',filters={semantic:{entity:'onu',action:'install',category:'definite',profile:'onu_physical',signal_context:'subscriber'},coworker:'Женя',date_from:'01.09.2026',date_to:'30.09.2026'};
const client=sandbox.MTAI.createClient({getConfig:()=>({backendUrl:'https://test.invalid',bearer:'synthetic'}),fetchImpl:async(_url,options)=>{
 posted.push(JSON.parse(options.body));
 return{ai_contract_version:1,ok:true,status:200,json:async()=>({ai_contract_version:1,ok:true,answer:'Карточка',total:1,selectedTicketId:id,presentation:{kind:'single_ticket',ticket_id:id},resultSet:null,resultItems:[],tickets:[],queryContext:{resolved_filters:filters},resultSetStatus:{reason:'selected_ticket',subjectChanged:false}})};
}});
(async()=>{
 const create=()=>sandbox.MTAI.createChatController({client,storage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)}});
 await create().send('Открой заявку за 18.09.2026');
 const restored=create();await restored.send('Открой карточку');
 assert.equal(posted.at(-1).context.selectedTicketId,id);
 assert.deepEqual(posted.at(-1).context.queryContext.resolved_filters,filters);
 await restored.send('Открой профиль');assert.equal(posted.at(-1).context.selectedTicketId,id);
 assert.ok(![...memory.values()].join('').includes('"bearer"'));
 console.log('PASS exact selected ticket/date/coworker context survives reload; no bearer persistence');
})().catch(e=>{console.error(e);process.exitCode=1;});

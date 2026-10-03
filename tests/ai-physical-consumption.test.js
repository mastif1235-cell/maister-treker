'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sandbox={MTAI:{config:{LIMITS:{questionMaxChars:2000},DEFAULT_PROVIDER:'groq',DEFAULT_MODEL:'test'}},setTimeout,clearTimeout,AbortController,console};sandbox.globalThis=sandbox;
for(const file of ['js/ai/ai-client.js','js/ai/ai-chat.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox);
const posted=[],memory=new Map(),filters={semantic:{entity:'router',action:'install',category:'definite',signal_context:'subscriber',profile:'physical_consumption'},type:'Ремонт',date_from:'01.09.2026',date_to:'30.09.2026',coworker:'Петя'};
const client=sandbox.MTAI.createClient({getConfig:()=>({backendUrl:'https://test.invalid',bearer:'synthetic'}),fetchImpl:async(_url,options)=>{posted.push(JSON.parse(options.body));return{ok:true,status:200,json:async()=>({ok:true,answer:'ok',queryContext:{resolved_filters:filters}})};}});
(async()=>{
 const create=()=>sandbox.MTAI.createChatController({client,coworkerRoster:()=>['Петя'],storage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)}});
 const chat=create();await chat.send('Сколько роутеров поставил на ремонтах за сентябрь?');await chat.send('Показать заявки');
 assert.deepEqual(posted.at(-1).context.queryContext.resolved_filters,filters);
 const restored=create();await restored.send('Почему так посчитано?');assert.deepEqual(posted.at(-1).context.queryContext.resolved_filters,filters);
 assert.ok(![...memory.values()].join('').includes('synthetic'),'bearer is not serialized into chat context');
 console.log('PASS physical profile/type/date/coworker follow-up/reload');
})().catch(e=>{console.error(e);process.exitCode=1;});

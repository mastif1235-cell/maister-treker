'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sandbox={MTAI:{config:{AI_CONTRACT_VERSION:1,LIMITS:{questionMaxChars:2000},DEFAULT_PROVIDER:'groq',DEFAULT_MODEL:'test'}},setTimeout,clearTimeout,AbortController,console};sandbox.globalThis=sandbox;
for(const file of ['js/ai/ai-client.js','js/ai/ai-chat.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox);
const posted=[],memory=new Map(),semantic={entity:'onu',action:'install',category:'definite',signal_context:'subscriber',profile:'onu_physical'};
const client=sandbox.MTAI.createClient({getConfig:()=>({backendUrl:'https://test.invalid',bearer:'synthetic'}),fetchImpl:async(_url,options)=>{posted.push(JSON.parse(options.body));return{ai_contract_version:1,ok:true,status:200,json:async()=>({ai_contract_version:1,ok:true,answer:'ok',queryContext:{resolved_filters:{semantic,coworker:'Петя'}}})};}});
(async()=>{
 await client.ask('test',[],{coworkerRoster:['Петя','Женя',null,{password:'private'},'secret:credential','', 'x'.repeat(61)]});
 assert.deepEqual(posted[0].context.coworkerRoster,['Петя','Женя']);
 let masters=['Петя'];const chat=sandbox.MTAI.createChatController({client,coworkerRoster:()=>masters,storage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)}});
 await chat.send('test');assert.deepEqual(posted.at(-1).context.coworkerRoster,['Петя']);
 masters=['Женя'];await chat.send('Показать заявки');assert.deepEqual(posted.at(-1).context.coworkerRoster,['Женя'],'roster reads current settings, not cached snapshot');
 assert.equal(posted.at(-1).context.queryContext.resolved_filters.coworker,'Петя','authoritative previous filter not rewritten by changed roster');
 assert.ok(![...memory.values()].join('').includes('coworkerRoster'),'roster not stored in chat/history');
 const reloaded=sandbox.MTAI.createChatController({client,coworkerRoster:()=>masters,storage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)}});
 await reloaded.send('Почему так посчитано?');assert.equal(posted.at(-1).context.queryContext.resolved_filters.coworker,'Петя');
 console.log('PASS request-only settings.masters roster / sanitation / follow-up / reload / no storage schema change');
})().catch(e=>{console.error(e);process.exitCode=1;});

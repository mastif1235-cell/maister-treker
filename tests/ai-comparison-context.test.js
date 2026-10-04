'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sb={console,setTimeout,clearTimeout,AbortController,Response,Headers};sb.globalThis=sb;vm.createContext(sb);
for(const f of ['ai-config.js','ai-client.js','ai-chat.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/ai',f),'utf8'),sb);
const qc={mode:'count',resolved_filters:{coworker:'Женя',semantic:{entity:'onu',action:'install',category:'definite',profile:'onu_physical',signal_context:'subscriber'}},comparison:{periods:[{from:'01.09.2026',to:'30.09.2026'},{from:'01.08.2026',to:'31.08.2026'}]}};
(async()=>{
 const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};let calls=0;
 const client=sb.MTAI.createClient({getConfig:()=>({backendUrl:'https://synthetic.invalid',bearer:'synthetic-only'}),fetchImpl:async(u,init)=>{
  const body=JSON.parse(init.body);if(calls++)assert.deepEqual(body.context.queryContext,qc);
  return new Response(JSON.stringify({ok:true,answer:'20 ONU / 27 ONU',queryContext:{...qc,comparison:{...qc.comparison,masterNote:'NEVER'},password:'NEVER'}}),{status:200});
 }});
 await sb.MTAI.createChatController({client,storage}).send('Сравни сентябрь и август');
 await sb.MTAI.createChatController({client,storage}).send('А только ремонты?');assert.equal(calls,2);
 let body;const invalid=sb.MTAI.createClient({getConfig:()=>({backendUrl:'https://synthetic.invalid',bearer:'synthetic-only'}),fetchImpl:async(u,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({ok:true,answer:'ok'}),{status:200})}});
 await invalid.ask('q',[],{queryContext:{...qc,comparison:{periods:[{from:'31.02.2026',to:'30.09.2026'},qc.comparison.periods[1]]}}});assert.equal(body.context?.queryContext,undefined);
 console.log('PASS comparison context whitelist, client echo, controller reload, invalid comparison rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function boot(){const sb={console,setTimeout,clearTimeout,AbortController,Response,Headers};sb.globalThis=sb;vm.createContext(sb);
 for(const f of ['js/ai/ai-config.js','js/ai/ai-client.js','js/ai/ai-chat.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),sb);return sb.MTAI;}
(async()=>{
 const M=boot(),memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
 const qc={mode:'count',resolved_filters:{date_from:'01.09.2026',date_to:'30.09.2026',coworker_exclude:'Женя',
  semantic:{entity:'onu',action:'install',profile:'onu_physical',category:'definite',signal_context:'subscriber'}}};
 let calls=0;
 const client={ask:async(q,h,ctx)=>{calls++;if(calls===1)return {ok:true,answer:'8 ONU',queryContext:qc};
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.queryContext)),qc);return {ok:true,answer:'28 ONU'};}};
 await M.createChatController({client,storage}).send('А без Жени?');
 await M.createChatController({client,storage}).send('А со всеми?');assert.equal(calls,2);
 let body;
 const transport=M.createClient({getConfig:()=>({backendUrl:'https://synthetic.invalid',bearer:'synthetic'}),
  fetchImpl:async(url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({ai_contract_version:1,ok:true,answer:'ok'}),{status:200});}});
 await transport.ask('А в августе?',[],{queryContext:qc});
 assert.deepEqual(body.context.queryContext,qc);
 const group={...qc,mode:'group',group_by:'coworker'};
 await transport.ask('А со всеми?',[],{queryContext:group});assert.equal(body.context.queryContext.group_by,'coworker');
 body=undefined;const rejected=await transport.ask('А со всеми?',[],{queryContext:{...qc,resolved_filters:{...qc.resolved_filters,coworker:'Петя'}}});
 assert.equal(rejected.error.kind,'compatibility');assert.equal(body,undefined,'contradictory include/exclude never reaches transport');
 assert.ok(!JSON.stringify(memory).includes('masterNote'));
 console.log('PASS coworker EXCLUDE reload + client request whitelist + group dimension + conflicting predicates rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function boot(fetchImpl){const sb={console,setTimeout,clearTimeout,AbortController,Response,Headers};sb.globalThis=sb;vm.createContext(sb);for(const f of ['js/ai/ai-config.js','js/ai/ai-client.js','js/ai/ai-chat.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),sb);return sb.MTAI;}
(async()=>{
 const M=boot();let calls=0;const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
 const qc={mode:'count',total_matched:20,resolved_filters:{date_from:'01.09.2026',date_to:'30.09.2026',coworker:'Женя',semantic:{entity:'onu',action:'install',profile:'onu_physical',category:'definite',signal_context:'subscriber'}}};
 const client={ask:async(q,h,ctx)=>{calls++;if(calls===1)return {ok:true,answer:'20 ONU',queryContext:qc};assert.equal(q,'А в августе?');assert.deepEqual(JSON.parse(JSON.stringify(ctx.queryContext)),qc);return {ok:true,answer:'28 ONU',queryContext:{...qc,resolved_filters:{...qc.resolved_filters,date_from:'01.08.2026',date_to:'31.08.2026'}}};}};
 await M.createChatController({client,storage}).send('Сколько ONU поставил с Женей за сентябрь?');
 await M.createChatController({client,storage}).send('А в августе?');assert.equal(calls,2);
 console.log('PASS reload retains exact aggregate semantic/date/coworker context');
 let fetchCalls=0,release;
 const N=boot(),real=N.createClient({getConfig:()=>({backendUrl:'https://synthetic.invalid',bearer:'synthetic-only'}),fetchImpl:async()=>{fetchCalls++;if(fetchCalls===1)throw new TypeError('Failed to fetch');return new Response(JSON.stringify({ai_contract_version:1,ok:true,answer:'ok'}),{status:200});}});
 const c=N.createChatController({client:real});assert.equal((await c.send('first')).error.kind,'network');assert.equal(c.canRetry(),true);assert.equal((await c.send('second')).ok,true);assert.equal(c.canRetry(),false);assert.equal(fetchCalls,2);
 const busy=N.createChatController({client:{ask:()=>new Promise(r=>release=r)}});const pending=busy.send('one');assert.equal((await busy.send('two')).skipped,true);release({ok:true,answer:'ok'});await pending;
 console.log('PASS successful send clears failed/retry state; no automatic retry or parallel duplicate');
 const edge=N.createClient({getConfig:()=>({backendUrl:'https://synthetic.invalid',bearer:'synthetic-only'}),fetchImpl:async()=>new Response('error code: 1102',{status:503})});
 assert.equal((await edge.ask('q')).error.kind,'server','edge resource-limit response is not missing provider configuration');
 const aborted=N.createClient({getConfig:()=>({backendUrl:'https://synthetic.invalid',bearer:'synthetic-only'}),fetchImpl:async()=>({ok:true,status:200,json:async()=>{const e=new Error('aborted');e.name='AbortError';throw e;}})});
 assert.equal((await aborted.ask('q')).error.kind,'timeout','body abort is not an HTTP 200 application error');
 console.log('PASS edge 503 / body abort classifications; no secret or payload logging');
})().catch(e=>{console.error(e);process.exitCode=1;});

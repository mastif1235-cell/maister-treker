'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const core=require('../js/tools-core.js');

const response=(status,body={})=>({ok:status>=200&&status<300,status,async json(){return body;}});
(async()=>{
  let tick=0;
  const ok=await core.runBrowserDiagnostics({now:()=>tick+=12,fetch:async url=>url.includes('ipify')?response(200,{ip:'203.0.113.7'}):response(200)});
  assert.equal(ok.summaryStatus,'ok');assert.equal(ok.online,true);assert.equal(ok.publicIp,'203.0.113.7');assert.equal(ok.ipFamily,'IPv4');assert.equal(ok.dnsStatus,'indirect');

  const partial=await core.runBrowserDiagnostics({fetch:async url=>{if(url.includes('ipify'))throw new TypeError('browser blocked');return response(200);}});
  assert.equal(partial.summaryStatus,'warning');assert.equal(partial.online,true);assert.equal(partial.publicIp,'');assert.equal(partial.resources[0].state,'blocked');

  const http=await core.runBrowserDiagnostics({fetch:async()=>response(503)});
  assert.equal(http.summaryStatus,'warning');assert.ok(http.resources.every(item=>item.state==='http'));

  const started=Date.now();const hung=await core.runBrowserDiagnostics({timeoutMs:100,navigatorOnline:false,fetch:()=>new Promise(()=>{})});
  assert.ok(Date.now()-started<500,'hung browser requests are bounded');assert.equal(hung.summaryStatus,'offline');assert.ok(hung.resources.every(item=>item.state==='timeout'));
  const ui=fs.readFileSync('js/tools-domain.js','utf8');assert.match(ui,/▶ Запустити діагностику/);assert.match(ui,/Публічна IP/);assert.match(ui,/Контрольні ресурси/);assert.match(ui,/Це не звичайний ICMP Ping/);
  console.log('PASS Diagnostics 2.0 factual HTTPS states, partial failure and bounded timeout');
})().catch(error=>{console.error(error);process.exitCode=1;});

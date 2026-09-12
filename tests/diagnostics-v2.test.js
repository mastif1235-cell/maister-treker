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
  const ui=require('./helpers/tools-source').readToolsSource();
  assert.match(ui,/▶ Запустити діагностику/);
  assert.match(ui,/Інтернет/);assert.match(ui,/Завантаження/);assert.match(ui,/Відвантаження/);
  for(const jargon of ['Публічна IP','Контрольні ресурси','ICMP','CORS','DNS lookup'])assert.doesNotMatch(ui,new RegExp(jargon),`fitter-facing screen keeps out ${jargon}`);
  console.log('PASS Diagnostics 2.0 factual HTTPS states, partial failure, bounded timeout and compact fitter-facing result');
})().catch(error=>{console.error(error);process.exitCode=1;});

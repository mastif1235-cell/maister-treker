'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/dispatcher-report-client.js','utf8').replace('  const activeActions=new Set();','  root.__diagnostics=collectDiagnostics;root.__sendRequest=sendRequest;\n  const activeActions=new Set();');
const cfg={dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec',dispatcherHmacSecret:'synthetic-only-secret-0123456789012345'};
const c={URL,AbortController,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,
  settings:cfg,navigator:{onLine:false},MTSyncTransport:{signedEnvelope:async r=>r},
  localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null},
  document:{getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},addEventListener(){},
  fetch:async()=>({ok:true,json:async()=>({ok:true,active_count:1})})};
c.window=c;vm.createContext(c);vm.runInContext(source,c);
(async()=>{
  assert.equal((await c.__diagnostics()).connection.verified,false,'configured key is not server evidence');
  c.navigator.onLine=true;assert.equal((await c.__diagnostics()).connection.connected,false);
  await c.__sendRequest(cfg.dispatcherReportEndpoint,{action:'report_status',request_id:'synthetic-status'});
  assert.equal((await c.__diagnostics()).connection.verified,true);
  c.navigator.onLine=false;assert.equal((await c.__diagnostics()).connection.verified,false);
  c.navigator.onLine=true;c.fetch=async()=>{throw Error('synthetic timeout');};
  await assert.rejects(()=>c.__sendRequest(cfg.dispatcherReportEndpoint,{action:'report_status',request_id:'synthetic-fail'}));
  assert.equal((await c.__diagnostics()).connection.verified,false);
  console.log('PASS A08 direct diagnostics require live server evidence; offline and failure revoke it');
})().catch(e=>{console.error(e);process.exitCode=1;});

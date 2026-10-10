'use strict';
/* v91.95 / runtime-140. Direct transport unit tests: the send adapter wraps the
   outbox request in the SAME signed MT-SYNC-HMAC-V3 envelope as the legacy
   sync (MTSyncTransport.signedEnvelope reused, not re-implemented), posts it as
   a plain CORS fetch and feeds the JSON result into the unchanged ACK path.
   Network failures map to a connection-class error so the durable queue waits
   instead of burning attempts. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const contract=require('../js/sync-contract.js');
const SECRET='dispatcher-test-secret-0123456789abcdef';
const ENDPOINT='https://script.google.com/macros/s/TEST-DEPLOY/exec';
let count=0;

function loadClient(){
  const ctx={globalThis:{},URL,setTimeout,clearTimeout,AbortController,crypto,TextEncoder,btoa};
  vm.createContext(ctx);
  vm.runInContext(read('js/sync-contract.js'),ctx,{filename:'js/sync-contract.js'});
  vm.runInContext(read('js/sync-transport.js'),ctx,{filename:'js/sync-transport.js'});
  vm.runInContext(read('js/dispatcher-report-client.js'),ctx,{filename:'js/dispatcher-report-client.js'});
  return ctx;
}

(async()=>{
  const ctx=loadClient();
  const api=ctx.globalThis.MTDispatcherReportClient;
  assert.equal(typeof api.createDirectSend,'function','createDirectSend is exported');
  assert.equal(typeof ctx.globalThis.MTSyncTransport.signedEnvelope,'function','the legacy signed envelope is loaded for reuse');

  // 1. Happy path: envelope shape, canonical signature, raw JSON passthrough.
  {
    let captured=null;
    const send=api.createDirectSend({
      settings:()=>({dispatcherHmacSecret:SECRET}),
      now:()=>1791244800000,
      fetch:async(url,options)=>{captured={url,options};return {json:async()=>({ok:true,inserted:1,updated:0,unchanged:0,deleted:0,rejected:0,errors:0})};}
    });
    const request={action:'report_sync_all',tickets:[{ticket_id:'t1',source_version:5}],deletes:[],request_id:'request-direct-001',rebuild:false};
    const result=await send(ENDPOINT,request);
    assert.deepEqual(result,{ok:true,inserted:1,updated:0,unchanged:0,deleted:0,rejected:0,errors:0},'JSON ACK passes through untouched');
    assert.equal(captured.url,ENDPOINT);
    assert.equal(captured.options.method,'POST');
    assert.equal(captured.options.headers['Content-Type'],'text/plain;charset=utf-8');
    const envelope=JSON.parse(captured.options.body);
    assert.equal(envelope.v,3);assert.equal(envelope.method,'POST');
    assert.equal(envelope.action,'report_sync_all');assert.equal(envelope.entity,'system');assert.equal(envelope.id,'');
    assert.equal(envelope.requestId,request.request_id,'envelope is bound to the outbox request_id');
    assert.equal(envelope.ts,String(1791244800000));
    assert.match(envelope.nonce,/^[A-Za-z0-9_-]{16,128}$/);
    assert.deepEqual(JSON.parse(envelope.body),request,'body carries the exact request');
    assert.match(envelope.sig,/^[A-Za-z0-9_-]{43}$/);
    const expected=crypto.createHmac('sha256',SECRET).update(contract.canonical(envelope),'utf8').digest('base64url');
    assert.equal(envelope.sig,expected,'signature is the shared canonical MT-SYNC-HMAC-V3 contract');
    count++;
  }

  // 2. Secret requirements: no short/empty secret ever reaches the wire.
  {
    const send=api.createDirectSend({settings:()=>({dispatcherHmacSecret:'short'}),fetch:async()=>{throw new Error('MUST_NOT_FETCH');}});
    await assert.rejects(()=>send(ENDPOINT,{action:'report_status',request_id:'request-direct-002'}),/REPORT_NOT_CONFIGURED/);
    const send2=api.createDirectSend({settings:()=>({}),fetch:async()=>{throw new Error('MUST_NOT_FETCH');}});
    await assert.rejects(()=>send2(ENDPOINT,{action:'report_status',request_id:'request-direct-003'}),/REPORT_NOT_CONFIGURED/);
    count++;
  }

  // 3. Transport failures map to a connection-class error (queue waits, no
  //    attempts burned) — never a permanent per-ticket failure.
  {
    const send=api.createDirectSend({settings:()=>({dispatcherHmacSecret:SECRET}),fetch:async()=>{throw new TypeError('Failed to fetch');}});
    await assert.rejects(()=>send(ENDPOINT,{action:'report_status',request_id:'request-direct-004'}),/REPORT_CONNECTION_RESET/);
    const send2=api.createDirectSend({settings:()=>({dispatcherHmacSecret:SECRET}),fetch:async()=>({json:async()=>{throw new SyntaxError('bad json');}})});
    await assert.rejects(()=>send2(ENDPOINT,{action:'report_status',request_id:'request-direct-005'}),/REPORT_CONNECTION_RESET/);
    count++;
  }

  // 4. Server denials pass through as structured results for the ACK path.
  {
    const send=api.createDirectSend({settings:()=>({dispatcherHmacSecret:SECRET}),fetch:async()=>({json:async()=>({ok:false,code:'AUTH_FAILED'})})});
    assert.deepEqual(await send(ENDPOINT,{action:'report_status',request_id:'request-direct-006'}),{ok:false,code:'AUTH_FAILED'});
    count++;
  }

  // 5. Endpoint validation still refuses anything but the GAS Web App URL.
  {
    const send=api.createDirectSend({settings:()=>({dispatcherHmacSecret:SECRET}),fetch:async()=>{throw new Error('MUST_NOT_FETCH');}});
    await assert.rejects(()=>send('https://example.com/exec',{action:'report_status',request_id:'request-direct-007'}),/INVALID_ENDPOINT/);
    count++;
  }

  console.log('dispatcher direct transport: '+count+' PASS');
})().catch(e=>{console.error(e);process.exit(1);});

'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const create=require('../js/offline-map-download-provider');
(async()=>{
  const token=crypto.randomBytes(32).toString('base64url');let captured;
  const root={mtOfflineMapTokenGet:()=>token,fetch:async(url,init)=>{captured={url,init};return new Response(JSON.stringify({mapId:'dnipro-oblast'}));}};
  const provider=create(root);assert.equal((await provider('dnipro-oblast','2026-09-30',{downloadId:'known',sha256:'hash',size:1})).mapId,'dnipro-oblast');
  assert.equal(captured.init.headers.Authorization,'Bearer '+token);assert.equal(captured.init.credentials,'omit');assert.equal(captured.init.cache,'no-store');assert.equal(captured.init.redirect,'error');
  assert.equal(captured.url.includes(token),false);assert.equal(captured.init.body.includes(token),false);
  for(const [status,code] of [[401,'DOWNLOAD_AUTH'],[403,'DOWNLOAD_AUTH'],[429,'DOWNLOAD_RATE_LIMIT'],[503,'DOWNLOAD_GRANT']]){
    root.fetch=async()=>new Response('',{status});await assert.rejects(()=>provider('id','version'),new RegExp(code));
  }
  root.fetch=async()=>{throw new TypeError('secret URL');};await assert.rejects(()=>provider('id','version'),/DOWNLOAD_NETWORK/);
  root.fetch=async()=>new Response('x'.repeat(9000));await assert.rejects(()=>provider('id','version'),/DOWNLOAD_GRANT/);
  root.fetch=async(_url,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
  await assert.rejects(()=>create(root,{timeoutMs:5})('id','version'),/DOWNLOAD_TIMEOUT/);
  const abort=new AbortController(),pending=provider('id','version',{signal:abort.signal});abort.abort();await assert.rejects(()=>pending,/STOPPED/);
  await assert.rejects(()=>provider('id','version',{signal:abort.signal}),/STOPPED/);
  root.mtOfflineMapTokenGet=()=>'';await assert.rejects(()=>provider('id','version'),/DOWNLOAD_AUTH/);
  console.log('PASS offline map provider auth/header isolation, bounded JSON, timeout, abort, readable errors');
})().catch(error=>{console.error(error);process.exitCode=1;});

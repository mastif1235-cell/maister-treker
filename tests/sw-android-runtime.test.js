'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const source=fs.readFileSync('sw.js','utf8'),handlers={},current=new Map(),other=new Map();
const cacheName=source.match(/const CACHE_NAME = '([^']+)'/)[1];
const wrap=map=>({match:async r=>map.get(String(r.url||r)),put:async()=>{throw Error('UNEXPECTED_WRITE');}});
let globalLookups=0,storageTouches=0;
const context={URL,crypto:webcrypto,Uint8Array,console,self:{location:{origin:'https://app.test'},addEventListener:(name,fn)=>{handlers[name]=fn;}},caches:{open:async name=>{assert.equal(name,cacheName);return wrap(current);},match:async r=>{globalLookups++;return other.get(String(r.url||r));}},fetch:async()=>{throw Error('OFFLINE');},indexedDB:new Proxy({},{get(){storageTouches++;}}),localStorage:new Proxy({},{get(){storageTouches++;}})};
vm.runInNewContext(source,context);
async function request(url,mode){let response;handlers.fetch({request:{url,method:'GET',mode},respondWith:p=>{response=p;}});return response;}
(async()=>{
  const good={body:'runtime136'},bad={body:'stale134'};
  current.set('https://app.test/app.js',good);other.set('https://app.test/app.js',bad);
  assert.equal(await request('https://app.test/app.js'),good);
  current.delete('https://app.test/app.js');
  assert.equal(await request('https://app.test/app.js'),null,'missing current asset must never fall through to stale cache');
  current.set('./index.html',good);other.set('./index.html',bad);
  assert.equal(await request('https://app.test/new-route','navigate'),good);
  assert.equal(globalLookups,0,'global CacheStorage lookup is forbidden');
  const paths=['./index.html','./app.js','./styles.css','./js/tickets-render.js','./js/tickets-compact-view.js','./js/dispatcher-report-client.js','./js/dispatcher-report-core.js','./js/dispatcher-report-projection.mjs'];
  for(const p of paths){const bytes=Buffer.from(p);current.set(p,{arrayBuffer:async()=>bytes});}
  let wait,result;handlers.message({data:{type:'MT_RUNTIME_STATUS'},ports:[{postMessage:value=>{result=value;}}],waitUntil:p=>{wait=p;}});await wait;
  assert.equal(result.cacheName,cacheName);assert.equal(Object.keys(result.assets).length,8);
  for(const hash of Object.values(result.assets))assert.match(hash,/^[a-f0-9]{64}$/);
  assert.equal(storageTouches,0,'no user data or storage is inspected');
  const proof=JSON.parse(fs.readFileSync('runtime-proof.json','utf8'));assert.equal(proof.cacheName,cacheName);
  for(const [asset,hash] of Object.entries(proof.assets))assert.equal(hash,require('node:crypto').createHash('sha256').update(fs.readFileSync(asset)).digest('hex'),'release manifest stays current: '+asset);
  console.log('PASS Android runtime cache isolation / SHA256 diagnostics / no data mutation');
})().catch(e=>{console.error(e);process.exitCode=1;});

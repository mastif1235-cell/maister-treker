import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, createHash, createHmac} from 'node:crypto';
import {createApp} from '../../src/index.js';
import {MAP_CATALOG, MAP_ORIGIN} from '../../src/offline-map/config.js';
import {signMapGet} from '../../src/offline-map/sign.js';
import {testEnv, mockGasFetch} from '../helpers/mcpapp.js';

const random=()=>randomBytes(32).toString('base64url');
function setup(patch={},deps={}){
  const map=random(),mcp=random(),ask=random();let hits=0;
  const env=testEnv({MCP_BEARER_TOKENS:`mcp:${mcp}:read`,ASK_BEARER_TOKENS:`ask:${ask}:read`,
    MAP_BEARER_TOKENS:`phone:${map}:read`,R2_ACCOUNT_ID:randomBytes(16).toString('hex'),
    R2_BUCKET:'maister-offline-maps',MAP_SIGN_TTL_SECONDS:'900',MAP_ALLOWED_ORIGIN:MAP_ORIGIN,
    R2_ACCESS_KEY_ID:random(),R2_SECRET_ACCESS_KEY:random(),
    MAP_GRANT_RATE_LIMIT:{async limit(){return {success:++hits<=6};}},...patch});
  const gas=mockGasFetch('ok');const app=createApp(env,{fetchImpl:gas,mapGrant:deps});
  return {env,map,mcp,ask,app,gas};
}
const body=()=>Object.fromEntries(['mapId','version','downloadId','sha256','size'].map(k=>[k,MAP_CATALOG[k]]));
function request(s,token=s.map,value=body(),extra={}){
  return s.app.fetch(new Request('https://worker.test/offline-map/grant',{method:'POST',
    headers:{Origin:MAP_ORIGIN,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},body:JSON.stringify(value)}));
}
test('map-only capability: all auth negatives denied, map token cannot access MCP/ASK/directory',async()=>{
  const s=setup();
  for(const token of [null,'malformed',random(),s.mcp,s.ask])assert.equal((await request(s,token)).status,401);
  for(const path of ['/mcp','/ask','/directory']){
    const response=await s.app.fetch(new Request('https://worker.test'+path,{method:'POST',headers:{Authorization:'Bearer '+s.map},body:'{}'}));
    assert.equal(response.status,401,path);
  }
  assert.equal(s.gas.calls.length,0);
  const ok=await request(s);assert.equal(ok.status,200);
  const output=await ok.json();assert.deepEqual(Object.keys(output).sort(),[...Object.keys(body()),'url','expiresAt'].sort());
  for(const [key,value] of Object.entries(body()))assert.equal(output[key],value);
  assert.equal(ok.headers.get('Cache-Control'),'no-store');
  assert.ok(!JSON.stringify(output).includes(s.map));assert.ok(!JSON.stringify(output).includes(s.env.R2_SECRET_ACCESS_KEY));
});
test('catalog rejects mismatches and arbitrary key/URL/bucket/TTL before signing',async()=>{
  for(const patch of [{mapId:'other'},{version:'2026-10-01'},{downloadId:'other'},{sha256:'a'.repeat(64)},
    {size:1},{objectKey:'other'},{url:'https://other.test'},{ttl:99999},{bucket:'other'}]){
    let signed=0;const s=setup({}, {sign:async()=>{signed++;throw new Error();}});
    assert.equal((await request(s,s.map,{...body(),...patch})).status,409);assert.equal(signed,0);
  }
});
test('native limiter applies only to map route; 429 has Retry-After',async()=>{
  const s=setup();for(let i=0;i<6;i++)assert.equal((await request(s)).status,200);
  const denied=await request(s);assert.equal(denied.status,429);assert.equal(denied.headers.get('Retry-After'),'60');
  assert.equal((await s.app.fetch(new Request('https://worker.test/healthz'))).status,200);
  assert.equal((await s.app.fetch(new Request('https://worker.test/mcp',{method:'POST',headers:{Authorization:'Bearer '+s.mcp},body:'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'}))).status,200);
});
test('CORS exact origin and strict preflight, no cookies/wildcard',async()=>{
  const s=setup();const good=await request(s);assert.equal(good.headers.get('Access-Control-Allow-Origin'),MAP_ORIGIN);
  const wrong=await request(s,s.map,body(),{Origin:'https://evil.test'});assert.equal(wrong.status,403);assert.equal(wrong.headers.get('Access-Control-Allow-Origin'),null);
  for(const [method,headers,status] of [['POST','authorization, content-type',204],['GET','authorization',403],['POST','x-evil',403]]){
    const r=await s.app.fetch(new Request('https://worker.test/offline-map/grant',{method:'OPTIONS',headers:{Origin:MAP_ORIGIN,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':headers}}));assert.equal(r.status,status);
  }
  assert.equal(good.headers.get('Set-Cookie'),null);assert.equal(good.headers.get('Access-Control-Allow-Credentials'),null);
});
test('fail closed independently: missing map secrets/binding/sign failure leaves other routes usable',async()=>{
  for(const key of ['MAP_BEARER_TOKENS','R2_ACCOUNT_ID','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','MAP_SIGN_TTL_SECONDS','MAP_GRANT_RATE_LIMIT']){
    const s=setup({[key]:undefined});assert.equal((await request(s)).status,503,key);
    assert.equal((await s.app.fetch(new Request('https://worker.test/healthz'))).status,200);
    for(const path of ['/mcp','/ask','/directory'])assert.equal((await s.app.fetch(new Request('https://worker.test'+path,{method:'POST',body:'{}'}))).status,401,path);
  }
  const broken=setup({}, {sign:async()=>{throw new Error('secret URL should not escape');}});
  const r=await request(broken);assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'map_grant_unavailable'});
  const independent=setup({GAS_SYNC_URL:undefined});assert.equal((await request(independent)).status,200);
});
test('SigV4 independently verified: correct GET bucket/key, 900 seconds, host only, no fixed Range',async()=>{
  const s=setup(),now=Date.UTC(2026,9,1,12);const config={accountId:s.env.R2_ACCOUNT_ID,bucket:s.env.R2_BUCKET,
    accessKeyId:s.env.R2_ACCESS_KEY_ID,secretAccessKey:s.env.R2_SECRET_ACCESS_KEY,ttl:900};
  const url=new URL(await signMapGet(config,MAP_CATALOG,now)),p=url.searchParams;
  assert.equal(url.hostname,config.accountId+'.r2.cloudflarestorage.com');assert.equal(url.pathname,'/'+config.bucket+'/'+MAP_CATALOG.objectKey);
  assert.equal(p.get('X-Amz-Expires'),'900');assert.equal(p.get('X-Amz-SignedHeaders'),'host');assert.equal(p.get('X-Amz-Date'),'20261001T120000Z');
  const signature=p.get('X-Amz-Signature');p.delete('X-Amz-Signature');
  const encode=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  const query=[...p].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>encode(k)+'='+encode(v)).join('&');
  const canonical=['GET',url.pathname,query,'host:'+url.host+'\n','host','UNSIGNED-PAYLOAD'].join('\n');
  const scope='20261001/auto/s3/aws4_request';
  const string=['AWS4-HMAC-SHA256','20261001T120000Z',scope,createHash('sha256').update(canonical).digest('hex')].join('\n');
  const hmac=(k,v)=>createHmac('sha256',k).update(v).digest();
  const key=hmac(hmac(hmac(hmac('AWS4'+config.secretAccessKey,'20261001'),'auto'),'s3'),'aws4_request');
  assert.equal(hmac(key,string).toString('hex'),signature);
});
test('bounded malformed input and overlapping credential pools fail closed',async()=>{
  for(const text of ['{', 'x'.repeat(2049)]){
    const s=setup();const r=await s.app.fetch(new Request('https://worker.test/offline-map/grant',{method:'POST',headers:{Authorization:'Bearer '+s.map,'Content-Type':'application/json'},body:text}));assert.equal(r.status,400);
  }
  const s=setup();s.env.MAP_BEARER_TOKENS=`phone:${s.mcp}:read`;
  assert.equal((await request(s,s.mcp)).status,503);
  assert.equal((await setup({}, {sign:async()=>''}).app.fetch(new Request('https://worker.test/offline-map/grant'))).status,405);
});

'use strict';
/* Release identity regression (v91.95 / runtime-140).
   Rule: any runtime-proof asset change between releases REQUIRES a new
   CACHE_NAME/runtime revision — changed cached JS must never ship under the
   same cache name (Android v91.92 smoke: stale dispatcher-report-client.js
   kept executing from maister-treker-v67-runtime-137). */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const core=require(path.join(root,'scripts','release-identity-core.cjs'));
const identity=JSON.parse(read('scripts/release-identity.json'));
const proof=JSON.parse(read('runtime-proof.json'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

// 1. The named cache IS the release unit: sw.js, runtime-guard pins and proof agree.
const guard=read('js/runtime-guard.js');
const CACHE_NAME=proof.cacheName;
assert.match(CACHE_NAME,/^maister-treker-v\d+-runtime-\d+$/,'proof keeps named-cache identity');
assert.ok(read('sw.js').includes("const CACHE_NAME = '"+CACHE_NAME+"'"),'sw.js CACHE_NAME matches runtime-proof cacheName');
assert.ok(guard.includes("const CACHE_EXPECTED='"+CACHE_NAME+"'"),'runtime-guard CACHE_EXPECTED pins the same cache');
assert.ok(guard.includes("const EXPECTED='"+proof.cacheName.match(/runtime-\d+/)[0]+"'"),'runtime-guard EXPECTED pins the cache runtime token');

// 2. runtime-proof is real bytes; dispatcher-report-client.js ships into the named cache.
for(const [asset,hash] of Object.entries(proof.assets)){
  const rel=asset.replace(/^\.\//,'');
  assert.equal(sha(fs.readFileSync(path.join(root,rel))),hash,asset+' hash matches file bytes');
  assert.match(hash,/^[a-f0-9]{64}$/,asset+' sha');
}
assert.ok(Object.keys(proof.assets).includes('./js/dispatcher-report-client.js'),'client is a runtime-proof asset');
const swSource=read('sw.js');
const coreAssets=swSource.match(/const CORE_ASSETS = (\[[^\]]+\])/)[1];
assert.ok(coreAssets.includes("'./js/dispatcher-report-client.js'"),'client is CORE_ASSETS — precached into CACHE_NAME at install');
assert.ok(Object.keys(proof.assets).length===8,'eight public release assets');

// 3. Current release identity is recorded and verifiable.
const ok=core.verifyReleaseIdentity({cacheName:proof.cacheName,assets:proof.assets,identity});
assert.equal(ok.recorded,true,'current CACHE_NAME is in the release identity ledger');
assert.equal(ok.runtime,proof.cacheName.match(/runtime-\d+/)[0],'recorded runtime token matches cache name');

// 4. THE RULE: changed assets under the SAME cache name are rejected.
const tampered={...proof.assets,'./app.js':'0'.repeat(64)};
assert.throws(()=>core.verifyReleaseIdentity({cacheName:proof.cacheName,assets:tampered,identity}),/RELEASE_IDENTITY_CHANGED/,'a changed asset must never ship under the same cache name');
assert.throws(()=>core.verifyReleaseIdentity({cacheName:proof.cacheName,assets:{...tampered,'./js/dispatcher-report-client.js':'1'.repeat(64)},identity}),/RELEASE_IDENTITY_CHANGED/,'the rule covers the report client itself');

// 5. The required remedy — a NEW cache/runtime for changed bytes — passes.
const bumped=core.verifyReleaseIdentity({cacheName:'maister-treker-v71-runtime-141',assets:tampered,identity});
assert.equal(bumped.recorded,false,'new cache name is not yet recorded');
assert.equal(bumped.runtime,'runtime-141','bumped release keeps the runtime token');

// 6. Ledger history: every recorded release keeps its own immutable fingerprint pair.
const names=Object.keys(identity);
assert.ok(names.includes('maister-treker-v67-runtime-137'),'production identity stays recorded');
assert.ok(names.includes('maister-treker-v68-runtime-138'),'the first cache bump stays recorded');
assert.ok(names.includes('maister-treker-v69-runtime-139'),'the v91.94 cache bump stays recorded');
assert.ok(names.includes('maister-treker-v70-runtime-140'),'the v91.95 direct-transport release is recorded');
assert.notEqual(identity['maister-treker-v70-runtime-140'].fingerprint,identity['maister-treker-v67-runtime-137'].fingerprint,'the two releases differ in bytes AND in cache name');
assert.notEqual(identity['maister-treker-v70-runtime-140'].fingerprint,identity['maister-treker-v68-runtime-138'].fingerprint,'every release keeps its own immutable fingerprint');
assert.notEqual(identity['maister-treker-v70-runtime-140'].fingerprint,identity['maister-treker-v69-runtime-139'].fingerprint,'v91.95 bytes are fingerprinted under their own cache name');
assert.notEqual(identity['maister-treker-v69-runtime-139'].fingerprint,identity['maister-treker-v68-runtime-138'].fingerprint,'history entries never share a fingerprint');
for(const [name,rec] of Object.entries(identity)){
  assert.ok(name.includes(rec.runtime),'recorded runtime token belongs to its cache name: '+name);
  assert.match(rec.fingerprint,/^[a-f0-9]{64}$/,name+' fingerprint');
}
assert.throws(()=>core.verifyReleaseIdentity({cacheName:proof.cacheName,assets:{...proof.assets,'./index.html':'2'.repeat(64)},identity}),/RELEASE_IDENTITY_CHANGED/);

// 7. The release build gate: --check is green now, red on identity tampering.
const check=spawnSync(process.execPath,['scripts/build-runtime-proof.cjs','--check'],{cwd:root,encoding:'utf8'});
assert.equal(check.status,0,'build-runtime-proof --check passes for the current release');
const tamperFile=path.join(root,'scripts','.release-identity-tamper.json');
const tamperIdentity={...identity,[proof.cacheName]:{runtime:identity[proof.cacheName].runtime,fingerprint:'f'.repeat(64),assets:8}};
fs.writeFileSync(tamperFile,JSON.stringify(tamperIdentity));
const bad=spawnSync(process.execPath,['scripts/build-runtime-proof.cjs','--check'],{cwd:root,encoding:'utf8',env:{...process.env,MT_RELEASE_IDENTITY_PATH:tamperFile}});
fs.unlinkSync(tamperFile);
assert.notEqual(bad.status,0,'the gate refuses a release whose identity does not match its bytes');
assert.match(String(bad.stderr||bad.stdout),/RELEASE_IDENTITY_CHANGED/,'failure names the release identity rule');
const missingFile=path.join(root,'scripts','.release-identity-missing.json');
fs.writeFileSync(missingFile,'{}');
const miss=spawnSync(process.execPath,['scripts/build-runtime-proof.cjs','--check'],{cwd:root,encoding:'utf8',env:{...process.env,MT_RELEASE_IDENTITY_PATH:missingFile}});
fs.unlinkSync(missingFile);
assert.notEqual(miss.status,0,'an unrecorded cache name is refused at release time');
assert.match(String(miss.stderr||miss.stdout),/RELEASE_IDENTITY_MISSING/,'unrecorded cache names must be recorded');

console.log('ok - release identity rule');

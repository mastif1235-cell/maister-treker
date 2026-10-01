'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const backup=require('../js/backup-system');
function harness(store=new Map(),available=true){
  const ctx={crypto:crypto.webcrypto,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout,
    backupDb:available?{}:null,backupDbGet:async k=>store.get(k),backupDbPut:async(k,v)=>{store.set(k,v);return true;},
    window:{open(){}},settings:{theme:'dark'},location:{href:'https://app.test/'}};
  vm.createContext(ctx);vm.runInContext(read('js/settings-secrets-vault.js'),ctx);vm.runInContext(read('js/security-hardening.js'),ctx);
  return ctx;
}
(async()=>{
  const token=crypto.randomBytes(32).toString('base64url'),store=new Map(),ctx=harness(store);
  assert.equal((await ctx.mtOfflineMapTokenSet(token)).persistent,true);
  assert.equal(ctx.mtOfflineMapTokenGet(),token);assert.equal(JSON.stringify(ctx.settings).includes(token),false);
  const record=store.get('__offlineMapAccessV1');assert.equal(Buffer.from(record.ciphertext).includes(Buffer.from(token)),false);
  assert.equal(store.get('__settingsSecretsKeyV1').extractable,false);
  const restarted=harness(store);await restarted.mtOfflineMapTokenRestore();assert.equal(restarted.mtOfflineMapTokenGet(),token);
  const malicious={offlineMapAccessToken:token,nested:[{offlineMapAccessToken:token}],theme:'light'};
  const clean=ctx.securitySanitizeSettingsForBackup(malicious);assert.equal(JSON.stringify(clean).includes(token),false);
  const payload={tickets:[],settings:JSON.parse(JSON.stringify(clean)),diagnostics:JSON.parse(JSON.stringify(ctx.securityStripSystemSecrets([malicious])))};
  const password=crypto.randomBytes(20).toString('base64url');
  const encrypted=await backup.encrypt(payload,password),decrypted=await backup.decrypt(encrypted,password);
  assert.equal(JSON.stringify(encrypted).includes(token),false);assert.equal(JSON.stringify(decrypted).includes(token),false);
  assert.equal(ctx.securityMergeImportedSettings(malicious,{offlineMapAccessToken:'',theme:'dark'}).offlineMapAccessToken,'');
  assert.equal(JSON.stringify(ctx.securityStripSystemSecrets({diagnostics:malicious})).includes(token),false);
  assert.equal(JSON.stringify(ctx.mtSettingsSecretsPreparePersist(ctx.settings)).includes(token),false);
  await restarted.mtOfflineMapTokenSet('');await ctx.mtOfflineMapTokenRestore();assert.equal(ctx.mtOfflineMapTokenGet(),'');
  const memory=harness(new Map(),false);assert.equal((await memory.mtOfflineMapTokenSet(token)).persistent,false);
  assert.equal(memory.mtOfflineMapTokenGet(),token);assert.equal(JSON.stringify(memory.settings).includes(token),false);
  await memory.mtOfflineMapTokenRestore();assert.equal(memory.mtOfflineMapTokenGet(),'');
  await assert.rejects(()=>ctx.mtOfflineMapTokenSet('bad'),/MAP_TOKEN_INVALID/);
  const failed=harness();failed.backupDbPut=async()=>false;
  assert.equal((await failed.mtOfflineMapTokenSet(token)).persistent,false);assert.equal(failed.mtOfflineMapTokenGet(),token);
  const durable=harness();await durable.mtOfflineMapTokenSet(token);durable.backupDbPut=async()=>false;
  await assert.rejects(()=>durable.mtOfflineMapTokenSet(''),/MAP_TOKEN_STORAGE/);assert.equal(durable.mtOfflineMapTokenGet(),token);
  // Existing encrypted export, daily backup, diagnostics and sync operate on
  // settings/explicit payloads, never enumerate the vault store.
  for(const f of ['js/backup-system.js','js/settings-core.js'])assert.equal(read(f).includes('mtOfflineMapTokenGet'),false);
  assert.ok(read('js/backup-system.js').includes('securitySanitizeSettingsForBackup(settings)'));
  console.log('PASS map token encrypted vault/reload/delete, session-only fallback, no settings/plain backup/diagnostics/import leakage');
})().catch(error=>{console.error(error);process.exitCode=1;});

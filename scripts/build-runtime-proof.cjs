'use strict';
// Public release bytes only. Never inspect or modify application/user storage.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const identityCore=require('./release-identity-core.cjs');
const root=path.resolve(__dirname,'..');
const paths=['index.html','app.js','styles.css','js/tickets-render.js','js/tickets-compact-view.js','js/dispatcher-report-client.js','js/dispatcher-report-core.js','js/dispatcher-report-projection.mjs'];
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const proof={cacheName:sw.match(/const CACHE_NAME = '([^']+)'/)[1],assets:Object.fromEntries(paths.map(p=>['./'+p,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]))};
const output=JSON.stringify(proof,null,2)+'\n',target=path.join(root,'runtime-proof.json');
// Release identity gate: a changed runtime-proof asset must never ship under
// the same CACHE_NAME — bump the cache/runtime first (see release-identity-core).
const identityPath=process.env.MT_RELEASE_IDENTITY_PATH||path.join(root,'scripts','release-identity.json');
const identity=fs.existsSync(identityPath)?JSON.parse(fs.readFileSync(identityPath,'utf8')):{};
const verdict=identityCore.verifyReleaseIdentity({cacheName:proof.cacheName,assets:proof.assets,identity});
if(process.argv.includes('--check')){
  if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==output)throw Error('RUNTIME_PROOF_OUTDATED');
  if(!verdict.recorded)throw Error('RELEASE_IDENTITY_MISSING: record '+proof.cacheName+' in scripts/release-identity.json');
}
else{
  fs.writeFileSync(target,output);
  if(!verdict.recorded){
    identity[proof.cacheName]={runtime:verdict.runtime,fingerprint:verdict.fingerprint,assets:Object.keys(proof.assets).length};
    fs.writeFileSync(identityPath,JSON.stringify(identity,null,2)+'\n');
    console.log('Release identity recorded: '+proof.cacheName+' -> '+verdict.fingerprint);
  }
}
console.log('Runtime release proof: '+proof.cacheName+' / '+paths.length+' assets');

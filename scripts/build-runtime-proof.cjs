'use strict';
// Public release bytes only. Never inspect or modify application/user storage.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const paths=['index.html','app.js','styles.css','js/tickets-render.js','js/tickets-compact-view.js','js/dispatcher-report-client.js','js/dispatcher-report-core.js','js/dispatcher-report-projection.mjs'];
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const proof={cacheName:sw.match(/const CACHE_NAME = '([^']+)'/)[1],assets:Object.fromEntries(paths.map(p=>['./'+p,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]))};
const output=JSON.stringify(proof,null,2)+'\n',target=path.join(root,'runtime-proof.json');
if(process.argv.includes('--check')){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==output)throw Error('RUNTIME_PROOF_OUTDATED');}
else fs.writeFileSync(target,output);
console.log('Runtime release proof: '+proof.cacheName+' / '+paths.length+' assets');

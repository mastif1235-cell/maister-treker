'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function discover(names){return names.filter(n=>/\.test\.(?:js|cjs)$/.test(n)).sort();}
module.exports={discover};
if(require.main===module){
  const args=process.argv.slice(2),index=args.indexOf('--filter');
  const pattern=index>=0?new RegExp(args[index+1]):null;
  const files=discover(fs.readdirSync(path.join(root,'tests'))).filter(n=>!pattern||pattern.test(n));
  if(args.includes('--list')){console.log(files.join('\n'));process.exit(0);}
  if(!files.length){console.error('No matching local tests');process.exit(1);}
  let passed=0,failed=0;const failedFiles=[];
  for(const file of files){
    const result=spawnSync(process.execPath,[path.join(root,'tests',file)],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
    if(result.status===0){passed++;console.log('PASS '+file);}
    else{failed++;failedFiles.push(file);console.error('FAIL '+file+'\n'+String(result.error||'')+String(result.stdout||'').slice(-4000)+String(result.stderr||'').slice(-4000));}
  }
  console.log(JSON.stringify({files:files.length,passed,failed,failedFiles}));process.exitCode=failed?1:0;
}

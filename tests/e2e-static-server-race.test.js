'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {startStaticServer}=require('../e2e/helpers/env');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mt-static-race-'));
  const file=path.join(dir,'fixture.js');fs.writeFileSync(file,'/* fixture */');
  const original=fs.createReadStream;
  let server;
  try{
    server=await startStaticServer(dir);
    fs.createReadStream=function(filePath,...args){
      if(filePath!==file)return original.call(this,filePath,...args);
      const stream=new Readable({read(){}});
      queueMicrotask(()=>stream.destroy(Object.assign(new Error('File disappeared after stat'),{code:'ENOENT'})));
      return stream;
    };
    const missing=await fetch(server.url+'/fixture.js');
    assert.equal(missing.status,404);assert.equal(await missing.text(),'Not found');
    fs.createReadStream=original;
    const healthy=await fetch(server.url+'/fixture.js');
    assert.equal(healthy.status,200);assert.equal(await healthy.text(),'/* fixture */');
    console.log('PASS E2E static server handles stat/open disappearance without an uncaught stream error');
  }finally{
    fs.createReadStream=original;
    if(server)await server.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

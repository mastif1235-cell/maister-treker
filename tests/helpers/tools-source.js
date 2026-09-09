'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const read=file=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8').replace(/\r\n/g,'\n');
function parts(){
  return [...read('index.html').matchAll(/<script src="(js\/tools-(?:domain|network-points|offline-ui|diagnostics-ui)\.js)"><\/script>/g)].map(match=>({file:match[1],source:read(match[1])}));
}
function readToolsSource(){return parts().map(part=>part.source).join('\n');}
function functions(source){
  return [...source.matchAll(/^(?:async )?function (\w+)\(/gm)].map(match=>{
    const lineEnd=source.indexOf('\n',match.index),first=source.slice(match.index,lineEnd<0?source.length:lineEnd);
    const end=first.endsWith('}')?(lineEnd<0?source.length:lineEnd):source.indexOf('\n}',lineEnd)+2;
    assert.ok(end>match.index,'complete top-level function '+match[1]);
    return {name:match[1],body:source.slice(match.index,end)};
  });
}
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function verifyExtraction(){
  const baseline=require('../fixtures/tools-extraction-baseline.json'),loaded=parts(),main=read('js/tools-domain.js'),all=loaded.flatMap(part=>functions(part.source).map(fn=>({...fn,file:part.file})));
  assert.deepEqual(all.map(fn=>fn.name).sort(),Object.keys(baseline.hashes).sort(),'same public functions, no missing/duplicate definitions');
  for(const fn of all)assert.equal(hash(fn.body),baseline.hashes[fn.name],'unchanged body: '+fn.name);
  assert.deepEqual(main.split('\n').filter(line=>/^(const|let) /.test(line)),baseline.state,'shared lexical state remains in its original owner and order');
  for(const name of baseline.protected)assert.ok(functions(main).some(fn=>fn.name===name),'protected owner '+name);
  const html=read('index.html'),sw=read('sw.js'),domainIndex=html.indexOf('src="js/tools-domain.js"'),networkIndex=html.indexOf('src="js/tools-diagnostics-network.js"');
  for(const part of loaded.slice(1)){
    assert.equal(html.split('src="'+part.file+'"').length-1,1,'one script '+part.file);
    assert.ok(html.indexOf('src="'+part.file+'"')>domainIndex&&html.indexOf('src="'+part.file+'"')<networkIndex,'before consumers/bootstrap '+part.file);
    assert.equal(sw.split("'./"+part.file+"'").length-1,1,'offline shell asset '+part.file);
    let declarationsOnly=part.source;
    for(const fn of functions(part.source))declarationsOnly=declarationsOnly.replace(fn.body,'');
    assert.equal(declarationsOnly.replace(/\/\*[\s\S]*?\*\//g,'').trim(),'','no new state or top-level effects '+part.file);
    vm.runInNewContext(part.source,{}, {filename:part.file}); // declarations load before any browser API exists
  }
}
function loadRuntime(context){
  vm.createContext(context);
  for(const part of parts())vm.runInContext(part.source,context,{filename:part.file});
  return context;
}
module.exports={read,parts,readToolsSource,functions,verifyExtraction,loadRuntime};

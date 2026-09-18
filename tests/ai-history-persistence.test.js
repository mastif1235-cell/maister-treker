'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function load(storage, answer){
  const sandbox={console,setTimeout,clearTimeout,Promise,Date,Math,JSON,Array,Object,String,Number,RegExp,Error,localStorage:storage};
  sandbox.globalThis=sandbox; sandbox.window=undefined;
  sandbox.MTAI={config:{LIMITS:{questionMaxChars:2000}}}; vm.runInNewContext(fs.readFileSync(path.join(root,'js/ai/ai-chat.js'),'utf8'),sandbox,{filename:'js/ai/ai-chat.js'});
  const client={ask:async()=>({ok:true,answer:answer,tickets:[{id:'full-real-id-123',date:'01.01.2026',address:'Safe',type:'Ремонт',sum:'1',signal:'',note:'',backupNote:'RAW',masterNote:'PRIVATE',fullDataJson:'RAW'}]})};
  return sandbox.MTAI.createChatController({storage:storage,client:client});
}
(async function(){
  const data=new Map(); const storage={getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const first=load(storage,'answer'); await first.send('question');
  const raw=data.get('mtAiChatHistoryV1'); assert.ok(raw);
  assert.match(raw,/full-real-id-123/); assert.doesNotMatch(raw,/backupNote|masterNote|fullDataJson|PRIVATE|RAW/);
  const restored=load(storage,'answer'); assert.equal(restored.history().find(m=>m.role==='assistant').tickets[0].id,'full-real-id-123');
  await restored.send('another'); restored.clear(); assert.equal(data.has('mtAiChatHistoryV1'),false);
  console.log('PASS AI history persistence: bounded safe structured metadata, reload, action id, clear');
})().catch(err=>{ console.error(err); process.exitCode=1; });

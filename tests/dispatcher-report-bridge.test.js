'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
async function main(){
  const appOrigin='http://127.0.0.1:50076';
  const googleOrigin='https://sandbox-script.googleusercontent.com';
  const handlers={},googleHandlers={};
  let config,closed=0,calls=0,opens=0;
  const pwaPeer={postMessage(data,target){assert.equal(target,appOrigin);if(data.type==='MT_REPORT_RESPONSE'){
    handlers.message({data:{...data,result:{ok:false}},origin:'https://evil.example',source:googlePeer});
    handlers.message({data:{...data,result:{ok:false}},origin:googleOrigin,source:{top:popup}});
    handlers.message({data:{...data,channel:'bad',result:{ok:false}},origin:googleOrigin,source:googlePeer});
  }handlers.message({data,origin:googleOrigin,source:googlePeer});}};
  const popup={closed:false,opener:pwaPeer,close(){this.closed=true;closed++;},postMessage(){}};popup.parent=popup;
  const googlePeer={top:popup,postMessage(data,target){assert.equal(target,googleOrigin);googleHandlers.message({data,origin:appOrigin,source:pwaPeer});}};
  pwaPeer.parent=pwaPeer;
  const timers=new Set();
  const timer=fn=>{timers.add(fn);return fn;};
  const clear=fn=>timers.delete(fn);
  const bridgeHtml=fs.readFileSync(path.join(root,'gas/dispatcher-report/Bridge.html'),'utf8');
  function open(url,target,features){if(features){assert(features.includes('noopener'));assert(features.includes('noreferrer'));return null;}opens++;const u=new URL(url);config={origin:u.searchParams.get('origin'),channel:u.searchParams.get('channel')};queueMicrotask(()=>{
    const boot={type:'MT_REPORT_BOOT',channel:config.channel};
    handlers.message({data:boot,origin:'https://evil.example',source:googlePeer});
    handlers.message({data:{...boot,channel:'bad'},origin:googleOrigin,source:googlePeer});
    handlers.message({data:boot,origin:googleOrigin,source:{top:{}}});
    const script=bridgeHtml.match(/<script>([\s\S]*?)<\/script>/)[1].replace('<?!= bridgeConfig ?>',JSON.stringify(config));
    let success;
    const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},reportDispatch(request){calls++;assert.equal(request.action,'report_status');success({ok:true,active_count:0});}};
    vm.runInNewContext(script,{window:{top:popup,parent:popup,addEventListener(type,fn){googleHandlers[type]=fn;}},document:{getElementById(){return {textContent:''};}},google:{script:{run:runner}}});
  });return popup;}
  const source=fs.readFileSync(path.join(root,'js/dispatcher-report-client.js'),'utf8');
  const start=source.indexOf('  function createBridge(){'),end=source.indexOf('  root.MTDispatcherReportClient=',start);
  assert(start>=0&&end>start);
  const context=vm.createContext({
    window:{open,addEventListener(type,fn){handlers[type]=fn;}},URL,crypto:webcrypto,
    location:{origin:appOrigin},setTimeout:timer,clearTimeout:clear,
    settings:{dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec'},
    endpoint:value=>new URL(value).href,
  });
  const security=fs.readFileSync(path.join(root,'js/security-hardening.js'),'utf8');
  const opener=security.match(/try\{\r?\n  const securityNativeOpen[\s\S]*?\n\}catch\(e\)\{[^\n]*\}/)[0];
  vm.runInContext(opener,context);
  assert.equal(context.window.open('https://example.com','_blank'),null);
  for(const value of [
    'https://example.com/?origin='+appOrigin+'&channel='+'a'.repeat(32),
    'https://script.google.com/macros/s/other/exec?origin='+appOrigin+'&channel='+'a'.repeat(32),
    'https://script.google.com/macros/s/synthetic/exec?origin=https://evil.example&channel='+'a'.repeat(32),
    'https://script.google.com/macros/s/synthetic/exec?origin='+appOrigin+'&channel=invalid',
    'https://script.google.com/macros/s/synthetic/exec?origin='+appOrigin+'&channel='+'a'.repeat(32)+'&extra=1',
    'https://user:password@script.google.com/macros/s/synthetic/exec?origin='+appOrigin+'&channel='+'a'.repeat(32),
    'https://script.google.com:444/macros/s/synthetic/exec?origin='+appOrigin+'&channel='+'a'.repeat(32),
  ])assert.throws(()=>context.window.MTDispatcherReportOpen(value),/INVALID_REPORT_WINDOW/);
  assert.equal(opens,0,'Invalid windows never reach native opener');
  const factory=vm.runInContext('(function(){'+source.slice(start,end)+'return createBridge;})()',context);
  const bridge=factory();
  await assert.rejects(bridge.send('https://script.google.com/macros/s/synthetic/exec',{action:'report_status'}),/GOOGLE_CONNECTION_REQUIRED/);
  assert.equal(opens,0,'Background saves must not open popup windows');
  const response=await bridge.send('https://script.google.com/macros/s/synthetic/exec',{action:'report_status'},true);
  assert.equal(response?.ok,true,'GAS response must reach the client with the same envelope field');
  assert.equal(response.active_count,0);
  assert.equal(calls,1);
  assert.equal(timers.size,0);
  const again=await bridge.send('https://script.google.com/macros/s/synthetic/exec',{action:'report_status'});
  assert.equal(again.ok,true);assert.equal(opens,1);assert.equal(calls,2);
  bridge.close();assert.equal(closed,1);
  console.log('Dispatcher actual HTML/client popup handshake + RPC + background safety + source/origin/nonce spoof rejection: PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

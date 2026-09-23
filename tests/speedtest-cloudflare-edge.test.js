'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const edge=require('../js/tools-speedtest-edge.js');

(async()=>{
  assert.deepEqual(edge.parseCloudflareTrace('ip=203.0.113.5\ncolo=KBP\nloc=UA\n'),{
    provider:'Cloudflare',colo:'KBP',countryCode:'UA',city:'Київ',country:'Україна',visitorCountryCode:'UA'
  });
  assert.deepEqual(edge.parseCloudflareTrace('colo=WAW\r\nloc=PL\r\n'),{
    provider:'Cloudflare',colo:'WAW',countryCode:'PL',city:'Варшава',country:'Польща',visitorCountryCode:'PL'
  });
  for(const [colo,city] of Object.entries({FRA:'Франкфурт',AMS:'Амстердам',PRG:'Прага',VIE:'Відень',BUD:'Будапешт',OTP:'Бухарест'})){
    assert.equal(edge.parseCloudflareTrace(`colo=${colo}\nloc=UA`).city,city,`${colo} has a Ukrainian city label`);
  }
  assert.deepEqual(edge.parseCloudflareTrace('colo=XYZ\nloc=UA'),{
    provider:'Cloudflare',colo:'XYZ',countryCode:'',city:'',country:'',visitorCountryCode:'UA'
  });
  assert.equal(edge.parseCloudflareTrace('colo=WAW\nloc=UA').country,'Польща','visitor location cannot relabel the Warsaw edge');
  assert.equal(edge.parseCloudflareTrace('not a trace'),null);
  assert.equal(edge.parseCloudflareTrace('colo=<script>\nloc=UA'),null);
  assert.equal(await edge.fetchCloudflareEdgeInfo({fetchFn:async()=>{throw new Error('offline');}}),null);
  assert.equal(await edge.fetchCloudflareEdgeInfo({fetchFn:async()=>({ok:false,status:503})}),null);
  assert.equal(await edge.fetchCloudflareEdgeInfo({fetchFn:async()=>({ok:true,text:async()=>'<html>oops</html>'})}),null);

  let traceRequests=0,measurementRuns=0,rendered='';
  const responses=['colo=KBP\nloc=UA','colo=XYZ\nloc=UA','malformed','NETWORK_ERROR','HTTP_ERROR'];
  const context={AbortController,setTimeout,clearTimeout,console,navigator:{onLine:true},toolsView:'speedtest',
    escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    showToast:()=>{throw new Error('Speedtest must not be interrupted by trace');},
    MTSpeedtestEdge:{fetchCloudflareEdgeInfo:options=>edge.fetchCloudflareEdgeInfo({...options,fetchFn:async(url,init)=>{
      traceRequests++;
      assert.equal(url,edge.TRACE_URL);
      assert.equal(init.cache,'no-store');
      const body=responses[traceRequests-1];
      await new Promise(resolve=>setTimeout(resolve,5));
      if(body==='NETWORK_ERROR')throw new Error('network offline');
      if(body==='HTTP_ERROR')return{ok:false,status:503};
      return{ok:true,text:async()=>body};
    }})},
    MTSpeedtest:{create:async({onFinish})=>({play(){measurementRuns++;onFinish({ok:'full',downloadMbps:333.6,uploadMbps:112.48,latencyMs:18});},pause(){}})},
    renderToolsScreen(){rendered=context.toolsSpeedtestResultsHtml(vm.runInContext('toolsSpeedtestState.last',context));}
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/tools-speedtest-ui.js'),'utf8'),context);
  for(let run=1;run<=5;run++){
    await context.toolsSpeedtestStart();
    await new Promise(resolve=>setTimeout(resolve,15));
    assert.equal(traceRequests,run,'exactly one trace request per speedtest run');
    assert.equal(measurementRuns,run,'measurement still runs with trace metadata or malformed trace');
    assert.match(rendered,/333\.6/);
    assert.match(rendered,/112\.48/);
  }
  assert.match(context.toolsSpeedtestResultsHtml({result:{ok:'full',downloadMbps:1},edgeInfo:edge.parseCloudflareTrace('colo=KBP\nloc=UA')}),/Київ \(KBP\).*Україна.*Автоматично/);
  assert.match(context.toolsSpeedtestResultsHtml({result:{ok:'full',downloadMbps:1},edgeInfo:edge.parseCloudflareTrace('colo=WAW\nloc=PL')}),/Варшава \(WAW\).*Польща/);
  const unknownHtml=context.toolsSpeedtestResultsHtml({result:{ok:'full',downloadMbps:1},edgeInfo:edge.parseCloudflareTrace('colo=XYZ\nloc=UA')});
  assert.match(unknownHtml,/Сервер: Cloudflare · XYZ · Автоматично/);
  assert.doesNotMatch(unknownHtml,/Країна клієнта|Україна|Місто|Київ|Варшава/,'visitor country is never presented as edge country');
  assert.match(rendered,/Сервер: Cloudflare · Автоматично/,'malformed trace leaves speed result intact with fallback');
  console.log('PASS Cloudflare trace edge: known/unknown colo, network/HTTP/malformed fallback, one request per run, final UI');
})().catch(error=>{console.error(error);process.exitCode=1;});

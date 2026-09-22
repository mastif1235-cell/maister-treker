'use strict';
/* v91.66: обгортка Cloudflare-движка на фейковому engine (без мережі).
   Контракти: легкий профіль (≈27 МБ стеля), прогрес-стадії з подій движка
   (жодного фейкового прогресу), нормалізація одиниць, відсутні метрики = null,
   packet loss ніколи не вигадується, скасований тест не стає результатом. */
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

function load(extra={}){
  const context=Object.assign({console:{log(){},warn(){},error(){}},Date},extra);
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('js/tools-network-utils.js'),context,{filename:'tools-network-utils.js'});
  vm.runInContext(read('js/tools-speedtest.js'),context,{filename:'tools-speedtest.js'});
  return context;
}

function fakeEngine(resultsOverrides){
  const calls={play:0,pause:0};
  const engine={
    config:null,
    calls,
    results:{
      getDownloadBandwidth:()=>resultsOverrides.downloadBps,
      getUploadBandwidth:()=>resultsOverrides.uploadBps,
      getUnloadedLatency:()=>resultsOverrides.latencyMs,
      getUnloadedJitter:()=>resultsOverrides.jitterMs,
      getDownLoadedLatency:()=>resultsOverrides.downLoadedMs,
      getUpLoadedLatency:()=>resultsOverrides.upLoadedMs
    },
    isRunning:()=>false,
    play(){calls.play++;},
    pause(){calls.pause++;},
    onResultsChange:null,onRunningChange:null,onFinish:null,onError:null
  };
  return engine;
}

(async()=>{
  const mod=load().MTSpeedtest;

  /* 1. Профіль: легкий, без packet loss, стеля трафіку */
  assert.equal(mod.LIGHT_PROFILE.some(set=>set.type==='packetLoss'),false,'no packet-loss set: the public loss source is gone, no own TURN');
  assert.equal(mod.LIGHT_PROFILE[0].type,'latency');
  const maxBytes=mod.profileMaxBytes();
  assert.ok(maxBytes<=28e6,'light profile stays ≈27 МБ worst case, got '+(maxBytes/1e6).toFixed(1)+' МБ');
  assert.ok(maxBytes>=15e6,'still enough traffic for a real estimate');

  /* 2. Фабрика: engine создаётся и управляется (play/pause), рестарт после отмены разрешён */
  {
    const seen=[];
    const handle=await mod.create({engineFactory:async()=>{
      seen.push('called');
      return fakeEngine({});
    }});
    assert.deepEqual(seen,['called']);
    assert.equal(typeof handle.play,'function');
    assert.equal(typeof handle.pause,'function');
    handle.play();
    handle.pause();
  }

  /* 3. Прогрес: стадії ONLY з подій движка */
  {
    const stages=[];
    const engine=fakeEngine({});
    const handle=await mod.create({
      engineFactory:async()=>engine,
      onStage:(text,type)=>stages.push([text,type])
    });
    engine.onResultsChange({type:'latency'});
    engine.onResultsChange({type:'download'});
    engine.onResultsChange({type:'upload'});
    assert.deepEqual(stages.map(pair=>pair[1]),['latency','download','upload']);
    assert.equal(stages[1][0],'Завантаження…');
    assert.equal(stages[2][0],'Відвантаження…');
  }

  /* 4. Живе значення під час тесту йде в onLive у Мбіт/с */
  {
    const engine=fakeEngine({downloadBps:427.4e6});
    const live=[];
    const handle=await mod.create({engineFactory:async()=>engine,onLive:(mbps,type)=>live.push([mbps,type])});
    engine.onResultsChange({type:'download'});
    assert.deepEqual(live[0],[427.4,'download']);
  }

  /* 5. Успішне завершення: нормалізація з реальних гетерів, одиниці вірні */
  {
    const engine=fakeEngine({downloadBps:427.4e6,uploadBps:312e6,latencyMs:14.4,jitterMs:3.2,downLoadedMs:32,upLoadedMs:28});
    let finalResult=null;
    const handle=await mod.create({engineFactory:async()=>engine,onFinish:result=>{finalResult=result;}});
    engine.onFinish(engine.results);
    assert.ok(finalResult);
    assert.equal(finalResult.downloadMbps,427.4);
    assert.equal(finalResult.uploadMbps,312);
    assert.equal(finalResult.latencyMs,14);
    assert.equal(finalResult.jitterMs,3);
    assert.equal(finalResult.loadedLatencyMs,32,'max(down,up) loaded');
    assert.equal(finalResult.loadedDownMs,32);
    assert.equal(finalResult.loadedUpMs,28);
    assert.equal(finalResult.provider,'cloudflare');
    assert.equal('packetLoss' in finalResult,false,'no faked loss, ever');
    assert.equal('loss' in finalResult,false);
  }

  /* 6. Відсутні метрики → null (UI їх не малює), жодних нулів-підробок */
  {
    const normalized=mod.normalizeResults({});
    assert.equal(normalized.downloadMbps,null);
    assert.equal(normalized.uploadMbps,null);
    assert.equal(normalized.latencyMs,null);
    assert.equal(normalized.loadedLatencyMs,null);
    assert.equal(normalized.jitterMs,null);
    const normalized2=mod.normalizeResults(null);
    assert.equal(normalized2.downloadMbps,null);
  }

  /* 7. Помилка движка → human callback */
  {
    const engine=fakeEngine({});
    let errorText=null;
    const handle=await mod.create({engineFactory:async()=>engine,onError:message=>{errorText=message;}});
    engine.onError('network unreachable');
    assert.equal(errorText,'network unreachable');
  }

  /* 8. Скасування: pause() → onFinish після нього ІГНОРУЄТЬСЯ (незавершений
     тест ніколи не стає результатом) */
  {
    const engine=fakeEngine({});
    let finished=false;
    const handle=await mod.create({engineFactory:async()=>engine,onFinish:()=>{finished=true;}});
    handle.play();
    handle.pause();
    assert.equal(engine.calls.pause,1);
    engine.onFinish(engine.results);
    assert.equal(finished,false,'cancelled run produces no result');
    /* restart after cancel is allowed by a fresh handle (UI: «Повторити») */
    handle.play();
    assert.equal(engine.calls.play,2);
  }

  console.log('PASS network tools speedtest: light profile (≤28 МБ) без packet loss, stages only from engine events, honest units/missing metrics, cancel never fabricates a result');
})().catch(error=>{console.error('FAIL:',error);process.exit(1);});

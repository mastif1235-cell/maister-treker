/* Speedtest: engine wrapper only, no DOM.
   The vendored @cloudflare/speedtest module is the measurement engine; this
   file owns the light measurement profile, event normalization and cancel.
   The engine is loaded through a dynamic import ('self' scope, precached),
   and tests inject a fake engine factory instead. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTSpeedtest=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const ENGINE_MODULE_URL='../vendor/cloudflare-speedtest/speedtest.js';

  /* Light profile for a phone: a normal test stays ≈15–25 МБ, the hard cap
     (every set runs to its count) is ≈27 МБ. Gigabit lines will read lower
     than a full test — that trade-off is deliberate and disclosed. */
  const LIGHT_PROFILE=[
    {type:'latency',numPackets:20},
    {type:'download',bytes:1e5,count:3},
    {type:'download',bytes:1e6,count:3},
    {type:'download',bytes:1e7,count:2},
    {type:'upload',bytes:1e5,count:3},
    {type:'upload',bytes:1e6,count:3}
  ];

  /* Worst-case bytes = profileMaxBytes() (download 0,3+3+20 МБ + upload 3,3 МБ ≈ 27 МБ). */
  const STAGES={latency:'Перевірка відгуку…',download:'Завантаження…',upload:'Відвантаження…'};

  function profileMaxBytes(){
    let total=0;
    for(const set of LIGHT_PROFILE)total+=(set.bytes||0)*(set.count||0);
    return total;
  }

  /* Engine results → the five honest numbers the UI shows. Packet loss is
     deliberately NOT read: the public loss source is deprecated and there is
     no own TURN server, so no loss value is ever produced or faked. */
  function normalizeResults(results){
    const read=name=>results&&typeof results[name]==='function'?results[name]():NaN;
    const toMs=value=>Number.isFinite(value)&&value>=0?Math.round(value):null;
    const toMbps=value=>{if(!Number.isFinite(value)||value<=0)return null;return Math.round(value/1e6*10)/10;};
    const downLoaded=Number(read('getDownLoadedLatency')),upLoaded=Number(read('getUpLoadedLatency'));
    const loaded=[downLoaded,upLoaded].filter(Number.isFinite);
    return{
      downloadMbps:toMbps(Number(read('getDownloadBandwidth'))),
      uploadMbps:toMbps(Number(read('getUploadBandwidth'))),
      latencyMs:toMs(Number(read('getUnloadedLatency'))),
      jitterMs:toMs(Number(read('getUnloadedJitter'))),
      loadedLatencyMs:loaded.length?toMs(Math.max(...loaded)):null,
      loadedDownMs:toMs(downLoaded),
      loadedUpMs:toMs(upLoaded),
      provider:'cloudflare'
    };
  }

  /* Creates a prepared engine with callbacks wired. Returns {play, pause}.
     options.engineFactory lets tests supply a fake engine. */
  async function create(options={}){
    const utils=options.utils||(typeof MTNetUtils!=='undefined'?MTNetUtils:null);
    const onStage=options.onStage||function(){},onLive=options.onLive||function(){};
    const onFinish=options.onFinish||function(){},onError=options.onError||function(){};
    let engineFactory=options.engineFactory;
    if(!engineFactory)engineFactory=async()=>{
      const mod=await import(ENGINE_MODULE_URL);
      return new mod.default({
        autoStart:false,
        measurements:LIGHT_PROFILE.slice(),
        logAimApiUrl:null, // don't hand the summary of this private test to the results log
        measureDownloadLoadedLatency:true,
        measureUploadLoadedLatency:true
      });
    };
    const engine=await engineFactory();
    let finished=false,paused=false;
    engine.onResultsChange=info=>{
      const type=info&&info.type;
      if(STAGES[type])onStage(STAGES[type],type);
      if(utils&&(type==='download'||type==='upload')&&engine.results&&typeof engine.results.getDownloadBandwidth==='function'){
        const mbps=utils.bpsToMbps(Number(engine.results.getDownloadBandwidth()));
        if(mbps)onLive(mbps,type);
      }
    };
    engine.onRunningChange=running=>{if(!running&&!finished)onStage('Завершення…');};
    engine.onFinish=results=>{
      if(paused)return; // cancelled run never becomes a result
      finished=true;
      onStage('Готово');
      onFinish(normalizeResults(results&&typeof results.getSummary==='function'?results.getSummary():results));
    };
    engine.onError=message=>{if(paused)return;finished=true;onError(String(message||''));};
    return{
      play(){paused=false;try{engine.play();}catch(error){onError(String(error&&error.message||error));}},
      pause(){paused=true;try{engine.pause();}catch(_error){}onStage('');},
      isRunning(){return engine.isRunning?!!engine.isRunning():false;}
    };
  }

  return{LIGHT_PROFILE,STAGES,ENGINE_MODULE_URL,profileMaxBytes,normalizeResults,create};
});

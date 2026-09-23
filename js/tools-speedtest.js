/* Speedtest: власний адаптивний multi-stream рушій поверх speed.cloudflare.com
   (__down/__up — ті самі ендпоинти, що використовує Cloudflare у браузері).
   Чому не @cloudflare/speedtest: (1) його packet loss-фаза вимагає TURN
   (__turn-creds тепер 404) і ЛЮБА помилка одного subtest'а фатально вбиває
   весь тест; (2) короткі фіксовані чанки не встигають стабілізуватись на
   300–1000 Мбіт/с. Тут: часові вікна (~8 с завантаження, ~6 с відвантаження),
   до 6 паралельних потоків, жорсткі ліміти часу/об'єму, а кожна фаза
   незалежна — невдача відвантаження/відгуку не стирає успішне завантаження.
   Packet loss не вимірюється і не імітується. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTSpeedtest=api;
})(typeof globalThis!=='undefined'?globalThis:function(){return{};},function(){
  'use strict';

  const DEFAULTS={
    warmupBytes:250e3,      // прогрів з'єднання (не враховується у вимірюванні)
    probeBytes:1e6,         // розвідний запит для вибору потоків/чанків
    latencyProbes:8,
    latencyTimeoutMs:4000,
    loadedLatencyProbes:3,
    downloadWindowMs:8000,  // орієнтир по часу, а не по одному файлу
    downloadMaxBytes:400e6, // жорсткий ліміт об'єму
    downloadRoundsMax:12,
    uploadWindowMs:6000,
    uploadMaxBytes:150e6,
    uploadRoundsMax:12,
    requestTimeoutMs:15000,
    now:()=>(typeof performance!=='undefined'?performance.now():Date.now())
  };

  const downUrl=bytes=>`https://speed.cloudflare.com/__down?bytes=${bytes}&_=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const upUrl=bytes=>`https://speed.cloudflare.com/__up?_=${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function chooseDownShape(mbps){
    if(mbps>=250)return{streams:6,chunk:32e6};
    if(mbps>=100)return{streams:4,chunk:16e6};
    if(mbps>=30)return{streams:3,chunk:8e6};
    if(mbps>=8)return{streams:2,chunk:4e6};
    return{streams:1,chunk:2e6};
  }
  function chooseUpShape(mbps){
    if(mbps>=150)return{streams:3,chunk:12e6};
    if(mbps>=40)return{streams:2,chunk:8e6};
    if(mbps>=10)return{streams:2,chunk:3e6};
    return{streams:1,chunk:1e6};
  }

  /* Кумулятивна шкала (час,байти) швидкість рахуємо після прогрівного вікна —
     перші частки секунди занижують середнє на повільному старті TCP/TLS. */
  function makeTimeline(){
    const points=[{t:0,bytes:0}];
    let total=0;
    return{
      add(bytes,t){total+=bytes;points.push({t,bytes:total});},
      total:()=>total,
      speed(warmupMs=1000){
        const end=points[points.length-1];
        if(end.bytes<=0||end.t<=0)return null;
        const baseT=Math.min(warmupMs,end.t*0.25);
        let base=points[0];
        for(const p of points){if(p.t<=baseT)base=p;else break;}
        const dt=(end.t-base.t)/1000;
        if(dt<=0.15)return null;
        return Math.round((end.bytes-base.bytes)*8/dt/1e4)/100; // Мбіт/с, 0.1
      }
    };
  }

  async function create(options={}){
    const cfg=Object.assign({},DEFAULTS,options);
    const now=cfg.now;
    const fetchFn=options.fetch||globalThis.fetch;
    const onStage=options.onStage||function(){};
    const onLive=options.onLive||function(){};
    const onFinish=options.onFinish||function(){};
    const onError=options.onError||function(){};

    let controller=null,paused=false,running=false;

    /* Один запит з таймаутом; для завантаження байти рахуються по мірі
       надходження (reader), щоб живий спидометр і швидкість були чесними. */
    async function downloadOnce(url,timeoutMs,signal,onBytes){
      const reqController=typeof AbortController==='function'?new AbortController():null;
      const timer=setTimeout(()=>reqController&&reqController.abort(),timeoutMs);
      const onAbort=()=>reqController&&reqController.abort();
      if(signal)signal.addEventListener('abort',onAbort,{once:true});
      try{
        const response=await fetchFn(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:reqController?reqController.signal:undefined});
        if(!response.ok)throw new Error('HTTP_'+response.status);
        if(!response.body||typeof response.body.getReader!=='function'){
          const buffer=await response.arrayBuffer();
          if(onBytes)onBytes(buffer.byteLength,now());
          return{ok:true,bytes:buffer.byteLength};
        }
        const reader=response.body.getReader();
        let bytes=0;
        for(;;){
          const chunk=await reader.read();
          if(chunk.done)break;
          bytes+=chunk.value.byteLength;
          if(onBytes)onBytes(chunk.value.byteLength,now());
          if(signal&&signal.aborted){try{reader.cancel();}catch(_e){}return{ok:false,bytes};}
        }
        return{ok:true,bytes};
      }finally{
        clearTimeout(timer);
        if(signal)signal.removeEventListener('abort',onAbort);
      }
    }

    let upPayload=null;
    async function uploadOnce(bytes,timeoutMs,signal){
      if(!upPayload||upPayload.length<bytes)upPayload=new Uint8Array(bytes);
      const reqController=typeof AbortController==='function'?new AbortController():null;
      const timer=setTimeout(()=>reqController&&reqController.abort(),timeoutMs);
      const onAbort=()=>reqController&&reqController.abort();
      if(signal)signal.addEventListener('abort',onAbort,{once:true});
      try{
        const response=await fetchFn(upUrl(bytes),{method:'POST',headers:{'content-type':'application/octet-stream'},body:upPayload.subarray(0,bytes),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:reqController?reqController.signal:undefined});
        if(!response.ok)throw new Error('HTTP_'+response.status);
        try{if(response.arrayBuffer)await response.arrayBuffer();}catch(_e){} // чекаємо підтвердження прийому
        return{ok:true,bytes};
      }finally{
        clearTimeout(timer);
        if(signal)signal.removeEventListener('abort',onAbort);
      }
    }

    async function latencyProbe(timeoutMs,signal){
      const started=now();
      const reqController=typeof AbortController==='function'?new AbortController():null;
      const timer=setTimeout(()=>reqController&&reqController.abort(),timeoutMs);
      const onAbort=()=>reqController&&reqController.abort();
      if(signal)signal.addEventListener('abort',onAbort,{once:true});
      try{
        const response=await fetchFn(downUrl(0),{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:reqController?reqController.signal:undefined});
        if(!response.ok)throw new Error('HTTP_'+response.status);
        try{if(response.arrayBuffer)await response.arrayBuffer();}catch(_e){}
        return Math.max(1,Math.round(now()-started));
      }catch(_error){return null;}
      finally{
        clearTimeout(timer);
        if(signal)signal.removeEventListener('abort',onAbort);
      }
    }

    function median(values){
      const sorted=[...values].sort((a,b)=>a-b);
      return sorted[Math.floor((sorted.length-1)/2)];
    }

    async function run(){
      running=true;
      controller=typeof AbortController==='function'?new AbortController():null;
      const signal=controller?controller.signal:null;
      const aborted=()=>!signal||signal.aborted;
      const result={ok:false,provider:'cloudflare',downloadMbps:null,uploadMbps:null,latencyMs:null,jitterMs:null,loadedLatencyMs:null,bytesDown:0,bytesUp:0,downloadOk:false,uploadOk:false,latencyOk:false,warnings:[]};
      try{
        /* Підготовка: прогрів (у вимірювання не йде, невдача не фатальна) */
        onStage('Підготовка…','prepare');
        try{await downloadOnce(downUrl(cfg.warmupBytes),cfg.requestTimeoutMs,signal,null);}catch(_error){}

        /* Перевірка відгуку (без навантаження) */
        onStage('Перевірка відгуку…','latency');
        const samples=[];
        for(let i=0;i<cfg.latencyProbes&&!aborted();i++){
          const ms=await latencyProbe(cfg.latencyTimeoutMs,signal);
          if(ms!=null)samples.push(ms);
        }
        if(!aborted()){
          if(samples.length){
            result.latencyOk=true;
            result.latencyMs=median(samples);
            if(samples.length>1){
              let sum=0;
              for(let i=1;i<samples.length;i++)sum+=Math.abs(samples[i]-samples[i-1]);
              result.jitterMs=Math.round(sum/(samples.length-1));
            }
          }else result.warnings.push('відгук виміряти не вдалося');
        }
        if(aborted())return;

        /* Завантаження: розвідка → адаптивні паралельні раунди в часовому вікні */
        onStage('Завантаження…','download');
        const downTimeline=makeTimeline();
        const downStart=now();
        let lastLive=0;
        const downOnBytes=(bytes,t)=>{
          downTimeline.add(bytes,t-downStart);
          const tNow=now();
          if(tNow-lastLive>250){
            lastLive=tNow;
            const live=downTimeline.speed(400);
            if(live)onLive(live,'download');
          }
        };
        let probeSpeed=null;
        try{
          const probeStart=now();
          const probe=await downloadOnce(downUrl(cfg.probeBytes),cfg.requestTimeoutMs,signal,(bytes,t)=>{downTimeline.add(bytes,t-downStart);});
          if(probe.ok){
            const elapsed=Math.max(1,now()-probeStart);
            probeSpeed=probe.bytes*8/(elapsed/1000)/1e6;
          }
        }catch(_error){}
        if(aborted())return;
        if(probeSpeed==null){
          result.warnings.push('завантаження виміряти не вдалося');
        }else{
          const shape=chooseDownShape(probeSpeed);
          let rounds=0;
          while(!aborted()&&rounds<cfg.downloadRoundsMax&&(now()-downStart)<cfg.downloadWindowMs&&downTimeline.total()+shape.chunk*shape.streams<=cfg.downloadMaxBytes){
            const attempts=[];
            for(let s=0;s<shape.streams;s++)attempts.push(downloadOnce(downUrl(shape.chunk),cfg.requestTimeoutMs,signal,downOnBytes).catch(()=>({ok:false,bytes:0})));
            const settled=await Promise.all(attempts);
            const good=settled.filter(item=>item.ok);
            if(!good.length)break; // мережа відвалилась — беремо те, що встигли наміряти
            rounds++;
          }
          if(aborted())return;
          const speed=downTimeline.speed(Math.min(1000,(now()-downStart)*0.25));
          if(speed!=null&&downTimeline.total()>0){
            result.downloadOk=true;
            result.downloadMbps=Math.max(1,Math.round(speed*10)/10);
            result.bytesDown=downTimeline.total();
          }else result.warnings.push('завантаження виміряти не вдалося');
          /* Відгук під навантаженням: короткі проби під час каналу, що завантажується */
          if(result.downloadOk){
            const loaded=[];
            for(let i=0;i<cfg.loadedLatencyProbes&&!aborted();i++){
              const ms=await latencyProbe(cfg.latencyTimeoutMs,signal);
              if(ms!=null)loaded.push(ms);
            }
            if(loaded.length)result.loadedLatencyMs=median(loaded);
          }
        }
        if(aborted())return;

        /* Відвантаження: та сама схема, невдача не стирає завантаження */
        onStage('Відвантаження…','upload');
        let upProbeSpeed=null;
        try{
          const probeStart=now();
          const probe=await uploadOnce(cfg.probeBytes,cfg.requestTimeoutMs,signal);
          const elapsed=Math.max(1,now()-probeStart);
          upProbeSpeed=probe.bytes*8/(elapsed/1000)/1e6;
        }catch(_error){}
        if(aborted())return;
        if(upProbeSpeed==null){
          result.warnings.push('відвантаження виміряти не вдалося');
        }else{
          const shape=chooseUpShape(upProbeSpeed);
          const upStart=now();
          let rounds=0;
          while(!aborted()&&rounds<cfg.uploadRoundsMax&&(now()-upStart)<cfg.uploadWindowMs&&result.bytesUp+shape.chunk*shape.streams<=cfg.uploadMaxBytes){
            const attempts=[];
            for(let s=0;s<shape.streams;s++)attempts.push(uploadOnce(shape.chunk,cfg.requestTimeoutMs,signal).catch(()=>({ok:false,bytes:0})));
            const settled=await Promise.all(attempts);
            const good=settled.filter(item=>item.ok);
            for(const item of good)result.bytesUp+=item.bytes;
            if(!good.length)break;
            onLive(null,'upload');
            rounds++;
          }
          if(aborted())return;
          const elapsed=(now()-upStart)/1000;
          if(result.bytesUp>0&&elapsed>0.2){
            result.uploadOk=true;
            result.uploadMbps=Math.max(1,Math.round(result.bytesUp*8/elapsed/1e4)/100);
          }else result.warnings.push('відвантаження виміряти не вдалося');
        }

        const measured=[result.downloadOk,result.uploadOk,result.latencyOk].filter(Boolean).length;
        if(!measured){
          onError('Не вдалося виміряти швидкість: мережа недоступна');
          return;
        }
        result.ok=measured===3?'full':'partial';
        onStage('Готово');
        onFinish(result);
      }catch(error){
        if(aborted()||paused)return;
        onError(String(error&&error.message||error));
      }finally{running=false;}
    }

    return{
      play(){if(paused||running)return;run();},
      pause(){paused=true;try{controller&&controller.abort();}catch(_e){}},
      isRunning(){return running;}
    };
  }

  return{DEFAULTS,downUrl,upUrl,chooseDownShape,chooseUpShape,makeTimeline,create};
});

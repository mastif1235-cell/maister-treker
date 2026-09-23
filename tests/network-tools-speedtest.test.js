'use strict';
/* v91.67: власний адаптивний multi-stream speedtest (speed.cloudflare.com).
   Ключові контракти:
   - часові вікна (~8 с download), до 6 потоків, жорсткі ліміти часу/об'єму;
   - проміжний (live) результат не зникає: успішне завантаження стає
     фінальним результатом навіть якщо відвантаження/відгук не вдались;
   - Stop/abort миттєво зупиняє всі потоки і не створює результату;
   - повторний запуск працює; одиниці — Мбіт/с; packet loss не імітується. */
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

/* Фейковий годинник + фейковий fetch: байти «надходять» шматками, кожен
   шматок просуває годинник → швидкість детермінована. */
function makeEnv({downMbps=1000,upMbps=null,failDown=false,failUp=false,failLatency=false,hangAll=false,perChunkMs=8,chunkServe=1e6,signalAware=true}={}){
  const clock={t:0};
  const calls=[];
  function stream(total,advance){
    let sent=0;
    return{
      read:async()=>{
        if(signalAware&&env.currentSignal&&env.currentSignal.aborted){const e=new Error('AbortError');throw e;}
        if(sent>=total){return{done:true};}
        const size=Math.min(chunkServe,total-sent);
        sent+=size;
        clock.t+=advance;
        return{done:false,value:new Uint8Array(size)};
      },
      cancel:async()=>{sent=total;}
    };
  }
  const env={
    clock,
    calls,
    currentSignal:null,
    fetch:async(url,init)=>{
      calls.push({url:String(url),method:(init&&init.method)||'GET'});
      env.currentSignal=(init&&init.signal)||env.currentSignal;
      if(hangAll){
        return new Promise((_resolve,reject)=>{
          if(init&&init.signal)init.signal.addEventListener('abort',()=>reject(new Error('AbortError')));
        });
      }
      const u=new URL(String(url));
      const plain={ok:true,arrayBuffer:async()=>new ArrayBuffer(0)};
      if(u.pathname.includes('__down')){
        if(failLatency&&Number(u.searchParams.get('bytes'))===0)throw new Error('latency down');
        if(failDown&&Number(u.searchParams.get('bytes'))>0)throw new Error('download fail');
        const bytes=Number(u.searchParams.get('bytes'))||0;
        if(bytes===0){clock.t+=perChunkMs;return Object.assign({},plain,{body:{getReader:()=>stream(0,0)}});}
        /* швидкість = chunkServe*8/perChunkMs*1000 Мбіт/с */
        return Object.assign({},plain,{body:{getReader:()=>stream(bytes,perChunkMs)}});
      }
      if(u.pathname.includes('__up')){
        if(failUp)throw new Error('upload fail');
        const sent=Number((init&&init.body&&init.body.length)||0);
        clock.t+=sent*8/(upMbps*1000); // мс на відправку: bytes*8/(Мбіт/с * 1000)
        return Object.assign({},plain,{body:{getReader:()=>stream(0,0)}});
      }
      throw new Error('unexpected url '+url);
    }
  };
  return env;
}

function load(envOptions){
  const env=makeEnv(envOptions);
  const context=Object.assign({console:{log(){},warn(){},error(){}},Date,URL,AbortController,ReadableStream,setTimeout,clearTimeout,performance:{now:()=>env.clock.t}},env);
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('js/tools-network-utils.js'),context,{filename:'tools-network-utils.js'});
  vm.runInContext(read('js/tools-speedtest.js'),context,{filename:'tools-speedtest.js'});
  return{context,env};
}

function runOnce(context,envOptions,hooks){
  hooks=hooks||{};
  const events={live:[],stages:[],finish:[],error:[]};
  return new Promise(async resolve=>{
    const done=()=>resolve(events);
    const guard=setTimeout(done,10000); // страховка от зависания
    const handle=await context.MTSpeedtest.create(Object.assign({
      fetch:hooks.fetchOverride||context.fetch,
      downloadWindowMs:hooks.windowMs||8000,
      uploadWindowMs:hooks.windowMs||8000,
      onStage:(text,type)=>events.stages.push(type),
      onLive:mbps=>events.live.push(mbps),
      onFinish:result=>{events.finish.push(result);clearTimeout(guard);done();},
      onError:message=>{events.error.push(message);clearTimeout(guard);done();}
    },hooks.createOverride||{}));
    handle.play();
  });
}

(async()=>{
  const mod=load({}).context.MTSpeedtest;

  /* 0. Конфігурація за замовчуванням відповідає новим вимогам */
  assert.equal(mod.DEFAULTS.downloadWindowMs,8000,'~8 с завантаження');
  assert.equal(mod.DEFAULTS.uploadWindowMs,6000,'~6 с відвантаження');
  assert.equal(mod.DEFAULTS.downloadMaxBytes,400e6,'ліміт об\'єму download ~400 МБ');
  assert.equal(mod.DEFAULTS.uploadMaxBytes,150e6,'ліміт об\'єму upload ~150 МБ');
  assert.equal(mod.chooseDownShape(1000).streams,6,'гігабіт → 6 потоків');
  assert.equal(mod.chooseDownShape(500).streams,6,'500 Мбіт/с → 6 потоків');
  assert.equal(mod.chooseDownShape(300).streams,6,'300 Мбіт/с → 6 потоків');
  assert.equal(mod.chooseDownShape(700).chunk,32e6,'700 Мбіт/с → великі чанки 32 МБ');
  assert.equal(mod.chooseDownShape(100).streams,4);
  assert.equal(mod.chooseUpShape(500).streams,3,'500 Мбіт/с upload → 3 потоки');
  assert.match(mod.downUrl(5),/^https:\/\/speed\.cloudflare\.com\/__down\?bytes=5/,'єдиний endpoint — Cloudflare');

  /* 1-2. Успішний тест на ~1 Гбіт/с: проміжні live-значення існують І
     фінальний результат успішний (проміжний не зникає) */
  {
    const {context}=load({downMbps:1000,upMbps:1000});
    const events=await runOnce(context,{windowMs:8000});
    assert.equal(events.error.length,0,'жодних фатальних помилок на гігабіті: '+events.error.join('|'));
    assert.equal(events.finish.length,1);
    const result=events.finish[0];
    assert.equal(result.ok,'full');
    assert.ok(events.live.some(mbps=>mbps>0),'проміжні значення показувались');
    assert.ok(result.downloadMbps>=800,'~1 Гбіт/с виміряно чесно, отримано '+result.downloadMbps);
    assert.ok(result.uploadMbps>=800,'upload ~1 Гбіт/с, отримано '+result.uploadMbps);
    assert.equal(result.downloadMbps,Math.round(result.downloadMbps*10)/10,'значення округлене до 0.1 Мбіт/с');
    assert.ok(result.bytesDown<=400e6+64e6,'жорсткий ліміт об\'єму дотриманий (±останній раунд)');
    assert.ok(result.latencyMs>=1&&result.jitterMs!=null);
    assert.equal(result.provider,'cloudflare');
    assert.equal('packetLoss' in result,false,'packet loss не додається і не імітується');
    assert.ok(events.stages.includes('prepare')&&events.stages.includes('latency')&&events.stages.includes('download')&&events.stages.includes('upload'),'стадії з реальних подій: '+events.stages.join(','));
    const downCalls=context.calls.filter(c=>c.url.includes('__down?bytes=')&&!c.url.includes('bytes=0'));
    assert.ok(downCalls.length>=4,'багато паралельних запитів, а не один маленький файл: '+downCalls.length);
  }

  /* 3-5. Невдача відвантаження/відгуку НЕ стирає успішне завантаження */
  {
    const {context}=load({downMbps:500,failUp:true});
    const events=await runOnce(context,{});
    assert.equal(events.error.length,0,'частковий успіх — це не помилка');
    assert.equal(events.finish.length,1);
    const result=events.finish[0];
    assert.equal(result.ok,'partial');
    assert.ok(result.downloadMbps>0,'успішне завантаження збережено: '+result.downloadMbps);
    assert.equal(result.uploadMbps,null);
    assert.ok(result.warnings.some(w=>/відвантаження/.test(w)),'чесне попередження про відвантаження');
  }
  {
    const {context}=load({downMbps:300,failLatency:true});
    const events=await runOnce(context,{});
    assert.equal(events.error.length,0);
    const result=events.finish[0];
    assert.equal(result.ok,'partial');
    assert.ok(result.downloadMbps>0);
    assert.equal(result.latencyMs,null);
  }
  {
    const {context}=load({downMbps:300,failUp:true,failLatency:true});
    const events=await runOnce(context,{});
    const result=events.finish[0];
    assert.equal(result.ok,'partial');
    assert.ok(result.downloadMbps>0,'лише download — все ще результат');
  }

  /* 6. Abort/Stop: миттєво, без фінального результату */
  {
    const {context,env}=load({hangAll:true});
    const events={live:[],stages:[],finish:[],error:[]};
    const handle=await context.MTSpeedtest.create({
      fetch:context.fetch,
      onStage:()=>{},onLive:()=>{},
      onFinish:r=>events.finish.push(r),
      onError:m=>events.error.push(m)
    });
    handle.play();
    await new Promise(resolve=>setTimeout(resolve,30));
    handle.pause();
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(events.finish.length,0,'скасований тест не стає результатом');
    assert.equal(events.error.length,0,'скасування — не помилка');
    assert.equal(handle.isRunning(),false);
  }

  /* 7. Таймаут: завислі запити не вішають тест назавжди */
  {
    const {context}=load({});
    const events={live:[],stages:[],finish:[],error:[]};
    let timeoutFired=false;
    const hangingFetch=async(url,init)=>new Promise((_resolve,reject)=>{
      if(init&&init.signal)init.signal.addEventListener('abort',()=>{timeoutFired=true;reject(new Error('AbortError'));});
    });
    const handle=await context.MTSpeedtest.create({
      fetch:hangingFetch,
      requestTimeoutMs:40,
      latencyTimeoutMs:40,
      onStage:()=>{},onLive:()=>{},
      onFinish:r=>events.finish.push(r),
      onError:m=>events.error.push(m)
    });
    handle.play();
    await new Promise(resolve=>setTimeout(resolve,1500));
    assert.equal(events.finish.length,0);
    assert.equal(events.error.length,1,'повна невдача → людське повідомлення: '+events.error[0]);
    assert.match(events.error[0],/мережа недоступна/);
    assert.ok(timeoutFired,'таймаут спрацював');
  }

  /* 8. Повторний запуск після завершення працює */
  {
    const {context}=load({downMbps:200,upMbps:200});
    const first=await runOnce(context,{windowMs:8000});
    const second=await runOnce(context,{windowMs:8000});
    assert.equal(first.finish.length,1);
    assert.equal(second.finish.length,1);
    assert.ok(second.finish[0].downloadMbps>0,'другий запуск також успішний');
  }

  /* 9-10. Низька швидкість і ліміти: повільна мережа теж дає результат;
     об'ємний ліміт зупиняє тест на гігабіті */
  {
    const {context}=load({downMbps:50,upMbps:20,perChunkMs:160});
    const events=await runOnce(context,{});
    const result=events.finish[0];
    assert.ok(result.downloadMbps>=35&&result.downloadMbps<=80,'50 Мбіт/с виміряно правдоподібно: '+result.downloadMbps);
    assert.ok(result.uploadMbps>=14&&result.uploadMbps<=30,'20 Мбіт/с upload: '+result.uploadMbps);
  }

  console.log('PASS network tools speedtest v2: adaptive multi-stream (6 потоків на гігабіті), вікна 8с/6с, ліміти 400/150 МБ, live→final збереження, partial без втрати download, abort/timeout/repeat/1Gbit');
})().catch(error=>{console.error('FAIL:',error);process.exit(1);});

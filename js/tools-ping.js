/* Пінг: execution logic only, no DOM.
   - external target → the Globalping community probes (PROBE → TARGET, anonymous free tier);
   - local/private target → a direct device check from this phone (PHONE → DEVICE), which is a
     reachability+latency probe, NOT a protocol-level echo; the UI must never claim otherwise.
   All network I/O goes through an injected fetch so tests run fully offline. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTPing=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const API_BASE='https://api.globalping.org/v1';
  /* A few sensible European vantage points; the probe network picks an
     available probe per country (never a hardcoded probe id). Ukraine first,
     then two nearby European countries; if none of them is available the API
     call falls back to three probes worldwide. */
  const PROBE_LOCATIONS=[{country:'UA',limit:1},{country:'PL',limit:1},{country:'DE',limit:1}];
  const COUNTRY_NAMES={UA:'Україна',PL:'Польща',DE:'Німеччина',CZ:'Чехія',SK:'Словаччина',RO:'Румунія',HU:'Угорщина',MD:'Молдова',LT:'Литва',LV:'Латвія',EE:'Естонія',AT:'Австрія',NL:'Нідерланди',BE:'Бельгія',FR:'Франція',GB:'Велика Британія',FI:'Фінляндія',SE:'Швеція',NO:'Норвегія',DK:'Данія',IT:'Італія',ES:'Іспанія',PT:'Португалія',BG:'Болгарія',RS:'Сербія',US:'США',CA:'Канада'};
  const POLL_INTERVAL_MS=1000, POLL_DEADLINE_MS=25000;

  function countryName(code){
    return COUNTRY_NAMES[String(code||'').toUpperCase()]||String(code||'').toUpperCase();
  }

  function sleep(ms,signal){
    return new Promise(resolve=>{
      const timer=setTimeout(resolve,ms);
      if(signal)signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});
    });
  }

  async function readJson(fetchFn,url,init){
    let response,body=null;
    try{response=await fetchFn(url,init);}
    catch(error){return{networkError:error,aborted:!!(init&&init.signal&&init.signal.aborted)};}
    try{body=await response.json();}catch(_error){}
    return{status:response.status,ok:response.ok,body};
  }

  /* POST the measurement; on "no probes in those countries" retry worldwide. */
  async function createMeasurement(fetchFn,host,signal){
    const base={type:'ping',target:host,measurementOptions:{packets:3}};
    let attempt=await readJson(fetchFn,API_BASE+'/measurements',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.assign({limit:3,locations:PROBE_LOCATIONS},base)),signal});
    if(attempt.networkError)return attempt;
    if(!attempt.ok&&(attempt.status===400||attempt.status===422)){
      attempt=await readJson(fetchFn,API_BASE+'/measurements',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.assign({limit:3},base)),signal});
    }
    return attempt;
  }

  async function pollMeasurement(fetchFn,id,signal){
    const deadline=Date.now()+POLL_DEADLINE_MS;
    while(Date.now()<deadline){
      await sleep(POLL_INTERVAL_MS,signal);
      if(signal&&signal.aborted)return{aborted:true};
      const attempt=await readJson(fetchFn,API_BASE+'/measurements/'+encodeURIComponent(id),{signal});
      if(attempt.networkError)return attempt;
      if(!attempt.ok)return{status:attempt.status,ok:false};
      if(attempt.body&&attempt.body.status==='in-progress')continue;
      return{ok:true,measurement:attempt.body};
    }
    return{ok:false,timeout:true};
  }

  /* Defensive normalization: the probe payload is untrusted input.
     stats.avg is the round-trip average in ms; loss arrives as a percent. */
  function normalizeMeasurement(measurement){
    const rows=[],summarySamples=[];
    for(const entry of (measurement&&measurement.results)||[]){
      const probe=entry&&entry.probe||{},result=entry&&entry.result||{};
      const label=countryName(probe.country);
      const where=[probe.city,probe.network].filter(Boolean).join(' · ');
      if(result.status&&result.status!=='done'){
        rows.push({label,where,failed:true,error:String(result.error||result.status||'')});
        continue;
      }
      const stats=result.stats||{};
      const avg=Number(stats.avg),min=Number(stats.min),max=Number(stats.max);
      let lossPct=null;
      if(typeof stats.loss==='number')lossPct=Math.round(stats.loss);
      else if(Number.isFinite(Number(stats.drops))&&Number(stats.total)>0)lossPct=Math.round(100*Number(stats.drops)/Number(stats.total));
      if(!Number.isFinite(avg)){rows.push({label,where,failed:true,error:'порожня відповідь'});continue;}
      summarySamples.push({avg,min:Number.isFinite(min)?min:avg,max:Number.isFinite(max)?max:avg,lossPct});
      rows.push({label,where,avgMs:Math.round(avg),minMs:Number.isFinite(min)?Math.round(min):null,maxMs:Number.isFinite(max)?Math.round(max):null,lossPct,failed:false});
    }
    let summary=null;
    if(summarySamples.length){
      const avgs=summarySamples.map(item=>item.avg);
      summary={
        minMs:Math.round(Math.min(...summarySamples.map(item=>item.min))),
        avgMs:Math.round(avgs.reduce((sum,value)=>sum+value,0)/avgs.length),
        maxMs:Math.round(Math.max(...summarySamples.map(item=>item.max))),
        lossPct:Math.max(...summarySamples.map(item=>item.lossPct==null?0:item.lossPct))
      };
    }
    return{rows,summary};
  }

  /* External (public target) check. The phone's connection quality is NOT
     what this measures — it measures the target from the probe network. */
  async function runExternal(host,options={}){
    const fetchFn=options.fetch||globalThis.fetch,signal=options.signal;
    const created=await createMeasurement(fetchFn,host,signal);
    if(created.aborted)return{ok:false,cancelled:true};
    if(created.networkError)return{ok:false,error:'Сервіс зовнішньої перевірки недоступний',detail:String(created.networkError&&created.networkError.message||created.networkError)};
    if(created.status===429||created.status===403)return{ok:false,error:'Занадто багато перевірок поспіль. Спробуйте за кілька хвилин'};
    if(!created.ok||!created.body||!created.body.id)return{ok:false,error:'Не вдалося розпочати зовнішню перевірку',detail:'HTTP '+created.status};
    const polled=await pollMeasurement(fetchFn,created.body.id,signal);
    if(polled.aborted)return{ok:false,cancelled:true};
    if(polled.networkError)return{ok:false,error:'Сервіс зовнішньої перевірки недоступний',detail:String(polled.networkError&&polled.networkError.message||'')};
    if(polled.timeout)return{ok:false,error:'Час очікування зовнішньої перевірки вичерпано',detail:'poll deadline'};
    if(!polled.ok)return{ok:false,error:'Сервіс зовнішньої перевірки недоступний',detail:'HTTP '+polled.status};
    const normalized=normalizeMeasurement(polled.measurement);
    if(!normalized.rows.length)return{ok:false,error:'Зовнішні вузли не відповіли',detail:'empty results'};
    return Object.assign({ok:true},normalized);
  }

  /* Local device (router/ONU) reachability from THIS phone over the home
     network. Browsers gate such requests behind a permission; a denial is
     indistinguishable from "no answer" here, so the UI wording covers both. */
  async function runLocal(host,options={}){
    const fetchFn=options.fetch||globalThis.fetch,timeoutMs=Math.max(500,Number(options.timeoutMs)||3000);
    const controller=typeof AbortController==='function'?new AbortController():null;
    const timer=setTimeout(()=>controller&&controller.abort(),timeoutMs);
    if(options.signal)options.signal.addEventListener('abort',()=>controller&&controller.abort(),{once:true});
    const target=(host.includes(':')?'['+host+']':host)+(options.port?':'+options.port:'');
    const started=Date.now();
    try{
      const init={mode:'no-cors',cache:'no-store',signal:controller?controller.signal:undefined};
      try{init.targetAddressSpace='local';}catch(_error){}
      await fetchFn('http://'+target+'/',init);
      return{ok:true,ms:Date.now()-started,kind:'local'};
    }catch(error){
      if(options.signal&&options.signal.aborted)return{ok:false,cancelled:true};
      if(controller&&controller.signal.aborted)return{ok:false,error:'Пристрій не відповів ('+Math.round(timeoutMs/1000)+' с)',detail:'timeout'};
      return{ok:false,error:'Пристрій не відповідає',detail:String(error&&error.message||error)};
    }finally{clearTimeout(timer);}
  }

  /* Router used by the UI: a local/private target NEVER goes to the external
     probe service — it goes to the direct device check instead. */
  async function run(host,options={}){
    const utils=options.utils||(typeof MTNetUtils!=='undefined'?MTNetUtils:null);
    const parsed=utils.parseTargetInput(host);
    if(!parsed.ok)return{ok:false,invalid:true,error:parsed.error};
    const runOptions=Object.assign({},options,{port:parsed.port||null});
    return parsed.local?runLocal(parsed.host,runOptions):runExternal(parsed.host,options);
  }

  return{API_BASE,PROBE_LOCATIONS,countryName,createMeasurement,pollMeasurement,normalizeMeasurement,runExternal,runLocal,run};
});

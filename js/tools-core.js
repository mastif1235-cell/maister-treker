(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTToolsCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const DIAGNOSTIC_VERSION='browser-v2';
  const NETWORK_POINT_TYPES=['FOB','Муфта','Вузол','Інше'];
  const MAP_CATEGORIES=['private','apartment','FOB','Муфта','Вузол','Інше'];

  function text(value){return String(value??'').trim();}
  function profileParts(source={}){
    return {
      city:text(source.city),street:text(source.street),house:text(source.house),
      apartment:text(source.apartment)
    };
  }
  function profileId(source){
    const p=profileParts(source);
    return JSON.stringify([p.city,p.street,p.house,p.apartment]);
  }
  function houseId(source){
    const p=profileParts(source);
    return JSON.stringify([p.city,p.street,p.house]);
  }
  function addressLabel(source={}){
    const p=profileParts(source);
    return [p.city,p.street,p.house,p.apartment?`кв. ${p.apartment}`:''].filter(Boolean).join(', ');
  }
  function parseCoordinates(value){
    const raw=text(value);
    if(!raw)return null;
    const patterns=[/[?&](?:q|ll)=(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i,/@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/, /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/];
    for(const pattern of patterns){
      const match=raw.match(pattern);
      if(!match)continue;
      const lat=Number(match[1]),lng=Number(match[2]);
      if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)return{lat,lng};
    }
    return null;
  }
  function explicitCoordinates(source={}){
    const lat=Number(source?.geoLat??source?.lat),lng=Number(source?.geoLng??source?.lng);
    return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
  }
  function googleMapsUrl(source={}){
    const coords=explicitCoordinates(source)||parseCoordinates(source?.geoLink);
    if(coords)return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${coords.lat},${coords.lng}`)}`;
    const link=text(source?.geoLink);
    return /^https:\/\//i.test(link)?link:'';
  }
  function requestCurrentPosition(geolocation,options={}){
    return new Promise((resolve,reject)=>{
      if(!geolocation||typeof geolocation.getCurrentPosition!=='function'){reject(Object.assign(new Error('UNSUPPORTED'),{code:'UNSUPPORTED'}));return;}
      geolocation.getCurrentPosition(position=>{
        const point=explicitCoordinates({lat:position?.coords?.latitude,lng:position?.coords?.longitude});
        if(!point){reject(Object.assign(new Error('UNAVAILABLE'),{code:'UNAVAILABLE'}));return;}
        resolve({...point,accuracy:Number(position.coords.accuracy)||0});
      },error=>reject(error||Object.assign(new Error('UNAVAILABLE'),{code:'UNAVAILABLE'})),{
        enableHighAccuracy:true,timeout:15000,maximumAge:30000,...options
      });
    });
  }
  function createGeoDraft(source={}){
    const original={geoLat:source.geoLat,geoLng:source.geoLng,geoLink:source.geoLink};
    let point=explicitCoordinates(source)||parseCoordinates(source.geoLink);
    return {
      get:()=>point?{...point}:null,
      set(value){const next=explicitCoordinates(value);if(next)point=next;return this.get();},
      commit(){return point?{geoLat:Number(point.lat.toFixed(6)),geoLng:Number(point.lng.toFixed(6)),geoLink:original.geoLink}:original;},
      cancel:()=>({...original})
    };
  }
  function listProfiles(tickets=[]){
    const groups=new Map();
    tickets.forEach((ticket,index)=>{
      if(!ticket||!text(ticket.city)||!text(ticket.street))return;
      const id=profileId(ticket);
      if(!groups.has(id))groups.set(id,{id,...profileParts(ticket),address:addressLabel(ticket),tickets:[],newestIndex:index});
      const group=groups.get(id);group.tickets.push(ticket);group.newestIndex=Math.max(group.newestIndex,index);
    });
    return [...groups.values()].sort((a,b)=>b.newestIndex-a.newestIndex||a.address.localeCompare(b.address,'uk'));
  }
  function profileFromTickets(items=[]){
    const first=items[0]||{};
    return {id:profileId(first),...profileParts(first),address:addressLabel(first)};
  }
  function sanitizeDiagnosticResult(result={}){
    const metric=(value,round=false)=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?(round?Math.round(Number(value)):Number(value)):null;
    const resources=Array.isArray(result.resources)?result.resources.slice(0,10).map(item=>({
      label:text(item?.label).slice(0,80),ok:!!item?.ok,
      httpMs:Number.isFinite(Number(item?.httpMs))?Math.round(Number(item.httpMs)):null,
      status:Number.isFinite(Number(item?.status))?Number(item.status):null,
      state:['ok','http','timeout','blocked','offline','unavailable'].includes(item?.state)?item.state:(item?.ok?'ok':'unavailable'),
      detail:text(item?.detail).slice(0,160)
    })):[];
    return {
      online:!!result.online,publicIp:text(result.publicIp).slice(0,80),
      ipFamily:['IPv4','IPv6','IPv4/IPv6'].includes(result.ipFamily)?result.ipFamily:'',
      ipv4:result.ipv4===true,ipv6:result.ipv6===true,
      summaryStatus:['ok','warning','offline'].includes(result.summaryStatus)?result.summaryStatus:(result.online?'warning':'offline'),
      internetStatus:['ok','offline','limited'].includes(result.internetStatus)?result.internetStatus:(result.online?'ok':'offline'),
      dnsStatus:['indirect','limited','unavailable'].includes(result.dnsStatus)?result.dnsStatus:'unavailable',
      latencyMs:metric(result.latencyMs,true),
      jitterMs:metric(result.jitterMs,true),
      downloadMbps:metric(result.downloadMbps),
      uploadMbps:metric(result.uploadMbps),
      speedProvider:text(result.speedProvider).slice(0,80),
      speedMethod:text(result.speedMethod).slice(0,120),
      speedStatus:['success','partial','error','cancelled'].includes(result.speedStatus)?result.speedStatus:'',
      resources
    };
  }
  function mergeDiagnosticResults(networkResult={},speedResult={}){
    const network=sanitizeDiagnosticResult(networkResult),speed=sanitizeDiagnosticResult(speedResult),speedAvailable=speed.downloadMbps!==null||speed.uploadMbps!==null||!!speed.speedStatus;
    return sanitizeDiagnosticResult({...network,
      downloadMbps:speed.downloadMbps,uploadMbps:speed.uploadMbps,
      speedProvider:speed.speedProvider,speedMethod:speed.speedMethod,
      speedStatus:speed.speedStatus||'error',
      summaryStatus:network.summaryStatus==='offline'?'offline':speed.speedStatus==='success'&&network.summaryStatus==='ok'?'ok':'warning',
      resources:[...network.resources,...(speedAvailable?speed.resources:[])]
    });
  }
  async function runBrowserDiagnostics(options={}){
    const fetchFn=options.fetch||globalThis.fetch,timeoutMs=Math.max(100,Number(options.timeoutMs)||5000),clock=options.now||(()=>Date.now());
    const endpoints=options.endpoints||[
      {label:'Public IP HTTPS',url:'https://api.ipify.org?format=json',ip:true},
      {label:'Internet HTTPS',url:'https://tile.openstreetmap.org/0/0/0.png'}
    ];
    async function check(endpoint){
      const controller=typeof AbortController==='function'?new AbortController():null,started=clock();let timer;
      const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller?.abort();resolve({timeout:true});},timeoutMs);});
      try{
        const request=Promise.resolve().then(async()=>{
          const response=await fetchFn(endpoint.url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller?.signal});
          let ip='';if(endpoint.ip&&response?.ok){const body=await response.json();ip=text(body?.ip).slice(0,80);}
          return{response,ip};
        }).catch(error=>({error}));
        const outcome=await Promise.race([request,timeout]);
        const httpMs=Math.max(0,Math.round(clock()-started));
        if(outcome.timeout)return{label:endpoint.label,ok:false,state:'timeout',status:null,httpMs:null,detail:'Час очікування вичерпано'};
        if(outcome.error)return{label:endpoint.label,ok:false,state:'blocked',status:null,httpMs:null,detail:'Мережа або браузер не дозволили HTTPS-перевірку'};
        const response=outcome.response,status=Number(response?.status)||0;
        if(!response?.ok)return{label:endpoint.label,ok:false,state:'http',status,httpMs,detail:`HTTP ${status||'помилка'}`};
        return{label:endpoint.label,ok:true,state:'ok',status,httpMs,detail:'',ip:outcome.ip||''};
      }finally{clearTimeout(timer);}
    }
    const checked=await Promise.all(endpoints.map(check)),successes=checked.filter(item=>item.ok),ips=checked.map(item=>item.ip).filter(Boolean),publicIp=[...new Set(ips)].join(' / ');
    const ipv4=ips.some(ip=>/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)),ipv6=ips.some(ip=>ip.includes(':'));
    const online=successes.length>0,browserOffline=options.navigatorOnline===false,internetStatus=online?'ok':browserOffline?'offline':'limited',dnsStatus=online?'indirect':browserOffline?'unavailable':'limited',samples=successes.map(item=>item.httpMs).filter(Number.isFinite);
    const latencyMs=samples.length?Math.round(samples.reduce((sum,value)=>sum+value,0)/samples.length):null;
    const jitterMs=samples.length>1?Math.round(samples.slice(1).reduce((sum,value,index)=>sum+Math.abs(value-samples[index]),0)/(samples.length-1)):null;
    const resources=checked.map(({ip,...item})=>item),summaryStatus=!online?(browserOffline?'offline':'warning'):resources.some(item=>!item.ok)||!publicIp?'warning':'ok';
    return sanitizeDiagnosticResult({online,internetStatus,dnsStatus,summaryStatus,publicIp,ipv4,ipv6,ipFamily:ipv4&&ipv6?'IPv4/IPv6':ipv6?'IPv6':ipv4?'IPv4':'',latencyMs,jitterMs,resources});
  }
  async function runBrowserSpeedTest(options={}){
    const fetchFn=options.fetch||globalThis.fetch,clock=options.now||(()=>performance.now()),signal=options.signal,requestTimeoutMs=Math.max(1000,Number(options.requestTimeoutMs||options.timeoutMs)||7000),startedAll=clock(),totalLimitMs=Math.max(5000,Number(options.totalTimeoutMs)||20000);
    const percentile=(values,p=.75)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),at=Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*p)-1));return Number(sorted[at].toFixed(1));};
    const request=async(url,init={})=>{const controller=typeof AbortController==='function'?new AbortController():null,timer=setTimeout(()=>controller?.abort(),requestTimeoutMs),abort=()=>controller?.abort();signal?.addEventListener?.('abort',abort,{once:true});const started=clock();try{const response=await fetchFn(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',...init,signal:controller?.signal});if(!response?.ok)throw new Error(`HTTP_${response?.status||0}`);const body=await response.arrayBuffer(),elapsed=Math.max(1,clock()-started),bytes=init.method==='POST'?Number(init.body?.byteLength)||0:Number(body?.byteLength)||0;return{ok:true,elapsed,bytes,mbps:bytes*8/elapsed/1000};}catch(error){return{ok:false,cancelled:signal?.aborted===true,error:String(error?.name||error?.message||'ERROR')};}finally{clearTimeout(timer);signal?.removeEventListener?.('abort',abort);}};
    const download=bytes=>request(`https://speed.cloudflare.com/__down?bytes=${bytes}&_=${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const upload=bytes=>request(`https://speed.cloudflare.com/__up?bytes=${bytes}&_=${Date.now()}-${Math.random().toString(36).slice(2)}`,{method:'POST',headers:{'content-type':'application/octet-stream'},body:new Uint8Array(bytes)});
    const parallelRound=async(direction,bytes,streams)=>{const started=clock(),samples=await Promise.all(Array.from({length:streams},()=>direction==='download'?download(bytes):upload(bytes))),successful=samples.filter(sample=>sample.ok),elapsed=Math.max(1,clock()-started),transferred=successful.reduce((sum,sample)=>sum+sample.bytes,0);return{ok:successful.length>0,elapsed,bytes:transferred,mbps:transferred*8/elapsed/1000,samples};};
    const canContinue=()=>!signal?.aborted&&clock()-startedAll<totalLimitMs;
    options.onProgress?.('prepare');if(canContinue())await download(250000); // connection warm-up is deliberately excluded
    options.onProgress?.('latency');const latency=[];for(let index=0;index<7&&canContinue();index++){const sample=await download(0);if(sample.ok)latency.push(sample.elapsed);}
    options.onProgress?.('download');const downSamples=[];let downBytes=0,downElapsed=0,probe=canContinue()?await download(Math.max(250000,Number(options.downloadBytes)||1000000)):{ok:false,cancelled:true};if(probe.ok)downBytes+=probe.bytes;const downStreams=probe.mbps>=250?4:probe.mbps>=80?3:probe.mbps>=20?2:1,downChunk=probe.mbps>=250?15000000:probe.mbps>=80?8000000:probe.mbps>=20?4000000:1500000,downBudget=Math.max(downChunk*downStreams,Number(options.maxDownloadBytes)||160000000);for(let index=0;index<4&&canContinue()&&downBytes+downChunk*downStreams<=downBudget&&(downElapsed<3000||downSamples.length<3);index++){const sample=await parallelRound('download',downChunk,downStreams);if(!sample.ok)break;downSamples.push(sample.mbps);downBytes+=sample.bytes;downElapsed+=sample.elapsed;options.onSample?.('download',sample);}
    options.onProgress?.('upload');const upSamples=[];let upBytes=0,upElapsed=0,upProbe=canContinue()?await upload(Math.max(100000,Number(options.uploadBytes)||500000)):{ok:false,cancelled:true};if(upProbe.ok)upBytes+=upProbe.bytes;const upStreams=upProbe.mbps>=150?3:upProbe.mbps>=40?2:1,upChunk=upProbe.mbps>=150?10000000:upProbe.mbps>=40?6000000:upProbe.mbps>=10?2500000:750000,upBudget=Math.max(upChunk*upStreams,Number(options.maxUploadBytes)||75000000);for(let index=0;index<4&&canContinue()&&upBytes+upChunk*upStreams<=upBudget&&(upElapsed<3000||upSamples.length<3);index++){const sample=await parallelRound('upload',upChunk,upStreams);if(!sample.ok)break;upSamples.push(sample.mbps);upBytes+=sample.bytes;upElapsed+=sample.elapsed;options.onSample?.('upload',sample);}
    options.onProgress?.('processing');const latencyMs=percentile(latency,.5),jitterMs=latency.length>1?Math.round(latency.slice(1).reduce((sum,value,index)=>sum+Math.abs(value-latency[index]),0)/(latency.length-1)):null,downloadMbps=percentile(downSamples),uploadMbps=percentile(upSamples),available=[downloadMbps!==null,uploadMbps!==null,latency.length>0].filter(Boolean).length,cancelled=signal?.aborted===true;
    return sanitizeDiagnosticResult({online:available>0,internetStatus:available>0?'ok':'limited',dnsStatus:available>0?'indirect':'limited',summaryStatus:downloadMbps!==null&&uploadMbps!==null?'ok':available?'warning':'offline',downloadMbps,uploadMbps,latencyMs,jitterMs,speedProvider:'Cloudflare',speedMethod:'Cloudflare parallel browser estimate v3',speedStatus:cancelled?'cancelled':downloadMbps!==null&&uploadMbps!==null?'success':available?'partial':'error',resources:[{label:'Cloudflare Speed',ok:downloadMbps!==null||uploadMbps!==null,state:cancelled?'unavailable':downloadMbps!==null||uploadMbps!==null?'ok':'blocked',detail:cancelled?'Скасовано користувачем':downloadMbps!==null&&uploadMbps!==null?`Паралельна HTTPS-оцінка: отримано ${downBytes} B, відправлено ${upBytes} B`:'Частина вимірювань недоступна'}]});
  }
  function makeDiagnosticRecord(result,profile=null,now=new Date()){
    const sanitized=sanitizeDiagnosticResult(result);
    return {
      id:`diag-${now.getTime()}-${Math.random().toString(36).slice(2,8)}`,
      timestamp:now.toISOString(),version:DIAGNOSTIC_VERSION,
      profileId:profile?.id||'',address:profile?.address||'',
      summaryStatus:sanitized.summaryStatus,result:sanitized
    };
  }
  function appendDiagnosticHistory(history=[],record){return sanitizeDiagnostics([...(Array.isArray(history)?history:[]),record]).slice(-200);}
  function previousDiagnostic(history=[],profileIdValue,beforeTimestamp){
    return history.filter(item=>item?.profileId===profileIdValue&&item?.timestamp!==beforeTimestamp)
      .sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)))[0]||null;
  }
  function diagnosticComparison(current,previous){
    if(!current||!previous)return[];
    const fields=[['downloadMbps','Download','Mbps'],['uploadMbps','Upload','Mbps'],['latencyMs','Відгук інтернету','мс'],['jitterMs','Стабільність відгуку','мс']];
    return fields.flatMap(([key,label,unit])=>{
      const from=Number(previous.result?.[key]),to=Number(current.result?.[key]);
      return Number.isFinite(from)&&Number.isFinite(to)?[{key,label,unit,from,to}]:[];
    });
  }
  function diagnosticStatus(history=[]){
    const items=sanitizeDiagnostics(history).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp))),latest=items[0]||null;
    return{latest,count:items.length,status:latest?(latest.summaryStatus||latest.result?.summaryStatus||'warning'):'none'};
  }
  function diagnosticReport(result,context=null,at=new Date()){
    const r=sanitizeDiagnosticResult(result),lines=['Діагностика',at.toLocaleString('uk-UA')];
    if(context?.address)lines.push(`Адреса: ${context.address}`);
    lines.push(`Інтернет: ${r.online?'доступний':r.internetStatus==='offline'?'немає з’єднання':'не підтверджено через обмеження браузера/мережі'}`);
    if(r.publicIp)lines.push(`External IP: ${r.publicIp}${r.ipFamily?` (${r.ipFamily})`:''}`);
    lines.push(`DNS: ${r.dnsStatus==='indirect'?'працює для HTTPS (непряма перевірка)':r.dnsStatus==='limited'?'не підтверджено через обмеження браузера':'недоступно'}`);
    if(r.ipv4||r.ipv6)lines.push(`IP: ${r.ipv4?'IPv4 ':''}${r.ipv6?'IPv6':''}`.trim());
    r.resources.forEach(item=>lines.push(`${item.label}: ${item.ok?'доступний':item.state==='timeout'?'таймаут':item.state==='http'?`HTTP ${item.status||'помилка'}`:'обмеження мережі/браузера'}${item.ok&&item.httpMs!==null?`, HTTP ${item.httpMs} мс`:''}`));
    if(r.downloadMbps!==null)lines.push(`Download: ${r.downloadMbps} Mbps`);
    if(r.uploadMbps!==null)lines.push(`Upload: ${r.uploadMbps} Mbps`);
    if(r.latencyMs!==null)lines.push(`Відгук інтернету: ${r.latencyMs} мс`);
    if(r.jitterMs!==null)lines.push(`Стабільність відгуку: ${r.jitterMs} мс`);
    return lines.join('\n');
  }
  function mapObjects(tickets=[],networkPoints=[]){
    const homes=new Map();
    listProfiles(tickets).forEach(profile=>{
      const ticket=profile.tickets.find(item=>parseCoordinates(`${item.geoLat??''},${item.geoLng??''}`)||parseCoordinates(item.geoLink));
      const coords=ticket&&(parseCoordinates(`${ticket.geoLat??''},${ticket.geoLng??''}`)||parseCoordinates(ticket.geoLink));
      if(!coords)return;
      const id=houseId(profile),existing=homes.get(id)||{kind:'home',id,...coords,city:profile.city,street:profile.street,house:profile.house,profiles:[]};
      existing.profiles.push({id:profile.id,address:profile.address,apartment:profile.apartment});
      homes.set(id,existing);
    });
    homes.forEach(home=>{home.category=home.profiles.length>1?'apartment':'private';});
    const points=networkPoints.flatMap(point=>{
      const coords=parseCoordinates(`${point?.lat??''},${point?.lng??''}`);
      const type=NETWORK_POINT_TYPES.includes(point?.type)?point.type:'Інше';
      return coords?[{kind:'network',id:String(point.id),...coords,name:text(point.name)||'Точка мережі',type,category:type}]:[];
    });
    return [...homes.values(),...points];
  }
  function filterMapObjects(objects=[],categories=MAP_CATEGORIES){
    const allowed=new Set(Array.isArray(categories)?categories:[]);
    return objects.filter(item=>allowed.has(item?.category));
  }
  function normalizeNetworkPoint(value={},now=new Date()){
    const coords=parseCoordinates(`${value.lat??''},${value.lng??''}`);
    if(!coords)return null;
    const safeNow=now instanceof Date&&!Number.isNaN(now.getTime())?now:new Date();
    const createdAt=text(value.createdAt)||safeNow.toISOString();
    return {
      id:text(value.id)||`point-${now.getTime()}-${Math.random().toString(36).slice(2,8)}`,
      name:text(value.name).slice(0,120),type:NETWORK_POINT_TYPES.includes(value.type)?value.type:'Інше',
      city:text(value.city).slice(0,120),street:text(value.street).slice(0,160),house:text(value.house).slice(0,120),
      label:text(value.label).slice(0,120),profileId:text(value.profileId).slice(0,500),
      lat:coords.lat,lng:coords.lng,note:text(value.note).slice(0,4000),
      photoKey:text(value.photoKey),photoKeys:[...new Set((Array.isArray(value.photoKeys)?value.photoKeys:[value.photoKey]).map(text).filter(Boolean))].slice(0,3),
      telegramChatId:text(value.telegramChatId).slice(0,80),telegramMessageId:Number.isSafeInteger(Number(value.telegramMessageId))&&Number(value.telegramMessageId)>0?Number(value.telegramMessageId):0,
      telegramSendPending:value.telegramSendPending===true,
      telegramMediaUpdatePending:value.telegramMediaUpdatePending===true,
      telegramPhotoSignature:text(value.telegramPhotoSignature).slice(0,500),
      telegramMediaRefs:(Array.isArray(value.telegramMediaRefs)?value.telegramMediaRefs:[]).map(ref=>({photoKey:text(ref?.photoKey).slice(0,500),messageId:Number(ref?.messageId)||0})).filter(ref=>ref.photoKey&&Number.isSafeInteger(ref.messageId)&&ref.messageId>0).slice(0,3),
      createdAt,updatedAt:safeNow.toISOString()
    };
  }
  function networkPointAddress(value={}){return [text(value.city),text(value.street),text(value.house)].filter(Boolean).join(', ');}
  function networkPointPickerMeta(value={}){
    const note=text(value.note).slice(0,60),identity=text(value.name)||text(value.label)||text(value.id);
    return [note?`«${note}»`:'',identity].filter(Boolean).join(' · ');
  }
  function networkPointPreviewData(value={}){
    const lat=Number(value.lat),lng=Number(value.lng),hasCoords=Number.isFinite(lat)&&Number.isFinite(lng);
    return {
      id:text(value.id),type:text(value.type),name:text(value.name),label:text(value.label),address:networkPointAddress(value),
      city:text(value.city),street:text(value.street),house:text(value.house),note:text(value.note),
      coordinates:hasCoords?`${lat.toFixed(6)}, ${lng.toFixed(6)}`:'',
      photoKeys:[...new Set((Array.isArray(value.photoKeys)?value.photoKeys:[value.photoKey]).map(text).filter(Boolean))].slice(0,3)
    };
  }
  function searchNetworkPoints(points=[],query=''){
    const needle=text(query).toLocaleLowerCase('uk');
    if(!needle)return points.slice();
    return points.filter(point=>[point.id,point.type,point.name,point.label,point.city,point.street,point.house,point.note].some(value=>text(value).toLocaleLowerCase('uk').includes(needle)));
  }
  function sortNewestFirst(items=[]){
    return items.map((item,index)=>({item,index,time:Date.parse(text(item?.createdAt))})).sort((a,b)=>{
      const aTimed=Number.isFinite(a.time),bTimed=Number.isFinite(b.time);
      if(aTimed!==bTimed)return bTimed-aTimed;
      if(aTimed&&a.time!==b.time)return b.time-a.time;
      return b.index-a.index||text(a.item?.id).localeCompare(text(b.item?.id),'uk',{numeric:true,sensitivity:'base'});
    }).map(entry=>entry.item);
  }
  function groupNetworkPoints(points=[],query=''){
    const source=sortNewestFirst(searchNetworkPoints(points,query)),cities=new Map();
    source.forEach(point=>{
      const city=text(point.city)||'Без адреси / Не визначено',street=text(point.street)||'Без адреси / Не визначено';
      if(!cities.has(city))cities.set(city,new Map());
      const streets=cities.get(city);if(!streets.has(street))streets.set(street,[]);streets.get(street).push(point);
    });
    return [...cities.entries()].map(([city,streets])=>({city,count:[...streets.values()].reduce((sum,list)=>sum+list.length,0),streets:[...streets.entries()].map(([street,list])=>({street,count:list.length,points:list}))}));
  }
  function removeNetworkPoint(points=[],id=''){
    const targetId=text(id),removed=points.find(point=>text(point?.id)===targetId)||null;
    return {removed,points:removed?points.filter(point=>text(point?.id)!==targetId):points.slice()};
  }
  function networkPointIds(value=[]){return [...new Set((Array.isArray(value)?value:[]).map(text).filter(Boolean))];}
  function linkNetworkPoint(ids=[],id=''){const target=text(id);return networkPointIds(target?[...ids,target]:ids);}
  function unlinkNetworkPoint(ids=[],id=''){const target=text(id);return networkPointIds(ids).filter(value=>value!==target);}
  function ticketsForNetworkPoint(tickets=[],id=''){const target=text(id);return tickets.filter(ticket=>networkPointIds(ticket?.networkPointIds).includes(target));}
  function removeNetworkPointLinks(tickets=[],id=''){const target=text(id),changed=[];tickets.forEach(ticket=>{const before=networkPointIds(ticket?.networkPointIds),after=before.filter(value=>value!==target);if(after.length!==before.length){ticket.networkPointIds=after;changed.push(ticket);}});return changed;}
  function tileRange(lon,lat,zoom){
    const n=2**zoom,x=Math.floor((lon+180)/360*n),rad=lat*Math.PI/180,y=Math.floor((1-Math.asinh(Math.tan(rad))/Math.PI)/2*n);
    return{x:Math.max(0,Math.min(n-1,x)),y:Math.max(0,Math.min(n-1,y))};
  }
  function estimateOfflineArea(bounds={},minZoom=10,maxZoom=16,averageTileBytes=25000){
    const minLat=Number(bounds.minLat),maxLat=Number(bounds.maxLat),minLng=Number(bounds.minLng),maxLng=Number(bounds.maxLng);
    if(![minLat,maxLat,minLng,maxLng].every(Number.isFinite)||minLat>=maxLat||minLng>=maxLng)return null;
    let tiles=0;for(let z=Math.max(0,Number(minZoom)||0);z<=Math.min(22,Number(maxZoom)||0);z++){const nw=tileRange(minLng,maxLat,z),se=tileRange(maxLng,minLat,z);tiles+=(se.x-nw.x+1)*(se.y-nw.y+1);}
    return{tiles,bytes:Math.round(tiles*Math.max(1,Number(averageTileBytes)||25000))};
  }
  function normalizeOfflineArea(value={},now=new Date()){
    const estimate=estimateOfflineArea(value,value.minZoom,value.maxZoom);if(!estimate)return null;const safeNow=now instanceof Date&&!Number.isNaN(now.getTime())?now:new Date();
    return{id:text(value.id)||`area-${safeNow.getTime()}-${Math.random().toString(36).slice(2,8)}`,name:text(value.name).slice(0,120)||'Робоча область',minLat:Number(value.minLat),minLng:Number(value.minLng),maxLat:Number(value.maxLat),maxLng:Number(value.maxLng),minZoom:Math.max(0,Math.min(22,Number(value.minZoom)||0)),maxZoom:Math.max(0,Math.min(22,Number(value.maxZoom)||0)),estimatedBytes:estimate.bytes,createdAt:text(value.createdAt)||safeNow.toISOString(),updatedAt:safeNow.toISOString()};
  }
  function sanitizeOfflineAreas(value){if(!Array.isArray(value))return[];return value.slice(0,50).flatMap(item=>{const area=normalizeOfflineArea(item,new Date(item?.updatedAt||Date.now()));return area?[area]:[];});}
  function offlineBoundsOverlap(area={},header={}){
    const a={w:Number(area.minLng),s:Number(area.minLat),e:Number(area.maxLng),n:Number(area.maxLat)},b={w:Number(header.minLon??header.minLng),s:Number(header.minLat),e:Number(header.maxLon??header.maxLng),n:Number(header.maxLat)};
    if(![a.w,a.s,a.e,a.n,b.w,b.s,b.e,b.n].every(Number.isFinite))return 0;const intersection=Math.max(0,Math.min(a.e,b.e)-Math.max(a.w,b.w))*Math.max(0,Math.min(a.n,b.n)-Math.max(a.s,b.s)),areaSize=Math.max(0,(a.e-a.w)*(a.n-a.s));return areaSize?Math.min(1,intersection/areaSize):0;
  }
  function offlineAreaDuplicate(first={},second={}){
    const name=value=>text(value).toLocaleLowerCase('uk').replace(/\s+/g,' '),sameName=!!name(first.name)&&name(first.name)===name(second.name);
    return sameName||(offlineBoundsOverlap(first,second)>=.95&&offlineBoundsOverlap(second,first)>=.95);
  }
  function sanitizeDiagnostics(value){
    if(!Array.isArray(value))return[];
    return value.slice(0,5000).flatMap(item=>{
      if(!item||typeof item!=='object'||!text(item.id)||!text(item.timestamp))return[];
      const result=sanitizeDiagnosticResult(item.result);return [{id:text(item.id),timestamp:text(item.timestamp),version:text(item.version)||DIAGNOSTIC_VERSION,profileId:text(item.profileId),address:text(item.address),summaryStatus:['ok','warning','offline'].includes(item.summaryStatus)?item.summaryStatus:result.summaryStatus,result}];
    });
  }
  function sanitizeNetworkPoints(value){
    if(!Array.isArray(value))return[];
    return value.slice(0,5000).flatMap((item,index)=>{const known=Date.parse(text(item?.createdAt)||text(item?.updatedAt)),fallback=new Date(Number.isFinite(known)?known:index);const point=normalizeNetworkPoint(item,fallback);return point?[point]:[];});
  }

  return {DIAGNOSTIC_VERSION,NETWORK_POINT_TYPES,MAP_CATEGORIES,profileParts,profileId,houseId,addressLabel,parseCoordinates,explicitCoordinates,googleMapsUrl,requestCurrentPosition,createGeoDraft,listProfiles,profileFromTickets,sanitizeDiagnosticResult,mergeDiagnosticResults,runBrowserDiagnostics,runBrowserSpeedTest,makeDiagnosticRecord,appendDiagnosticHistory,previousDiagnostic,diagnosticComparison,diagnosticStatus,diagnosticReport,mapObjects,filterMapObjects,normalizeNetworkPoint,networkPointAddress,networkPointPickerMeta,networkPointPreviewData,searchNetworkPoints,sortNewestFirst,groupNetworkPoints,removeNetworkPoint,networkPointIds,linkNetworkPoint,unlinkNetworkPoint,ticketsForNetworkPoint,removeNetworkPointLinks,estimateOfflineArea,normalizeOfflineArea,sanitizeOfflineAreas,offlineBoundsOverlap,offlineAreaDuplicate,sanitizeDiagnostics,sanitizeNetworkPoints};
});

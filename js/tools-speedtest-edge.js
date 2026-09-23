/* Optional Cloudflare edge metadata for the Speedtest result. Never measures speed. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTSpeedtestEdge=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TRACE_URL='https://speed.cloudflare.com/cdn-cgi/trace';
  const COLOS={KBP:['Київ','UA'],WAW:['Варшава','PL'],FRA:['Франкфурт','DE'],AMS:['Амстердам','NL'],PRG:['Прага','CZ'],VIE:['Відень','AT'],BUD:['Будапешт','HU'],OTP:['Бухарест','RO']};
  const COUNTRIES={UA:'Україна',PL:'Польща',DE:'Німеччина',NL:'Нідерланди',CZ:'Чехія',AT:'Австрія',RO:'Румунія',HU:'Угорщина'};

  function parseCloudflareTrace(body){
    if(typeof body!=='string'||body.length>8192)return null;
    const fields=Object.create(null);
    for(const line of body.split(/\r?\n/)){
      const equal=line.indexOf('=');
      if(equal<1)continue;
      const field=line.slice(0,equal);
      if(field==='colo'||field==='loc')fields[field]=line.slice(equal+1).trim().toUpperCase();
    }
    const colo=fields.colo;
    if(!/^[A-Z0-9]{3}$/.test(colo||''))return null;
    const visitorCountryCode=/^[A-Z]{2}$/.test(fields.loc||'')?fields.loc:'';
    const known=COLOS[colo];
    const countryCode=known?.[1]||'';
    // `loc` describes the visitor IP, not the country of the `colo` data center.
    return{provider:'Cloudflare',colo,countryCode,city:known?.[0]||'',country:COUNTRIES[countryCode]||countryCode,visitorCountryCode};
  }

  async function fetchCloudflareEdgeInfo({fetchFn=globalThis.fetch,signal,timeoutMs=4000}={}){
    if(typeof fetchFn!=='function'||signal?.aborted)return null;
    const controller=new AbortController();
    const abort=()=>controller.abort();
    const timer=setTimeout(abort,timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    try{
      if(signal?.aborted)return null;
      const response=await fetchFn(TRACE_URL,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
      if(!response?.ok||typeof response.text!=='function')return null;
      return parseCloudflareTrace(await response.text());
    }catch(_error){return null;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  return{TRACE_URL,parseCloudflareTrace,fetchCloudflareEdgeInfo};
});

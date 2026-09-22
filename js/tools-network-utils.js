/* Shared validation/formatting for the network tools (Пінг + Speedtest).
   Pure logic, no DOM: safe to unit-test in Node. UI strings stay human
   (the compact-tools contract: no protocol jargon in what the fitter sees). */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTNetUtils=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const IPV4_RE=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const HOSTNAME_RE=/^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9_-]{1,63}(?<!-))*$/i;
  /* Values that must never be probed, fetched or passed anywhere. */
  const BANNED_SCHEME_RE=/^(?:javascript|data|file|blob|vbscript|about):/i;

  function isValidIPv4(value){
    const match=IPV4_RE.exec(String(value==null?'':value).trim());
    return !!match&&match.slice(1).every(part=>Number(part)<=255);
  }

  function isPrivateIPv4(value){
    const match=IPV4_RE.exec(String(value==null?'':value).trim());
    if(!match||match.slice(1).some(part=>Number(part)>255))return false;
    const first=Number(match[1]),second=Number(match[2]);
    if(first===10||first===127||first===0)return true;
    if(first===192&&second===168)return true;
    if(first===172&&second>=16&&second<=31)return true;
    if(first===169&&second===254)return true;
    return false;
  }

  function isValidIpv6(value){
    const text=String(value==null?'':value).trim().replace(/^\[|\]$/g,'');
    if(!text||!text.includes(':'))return false;
    try{new URL('http://['+text+']/');return true;}catch(_error){return false;}
  }

  function isPrivateIpv6(value){
    const text=String(value==null?'':value).trim().replace(/^\[|\]$/g,'').toLowerCase();
    return text==='::1'||text.startsWith('fe80:')||text.startsWith('fc')||text.startsWith('fd');
  }

  /* One entry point for the ping target field. Never throws. Returns
     {ok:true, kind, host, local, note?} or {ok:false, error:<human UA>}.
     kind: 'ipv4' | 'ipv6' | 'hostname' | 'local-ipv4' | 'local-ipv6'.
     URLs are reduced to their hostname (the path is ignored, not fetched);
     schemes that cannot be a network target are rejected outright. */
  function parseTargetInput(raw){
    let text=String(raw==null?'':raw).trim();
    if(!text)return{ok:false,error:'Введіть IP-адресу або домен'};
    if(BANNED_SCHEME_RE.test(text))return{ok:false,error:'Таке значення перевірити не можна. Введіть IP або домен'};
    if(/^[a-z][a-z0-9+.-]*:\/\//i.test(text)){
      let parsed=null;
      try{parsed=new URL(text);}catch(_error){return{ok:false,error:'Не вдалося розпізнати адресу. Введіть IP або домен'};}
      const host=parsed.hostname;
      if(!host)return{ok:false,error:'Не вдалося розпізнати домен. Введіть IP або домен'};
      const inner=parseTargetInput(host);
      const path=parsed.pathname&&parsed.pathname!=='/'?parsed.pathname:'';
      if(inner.ok&&path)inner.note='Перевіряється лише '+host+' (шлях "'+path+'" ігнорується)';
      return inner;
    }
    const hasBrackets=text.includes(']');
    let port=null;
    const portMatch=/^(.+):(\d{1,5})$/.exec(text);
    if(portMatch&&!hasBrackets){
      const left=portMatch[1].replace(/^\[|\]$/g,'');
      const portNum=Number(portMatch[2]);
      if(portNum>=1&&portNum<=65535&&(isValidIPv4(left)||HOSTNAME_RE.test(left))){
        text=left;port=String(portNum); // порт полезен только локальной HTTP-проверке
      }
    }
    const bare=text.replace(/^\[|\]$/g,'');
    if(IPV4_RE.test(bare)){
      if(!isValidIPv4(bare))return{ok:false,error:'Некоректна IPv4-адреса'};
      const local=isPrivateIPv4(bare);
      const result={ok:true,kind:local?'local-ipv4':'ipv4',host:bare,local};
      if(port)result.port=port;
      return result;
    }
    if(bare.includes(':')||hasBrackets){
      if(!isValidIpv6(bare))return{ok:false,error:'Некоректна IPv6-адреса'};
      const local=isPrivateIpv6(bare);
      return{ok:true,kind:local?'local-ipv6':'ipv6',host:bare,local};
    }
    /* Digit-only dotted values (1.2.3, 1.2.3.4.5) are broken IPs, not hostnames. */
    if(/^\d+(\.\d+)+$/.test(bare))return{ok:false,error:'Некоректна IPv4-адреса'};
    if(!HOSTNAME_RE.test(text))return{ok:false,error:'Некоректний домен або IP. Приклади: 1.1.1.1, google.com'};
    const result={ok:true,kind:'hostname',host:text.toLowerCase(),local:false};
    if(port)result.port=port;
    return result;
  }

  /* The external probe service never sees the phone's LAN: callers must route
     local targets to the local device check instead. This predicate is the
     single source of that decision. */
  function isLocalTarget(parsed){return !!parsed&&parsed.ok===true&&parsed.local===true;}

  const MS_SCALE=['мс','с'];
  function formatMs(value){
    if(!Number.isFinite(value))return '—';
    if(value>=1000)return (value/1000).toFixed(value>=10000?0:1).replace('.',',')+' с';
    return String(Math.round(value))+' мс';
  }

  /* Engine reports bits per second; the UI speaks Мбіт/с. */
  function bpsToMbps(bps){
    if(!Number.isFinite(bps)||bps<=0)return null;
    return Math.round(bps/1e6*10)/10;
  }

  return{IPV4_RE,HOSTNAME_RE,isValidIPv4,isPrivateIPv4,isValidIpv6,isPrivateIpv6,parseTargetInput,isLocalTarget,formatMs,bpsToMbps};
});

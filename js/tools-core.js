(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTToolsCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const DIAGNOSTIC_VERSION='browser-v1';
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
  function listProfiles(tickets=[]){
    const groups=new Map();
    tickets.forEach(ticket=>{
      if(!ticket||!text(ticket.city)||!text(ticket.street))return;
      const id=profileId(ticket);
      if(!groups.has(id))groups.set(id,{id,...profileParts(ticket),address:addressLabel(ticket),tickets:[]});
      groups.get(id).tickets.push(ticket);
    });
    return [...groups.values()].sort((a,b)=>a.address.localeCompare(b.address,'uk'));
  }
  function profileFromTickets(items=[]){
    const first=items[0]||{};
    return {id:profileId(first),...profileParts(first),address:addressLabel(first)};
  }
  function sanitizeDiagnosticResult(result={}){
    const resources=Array.isArray(result.resources)?result.resources.slice(0,10).map(item=>({
      label:text(item?.label).slice(0,80),ok:!!item?.ok,
      httpMs:Number.isFinite(Number(item?.httpMs))?Math.round(Number(item.httpMs)):null,
      status:Number.isFinite(Number(item?.status))?Number(item.status):null
    })):[];
    return {
      online:!!result.online,publicIp:text(result.publicIp).slice(0,80),
      ipFamily:['IPv4','IPv6','IPv4/IPv6'].includes(result.ipFamily)?result.ipFamily:'',
      ipv4:result.ipv4===true,ipv6:result.ipv6===true,
      latencyMs:Number.isFinite(Number(result.latencyMs))?Math.round(Number(result.latencyMs)):null,
      jitterMs:Number.isFinite(Number(result.jitterMs))?Math.round(Number(result.jitterMs)):null,
      downloadMbps:Number.isFinite(Number(result.downloadMbps))?Number(result.downloadMbps):null,
      uploadMbps:Number.isFinite(Number(result.uploadMbps))?Number(result.uploadMbps):null,
      resources
    };
  }
  function makeDiagnosticRecord(result,profile=null,now=new Date()){
    return {
      id:`diag-${now.getTime()}-${Math.random().toString(36).slice(2,8)}`,
      timestamp:now.toISOString(),version:DIAGNOSTIC_VERSION,
      profileId:profile?.id||'',address:profile?.address||'',
      result:sanitizeDiagnosticResult(result)
    };
  }
  function previousDiagnostic(history=[],profileIdValue,beforeTimestamp){
    return history.filter(item=>item?.profileId===profileIdValue&&item?.timestamp!==beforeTimestamp)
      .sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)))[0]||null;
  }
  function diagnosticComparison(current,previous){
    if(!current||!previous)return[];
    const fields=[['downloadMbps','Download','Mbps'],['uploadMbps','Upload','Mbps'],['latencyMs','HTTP latency','мс'],['jitterMs','HTTP jitter','мс']];
    return fields.flatMap(([key,label,unit])=>{
      const from=Number(previous.result?.[key]),to=Number(current.result?.[key]);
      return Number.isFinite(from)&&Number.isFinite(to)?[{key,label,unit,from,to}]:[];
    });
  }
  function diagnosticReport(result,context=null,at=new Date()){
    const r=sanitizeDiagnosticResult(result),lines=['Діагностика',at.toLocaleString('uk-UA')];
    if(context?.address)lines.push(`Адреса: ${context.address}`);
    lines.push(`Інтернет: ${r.online?'доступний':'немає з’єднання'}`);
    if(r.publicIp)lines.push(`External IP: ${r.publicIp}${r.ipFamily?` (${r.ipFamily})`:''}`);
    if(r.ipv4||r.ipv6)lines.push(`IP: ${r.ipv4?'IPv4 ':''}${r.ipv6?'IPv6':''}`.trim());
    r.resources.forEach(item=>lines.push(`${item.label}: ${item.ok?'доступний':'недоступний'}${item.httpMs!==null?`, HTTP ${item.httpMs} мс`:''}`));
    if(r.downloadMbps!==null)lines.push(`Download: ${r.downloadMbps} Mbps`);
    if(r.uploadMbps!==null)lines.push(`Upload: ${r.uploadMbps} Mbps`);
    if(r.latencyMs!==null)lines.push(`HTTP latency: ${r.latencyMs} мс`);
    if(r.jitterMs!==null)lines.push(`HTTP jitter: ${r.jitterMs} мс`);
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
      createdAt,updatedAt:safeNow.toISOString()
    };
  }
  function networkPointAddress(value={}){return [text(value.city),text(value.street),text(value.house)].filter(Boolean).join(', ');}
  function searchNetworkPoints(points=[],query=''){
    const needle=text(query).toLocaleLowerCase('uk');
    if(!needle)return points.slice();
    return points.filter(point=>[point.type,point.name,point.label,point.city,point.street,point.house,point.note].some(value=>text(value).toLocaleLowerCase('uk').includes(needle)));
  }
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
  function sanitizeDiagnostics(value){
    if(!Array.isArray(value))return[];
    return value.slice(0,5000).flatMap(item=>{
      if(!item||typeof item!=='object'||!text(item.id)||!text(item.timestamp))return[];
      return [{id:text(item.id),timestamp:text(item.timestamp),version:text(item.version)||DIAGNOSTIC_VERSION,profileId:text(item.profileId),address:text(item.address),result:sanitizeDiagnosticResult(item.result)}];
    });
  }
  function sanitizeNetworkPoints(value){
    if(!Array.isArray(value))return[];
    return value.slice(0,5000).flatMap(item=>{const point=normalizeNetworkPoint(item,new Date(item?.updatedAt||Date.now()));return point?[point]:[];});
  }

  return {DIAGNOSTIC_VERSION,NETWORK_POINT_TYPES,MAP_CATEGORIES,profileParts,profileId,houseId,addressLabel,parseCoordinates,listProfiles,profileFromTickets,sanitizeDiagnosticResult,makeDiagnosticRecord,previousDiagnostic,diagnosticComparison,diagnosticReport,mapObjects,filterMapObjects,normalizeNetworkPoint,networkPointAddress,searchNetworkPoints,estimateOfflineArea,normalizeOfflineArea,sanitizeOfflineAreas,offlineBoundsOverlap,sanitizeDiagnostics,sanitizeNetworkPoints};
});

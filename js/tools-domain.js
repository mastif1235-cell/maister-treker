/* Field tools. Data stays local except explicit address-coordinate sync and explicit Telegram sharing. */
const MT_TOOLS_DIAGNOSTICS_KEY='mtSavedDiagnosticsV1';
const MT_TOOLS_NETWORK_POINTS_KEY='mtNetworkPointsV1';
const MT_TOOLS_DRAFT_KEY='mtToolsCalculatorDraftV1';
const MT_TOOLS_OFFLINE_BOUNDS_KEY='mtOfflineAreaBoundsV1';
const MT_TOOLS_OFFLINE_AREAS_KEY='mtOfflineAreasV1';
let toolsView='home';
let toolsDiagnosticContext=null;
let toolsDiagnosticResult=null;
let toolsDiagnosticRunAt=null;
let toolsDiagnosticSaved=false;
let toolsReturnTab='tools';
let toolsCalculatorDraft=null;
let toolsOfflinePendingBounds=null;
let toolsOfflineEditingAreaId='';
let toolsOfflineImportAreaId='';
let toolsLastUserLocation=null;
let toolsMapReturnContext=null;
let toolsDiagnostics=MTToolsCore.sanitizeDiagnostics(loadJSON(MT_TOOLS_DIAGNOSTICS_KEY,[]));
let toolsNetworkPoints=MTToolsCore.sanitizeNetworkPoints(loadJSON(MT_TOOLS_NETWORK_POINTS_KEY,[]));
function toolsLoadOfflineAreas(){
  let areas=MTToolsCore.sanitizeOfflineAreas(loadJSON(MT_TOOLS_OFFLINE_AREAS_KEY,[]));
  if(!areas.length){const legacy=loadJSON(MT_TOOLS_OFFLINE_BOUNDS_KEY,null),migrated=legacy&&MTToolsCore.normalizeOfflineArea({...legacy,name:'Робоча область'});if(migrated){areas=[migrated];toolsSaveLocal(MT_TOOLS_OFFLINE_AREAS_KEY,areas);}}
  return areas;
}
function toolsSaveOfflineAreas(value){return toolsSaveLocal(MT_TOOLS_OFFLINE_AREAS_KEY,MTToolsCore.sanitizeOfflineAreas(value));}

function toolsSaveLocal(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(_e){showToast('Не вдалося зберегти локальні дані');return false;}
}
function toolsSaveDiagnostics(){return toolsSaveLocal(MT_TOOLS_DIAGNOSTICS_KEY,toolsDiagnostics);}
function toolsSaveNetworkPoints(){return toolsSaveLocal(MT_TOOLS_NETWORK_POINTS_KEY,toolsNetworkPoints);}
function toolsExportData(){return{diagnostics:MTToolsCore.sanitizeDiagnostics(toolsDiagnostics),networkPoints:MTToolsCore.sanitizeNetworkPoints(toolsNetworkPoints)};}
function toolsRestoreData(data={}){
  if(Array.isArray(data.diagnostics)){
    toolsDiagnostics=MTToolsCore.sanitizeDiagnostics(data.diagnostics);
    if(!toolsSaveDiagnostics())throw new Error('TOOLS_DIAGNOSTICS_WRITE_FAILED');
  }
  if(Array.isArray(data.networkPoints)){
    toolsNetworkPoints=MTToolsCore.sanitizeNetworkPoints(data.networkPoints);
    if(!toolsSaveNetworkPoints())throw new Error('TOOLS_POINTS_WRITE_FAILED');
  }
  renderToolsScreen();
  return true;
}
function toolsPhotoOwnerRecords(){return toolsNetworkPoints.filter(point=>(point.photoKeys||[]).length||point.photoKey).map(point=>({photos:(point.photoKeys||[point.photoKey]).filter(Boolean)}));}

function toolsHomeHtml(){
  return `<div class="tools-grid">
    <button type="button" class="btn" data-tools-view="map"><span class="tools-icon">🗺️</span>Карта</button>
    <button type="button" class="btn" data-tools-action="quick-diagnostics"><span class="tools-icon">🛠</span>Діагностика</button>
    <button type="button" class="btn" data-tools-view="network"><span class="tools-icon">📡</span>Точки мережі</button>
    <button type="button" class="btn" data-tools-view="offline"><span class="tools-icon">⬇️</span>Офлайн-карта</button>
  </div>
  <div class="card" style="margin-top:12px;font-size:12px;color:var(--text-dim);">Інструменти зберігають дані лише на цьому пристрої. Діагностика не створює записів без явного натискання «Зберегти».</div>`;
}
function toolsBackButton(){return `<button type="button" class="btn btn-sm btn-ghost" data-tools-view="home" style="margin-bottom:10px;">← Інструменти</button>`;}
function toolsContextHtml(){
  return toolsDiagnosticContext?.address
    ? `<div class="card" style="font-size:13px;"><strong>📍 ${escapeHtml(toolsDiagnosticContext.address)}</strong><div style="color:var(--text-dim);margin-top:3px;">Результат збережеться лише після вашого підтвердження.</div></div>`
    : `<div class="card" style="font-size:13px;color:var(--text-dim);">Швидка діагностика без адреси. За замовчуванням результат ніде не зберігається.</div>`;
}
function toolsDiagnosticResultsHtml(){
  if(!toolsDiagnosticResult)return `<div class="card" style="text-align:center;color:var(--text-dim);">Натисніть «Запустити». Перевірка не змінює заявки чи профілі.</div>`;
  const r=MTToolsCore.sanitizeDiagnosticResult(toolsDiagnosticResult);
  const rows=[
    ['Інтернет',r.online?'✅ Доступний':'❌ Немає з’єднання'],
    ['Public IP',r.publicIp?escapeHtml(r.publicIp.split(' / ')[0]):'Недоступно'],
    ['IPv4',r.ipv4?'✅ Доступний':'Недоступно / не підтверджено']
  ];
  r.resources.forEach(item=>rows.push([item.label,item.ok?`✅ HTTP ${item.httpMs??'—'} мс`:'❌ Недоступний']));
  rows.push(['HTTP latency',r.latencyMs!==null?`${r.latencyMs} мс`:'Недоступно в браузері']);
  rows.push(['HTTP jitter',r.jitterMs!==null?`${r.jitterMs} мс`:'Недоступно в браузері']);
  const actions=toolsDiagnosticContext
    ? `<button type="button" class="btn btn-accent" data-tools-action="save-diagnostics" style="flex:1;" ${toolsDiagnosticSaved?'disabled':''}>${toolsDiagnosticSaved?'✅ Збережено':'Зберегти в профіль'}</button>`
    : `<button type="button" class="btn" data-tools-action="attach-diagnostics" style="flex:1;">Прив'язати до адреси</button>`;
  return `<div class="card">${rows.map(row=>`<div class="tools-result-row"><span>${escapeHtml(row[0])}</span><strong style="text-align:right;">${row[1]}</strong></div>`).join('')}</div>
    <button type="button" class="btn btn-block" data-tools-action="external-speed-test" style="margin-bottom:10px;">⚡ Перевірити швидкість</button>
    <div style="font-size:11.5px;color:var(--text-dim);margin:-4px 0 12px;">Відкриється офіційний Cloudflare Speed Test у новій вкладці. Тест може використати значний обсяг мобільного трафіку.</div>
    <div class="row wrap"><button type="button" class="btn" data-tools-action="copy-diagnostics" style="flex:1;">📋 Скопіювати</button>${actions}</div>`;
}
function toolsOpenExternalSpeedTest(){window.open('https://speed.cloudflare.com/','_blank','noopener');}
function toolsDiagnosticsHtml(){
  return `${toolsBackButton()}${toolsContextHtml()}
    <button type="button" class="btn btn-accent btn-block" data-tools-action="run-diagnostics" id="toolsRunDiagnosticsBtn">🛠 Запустити діагностику</button>
    <div id="toolsDiagnosticsResults" style="margin-top:12px;">${toolsDiagnosticResultsHtml()}</div>
    ${toolsReturnTab==='calculator'?'<button type="button" class="btn btn-accent btn-block" data-tools-action="return-to-ticket" style="margin-top:12px;">← Повернутися до заявки</button>':''}
    <div class="card" style="margin-top:12px;"><strong>Роутер</strong><div style="font-size:12px;color:var(--text-dim);margin:5px 0 9px;">Автоперевірка локальних адресів ненадійна через HTTPS, CORS і Private Network Access. Відкриття — тільки вручну.</div>
      <div class="row wrap">${['192.168.0.1','192.168.1.1','192.168.100.1'].map(ip=>`<button type="button" class="btn btn-sm" data-router-ip="${ip}">${ip}</button>`).join('')}</div></div>`;
}

async function toolsTimedFetch(url,timeoutMs=5000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),started=performance.now();
  try{
    const response=await fetch(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
    return{ok:response.ok,status:response.status,httpMs:Math.max(0,Math.round(performance.now()-started)),response};
  }catch(_e){return{ok:false,status:0,httpMs:null,response:null};}
  finally{clearTimeout(timer);}
}
async function toolsFetchIp(url){
  const measured=await toolsTimedFetch(`${url}?format=json&_=${Date.now()}-${Math.random().toString(36).slice(2)}`,5000);
  if(!measured.ok)return{...measured,ip:''};
  try{const body=await measured.response.json();return{...measured,ip:String(body?.ip||'').slice(0,80)};}catch(_e){return{...measured,ok:false,ip:''};}
}
async function runToolsDiagnostics(){
  const button=document.getElementById('toolsRunDiagnosticsBtn');
  if(button){button.disabled=true;button.textContent='⏳ Перевіряю…';}
  const online=navigator.onLine;
  const result={online,resources:[],publicIp:'',ipFamily:'',ipv4:false,ipv6:false,latencyMs:null,jitterMs:null,downloadMbps:null,uploadMbps:null};
  if(online){
    const appCheck=await toolsTimedFetch(`./index.html?mt_diag=${Date.now()}`,5000);
    result.resources.push({label:'Майстер-Трекер HTTPS',ok:appCheck.ok,httpMs:appCheck.httpMs,status:appCheck.status});
    const [v4,v6]=await Promise.all([toolsFetchIp('https://api.ipify.org'),toolsFetchIp('https://api6.ipify.org')]);
    result.ipv4=!!v4.ip;result.ipv6=!!v6.ip;
    result.publicIp=[v4.ip,v6.ip].filter(Boolean).join(' / ');
    result.ipFamily=result.ipv4&&result.ipv6?'IPv4/IPv6':result.ipv6?'IPv6':result.ipv4?'IPv4':'';
    const samples=[];
    for(let i=0;i<3;i++){
      const sample=await toolsFetchIp('https://api64.ipify.org');
      if(sample.ok&&sample.httpMs!==null)samples.push(sample.httpMs);
      if(i===0)result.resources.push({label:'Public IP HTTPS',ok:sample.ok,httpMs:sample.httpMs,status:sample.status});
    }
    if(samples.length){
      result.latencyMs=Math.round(samples.reduce((sum,value)=>sum+value,0)/samples.length);
      result.jitterMs=samples.length>1?Math.round(samples.slice(1).reduce((sum,value,index)=>sum+Math.abs(value-samples[index]),0)/(samples.length-1)):0;
    }
  }
  toolsDiagnosticResult=result;toolsDiagnosticRunAt=new Date();toolsDiagnosticSaved=false;
  renderToolsScreen('diagnostics');
}
function toolsOpenDiagnostics(context=null,returnTab='tools'){
  toolsDiagnosticContext=context;toolsDiagnosticResult=null;toolsDiagnosticRunAt=null;toolsDiagnosticSaved=false;toolsReturnTab=returnTab;toolsView='diagnostics';
  switchTab('tools');renderToolsScreen('diagnostics');
}
function openToolsDiagnosticsFromCalculator(){
  syncFormToState();
  if(!calcState.city||!calcState.street){showToast('Спочатку вкажіть місто та вулицю');return;}
  toolsCalculatorDraft={state:JSON.parse(JSON.stringify(calcState)),editingTicketId,originalPhotoKeys:(calcOriginalPhotoKeys||[]).slice()};
  try{localStorage.setItem(MT_TOOLS_DRAFT_KEY,JSON.stringify(toolsCalculatorDraft));}catch(_e){}
  const context={id:MTToolsCore.profileId(calcState),...MTToolsCore.profileParts(calcState),address:MTToolsCore.addressLabel(calcState)};
  toolsOpenDiagnostics(context,'calculator');
}
function toolsReturnToTicket(){
  let draft=toolsCalculatorDraft;try{draft=draft||JSON.parse(localStorage.getItem(MT_TOOLS_DRAFT_KEY)||'null');}catch(_e){}
  if(!draft?.state){showToast('Чернетку заявки не знайдено');return;}
  calcState=JSON.parse(JSON.stringify(draft.state));editingTicketId=draft.editingTicketId??null;calcOriginalPhotoKeys=Array.isArray(draft.originalPhotoKeys)?draft.originalPhotoKeys.slice():[];
  fillFormFromState();document.getElementById('saveTicketBtn').textContent=editingTicketId?'Оновити заявку':'Зберегти заявку';document.getElementById('cancelEditBtn').classList.toggle('hidden',!editingTicketId);
  switchTab('calculator');showToast('Чернетку заявки відновлено');
}
function openToolsDiagnosticsFromProfile(ids=[]){
  const list=tickets.filter(ticket=>ids.some(id=>String(id)===String(ticket.id)));
  if(!list.length){showToast('Профіль не знайдено');return;}
  toolsOpenDiagnostics(MTToolsCore.profileFromTickets(list),'tickets');
}
function toolsProfileDiagnosticsHtml(list=[]){
  const profile=MTToolsCore.profileFromTickets(list),history=toolsDiagnostics.filter(item=>item.profileId===profile.id).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
  const latest=history[0],previous=history[1],comparison=latest&&previous?MTToolsCore.diagnosticComparison(latest,previous):[];
  const historyHtml=history.slice(0,5).map(item=>{
    const result=item.result||{},metrics=[result.latencyMs!==null&&result.latencyMs!==undefined?`HTTP ${result.latencyMs} мс`:'',result.downloadMbps!==null&&result.downloadMbps!==undefined?`${result.downloadMbps} Mbps`:''].filter(Boolean).join(' · ');
    return `<div style="font-size:11.5px;color:var(--text-dim);margin-top:4px;">${escapeHtml(new Date(item.timestamp).toLocaleString('uk-UA'))}${metrics?` — ${escapeHtml(metrics)}`:''}</div>`;
  }).join('');
  const ids=escapeHtml(JSON.stringify(list.map(ticket=>ticket.id)));
  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
    <div class="row between"><strong style="font-size:13px;">🛠 Діагностика</strong><button type="button" class="btn btn-sm abonent-diagnostics-btn" data-ids="${ids}">Запустити</button></div>
    ${latest?`<div style="font-size:12px;color:var(--text-dim);margin-top:7px;">Історія:</div>${historyHtml}${comparison.map(item=>`<div style="font-size:12px;margin-top:3px;">${escapeHtml(item.label)}: ${item.from} → ${item.to} ${item.unit}</div>`).join('')}`:'<div style="font-size:12px;color:var(--text-faint);margin-top:7px;">Збережених результатів немає</div>'}
  </div>`;
}
function toolsAttachDiagnostics(){
  const profiles=MTToolsCore.listProfiles(tickets);
  if(!profiles.length){showToast('Немає існуючих адрес для прив’язки');return;}
  openModal('Прив’язати діагностику',`<div style="max-height:60vh;overflow:auto;">${profiles.map((profile,index)=>`<button type="button" class="btn btn-block tools-profile-choice" data-index="${index}" style="margin-bottom:8px;text-align:left;justify-content:flex-start;">📍 ${escapeHtml(profile.address)}</button>`).join('')}</div>`,{onOpen:root=>{
    root.addEventListener('click',event=>{const button=event.target.closest('.tools-profile-choice');if(!button)return;toolsDiagnosticContext=profiles[Number(button.dataset.index)];closeModal();renderToolsScreen('diagnostics');});
  }});
}
function toolsSaveCurrentDiagnostic(){
  if(!toolsDiagnosticResult||!toolsDiagnosticContext||toolsDiagnosticSaved)return;
  const record=MTToolsCore.makeDiagnosticRecord(toolsDiagnosticResult,toolsDiagnosticContext,toolsDiagnosticRunAt||new Date());
  toolsDiagnostics.push(record);
  if(toolsSaveDiagnostics()){toolsDiagnosticSaved=true;showToast('Діагностику збережено в профіль');renderToolsScreen('diagnostics');}
}
async function toolsCopyDiagnostic(){
  if(!toolsDiagnosticResult)return;
  const report=MTToolsCore.diagnosticReport(toolsDiagnosticResult,toolsDiagnosticContext,toolsDiagnosticRunAt||new Date());
  try{await navigator.clipboard.writeText(report);showToast('Діагностику скопійовано');}catch(_e){showToast('Не вдалося скопіювати');}
}

function toolsMapHtml(){
  const objects=MTToolsCore.mapObjects(tickets,toolsNetworkPoints);
  const offline=MTOfflineMap?.readMeta?.();
  const mode=MTOfflineMap?.getMode?.()||'auto';
  const filters=MTToolsCore.MAP_CATEGORIES.map(category=>{
    const meta=MTToolsMap.CATEGORY_META[category];
    return `<button type="button" class="tools-map-filter active" data-map-filter="${escapeHtml(category)}" aria-pressed="true">${meta.icon} ${escapeHtml(meta.label)}</button>`;
  }).join('');
  return `${toolsBackButton()}
    <div class="row wrap tools-map-actions"><button type="button" class="btn btn-accent" data-tools-action="map-add-object" style="flex:1;">＋ Додати об’єкт</button><button type="button" class="btn" data-tools-action="map-my-location" style="flex:1;">◎ Моє місце</button><button type="button" class="btn ${toolsLastUserLocation?'':'hidden'}" id="toolsAddAtLocationBtn" data-tools-action="map-add-at-location" style="flex:1 0 100%;">＋ Додати об’єкт тут</button><button type="button" class="btn" data-tools-action="map-bind-address" style="flex:1 0 100%;">📍 Прив’язати адресу</button></div>
    <div class="card tools-map-privacy">Підкладка: OpenStreetMap. Постачальник плиток отримує лише координати видимої ділянки — без ПІБ, телефонів, адресного тексту, MAC, нотаток, фото чи історії.</div>
    <div class="card tools-offline-map-card">
      <div class="row between wrap"><div><strong>Офлайн-карта: ${offline?'✅ встановлена':'не встановлена'}</strong>${offline?`<div class="tools-offline-map-meta">${escapeHtml(MTOfflineMap.formatBytes(offline.size))} · Z${offline.header.minZoom}–Z${offline.header.maxZoom}</div>`:''}</div>
        <select id="toolsMapBaseMode" class="tools-map-mode" aria-label="Режим підкладки"><option value="auto" ${mode==='auto'?'selected':''}>Авто</option><option value="online" ${mode==='online'?'selected':''}>Онлайн</option><option value="offline" ${mode==='offline'?'selected':''}>Офлайн</option></select></div>
      <div class="row wrap" style="margin-top:8px;"><button type="button" class="btn btn-sm" data-tools-view="offline" style="flex:1;">Офлайн-карти</button>${offline?'<button type="button" class="btn btn-sm btn-danger" data-tools-action="delete-offline-map">Видалити</button>':''}</div>
      <input type="file" id="toolsOfflineMapFile" accept=".pmtiles,application/octet-stream" class="hidden">
    </div>
    <div class="tools-map-filters" id="toolsMapFilters" aria-label="Фільтри об’єктів карти"><button type="button" class="tools-map-filter active" data-map-filter="all" aria-pressed="true">Усі</button>${filters}</div>
    ${objects.length?'':'<div class="card" style="font-size:12px;color:var(--text-dim);">Немає об’єктів із координатами. Додайте геолокацію до профілю або створіть точку мережі.</div>'}
    <div id="toolsMapStatus" class="tools-map-status hidden" role="status"></div>
    <div class="tools-map-shell"><div class="tools-map" id="toolsLeafletMap" aria-label="Інтерактивна карта об’єктів"></div><div id="toolsMapEmptyState" class="tools-map-empty hidden"><strong>Для цієї області офлайн-карта ще не завантажена.</strong><div class="row wrap"><button type="button" class="btn btn-sm" data-tools-action="map-use-online">Онлайн</button><button type="button" class="btn btn-sm" data-tools-view="offline">Офлайн-карти</button><button type="button" class="btn btn-sm" data-tools-action="import-offline-map">Додати файл карти</button></div></div></div>`;
}
function toolsOpenPointEditorFromMap(point,placement){
  toolsOpenNetworkPointEditor('',{type:'FOB',...point},{placement,returnView:'map'});
}
function toolsStartMapAddMode(point=null){
  const status=document.getElementById('toolsMapStatus');
  if(status){status.textContent=point?'Перетягніть робочий маркер за потреби.':'Натисніть місце на карті для нового об’єкта.';status.classList.remove('hidden');}
  const placement=MTToolsMap.startPointPlacement({initial:point,onPlace:toolsOpenPointEditorFromMap});
  if(!placement)showToast('Карта ще не готова');
}
function toolsLocateOnMap(){
  if(!navigator.geolocation){showToast('Геолокація не підтримується');return;}
  showToast('Визначаю ваше місце…');navigator.geolocation.getCurrentPosition(position=>{toolsLastUserLocation={lat:position.coords.latitude,lng:position.coords.longitude};MTToolsMap.showUserLocation(toolsLastUserLocation,position.coords.accuracy);document.getElementById('toolsAddAtLocationBtn')?.classList.remove('hidden');showToast(`Місце знайдено${position.coords.accuracy?` · точність ≈ ${Math.round(position.coords.accuracy)} м`:''}. GPS-маркер не переміщується.`);},()=>showToast('Доступ до геолокації заборонено або місце недоступне'),{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}
function toolsBindAddressFromMap(){
  const profiles=MTToolsCore.listProfiles(tickets);if(!profiles.length){showToast('Немає існуючих адрес для прив’язки');return;}
  const point=MTToolsMap.currentCenter?.();if(!point){showToast('Карта ще не готова');return;}
  openModal('Прив’язати існуючу адресу',`<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Буде використано центр карти. Нова адреса не створюється.</div><div style="max-height:60vh;overflow:auto;">${profiles.map((profile,index)=>`<button type="button" class="btn btn-block tools-address-choice" data-index="${index}" style="margin-bottom:7px;text-align:left;">${escapeHtml(profile.address)}</button>`).join('')}</div>`,{onOpen:root=>root.onclick=async event=>{const button=event.target.closest('.tools-address-choice');if(!button)return;const profile=profiles[Number(button.dataset.index)],list=tickets.filter(ticket=>MTToolsCore.profileId(ticket)===profile.id);list.forEach(ticket=>{ticket.geoLat=Number(point.lat.toFixed(6));ticket.geoLng=Number(point.lng.toFixed(6));});await saveTickets();closeModal();renderToolsScreen('map');showToast('✅ Існуючу адресу прив’язано');}});
}
function toolsBoundsLabel(header={}){
  return `${Number(header.minLat).toFixed(4)}, ${Number(header.minLon).toFixed(4)} → ${Number(header.maxLat).toFixed(4)}, ${Number(header.maxLon).toFixed(4)}`;
}
async function toolsPrepareOfflineMap(file,areaId=toolsOfflineImportAreaId){
  if(!file)return;
  if(!MTOfflineMap?.supported?.()){showToast('Цей браузер не підтримує локальне сховище офлайн-карти');return;}
  showToast('Перевіряю PMTiles…');
  try{
    const [info,quota]=await Promise.all([MTOfflineMap.inspectFile(file),MTOfflineMap.quotaFor(file.size)]),area=toolsLoadOfflineAreas().find(item=>item.id===areaId),overlap=area?MTToolsCore.offlineBoundsOverlap(area,info.header):null;
    if(quota.enough===false){showToast('Недостатньо вільного місця для цієї карти');return;}
    const quotaText=quota.available===null?'Доступний обсяг браузер не повідомив.':`Орієнтовно вільно: ${MTOfflineMap.formatBytes(quota.available)}.`;
    const matchText=area?(overlap>=.65?`✅ Файл відповідає області «${escapeHtml(area.name)}».`:`⚠️ Межі файла помітно відрізняються від області «${escapeHtml(area.name)}» (${Math.round(overlap*100)}% покриття). Імпорт дозволений, але перевірте територію.`):'Файл буде встановлено як активна офлайн-підкладка без прив’язки до збереженої області.';
    openModal('Офлайн-карта',`<div class="card" style="font-size:13px;line-height:1.55;"><strong>${escapeHtml(info.fileName)}</strong><br>Розмір: ${escapeHtml(MTOfflineMap.formatBytes(info.size))}<br>Територія: ${escapeHtml(toolsBoundsLabel(info.header))}<br>Масштаби: Z${info.header.minZoom}–Z${info.header.maxZoom}<br><span style="color:var(--text-dim);">${escapeHtml(quotaText)}</span><div class="tools-map-status" style="margin-top:8px;">${matchText}</div></div><div class="row" style="margin-top:10px;"><button type="button" class="btn btn-accent" id="toolsOfflineMapConfirmBtn" style="flex:1;">Встановити офлайн-карту</button><button type="button" class="btn" id="toolsOfflineMapCancelBtn">Скасувати</button></div>`,{onOpen:()=>{
      document.getElementById('toolsOfflineMapCancelBtn').onclick=closeModal;
      document.getElementById('toolsOfflineMapConfirmBtn').onclick=async event=>{
        const button=event.currentTarget;button.disabled=true;button.textContent='Зберігаю…';
        try{await MTOfflineMap.install(file,info,{areaId:area?.id||''});toolsOfflineImportAreaId='';closeModal();renderToolsScreen('offline');showToast('✅ Офлайн-карту встановлено');}
        catch(_e){button.disabled=false;button.textContent='Спробувати ще';showToast('Не вдалося зберегти карту. Попередню карту не змінено');}
      };
    }});
  }catch(error){
    const message=String(error?.message||'');
    showToast(message==='PMTILES_RASTER_REQUIRED'?'Потрібен raster PMTiles (PNG/JPEG/WebP/AVIF)':'Файл не є підтримуваною PMTiles-картою');
  }
}
async function toolsDeleteOfflineMap(){
  if(!confirm('Видалити лише офлайн-карту? Заявки, точки, фото й налаштування залишаться.'))return;
  const ok=await MTOfflineMap.remove();
  if(ok){renderToolsScreen('map');showToast('Офлайн-карту видалено');}else showToast('Не вдалося видалити офлайн-карту');
}
function toolsOfflineSelectionHtml(value){
  if(!value)return '<div style="font-size:12px;color:var(--text-dim);">Область ще не вибрана.</div>';
  const estimate=MTToolsCore.estimateOfflineArea(value,value.minZoom||10,value.maxZoom||16),large=(estimate?.bytes||0)>500*1024*1024;
  const editing=toolsLoadOfflineAreas().find(item=>item.id===toolsOfflineEditingAreaId);
  return `<div class="card" style="margin-top:10px;"><strong>${editing?'Змінити область':'Нова область'}</strong><div class="field" style="margin-top:8px;"><label>Назва області</label><input id="toolsOfflineAreaName" value="${escapeHtml(value.name||editing?.name||'')}" placeholder="Наприклад: Дніпро"></div><div class="tools-offline-map-meta">Bounds: ${escapeHtml(toolsBoundsLabel({minLat:value.minLat,minLon:value.minLng,maxLat:value.maxLat,maxLon:value.maxLng}))}<br>Z${value.minZoom}–Z${value.maxZoom} · приблизно ${estimate?.tiles||0} плиток / ${escapeHtml(MTOfflineMap.formatBytes(estimate?.bytes||0))}</div>${large?'<div class="tools-map-status" style="margin-top:8px;">⚠️ Велика область: файл може займати понад 500 МБ. Зменште zoom або прямокутник.</div>':''}<button type="button" class="btn btn-accent btn-block" data-tools-action="save-offline-area" style="margin-top:9px;">Зберегти область</button></div>`;
}
function toolsOfflineAreasHtml(areas=[]){
  const installed=MTOfflineMap.readMeta?.();if(!areas.length)return '<div class="card"><strong>Офлайн-області</strong><div style="font-size:12px;color:var(--text-dim);margin-top:6px;">Збережених областей ще немає.</div></div>';
  return `<div class="card"><strong>Офлайн-області (${areas.length})</strong><div style="margin-top:9px;">${areas.map((area,index)=>{const linked=installed?.areaId===area.id;return `<div class="tools-offline-area-row"><div><strong>${index+1}. ${escapeHtml(area.name)}</strong><div class="tools-offline-map-meta">Z${area.minZoom}–Z${area.maxZoom} · ~${escapeHtml(MTOfflineMap.formatBytes(area.estimatedBytes))}<br>${linked?`✅ Офлайн-карта встановлена · ${escapeHtml(MTOfflineMap.formatBytes(installed.size))}`:'⚠️ Тільки область збережена'}</div></div><div class="row wrap" style="margin-top:7px;"><button type="button" class="btn btn-sm" data-tools-action="show-offline-area" data-area-id="${escapeHtml(area.id)}">Показати на карті</button><button type="button" class="btn btn-sm" data-tools-action="edit-offline-area" data-area-id="${escapeHtml(area.id)}">Змінити</button><button type="button" class="btn btn-sm" data-tools-action="export-offline-area" data-area-id="${escapeHtml(area.id)}">Експортувати параметри</button><button type="button" class="btn btn-sm" data-tools-action="import-offline-area" data-area-id="${escapeHtml(area.id)}">Додати файл карти</button><button type="button" class="btn btn-sm btn-danger" data-tools-action="delete-offline-area" data-area-id="${escapeHtml(area.id)}">Видалити</button></div></div>`;}).join('')}</div></div>`;
}
function toolsOfflineHtml(){
  const areas=toolsLoadOfflineAreas(),shown=toolsOfflinePendingBounds;
  return `${toolsBackButton()}<div class="card"><strong>Як працює офлайн-карта</strong><p style="font-size:13px;color:var(--text-dim);">Збережена область — це лише назва, межі та zoom. Вулиці, дороги й підписи доступні без мережі тільки після встановлення окремого файла карти, підготовленого на ПК або отриманого від дозволеного постачальника. Застосунок не робить масове завантаження з OpenStreetMap.</p><details class="instructions"><summary>Додатково / Імпорт файлу PMTiles</summary><div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Підтримується raster PMTiles. Спочатку збережіть область, потім додайте підготовлений файл до цієї області.</div><button type="button" class="btn btn-block" data-tools-action="import-offline-map">Додати файл карти</button></details><input type="file" id="toolsOfflineMapFile" accept=".pmtiles,application/octet-stream" class="hidden"></div>${toolsOfflineAreasHtml(areas)}
    <div class="card"><strong>Додати область</strong><div style="font-size:12px;color:var(--text-dim);margin:6px 0;">Вкажіть zoom, натисніть «Вибрати область» і поставте дві протилежні точки прямокутника.</div><div class="field-row"><div class="field"><label>Мін. zoom</label><input id="toolsOfflineMinZoom" type="number" min="0" max="22" value="${shown?.minZoom||10}"></div><div class="field"><label>Макс. zoom</label><input id="toolsOfflineMaxZoom" type="number" min="0" max="22" value="${shown?.maxZoom||16}"></div></div><button type="button" class="btn btn-accent btn-block" data-tools-action="select-offline-bounds">▱ Вибрати область</button><div id="toolsOfflineSelection">${toolsOfflineSelectionHtml(shown)}</div></div>
    <div id="toolsOfflineSelectStatus" class="tools-map-status hidden"></div><div id="toolsOfflineSelectMap" class="tools-map"></div>`;
}
function toolsStartOfflineBoundsSelection(){
  const minZoom=Number(document.getElementById('toolsOfflineMinZoom')?.value||10),maxZoom=Number(document.getElementById('toolsOfflineMaxZoom')?.value||16),status=document.getElementById('toolsOfflineSelectStatus');
  if(status){status.textContent='Натисніть дві протилежні точки прямокутника.';status.classList.remove('hidden');}
  MTToolsMap.selectBounds(bounds=>{toolsOfflinePendingBounds={...bounds,minZoom,maxZoom};const selection=document.getElementById('toolsOfflineSelection');if(selection)selection.innerHTML=toolsOfflineSelectionHtml(toolsOfflinePendingBounds,false);if(status)status.textContent='Прямокутник вибрано. Перевірте розмір і натисніть «Зберегти вибір області».';});
}
function toolsSaveOfflineArea(){
  if(!toolsOfflinePendingBounds){showToast('Спочатку виберіть область');return;}const name=document.getElementById('toolsOfflineAreaName')?.value.trim();if(!name){showToast('Вкажіть назву області');return;}
  const areas=toolsLoadOfflineAreas(),at=areas.findIndex(item=>item.id===toolsOfflineEditingAreaId),base=at>=0?areas[at]:{},area=MTToolsCore.normalizeOfflineArea({...base,...toolsOfflinePendingBounds,name});if(at>=0)areas[at]=area;else areas.push(area);
  if(toolsSaveOfflineAreas(areas)){toolsOfflinePendingBounds=null;toolsOfflineEditingAreaId='';renderToolsScreen('offline');showToast('✅ Область збережена');}
}
function toolsEditOfflineArea(id){const area=toolsLoadOfflineAreas().find(item=>item.id===id);if(!area)return;toolsOfflineEditingAreaId=id;toolsOfflinePendingBounds={...area};renderToolsScreen('offline');}
function toolsDeleteOfflineArea(id){const areas=toolsLoadOfflineAreas(),area=areas.find(item=>item.id===id);if(!area||!confirm(`Видалити лише область «${area.name}»? Встановлений PMTiles та інші дані залишаться.`))return;toolsSaveOfflineAreas(areas.filter(item=>item.id!==id));if(toolsOfflineEditingAreaId===id){toolsOfflineEditingAreaId='';toolsOfflinePendingBounds=null;}renderToolsScreen('offline');showToast('Область видалено. Дані та PMTiles не змінено');}
function toolsShowOfflineArea(id){const area=toolsLoadOfflineAreas().find(item=>item.id===id);if(!area)return;MTToolsMap.drawBounds(area);document.getElementById('toolsOfflineSelectMap')?.scrollIntoView({behavior:'smooth',block:'center'});}
function toolsImportOfflineArea(id){toolsOfflineImportAreaId=id;document.getElementById('toolsOfflineMapFile')?.click();}
function toolsExportOfflineArea(id){
  const area=toolsLoadOfflineAreas().find(item=>item.id===id);if(!area)return;
  const payload={format:'master-tracker-offline-area-v1',name:area.name,bounds:{minLat:area.minLat,minLng:area.minLng,maxLat:area.maxLat,maxLng:area.maxLng},zoom:{min:area.minZoom,max:area.maxZoom}};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`master-tracker-area-${String(area.name||'area').replace(/[^a-zа-яіїє0-9_-]+/gi,'-').replace(/^-|-$/g,'')||'area'}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);showToast('Параметри області експортовано. Це не файл карти.');
}
function toolsOpenProfileById(profileId){
  const profile=MTToolsCore.listProfiles(tickets).find(item=>item.id===profileId);
  if(!profile){showToast('Профіль не знайдено');return;}
  toolsMapReturnContext={profileId};
  addrNavState={level:'tickets',city:profile.city,street:profile.street,house:profile.house||'(без номера)',apartment:profile.apartment||'(без кв.)'};
  addrNavSearchQuery='';switchTab('tickets');renderAddressNav();
}
function toolsMapReturnButtonHtml(){return toolsMapReturnContext?'<button type="button" class="btn btn-block abonent-back-map-btn" style="margin-bottom:10px;">← Назад до карти</button>':'';}
function toolsClearMapReturnContext(){toolsMapReturnContext=null;}
function toolsReturnFromProfileToMap(){closeModal();toolsMapReturnContext=null;toolsView='map';switchTab('tools');}
function toolsOpenMapObject(item){
  if(!item)return;
  if(item.kind==='network'){toolsShowNetworkPoint(item.id);return;}
  if(item.profiles.length===1){toolsOpenProfileById(item.profiles[0].id);return;}
  openModal('Відомі квартири',item.profiles.map(profile=>`<button type="button" class="btn btn-block tools-map-profile" data-profile-id="${escapeHtml(profile.id)}" style="margin-bottom:8px;">${escapeHtml(profile.apartment?`кв. ${profile.apartment}`:profile.address)}</button>`).join(''),{onOpen:root=>root.addEventListener('click',event=>{const button=event.target.closest('.tools-map-profile');if(button){closeModal();toolsOpenProfileById(button.dataset.profileId);}})});
}
function openAbonentMapPointPicker(ids=[]){
  const list=tickets.filter(ticket=>ids.some(id=>String(id)===String(ticket.id)));
  if(!list.length){showToast('Профіль не знайдено');return;}
  const source=list.find(ticket=>MTToolsCore.parseCoordinates(`${ticket.geoLat??''},${ticket.geoLng??''}`)||MTToolsCore.parseCoordinates(ticket.geoLink));
  const initial=source&&(MTToolsCore.parseCoordinates(`${source.geoLat??''},${source.geoLng??''}`)||MTToolsCore.parseCoordinates(source.geoLink));
  let picker=null;
  openModal(initial?'📍 Уточнити точку':'📍 Додати на карту',`<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Поставте маркер або перетягніть його. Google Maps посилання залишиться без змін.</div><div id="abonentMapPointStatus" class="tools-map-status hidden"></div><div id="abonentMapPointPicker" class="tools-map tools-map-picker"></div><div class="row" style="margin-top:8px;"><button type="button" class="btn btn-accent" id="abonentMapPointSave" style="flex:1;">Зберегти точку</button><button type="button" class="btn" id="abonentMapPointCancel">Скасувати</button></div>`,{onClose:()=>MTToolsMap.destroyPicker(),onOpen:()=>{
    picker=MTToolsMap.mountPicker(document.getElementById('abonentMapPointPicker'),{initial,statusNode:document.getElementById('abonentMapPointStatus')});
    document.getElementById('abonentMapPointCancel').onclick=closeModal;
    document.getElementById('abonentMapPointSave').onclick=async()=>{
      const point=picker?.getPoint();if(!point){showToast('Натисніть потрібне місце на карті');return;}
      list.forEach(ticket=>{ticket.geoLat=Number(point.lat.toFixed(6));ticket.geoLng=Number(point.lng.toFixed(6));});
      await saveTickets();closeModal();renderAddressNav();showToast('✅ Точку адреси збережено');
    };
  }});
}

function toolsNetworkHtml(){
  const query=String(toolsNetworkSearch||''),list=MTToolsCore.searchNetworkPoints(toolsNetworkPoints,query).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return `${toolsBackButton()}<button type="button" class="btn btn-accent btn-block" data-tools-action="new-network-point">＋ Додати точку</button>
    <div class="field" style="margin-top:10px;"><input id="toolsNetworkSearch" value="${escapeHtml(query)}" placeholder="Пошук: тип, місто, вулиця, примітка"></div>
    <div style="margin-top:8px;">${list.length?list.map(point=>`<button type="button" class="btn btn-block tools-network-open" data-point-id="${escapeHtml(point.id)}" style="height:auto;min-height:58px;margin-bottom:8px;text-align:left;justify-content:space-between;"><span>📡 <strong>${escapeHtml(point.name||point.type||'Без назви')}</strong><small style="display:block;color:var(--text-dim);">${escapeHtml(MTToolsCore.networkPointAddress(point)||`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`)}${point.note?` · ${escapeHtml(point.note.slice(0,50))}`:''}</small></span><span>›</span></button>`).join(''):'<div class="card">Нічого не знайдено.</div>'}</div>`;
}
let toolsNetworkSearch='';
function toolsOpenNetworkPointEditor(id='',defaults={},options={}){
  const existing=toolsNetworkPoints.find(point=>point.id===id)||defaults||{};
  const cities=[...new Set([...(settings.cities||[]),...tickets.map(ticket=>ticket.city)].filter(Boolean))].sort();
  const streets=[...new Set([...Object.values(settings.streets||{}).flat(),...tickets.map(ticket=>ticket.street)].filter(Boolean))].sort();
  const closePointEditor=()=>{document.getElementById('toolsScreenRoot')?.classList.remove('tools-map-editor-open');options.placement?.cancel?.();MTToolsMap.destroyPicker();closeModal();};
  openModal(existing.id?'Редагувати точку':'Нова точка мережі',`
    <div class="field"><label>Тип</label><select id="toolsPointType">${MTToolsCore.NETWORK_POINT_TYPES.map(type=>`<option ${type===(existing.type||'FOB')?'selected':''}>${escapeHtml(type)}</option>`).join('')}</select></div>
    <div class="field-row"><div class="field"><label>Місто</label><input id="toolsPointCity" list="toolsPointCities" value="${escapeHtml(existing.city||'')}"><datalist id="toolsPointCities">${cities.map(value=>`<option value="${escapeHtml(value)}">`).join('')}</datalist></div><div class="field"><label>Вулиця</label><input id="toolsPointStreet" list="toolsPointStreets" value="${escapeHtml(existing.street||'')}"><datalist id="toolsPointStreets">${streets.map(value=>`<option value="${escapeHtml(value)}">`).join('')}</datalist></div></div>
    <div class="field-row"><div class="field"><label>Будинок / орієнтир</label><input id="toolsPointHouse" value="${escapeHtml(existing.house||'')}"></div><div class="field"><label>Коротка позначка</label><input id="toolsPointLabel" value="${escapeHtml(existing.label||'')}"></div></div>
    <div class="field-row"><div class="field"><label>Широта</label><input id="toolsPointLat" inputmode="decimal" value="${existing.lat??''}" placeholder="50.4501"></div><div class="field"><label>Довгота</label><input id="toolsPointLng" inputmode="decimal" value="${existing.lng??''}" placeholder="30.5234"></div></div>
    <div class="row wrap" style="margin:-2px 0 12px;"><button type="button" class="btn" id="toolsPointLocateBtn" style="flex:1;">◎ Поточне місце</button><button type="button" class="btn" id="toolsPointPickBtn" style="flex:1;">🗺 Вказати на карті</button></div>
    <div id="toolsPointPickerPanel" class="hidden tools-map-picker-panel"><div id="toolsPointPickerStatus" class="tools-map-status hidden" role="status"></div><div id="toolsPointPickerMap" class="tools-map tools-map-picker" aria-label="Вибір координат точки"></div><div class="row" style="margin-top:8px;"><button type="button" class="btn btn-accent" id="toolsPointUseMapBtn" style="flex:1;">Використати цю точку</button><button type="button" class="btn" id="toolsPointCancelMapBtn">Скасувати</button></div></div>
    <div class="field"><label>Примітка</label><textarea id="toolsPointNote">${escapeHtml(existing.note||'')}</textarea></div>
    <div class="field"><label>Фото (до 3)</label><input type="file" id="toolsPointPhoto" accept="image/*" multiple></div>
    <div class="tools-point-editor-footer row wrap"><button type="button" class="btn" id="toolsPointSaveBtn" style="flex:1;">Зберегти</button><button type="button" class="btn btn-accent" id="toolsPointSaveTelegramBtn" style="flex:1 0 100%;">Зберегти і надіслати в Telegram</button><button type="button" class="btn" id="toolsPointCancelBtn" style="flex:1;">Скасувати</button></div>`,{overlayClass:options.placement?'tools-point-editor-overlay':'',onClose:closePointEditor,onOpen:()=>{
      const latInput=document.getElementById('toolsPointLat'),lngInput=document.getElementById('toolsPointLng'),panel=document.getElementById('toolsPointPickerPanel');
      let mapPicker=null;
      const inputPoint=()=>MTToolsCore.parseCoordinates(`${latInput.value.replace(',','.')},${lngInput.value.replace(',','.')}`);
      const writePoint=point=>{latInput.value=Number(point.lat).toFixed(6);lngInput.value=Number(point.lng).toFixed(6);};
      options.placement?.onChange?.(writePoint);
      if(options.placement){document.getElementById('toolsScreenRoot')?.classList.add('tools-map-editor-open');setTimeout(()=>document.getElementById('toolsLeafletMap')?.scrollIntoView({block:'start'}),0);}
      document.getElementById('toolsPointCancelBtn').onclick=closePointEditor;
      document.getElementById('toolsPointPickBtn').onclick=()=>{
        panel.classList.remove('hidden');
        mapPicker=MTToolsMap.mountPicker(document.getElementById('toolsPointPickerMap'),{initial:inputPoint(),statusNode:document.getElementById('toolsPointPickerStatus')});
        if(!mapPicker)showToast('Модуль карти недоступний');
      };
      document.getElementById('toolsPointCancelMapBtn').onclick=()=>{MTToolsMap.destroyPicker();mapPicker=null;panel.classList.add('hidden');};
      document.getElementById('toolsPointUseMapBtn').onclick=()=>{
        const point=mapPicker?.getPoint();if(!point){showToast('Натисніть потрібне місце на карті');return;}
        writePoint(point);MTToolsMap.destroyPicker();mapPicker=null;panel.classList.add('hidden');showToast('Координати вибрано');
      };
      document.getElementById('toolsPointLocateBtn').onclick=()=>{
        if(!navigator.geolocation){showToast('Геолокація не підтримується');return;}
        showToast('Визначаю координати…');
        navigator.geolocation.getCurrentPosition(position=>{
          const point={lat:position.coords.latitude,lng:position.coords.longitude};writePoint(point);mapPicker?.setPoint(point);showToast('Поточне місце визначено');
        },()=>showToast('Не вдалося отримати геолокацію'),{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
      };
      const savePoint=async send=>{
        const now=new Date(),type=document.getElementById('toolsPointType').value,label=document.getElementById('toolsPointLabel').value.trim(),base={...existing,name:[type,label].filter(Boolean).join(' '),type,city:document.getElementById('toolsPointCity').value,street:document.getElementById('toolsPointStreet').value,house:document.getElementById('toolsPointHouse').value,label,lat:document.getElementById('toolsPointLat').value.replace(',','.'),lng:document.getElementById('toolsPointLng').value.replace(',','.'),note:document.getElementById('toolsPointNote').value};
        const normalized=MTToolsCore.normalizeNetworkPoint(base,now);if(!normalized){showToast('Вкажіть коректні координати');return;}
        const files=[...document.getElementById('toolsPointPhoto').files].slice(0,3),keys=(existing.photoKeys||[existing.photoKey]).filter(Boolean);
        for(const file of files){const key=await toolsStoreCompressedPhoto(file);if(!key){showToast('Не вдалося зберегти фото');return;}keys.push(key);}normalized.photoKeys=[...new Set(keys)].slice(0,3);normalized.photoKey=normalized.photoKeys[0]||'';
        const at=toolsNetworkPoints.findIndex(point=>point.id===normalized.id);if(at>=0)toolsNetworkPoints[at]=normalized;else toolsNetworkPoints.push(normalized);
        if(!toolsSaveNetworkPoints())return;closePointEditor();renderToolsScreen(options.returnView||'network');showToast('Точку збережено локально');if(send)await toolsSendNetworkPointTelegram(normalized);
      };
      document.getElementById('toolsPointSaveBtn').onclick=()=>savePoint(false);
      document.getElementById('toolsPointSaveTelegramBtn').onclick=()=>savePoint(true);
    }});
}
async function toolsSendNetworkPointTelegram(point){
  const chatId=String(settings.tgBackupChatId||'').trim();if(!String(settings.tgBotToken||'').trim()||!chatId){showToast('Точку збережено. Telegram не налаштовано');return false;}
  const address=MTToolsCore.networkPointAddress(point),location=`https://www.google.com/maps?q=${point.lat},${point.lng}`,text=[`📡 ${point.name||point.type}`,address?`Адреса: ${address}`:'',point.note?`Примітка: ${point.note}`:'',`Дата: ${new Date(point.updatedAt).toLocaleString('uk-UA')}`,`Координати: ${point.lat}, ${point.lng}`,location].filter(Boolean).join('\n'),photos=(point.photoKeys||[point.photoKey]).filter(Boolean);
  let result=await sendToTelegramChat(chatId,text,photos[0]||null,null);for(let i=1;result.ok&&i<photos.length;i++)result=await sendToTelegramChat(chatId,`Фото ${i+1}/${photos.length}: ${point.name||point.type}`,photos[i],null);
  showToast(result.ok?'✅ Точку надіслано в Telegram':`Точку збережено локально. Telegram: ${result.reason||'помилка'}`);return result.ok;
}
function toolsStoreCompressedPhoto(file){
  return new Promise(resolve=>{const reader=new FileReader();reader.onerror=()=>resolve(null);reader.onload=event=>{const image=new Image();image.onerror=()=>resolve(null);image.onload=async()=>{const scale=Math.min(1,800/image.width),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);resolve(await storePhoto(canvas.toDataURL('image/jpeg',.72)));};image.src=event.target.result;};reader.readAsDataURL(file);});
}
function toolsPhotoKeyStillUsed(key,removedPointId){
  const inAnotherPoint=toolsNetworkPoints.some(point=>String(point.id)!==String(removedPointId)&&(point.photoKeys||[point.photoKey]).filter(Boolean).includes(key));
  const inTicket=tickets.some(ticket=>(ticket.photos||[ticket.photo]).filter(Boolean).includes(key));
  return inAnotherPoint||inTicket;
}
async function toolsDeleteNetworkPoint(id){
  const previous=toolsNetworkPoints,outcome=MTToolsCore.removeNetworkPoint(previous,id);if(!outcome.removed)return false;
  toolsNetworkPoints=outcome.points;
  if(!toolsSaveNetworkPoints()){toolsNetworkPoints=previous;return false;}
  const photoKeys=[...new Set((outcome.removed.photoKeys||[outcome.removed.photoKey]).filter(Boolean))];
  for(const key of photoKeys){if(!toolsPhotoKeyStillUsed(key,id))await deletePhotoKey(key);}
  closeModal();renderToolsScreen(toolsView);showToast('Об’єкт видалено');return true;
}
function toolsConfirmDeleteNetworkPoint(id){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return;
  openModal('Видалити об’єкт',`<p style="margin:0 0 14px;">Видалити цей об’єкт?</p><div class="row wrap"><button type="button" class="btn btn-danger" id="toolsPointDeleteConfirmBtn" style="flex:1;">Видалити</button><button type="button" class="btn" id="toolsPointDeleteCancelBtn" style="flex:1;">Скасувати</button></div>`,{onOpen:()=>{
    document.getElementById('toolsPointDeleteCancelBtn').onclick=()=>toolsShowNetworkPoint(point.id);
    document.getElementById('toolsPointDeleteConfirmBtn').onclick=async event=>{event.currentTarget.disabled=true;await toolsDeleteNetworkPoint(point.id);};
  }});
}
function toolsShowNetworkPoint(id){
  const point=toolsNetworkPoints.find(item=>item.id===id);if(!point)return;
  const address=MTToolsCore.networkPointAddress(point);openModal(point.name||point.type||'Точка мережі',`<div style="font-size:13px;line-height:1.6;"><strong>${escapeHtml(point.type)}</strong>${address?`<br>🏘 ${escapeHtml(address)}`:''}<br>📍 ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}<div style="font-size:11.5px;color:var(--text-dim);margin-top:4px;">Створено: ${escapeHtml(new Date(point.createdAt).toLocaleString('uk-UA'))}<br>Оновлено: ${escapeHtml(new Date(point.updatedAt).toLocaleString('uk-UA'))}</div>${point.note?`<div style="white-space:pre-wrap;margin-top:8px;">${escapeHtml(point.note)}</div>`:''}<div id="toolsPointPhotoPreview" class="tools-point-photo-grid" style="margin-top:8px;"></div><div class="row wrap" style="margin-top:10px;"><button type="button" class="btn" id="toolsPointMapBtn" style="flex:1;">📍 Показати на карті</button><button type="button" class="btn" id="toolsPointRouteBtn" style="flex:1;">🗺 Маршрут</button><button type="button" class="btn" id="toolsPointEditBtn" style="flex:1;">✏️ Редагувати</button><button type="button" class="btn" id="toolsPointTelegramBtn" style="flex:1 0 100%;">✈️ Надіслати в Telegram</button><button type="button" class="btn btn-danger" id="toolsPointDeleteBtn" style="flex:1 0 100%;">Видалити об’єкт</button></div></div>`,{onOpen:async()=>{
    document.getElementById('toolsPointMapBtn').onclick=()=>{closeModal();MTToolsMap.focusPoint(point,18);toolsView='map';switchTab('tools');};
    document.getElementById('toolsPointRouteBtn').onclick=()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${point.lat},${point.lng}`)}`,'_blank','noopener');
    document.getElementById('toolsPointEditBtn').onclick=()=>{closeModal();toolsOpenNetworkPointEditor(point.id);};
    document.getElementById('toolsPointDeleteBtn').onclick=()=>toolsConfirmDeleteNetworkPoint(point.id);
    document.getElementById('toolsPointTelegramBtn').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;await toolsSendNetworkPointTelegram(point);button.disabled=false;
    };
    const root=document.getElementById('toolsPointPhotoPreview'),photos=(point.photoKeys||[point.photoKey]).filter(Boolean);for(const key of photos){const data=await resolvePhotoAsync(key,null);if(root&&data)root.insertAdjacentHTML('beforeend',`<img src="${data}" alt="Фото точки" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;">`);}
  }});
}

function renderToolsScreen(view){
  if(view)toolsView=view;
  const root=document.getElementById('toolsScreenRoot');if(!root)return;
  MTToolsMap?.captureView?.();
  if(toolsView==='diagnostics')root.innerHTML=toolsDiagnosticsHtml();
  else if(toolsView==='map'){
    root.innerHTML=toolsMapHtml();
    requestAnimationFrame(()=>MTToolsMap.mount(document.getElementById('toolsLeafletMap'),MTToolsCore.mapObjects(tickets,toolsNetworkPoints),{
      filterRoot:document.getElementById('toolsMapFilters'),statusNode:document.getElementById('toolsMapStatus'),emptyStateNode:document.getElementById('toolsMapEmptyState'),onSelect:toolsOpenMapObject,onAddHere:point=>toolsStartMapAddMode(point)
    }));
  }
  else if(toolsView==='network')root.innerHTML=toolsNetworkHtml();
  else if(toolsView==='offline'){
    root.innerHTML=toolsOfflineHtml();requestAnimationFrame(()=>{MTToolsMap.mount(document.getElementById('toolsOfflineSelectMap'),[],{statusNode:document.getElementById('toolsOfflineSelectStatus')});if(toolsOfflinePendingBounds)setTimeout(()=>MTToolsMap.drawBounds(toolsOfflinePendingBounds),0);});
  }
  else{toolsView='home';root.innerHTML=toolsHomeHtml();}
}
function bindToolsScreen(){
  const root=document.getElementById('toolsScreenRoot');
  root.addEventListener('click',event=>{
    const viewButton=event.target.closest('[data-tools-view]');if(viewButton){toolsView=viewButton.dataset.toolsView;renderToolsScreen();return;}
    const router=event.target.closest('[data-router-ip]');if(router){window.open(`http://${router.dataset.routerIp}`,'_blank','noopener');return;}
    const point=event.target.closest('.tools-network-open');if(point){toolsShowNetworkPoint(point.dataset.pointId);return;}
    const action=event.target.closest('[data-tools-action]')?.dataset.toolsAction;
    if(action==='quick-diagnostics')toolsOpenDiagnostics(null,'tools');
    else if(action==='run-diagnostics')runToolsDiagnostics();
    else if(action==='copy-diagnostics')toolsCopyDiagnostic();
    else if(action==='attach-diagnostics')toolsAttachDiagnostics();
    else if(action==='save-diagnostics')toolsSaveCurrentDiagnostic();
    else if(action==='external-speed-test')toolsOpenExternalSpeedTest();
    else if(action==='return-to-ticket')toolsReturnToTicket();
    else if(action==='new-network-point')toolsOpenNetworkPointEditor();
    else if(action==='map-add-object')toolsStartMapAddMode();
    else if(action==='map-my-location')toolsLocateOnMap();
    else if(action==='map-add-at-location'&&toolsLastUserLocation)toolsStartMapAddMode(toolsLastUserLocation);
    else if(action==='map-use-online'){MTOfflineMap.setMode('online');renderToolsScreen('map');}
    else if(action==='map-bind-address')toolsBindAddressFromMap();
    else if(action==='select-offline-bounds')toolsStartOfflineBoundsSelection();
    else if(action==='save-offline-area')toolsSaveOfflineArea();
    else if(action==='show-offline-area')toolsShowOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='edit-offline-area')toolsEditOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='delete-offline-area')toolsDeleteOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='import-offline-area')toolsImportOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='export-offline-area')toolsExportOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='import-offline-map'){toolsOfflineImportAreaId='';document.getElementById('toolsOfflineMapFile')?.click();}
    else if(action==='delete-offline-map')toolsDeleteOfflineMap();
  });
  root.addEventListener('change',event=>{
    if(event.target.id==='toolsOfflineMapFile'){const file=event.target.files?.[0];event.target.value='';toolsPrepareOfflineMap(file);}
    if(event.target.id==='toolsMapBaseMode'){MTOfflineMap.setMode(event.target.value);renderToolsScreen('map');}
  });
  root.addEventListener('input',event=>{if(event.target.id==='toolsNetworkSearch'){toolsNetworkSearch=event.target.value;renderToolsScreen('network');const input=document.getElementById('toolsNetworkSearch');input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}});
  window.addEventListener('online',()=>{if(toolsView==='map'&&MTOfflineMap.getMode()==='auto')renderToolsScreen('map');});
  window.addEventListener('offline',()=>{if(toolsView==='map'&&MTOfflineMap.getMode()==='auto')renderToolsScreen('map');});
  document.getElementById('calcDiagnosticsBtn').addEventListener('click',openToolsDiagnosticsFromCalculator);
}

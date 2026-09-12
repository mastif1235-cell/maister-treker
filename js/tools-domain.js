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
let toolsSelectedNetworkPointId='';
let toolsSpeedController=null;
let toolsSpeedStatus='';
let toolsOfflineReturnSettings=false;
let toolsMapFullscreen=false;
let toolsTicketLinkContext=null;
let toolsLinkCreationContext=null;
const toolsNetworkOpenCities=new Set();
const toolsNetworkOpenStreets=new Set();
const toolsNetworkTelegramSending=new Set();
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
  </div>
  <div class="card" style="margin-top:12px;font-size:12px;color:var(--text-dim);">Інструменти зберігають дані лише на цьому пристрої. Діагностика не створює записів без явного натискання «Зберегти».</div>`;
}
function toolsBackButton(){return appNavigationCanGoBack()?appBackButtonHtml(toolsView==='offline'&&toolsOfflineReturnSettings?'Налаштування':'Назад'):'';}
function toolsNavigate(view){
  const from=toolsView;if(from===view)return renderToolsScreen(view);
  if(from==='map'&&view!=='map')MTOfflineMap?.resetViewMode?.();
  appNavigationPush(`tools-${view}`,()=>{if(toolsView==='map')MTOfflineMap?.resetViewMode?.();toolsView=from;switchTab('tools');renderToolsScreen(from);});toolsView=view;renderToolsScreen(view);
}
function toolsOpenRootFromTab(){
  toolsCancelSpeedTest();toolsResumeTicketAddressInputs();toolsClearDiagnosticAddress();MTToolsMap?.destroyMap?.();
  MTOfflineMap?.resetViewMode?.();
  toolsMapFullscreen=false;document.body.classList.remove('tools-map-fullscreen-open');
  toolsOfflineReturnSettings=false;toolsOfflinePendingBounds=null;toolsOfflineEditingAreaId='';toolsOfflineImportAreaId='';toolsView='home';
}
function toolsLeaveOfflineSettings(dropNavigation=true){if(toolsView!=='offline'&&!toolsOfflineReturnSettings)return;MTToolsMap?.destroyMap?.();MTOfflineMap?.resetViewMode?.();toolsOfflineReturnSettings=false;toolsOfflinePendingBounds=null;toolsOfflineEditingAreaId='';toolsOfflineImportAreaId='';toolsView='home';if(dropNavigation)appNavigationDrop('tools-offline-settings');}
function openOfflineMapSettings(){MTOfflineMap?.resetViewMode?.();toolsOfflineReturnSettings=true;appNavigationPush('tools-offline-settings',()=>{toolsLeaveOfflineSettings(false);switchTab('settings');});toolsView='offline';switchTab('tools');renderToolsScreen('offline');}
function toolsContextHtml(){
  return toolsDiagnosticContext?.address
    ? `<div class="card" style="font-size:13px;"><div class="row wrap" style="justify-content:space-between;align-items:center;"><strong>📍 ${escapeHtml(toolsDiagnosticContext.address)}</strong><button type="button" class="btn btn-sm" data-tools-action="reset-diagnostic-address">✕ Скинути адресу</button></div><div style="color:var(--text-dim);margin-top:3px;">Результат збережеться лише після вашого підтвердження.</div></div>`
    : `<div class="card" style="font-size:13px;color:var(--text-dim);">Швидка діагностика без адреси. За замовчуванням результат ніде не зберігається.</div>`;
}

function toolsClearDiagnosticAddress(){toolsDiagnosticContext=null;toolsDiagnosticSaved=false;}
function toolsResumeTicketAddressInputs(){['f_city','f_street','f_house','f_apartment'].forEach(id=>{const input=document.getElementById(id);if(input)input.disabled=false;});}
function toolsSuspendTicketAddressInputs(){['f_city','f_street','f_house','f_apartment'].forEach(id=>{const input=document.getElementById(id);if(input){input.value='';input.disabled=true;}});}
function toolsLeaveDiagnostics(){if(toolsView!=='diagnostics')return;toolsCancelSpeedTest();toolsResumeTicketAddressInputs();toolsClearDiagnosticAddress();toolsView='home';}
function toolsResetDiagnosticAddress(){toolsClearDiagnosticAddress();renderToolsScreen('diagnostics');}
function toolsOpenDiagnostics(context=null,returnTab='tools'){
  if(returnTab==='tools')appNavigationPush('tools-diagnostics',()=>{toolsLeaveDiagnostics();switchTab('tools');renderToolsScreen('home');});
  else if(returnTab==='calculator')appNavigationPush('tools-diagnostics',toolsReturnToTicket);
  else if(returnTab==='tickets')appNavigationPush('tools-diagnostics',()=>{toolsLeaveDiagnostics();switchTab('tickets');renderAddressNav();});
  toolsDiagnosticContext=context;toolsDiagnosticResult=null;toolsDiagnosticRunAt=null;toolsDiagnosticSaved=false;toolsSpeedStatus='';toolsReturnTab=returnTab;toolsView='diagnostics';
  switchTab('tools');renderToolsScreen('diagnostics');
}
function openToolsDiagnosticsFromCalculator(){
  syncFormToState();
  if(!calcState.city||!calcState.street){showToast('Спочатку вкажіть місто та вулицю');return;}
  document.activeElement?.blur?.();
  toolsCalculatorDraft={state:JSON.parse(JSON.stringify(calcState)),editingTicketId,originalPhotoKeys:(calcOriginalPhotoKeys||[]).slice()};
  try{localStorage.setItem(MT_TOOLS_DRAFT_KEY,JSON.stringify(toolsCalculatorDraft));}catch(_e){}
  toolsSuspendTicketAddressInputs();
  const context={id:MTToolsCore.profileId(calcState),...MTToolsCore.profileParts(calcState),address:MTToolsCore.addressLabel(calcState),ticketId:editingTicketId||'',editorContext:true};
  toolsOpenDiagnostics(context,'calculator');
}
function toolsReturnToTicket(){
  toolsLeaveDiagnostics();
  let draft=toolsCalculatorDraft;try{draft=draft||JSON.parse(localStorage.getItem(MT_TOOLS_DRAFT_KEY)||'null');}catch(_e){}
  if(!draft?.state){showToast('Чернетку заявки не знайдено');return;}
  calcState=JSON.parse(JSON.stringify(draft.state));editingTicketId=draft.editingTicketId??null;calcOriginalPhotoKeys=Array.isArray(draft.originalPhotoKeys)?draft.originalPhotoKeys.slice():[];
  fillFormFromState();document.getElementById('saveTicketBtn').textContent=editingTicketId?'Оновити заявку':'Зберегти заявку';document.getElementById('cancelEditBtn').classList.toggle('hidden',!editingTicketId);
  switchTab('calculator');showToast('Чернетку заявки відновлено');
}
function toolsClearCalculatorDraft(){toolsCalculatorDraft=null;try{localStorage.removeItem(MT_TOOLS_DRAFT_KEY);}catch(_e){}}
function openToolsDiagnosticsFromProfile(ids=[]){
  const list=tickets.filter(ticket=>ids.some(id=>String(id)===String(ticket.id)));
  if(!list.length){showToast('Профіль не знайдено');return;}
  toolsOpenDiagnostics({...MTToolsCore.profileFromTickets(list),ticketId:String(list[0].id)},'tickets');
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
    <div id="toolsMapStatus" class="tools-map-status hidden" role="status"></div>
    <div class="tools-map-shell ${toolsMapFullscreen?'tools-map-fullscreen':''}"><div class="tools-map" id="toolsLeafletMap" aria-label="Інтерактивна карта об’єктів"></div><div class="tools-map-service-controls" aria-label="Дії карти"><button type="button" class="tools-map-floating-btn" data-tools-action="map-my-location" aria-label="Моє місце" title="Моє місце">🎯</button><button type="button" class="tools-map-floating-btn" data-tools-action="map-add-object" aria-label="Додати об’єкт" title="Додати об’єкт">＋</button></div><div class="tools-map-fullscreen-control"><button type="button" class="tools-map-floating-btn" data-tools-action="map-toggle-fullscreen" aria-label="${toolsMapFullscreen?'Вийти з повноекранної карти':'Відкрити карту на весь екран'}" title="${toolsMapFullscreen?'Вийти':'На весь екран'}">${toolsMapFullscreen?'✕':'⛶'}</button></div><div id="toolsMapEmptyState" class="tools-map-empty hidden"><strong>Офлайн-підкладка для цієї області не встановлена.</strong><div>Маркери доступні без підкладки. Керування офлайн-картою знаходиться в Налаштуваннях.</div></div></div>
    <div class="tools-map-filters" id="toolsMapFilters" aria-label="Фільтри об’єктів карти"><button type="button" class="tools-map-filter active" data-map-filter="all" aria-pressed="true">Усі</button><button type="button" class="tools-map-filter" data-map-filter="none" aria-pressed="false">Зняти всі</button>${filters}</div>
    ${objects.length?'':'<div class="card" style="font-size:12px;color:var(--text-dim);">Немає об’єктів із координатами. Додайте геолокацію до профілю або створіть точку мережі.</div>'}
    <div class="card tools-network-groups-card"><div class="row between wrap"><strong>Об’єкти мережі</strong><span class="tools-offline-map-meta">${toolsNetworkPoints.length}</span></div><div class="field" style="margin-top:8px;"><label>Пошук об’єктів</label><input type="search" role="searchbox" name="mt-internal-network-search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="search" id="toolsNetworkSearch" value="${escapeHtml(toolsNetworkSearch)}" placeholder="ID, тип, місто, вулиця, будинок, примітка"></div><div id="toolsNetworkGroups">${toolsNetworkGroupsHtml()}</div></div>
    <div class="row wrap tools-map-actions"><button type="button" class="btn" data-tools-action="map-bind-address" style="flex:1 0 100%;">📍 Прив’язати існуючу адресу</button></div>
    <div class="tools-offline-map-meta" style="margin:-2px 0 9px;">${offline?`✅ Офлайн-карта встановлена · ${escapeHtml(MTOfflineMap.formatBytes(offline.size))} · режим ${escapeHtml(mode)}`:'Офлайн-карта не встановлена'}</div>
    <details class="tools-map-info"><summary>ⓘ Про карту</summary><div>Звичайна підкладка: OpenStreetMap. Супутникова: MapTiler із власним ключем користувача. Постачальник плиток отримує лише координати видимої ділянки — без ПІБ, телефонів, адресного тексту, MAC, нотаток, фото чи історії.</div></details>`;
}
function toolsNetworkGroupsHtml(){
  const query=String(toolsNetworkSearch||'').trim(),groups=MTToolsCore.groupNetworkPoints(toolsNetworkPoints,query);if(!groups.length)return '<div class="tools-network-empty">Нічого не знайдено.</div>';
  return groups.map(cityGroup=>{const cityKey=cityGroup.city,cityOpen=!!query||toolsNetworkOpenCities.has(cityKey),streets=cityGroup.streets.map(streetGroup=>{const streetKey=`${cityKey}\u0000${streetGroup.street}`,streetOpen=!!query||toolsNetworkOpenStreets.has(streetKey),items=streetGroup.points.map(point=>`<button type="button" class="tools-network-object ${String(point.id)===String(toolsSelectedNetworkPointId)?'selected':''}" data-point-id="${escapeHtml(point.id)}"><span><strong>${escapeHtml(point.name||point.type||'Без назви')}</strong><small>${escapeHtml([point.type,point.house,point.note].filter(Boolean).join(' · '))}</small></span><span>›</span></button>`).join('');return `<details class="tools-network-street" data-network-street="${escapeHtml(streetKey)}" ${streetOpen?'open':''}><summary>${escapeHtml(streetGroup.street)} <span>${streetGroup.count}</span></summary>${items}</details>`;}).join('');return `<details class="tools-network-city" data-network-city="${escapeHtml(cityKey)}" ${cityOpen?'open':''}><summary>${escapeHtml(cityGroup.city)} <span>${cityGroup.count}</span></summary>${streets}</details>`;}).join('');
}
function toolsOpenPointEditorFromMap(point,placement){
  toolsOpenNetworkPointEditor('',{type:'FOB',...point},{placement,returnView:'map',returnToLinking:!!toolsLinkCreationContext});
}
function toolsStartMapAddMode(point=null){
  const status=document.getElementById('toolsMapStatus');
  if(status){status.textContent=point?'Перетягніть робочий маркер за потреби.':'Натисніть місце на карті для нового об’єкта.';status.classList.remove('hidden');}
  const placement=MTToolsMap.startPointPlacement({initial:point,onPlace:toolsOpenPointEditorFromMap});
  if(!placement)showToast('Карта ще не готова');else if(!point)showToast('Торкніться карти, щоб додати об’єкт');
}
async function toolsLocateOnMap(){
  showToast('Визначаю ваше місце…');
  try{const point=await MTToolsCore.requestCurrentPosition(navigator.geolocation);toolsLastUserLocation=point;MTToolsMap.showUserLocation(point,point.accuracy);showToast(`Ваше місце${point.accuracy?` · точність ≈ ${Math.round(point.accuracy)} м`:''}`);}
  catch(error){const code=Number(error?.code);showToast(code===1?'Доступ до геолокації заборонено':code===3?'Час очікування GPS вичерпано':'Геолокація недоступна');}
}
function toolsToggleMapFullscreen(){
  toolsMapFullscreen=!toolsMapFullscreen;
  document.body.classList.toggle('tools-map-fullscreen-open',toolsMapFullscreen);
  const shell=document.querySelector('.tools-map-shell'),button=document.querySelector('[data-tools-action="map-toggle-fullscreen"]');
  shell?.classList.toggle('tools-map-fullscreen',toolsMapFullscreen);
  if(button){button.textContent=toolsMapFullscreen?'✕':'⛶';button.title=toolsMapFullscreen?'Вийти':'На весь екран';button.setAttribute('aria-label',toolsMapFullscreen?'Вийти з повноекранної карти':'Відкрити карту на весь екран');}
  MTToolsMap.invalidateSize?.();
}
function toolsBindAddressFromMap(){
  const profiles=MTToolsCore.listProfiles(tickets);if(!profiles.length){showToast('Немає існуючих адрес для прив’язки');return;}
  openModal('Прив’язати існуючу адресу',`<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Виберіть існуючий профіль. Координати не зміняться, доки ви явно не натиснете «Зберегти координати».</div><div class="field"><input type="search" role="searchbox" name="mt-internal-map-profile-search" inputmode="search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" id="toolsAddressSearch" placeholder="Місто, вулиця, будинок, квартира або повна адреса"></div><div id="toolsAddressChoices" style="max-height:55vh;overflow:auto;"></div>`,{onOpen:root=>{
    const choices=document.getElementById('toolsAddressChoices'),input=document.getElementById('toolsAddressSearch');
    const render=query=>{const needle=String(query||'').trim().toLocaleLowerCase('uk'),matches=profiles.filter(profile=>!needle||[profile.city,profile.street,profile.house,profile.apartment,profile.address].some(value=>String(value||'').toLocaleLowerCase('uk').includes(needle))).slice(0,100);choices.innerHTML=matches.map(profile=>`<button type="button" class="btn btn-block tools-address-choice" data-profile-id="${escapeHtml(profile.id)}" style="margin-bottom:7px;text-align:left;">${escapeHtml(profile.address)}</button>`).join('')||'<div class="card">Нічого не знайдено.</div>';};
    render('');input.addEventListener('input',()=>render(input.value));root.onclick=event=>{const button=event.target.closest('.tools-address-choice');if(!button)return;const profile=profiles.find(item=>item.id===button.dataset.profileId);if(!profile)return;closeModal();toolsOpenAddressBindingPicker(profile);};
  }});
}
function toolsOpenAddressBindingPicker(profile){
  const list=tickets.filter(ticket=>MTToolsCore.profileId(ticket)===profile.id),source=list.find(ticket=>MTToolsCore.parseCoordinates(`${ticket.geoLat??''},${ticket.geoLng??''}`)||MTToolsCore.parseCoordinates(ticket.geoLink)),initial=source&&(MTToolsCore.parseCoordinates(`${source.geoLat??''},${source.geoLng??''}`)||MTToolsCore.parseCoordinates(source.geoLink));let picker=null;
  openModal('Вкажіть точку на карті',`<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">${escapeHtml(profile.address)}. Натисніть карту або перетягніть маркер. GPS використовується лише після окремого натискання.</div><div id="toolsAddressPickerStatus" class="tools-map-status hidden"></div><div id="toolsAddressPicker" class="tools-map tools-map-picker"></div><div class="row wrap" style="margin-top:8px;"><button type="button" class="btn" id="toolsAddressPickerGps" style="flex:1;">🎯 Моє місце</button><button type="button" class="btn btn-accent" id="toolsAddressPickerSave" style="flex:1;">Зберегти координати</button><button type="button" class="btn" id="toolsAddressPickerCancel">Скасувати</button></div>`,{onClose:()=>MTToolsMap.destroyPicker(),onOpen:()=>{
    picker=MTToolsMap.mountPicker(document.getElementById('toolsAddressPicker'),{initial,statusNode:document.getElementById('toolsAddressPickerStatus')});
    document.getElementById('toolsAddressPickerCancel').onclick=closeModal;
    document.getElementById('toolsAddressPickerGps').onclick=async()=>{try{const point=await MTToolsCore.requestCurrentPosition(navigator.geolocation);picker?.setPoint(point);showToast(point.accuracy?`Точність GPS ≈ ${Math.round(point.accuracy)} м`:'Точку GPS визначено');}catch(_error){showToast('Не вдалося отримати геолокацію');}};
    document.getElementById('toolsAddressPickerSave').onclick=async()=>{const point=picker?.getPoint();if(!point){showToast('Вкажіть точку на карті');return;}list.forEach(ticket=>{ticket.geoLat=Number(point.lat.toFixed(6));ticket.geoLng=Number(point.lng.toFixed(6));});await saveTickets();closeModal();renderToolsScreen('map');showToast('✅ Координати адреси збережено');};
  }});
}
function toolsEditOfflineArea(id){const area=toolsLoadOfflineAreas().find(item=>item.id===id);if(!area)return;toolsOfflineEditingAreaId=id;toolsOfflinePendingBounds={...area};renderToolsScreen('offline');}
function toolsDeleteOfflineArea(id){const areas=toolsLoadOfflineAreas(),area=areas.find(item=>item.id===id);if(!area||!confirm(`Видалити лише область «${area.name}»? Встановлений PMTiles та інші дані залишаться.`))return;toolsSaveOfflineAreas(areas.filter(item=>item.id!==id));if(toolsOfflineEditingAreaId===id){toolsOfflineEditingAreaId='';toolsOfflinePendingBounds=null;}renderToolsScreen('offline');showToast('Область видалено. Дані та PMTiles не змінено');}
function toolsShowOfflineArea(id){const area=toolsLoadOfflineAreas().find(item=>item.id===id);if(!area)return;MTToolsMap.drawBounds(area);document.getElementById('toolsOfflineSelectMap')?.scrollIntoView({behavior:'smooth',block:'center'});}
function toolsOpenOfflineMap(){MTOfflineMap.setViewMode('offline');toolsNavigate('map');}
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
  toolsMapReturnContext={profileId};appNavigationPush('map-profile',()=>{toolsMapReturnContext=null;closeModal();toolsView='map';switchTab('tools');renderToolsScreen('map');});
  addrNavState={level:'tickets',city:profile.city,street:profile.street,house:profile.house||'(без номера)',apartment:profile.apartment||'(без кв.)'};
  addrNavSearchQuery='';switchTab('tickets');renderAddressNav();
}
function toolsMapReturnButtonHtml(){return toolsMapReturnContext?appBackButtonHtml('Назад до карти'):'';}
function toolsClearMapReturnContext(){toolsMapReturnContext=null;}
function toolsReturnFromProfileToMap(){if(!appNavigationBack()){closeModal();toolsMapReturnContext=null;toolsView='map';switchTab('tools');renderToolsScreen('map');}}
function toolsOpenMapObject(item){
  if(!item)return;
  if(item.kind==='network'){toolsSelectedNetworkPointId=String(item.id);toolsHighlightNetworkPointInList(item.id);appNavigationPush('map-network-point',()=>{closeModal();toolsView='map';switchTab('tools');renderToolsScreen('map');});toolsShowNetworkPoint(item.id);return;}
  if(item.profiles.length===1){toolsOpenProfileById(item.profiles[0].id);return;}
  openModal('Відомі квартири',item.profiles.map(profile=>`<button type="button" class="btn btn-block tools-map-profile" data-profile-id="${escapeHtml(profile.id)}" style="margin-bottom:8px;">${escapeHtml(profile.apartment?`кв. ${profile.apartment}`:profile.address)}</button>`).join(''),{onOpen:root=>root.addEventListener('click',event=>{const button=event.target.closest('.tools-map-profile');if(button){closeModal();toolsOpenProfileById(button.dataset.profileId);}})});
}
function openAbonentMapPointPicker(ids=[]){
  const list=tickets.filter(ticket=>ids.some(id=>String(id)===String(ticket.id)));
  if(!list.length){showToast('Профіль не знайдено');return;}
  const source=list.find(ticket=>MTToolsCore.parseCoordinates(`${ticket.geoLat??''},${ticket.geoLng??''}`)||MTToolsCore.parseCoordinates(ticket.geoLink));
  const initial=source&&(MTToolsCore.parseCoordinates(`${source.geoLat??''},${source.geoLng??''}`)||MTToolsCore.parseCoordinates(source.geoLink));
  let picker=null;
  const closePicker=()=>{MTToolsMap.destroyPicker();closeModal();renderAddressNav();};
  openModal(initial?'📍 Уточнити точку':'📍 Додати на карту',`<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Поставте маркер або перетягніть його. Google Maps посилання залишиться без змін.</div><div id="abonentMapPointStatus" class="tools-map-status hidden"></div><div id="abonentMapPointPicker" class="tools-map tools-map-picker"></div><div class="row wrap" style="margin-top:8px;"><button type="button" class="btn" id="abonentMapPointGps" style="flex:1;">🎯 Моє місце</button><button type="button" class="btn btn-accent" id="abonentMapPointSave" style="flex:1;">Зберегти точку</button><button type="button" class="btn" id="abonentMapPointCancel">Скасувати</button></div>`,{onClose:closePicker,onOpen:()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    picker=MTToolsMap.mountPicker(document.getElementById('abonentMapPointPicker'),{initial,statusNode:document.getElementById('abonentMapPointStatus')});
    document.getElementById('abonentMapPointCancel').onclick=closePicker;
    document.getElementById('abonentMapPointGps').onclick=async()=>{try{picker?.setPoint(await MTToolsCore.requestCurrentPosition(navigator.geolocation));}catch(_error){showToast('Не вдалося отримати геолокацію');}};
    document.getElementById('abonentMapPointSave').onclick=async()=>{
      if(!picker?.hasChanged()){showToast('Поставте або перемістіть маркер');return;}
      const point=picker?.getPoint();if(!point){showToast('Натисніть потрібне місце на карті');return;}
      const previous=list.map(ticket=>({ticket,geoLat:ticket.geoLat,geoLng:ticket.geoLng}));
      list.forEach(ticket=>{ticket.geoLat=Number(point.lat.toFixed(6));ticket.geoLng=Number(point.lng.toFixed(6));});
      if(!await saveTickets()){previous.forEach(item=>{item.ticket.geoLat=item.geoLat;item.ticket.geoLng=item.geoLng;});showToast('Не вдалося зберегти точку');return;}
      closePicker();showToast('✅ Точку збережено');
    };
  }))});
}

function openTicketGeoPointPicker(){
  const draft=MTToolsCore.createGeoDraft(calcState),initial=draft.get();
  let picker=null;
  const closePicker=()=>{MTToolsMap.destroyPicker();closeModal();};
  openModal('📍 Уточнити точку',`<div class="ticket-geo-picker-layout"><div class="ticket-geo-picker-help">Поставте маркер або перетягніть його. GPS працює лише після натискання. До збереження заявка не змінюється.</div><div id="ticketGeoPointStatus" class="tools-map-status hidden"></div><div id="ticketGeoPointPicker" class="tools-map tools-map-picker ticket-geo-picker-map"></div><div class="ticket-geo-picker-footer"><div id="ticketGeoPointCoords" class="ticket-geo-picker-coords">${initial?`${initial.lat.toFixed(6)}, ${initial.lng.toFixed(6)}`:'Точку ще не вибрано'}</div><div class="row wrap ticket-geo-picker-actions"><button type="button" class="btn" id="ticketGeoPointGps">🎯 Моє місцезнаходження</button><button type="button" class="btn btn-accent" id="ticketGeoPointSave">Зберегти точку</button><button type="button" class="btn" id="ticketGeoPointCancel">Скасувати</button></div></div></div>`,{overlayClass:'ticket-geo-picker-overlay',onClose:closePicker,onOpen:()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const showPoint=point=>{draft.set(point);const node=document.getElementById('ticketGeoPointCoords');if(node&&point)node.textContent=`${Number(point.lat).toFixed(6)}, ${Number(point.lng).toFixed(6)}`;};
    picker=MTToolsMap.mountPicker(document.getElementById('ticketGeoPointPicker'),{engine:'maplibre',initial,statusNode:document.getElementById('ticketGeoPointStatus'),onChange:showPoint});
    document.getElementById('ticketGeoPointCancel').onclick=closePicker;
    document.getElementById('ticketGeoPointGps').onclick=async()=>{
      try{const point=await MTToolsCore.requestCurrentPosition(navigator.geolocation);picker?.setPoint(point);showToast(point.accuracy?`Точність GPS ≈ ${Math.round(point.accuracy)} м`:'Точку GPS визначено');}
      catch(error){const code=Number(error?.code);showToast(code===1?'Доступ до геолокації заборонено':code===3?'Час очікування GPS вичерпано':'Не вдалося визначити місцезнаходження');}
    };
    document.getElementById('ticketGeoPointSave').onclick=()=>{
      if(!picker?.hasChanged()){showToast('Поставте або перемістіть маркер');return;}
      const point=picker.getPoint();if(!point){showToast('Натисніть потрібне місце на карті');return;}
      draft.set(point);const committed=draft.commit();setGeoLink(committed.geoLink,{lat:committed.geoLat,lng:committed.geoLng});
      closePicker();showToast('✅ Точку збережено');
    };
  }))});
}

function toolsNetworkHtml(){
  const query=String(toolsNetworkSearch||''),list=MTToolsCore.searchNetworkPoints(toolsNetworkPoints,query).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return `${toolsBackButton()}<button type="button" class="btn btn-accent btn-block" data-tools-action="new-network-point">＋ Додати точку</button>
    <div class="field" style="margin-top:10px;"><input type="search" role="searchbox" name="mt-internal-network-list-search" inputmode="search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" id="toolsNetworkSearch" value="${escapeHtml(query)}" placeholder="Пошук: тип, місто, вулиця, примітка"></div>
    <div style="margin-top:8px;">${list.length?list.map(point=>`<button type="button" class="btn btn-block tools-network-open" data-point-id="${escapeHtml(point.id)}" style="height:auto;min-height:58px;margin-bottom:8px;text-align:left;justify-content:space-between;"><span>📡 <strong>${escapeHtml(point.name||point.type||'Без назви')}</strong><small style="display:block;color:var(--text-dim);">${escapeHtml(MTToolsCore.networkPointAddress(point)||`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`)}${point.note?` · ${escapeHtml(point.note.slice(0,50))}`:''}</small></span><span>›</span></button>`).join(''):'<div class="card">Нічого не знайдено.</div>'}</div>`;
}
let toolsNetworkSearch='';
function toolsRenderTicketNetworkLinks(){
  const root=document.getElementById('calcNetworkPointLinks');if(!root)return;calcState.networkPointIds=MTToolsCore.networkPointIds(calcState.networkPointIds);
  const points=calcState.networkPointIds.map(id=>toolsNetworkPoints.find(point=>String(point.id)===id)).filter(Boolean);
  root.innerHTML=points.length?points.map(point=>`<div class="row between calc-network-link"><button type="button" class="btn btn-sm calc-network-open" data-point-id="${escapeHtml(point.id)}">${escapeHtml(point.type)} · ${escapeHtml(MTToolsCore.networkPointAddress(point)||point.name||point.id)}</button><button type="button" class="btn btn-sm btn-danger calc-network-unlink" data-point-id="${escapeHtml(point.id)}" aria-label="Відв’язати">✕</button></div>`).join(''):'<span style="font-size:12px;color:var(--text-faint);">Об’єкти не прив’язані</span>';
  root.querySelectorAll('.calc-network-open').forEach(button=>button.onclick=()=>{appNavigationPush('calculator-network-point',closeModal);toolsShowNetworkPoint(button.dataset.pointId);});
  root.querySelectorAll('.calc-network-unlink').forEach(button=>button.onclick=()=>{if(!confirm('Відв’язати об’єкт від заявки?'))return;calcState.networkPointIds=MTToolsCore.unlinkNetworkPoint(calcState.networkPointIds,button.dataset.pointId);toolsRenderTicketNetworkLinks();formTouchedByUser=true;});
}
function toolsLinkNetworkPointToTicket(id){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return false;
  calcState.networkPointIds=MTToolsCore.linkNetworkPoint(calcState.networkPointIds,point.id);appNavigationDrop('ticket-network-preview');toolsTicketLinkContext=null;closeModal();toolsRenderTicketNetworkLinks();formTouchedByUser=true;return true;
}
function toolsShowNetworkPointOnMap(point,returnToLinking=false){
  if(!point)return false;
  if(returnToLinking){const state=toolsCaptureTicketLinkContext();appNavigationDrop('ticket-network-preview');appNavigationPush('ticket-network-map',()=>toolsOpenTicketNetworkPointPicker(state),state);}
  closeModal();toolsView='map';toolsSelectedNetworkPointId=String(point.id);switchTab('tools');renderToolsScreen('map');requestAnimationFrame(()=>requestAnimationFrame(()=>{MTToolsMap.focusPoint(point,18);toolsHighlightNetworkPointInList(point.id);document.getElementById('toolsLeafletMap')?.scrollIntoView({behavior:'smooth',block:'center'});}));return true;
}
function toolsTicketNetworkPointPreviewHtml(point){
  const view=MTToolsCore.networkPointPreviewData(point),rows=[['Тип об’єкта',view.type],['Назва',view.name],['Ідентифікатор',view.id],['Коротка позначка',view.label],['Повна адреса',view.address],['Місто',view.city],['Вулиця',view.street],['Будинок / орієнтир',view.house],['Координати',view.coordinates]];
  return `<div class="tools-network-preview">${appBackButtonHtml('Назад до списку')}<div class="card">${rows.filter(row=>row[1]).map(row=>`<div class="tools-result-row"><span>${escapeHtml(row[0])}</span><strong>${escapeHtml(row[1])}</strong></div>`).join('')}${view.note?`<div class="tools-network-preview-note"><span>Примітка</span><div>${escapeHtml(view.note)}</div></div>`:''}</div><div id="ticketNetworkPointPreviewPhotos" class="tools-point-photo-grid"><span class="tools-network-preview-photo-empty">Фото недоступне</span></div><div class="row wrap tools-network-preview-actions"><button type="button" class="btn" id="ticketNetworkPointPreviewMapBtn">Показати на карті</button><button type="button" class="btn btn-accent" id="ticketNetworkPointPreviewLinkBtn">Прив’язати до заявки</button><button type="button" class="btn" id="ticketNetworkPointPreviewCloseBtn">Закрити</button></div></div>`;
}
async function toolsPopulateTicketNetworkPointPreviewPhotos(point){
  const root=document.getElementById('ticketNetworkPointPreviewPhotos'),keys=MTToolsCore.networkPointPreviewData(point).photoKeys;if(!root||!keys.length)return;
  let rendered=0;
  for(let index=0;index<keys.length;index++){
    const data=await resolvePhotoAsync(keys[index],null);if(!root||!data)continue;
    const button=document.createElement('button'),image=document.createElement('img');button.type='button';button.className='tools-point-photo-view';button.dataset.photoIndex=String(index);button.setAttribute('aria-label',`Відкрити фото ${index+1}`);image.src=data;image.alt=`Фото об’єкта ${index+1}`;button.appendChild(image);root.appendChild(button);rendered++;
  }
  if(rendered)root.querySelector('.tools-network-preview-photo-empty')?.remove();
  root.querySelectorAll('.tools-point-photo-view').forEach(button=>button.onclick=()=>toolsOpenNetworkPhotoViewer(point.id,button.dataset.photoIndex));
}
function toolsOpenTicketNetworkPointPreview(id){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return false;
  const context=toolsCaptureTicketLinkContext();appNavigationPush('ticket-network-preview',()=>toolsOpenTicketNetworkPointPicker(context),context);
  const closePreview=()=>{appNavigationDrop('ticket-network-preview');toolsTicketLinkContext=null;closeModal();};
  openModal('Деталі об’єкта',toolsTicketNetworkPointPreviewHtml(point),{onClose:closePreview,onOpen:()=>{
    document.getElementById('ticketNetworkPointPreviewMapBtn').onclick=()=>toolsShowNetworkPointOnMap(point,true);
    document.getElementById('ticketNetworkPointPreviewLinkBtn').onclick=()=>toolsLinkNetworkPointToTicket(point.id);
    document.getElementById('ticketNetworkPointPreviewCloseBtn').onclick=closePreview;
    toolsPopulateTicketNetworkPointPreviewPhotos(point);
  }});return true;
}
function toolsCaptureTicketLinkContext(){
  const input=document.getElementById('ticketNetworkPointSearch'),list=document.getElementById('ticketNetworkPointChoices');
  if(input)toolsTicketLinkContext={ticketId:String(editingTicketId||'draft'),query:input.value,scrollTop:list?.scrollTop||0};
  return appNavigationState(toolsTicketLinkContext||{ticketId:String(editingTicketId||'draft'),query:'',scrollTop:0});
}
function toolsOpenTicketNetworkPointPicker(context=null){
  toolsTicketLinkContext=appNavigationState(context||{ticketId:String(editingTicketId||'draft'),query:'',scrollTop:0});
  const rank=point=>{let score=0;if(String(point.city||'').toLocaleLowerCase('uk')===String(calcState.city||'').toLocaleLowerCase('uk'))score+=2;if(String(point.street||'').toLocaleLowerCase('uk')===String(calcState.street||'').toLocaleLowerCase('uk'))score+=4;return score;};
  openModal('Прив’язати об’єкт',`<button type="button" class="btn btn-accent btn-block" id="ticketNetworkPointCreateBtn" style="margin-bottom:10px;">➕ Створити об’єкт</button><div class="field"><input type="search" role="searchbox" name="mt-internal-point-link-search" inputmode="search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" id="ticketNetworkPointSearch" value="${escapeHtml(toolsTicketLinkContext.query||'')}" placeholder="Тип, місто, вулиця, адреса або примітка"></div><div id="ticketNetworkPointChoices" class="tools-network-point-choices"></div>`,{onClose:()=>{toolsTicketLinkContext=null;appNavigationDropPrefix('ticket-network-');closeModal();},onOpen:()=>{const input=document.getElementById('ticketNetworkPointSearch'),root=document.getElementById('ticketNetworkPointChoices'),render=()=>{const list=MTToolsCore.sortNewestFirst(MTToolsCore.searchNetworkPoints(toolsNetworkPoints,input.value)).sort((a,b)=>rank(b)-rank(a)).slice(0,150);root.innerHTML=list.map(point=>{const meta=MTToolsCore.networkPointPickerMeta(point);return `<div class="ticket-network-choice-row" data-point-row="${escapeHtml(point.id)}"><button type="button" class="btn ticket-network-choice" data-point-id="${escapeHtml(point.id)}"><span class="ticket-network-choice-copy"><span>${escapeHtml(point.type)} · ${escapeHtml(MTToolsCore.networkPointAddress(point)||point.name||point.id)}</span>${meta?`<small>${escapeHtml(meta)}</small>`:''}</span>${calcState.networkPointIds?.includes(String(point.id))?'<span>✅</span>':''}</button><button type="button" class="btn ticket-network-preview" data-point-id="${escapeHtml(point.id)}" aria-label="Переглянути деталі ${escapeHtml(point.name||point.type||point.id)}" title="Деталі">👁</button></div>`;}).join('')||'<div class="card">Нічого не знайдено.</div>';root.querySelectorAll('.ticket-network-choice').forEach(button=>button.onclick=()=>toolsLinkNetworkPointToTicket(button.dataset.pointId));root.querySelectorAll('.ticket-network-preview').forEach(button=>button.onclick=()=>toolsOpenTicketNetworkPointPreview(button.dataset.pointId));requestAnimationFrame(()=>{root.scrollTop=Number(toolsTicketLinkContext?.scrollTop)||0;const selected=toolsTicketLinkContext?.newPointId&&[...root.querySelectorAll('[data-point-row]')].find(row=>row.dataset.pointRow===String(toolsTicketLinkContext.newPointId));selected?.classList.add('selected');selected?.scrollIntoView({block:'nearest'});});};input.oninput=()=>{toolsTicketLinkContext.query=input.value;toolsTicketLinkContext.scrollTop=0;render();};document.getElementById('ticketNetworkPointCreateBtn').onclick=toolsStartTicketNetworkPointCreation;render();}});
}
function toolsStartTicketNetworkPointCreation(){
  const context=toolsCaptureTicketLinkContext();toolsLinkCreationContext=context;closeModal();appNavigationPush('ticket-network-create',()=>{toolsLinkCreationContext=null;toolsOpenTicketNetworkPointPicker(context);},context);toolsView='map';switchTab('tools');renderToolsScreen('map');requestAnimationFrame(()=>toolsStartMapAddMode());
}
function toolsReturnToTicketLinking(newPointId=''){
  const context=appNavigationState(toolsLinkCreationContext||toolsTicketLinkContext||{});context.newPointId=String(newPointId||'');toolsLinkCreationContext=null;appNavigationDrop('ticket-network-create');switchTab('calculator');toolsOpenTicketNetworkPointPicker(context);
}

function renderToolsScreen(view){
  const nextView=view||toolsView;toolsView=nextView;
  const root=document.getElementById('toolsScreenRoot');if(!root)return;
  MTToolsMap?.captureView?.();
  if(toolsView==='diagnostics')root.innerHTML=toolsDiagnosticsHtml();
  else if(toolsView==='map'){
    root.innerHTML=toolsMapHtml();
    requestAnimationFrame(()=>MTToolsMap.mount(document.getElementById('toolsLeafletMap'),MTToolsCore.mapObjects(tickets,toolsNetworkPoints),{
      filterRoot:document.getElementById('toolsMapFilters'),statusNode:document.getElementById('toolsMapStatus'),emptyStateNode:document.getElementById('toolsMapEmptyState'),markerPreset:settings.mapMarkerPreset,markerPreferences:settings.mapMarkerPreferences,onSelect:toolsOpenMapObject,onAddHere:point=>toolsStartMapAddMode(point)
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
    const viewButton=event.target.closest('[data-tools-view]');if(viewButton){toolsNavigate(viewButton.dataset.toolsView);return;}
    const router=event.target.closest('[data-router-ip]');if(router){window.open(`http://${router.dataset.routerIp}`,'_blank','noopener');return;}
    const point=event.target.closest('.tools-network-open');if(point){toolsShowNetworkPoint(point.dataset.pointId);return;}
    const groupedPoint=event.target.closest('.tools-network-object');if(groupedPoint){toolsFocusNetworkPoint(groupedPoint.dataset.pointId);return;}
    const action=event.target.closest('[data-tools-action]')?.dataset.toolsAction;
    if(action==='quick-diagnostics')toolsOpenDiagnostics(null,'tools');
    else if(action==='run-diagnostics')runToolsDiagnostics();
    else if(action==='copy-diagnostics')toolsCopyDiagnostic();
    else if(action==='attach-diagnostics')toolsAttachDiagnostics();
    else if(action==='save-diagnostics')toolsSaveCurrentDiagnostic();
    else if(action==='reset-diagnostic-address')toolsResetDiagnosticAddress();
    else if(action==='run-speed-test')toolsRunSpeedTest();
    else if(action==='cancel-speed-test')toolsCancelSpeedTest();
    else if(action==='return-to-ticket')toolsReturnToTicket();
    else if(action==='new-network-point')toolsOpenNetworkPointEditor();
    else if(action==='map-add-object')toolsStartMapAddMode();
    else if(action==='map-my-location')toolsLocateOnMap();
    else if(action==='map-toggle-fullscreen')toolsToggleMapFullscreen();
    else if(action==='map-add-at-location'&&toolsLastUserLocation)toolsStartMapAddMode(toolsLastUserLocation);
    else if(action==='map-use-online'){MTOfflineMap.setMode('online');renderToolsScreen('map');}
    else if(action==='map-bind-address')toolsBindAddressFromMap();
    else if(action==='select-offline-bounds')toolsStartOfflineBoundsSelection();
    else if(action==='save-offline-area')toolsSaveOfflineArea();
    else if(action==='show-offline-area')toolsShowOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='open-offline-map')toolsOpenOfflineMap();
    else if(action==='edit-offline-area')toolsEditOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='delete-offline-area')toolsDeleteOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='import-offline-area')toolsImportOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='export-offline-area')toolsExportOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='offline-map-guide')toolsOpenOfflineMapGuide(event.target.closest('[data-area-id]')?.dataset.areaId||'');
    else if(action==='import-offline-map'){toolsOfflineImportAreaId='';document.getElementById('toolsOfflineMapFile')?.click();}
    else if(action==='delete-offline-map')toolsDeleteOfflineMap();
    else if(action==='offline-settings-back')appNavigationBack();
  });
  root.addEventListener('change',event=>{
    if(event.target.id==='toolsOfflineMapFile'){const file=event.target.files?.[0];event.target.value='';toolsPrepareOfflineMap(file);}
    if(event.target.id==='toolsMapBaseMode'){event.target.value==='offline'?MTOfflineMap.setViewMode('offline'):MTOfflineMap.setMode(event.target.value);renderToolsScreen(toolsView);}
  });
  root.addEventListener('toggle',event=>{const street=event.target.closest?.('[data-network-street]');if(street){street.open?toolsNetworkOpenStreets.add(street.dataset.networkStreet):toolsNetworkOpenStreets.delete(street.dataset.networkStreet);return;}const city=event.target.closest?.('[data-network-city]');if(city)city.open?toolsNetworkOpenCities.add(city.dataset.networkCity):toolsNetworkOpenCities.delete(city.dataset.networkCity);},true);
  root.addEventListener('input',event=>{if(event.target.id==='toolsNetworkSearch'){toolsNetworkSearch=event.target.value;renderToolsScreen('map');const input=document.getElementById('toolsNetworkSearch');input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}});
  window.addEventListener('online',()=>{if(toolsView==='map'&&MTOfflineMap.getMode()==='auto'&&!MTToolsMap.handleConnectivityChange?.())renderToolsScreen('map');});
  window.addEventListener('offline',()=>{if(toolsView==='map'&&MTOfflineMap.getMode()==='auto'&&!MTToolsMap.handleConnectivityChange?.())renderToolsScreen('map');});
  document.getElementById('calcDiagnosticsBtn').addEventListener('click',openToolsDiagnosticsFromCalculator);
  document.getElementById('calcNetworkPointAddBtn')?.addEventListener('click',toolsOpenTicketNetworkPointPicker);
}

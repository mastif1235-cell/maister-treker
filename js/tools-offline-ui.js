/* Offline area and PMTiles installation UI. Mode/navigation and storage remain in their existing owners. */
function toolsBoundsLabel(header={}){
  return `${Number(header.minLat).toFixed(4)}, ${Number(header.minLon).toFixed(4)} → ${Number(header.maxLat).toFixed(4)}, ${Number(header.maxLon).toFixed(4)}`;
}
async function toolsPrepareOfflineMap(file,areaId=toolsOfflineImportAreaId){
  if(!file)return;
  const fileName=String(file.name||'').toLowerCase();
  if(fileName.endsWith('.json')){
    let isAreaParameters=false;
    try{if(file.size<=1024*1024){const parsed=JSON.parse(await file.text());isAreaParameters=parsed?.format==='master-tracker-offline-area-v1';}}catch(_e){}
    showToast(isAreaParameters?'Це файл параметрів області, а не офлайн-карта.\nДля офлайн-підкладки потрібен файл .pmtiles.':'Потрібен файл офлайн-карти у форматі .pmtiles.');return;
  }
  if(!fileName.endsWith('.pmtiles')){showToast('Потрібен файл офлайн-карти у форматі .pmtiles.');return;}
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
    showToast(message==='PMTILES_TILE_TYPE_UNSUPPORTED'?'Цей тип плиток PMTiles не підтримується. Потрібен vector MVT або raster PMTiles v3.':'Потрібен коректний файл офлайн-карти PMTiles v3.');
  }
}
async function toolsDeleteOfflineMap(){
  if(!confirm('Видалити лише офлайн-карту? Заявки, точки, фото й налаштування залишаться.'))return;
  const ok=await MTOfflineMap.remove();
  if(ok){renderToolsScreen(toolsView==='offline'?'offline':'map');showToast('Офлайн-карту видалено');}else showToast('Не вдалося видалити офлайн-карту');
}
function toolsOfflineSelectionHtml(value){
  if(!value)return '<div style="font-size:12px;color:var(--text-dim);">Область ще не вибрана.</div>';
  const estimate=MTToolsCore.estimateOfflineArea(value,value.minZoom||10,value.maxZoom||16),large=(estimate?.bytes||0)>500*1024*1024;
  const editing=toolsLoadOfflineAreas().find(item=>item.id===toolsOfflineEditingAreaId);
  return `<div class="card" style="margin-top:10px;"><strong>${editing?'Змінити область':'Нова область'}</strong><div class="field" style="margin-top:8px;"><label>Назва регіону</label><input id="toolsOfflineAreaName" value="${escapeHtml(value.name||editing?.name||'')}" placeholder="Наприклад: Дніпро"></div><div class="tools-offline-map-meta">Область вибрана ✅ · Zoom ${value.minZoom}–${value.maxZoom}</div>${large?'<div class="tools-map-status" style="margin-top:8px;">⚠️ Область може займати понад 500 МБ. Зменште її або максимальний zoom.</div>':''}<details class="tools-offline-more"><summary>Технічна інформація</summary><div class="tools-offline-map-meta">BBox: ${escapeHtml(toolsBoundsLabel({minLat:value.minLat,minLon:value.minLng,maxLat:value.maxLat,maxLon:value.maxLng}))}<br>Орієнтовно ${estimate?.tiles||0} плиток / ${escapeHtml(MTOfflineMap.formatBytes(estimate?.bytes||0))}</div></details><button type="button" class="btn btn-accent btn-block" data-tools-action="save-offline-area" style="margin-top:9px;">Зберегти область</button></div>`;
}
function toolsOpenOfflineMapGuide(areaId=''){
  const area=toolsLoadOfflineAreas().find(item=>item.id===areaId),areaDetails=area?`<div class="tools-map-status" style="margin-top:9px;"><strong>${escapeHtml(area.name)}</strong><br>BBox: ${escapeHtml(`${area.minLng},${area.minLat},${area.maxLng},${area.maxLat}`)}<br>Zoom: Z${area.minZoom}–Z${area.maxZoom}</div>`:'';
  openModal('Як отримати файл .pmtiles?',`<div class="card" style="font-size:13px;line-height:1.55;"><strong>1. Межі — не карта</strong><br>JSON містить лише назву, координати меж і zoom. Він не містить плиток і не перетворюється на карту.<br><br><strong>2. Підготуйте файл окремо</strong><br>Потрібен готовий <strong>PMTiles v3</strong> із vector MVT або raster-плитками з власного чи ліцензованого джерела. Офіційний PMTiles CLI може вирізати область лише з уже наявного сумісного PMTiles-архіву.<br><br><strong>3. Імпортуйте файл</strong><br>Застосунок перевірить формат, межі й доступне місце, а потім збереже карту локально на цьому пристрої.${areaDetails}</div><div class="tools-map-status" style="margin-top:10px;">Застосунок не завантажує плитки масово з OpenStreetMap або MapTiler і не надсилає ключ MapTiler у файл області.</div><a class="btn btn-block" style="margin-top:10px;text-decoration:none;text-align:center;" href="https://docs.protomaps.com/pmtiles/cli" target="_blank" rel="noopener noreferrer">Офіційна документація PMTiles CLI</a><div class="row wrap" style="margin-top:10px;"><button type="button" class="btn btn-accent" id="toolsOfflineGuideImportBtn" style="flex:1;">Вибрати готовий .pmtiles</button>${area?'<button type="button" class="btn" id="toolsOfflineGuideExportBtn">Зберегти межі (.json)</button>':''}<button type="button" class="btn" id="toolsOfflineGuideCloseBtn">Закрити</button></div>`,{onOpen:()=>{
    document.getElementById('toolsOfflineGuideCloseBtn').onclick=closeModal;
    document.getElementById('toolsOfflineGuideImportBtn').onclick=()=>{closeModal();toolsImportOfflineArea(area?.id||'');};
    const exportButton=document.getElementById('toolsOfflineGuideExportBtn');if(exportButton)exportButton.onclick=()=>{closeModal();toolsExportOfflineArea(area.id);};
  }});
}
function toolsOfflineAreasHtml(areas=[]){
  const installed=MTOfflineMap.readMeta?.();if(!areas.length)return `<div class="card"><strong>${installed?'✅ Офлайн-карта встановлена':'Офлайн-карта не встановлена'}</strong><div style="font-size:12px;color:var(--text-dim);margin-top:6px;">Збережених областей ще немає.</div></div>`;
  return `<div class="card"><div>${areas.map((area,index)=>{const linked=installed?.areaId===area.id;return `<div class="tools-offline-area-row"><div><strong>${index+1}. ${escapeHtml(area.name)}</strong><div class="tools-offline-map-meta">${linked?`✅ Офлайн-карта встановлена · ${escapeHtml(MTOfflineMap.formatBytes(installed.size))} · Zoom ${installed.header.minZoom}–${installed.header.maxZoom}`:'Карта не встановлена'}</div></div>${linked?`<div class="row wrap tools-offline-primary-actions"><button type="button" class="btn btn-sm" data-tools-action="open-offline-map">Відкрити</button><button type="button" class="btn btn-sm" data-tools-action="import-offline-area" data-area-id="${escapeHtml(area.id)}">Замінити</button><button type="button" class="btn btn-sm btn-danger" data-tools-action="delete-offline-map">Видалити</button></div>`:`<button type="button" class="btn btn-accent btn-block tools-offline-install" data-tools-action="import-offline-area" data-area-id="${escapeHtml(area.id)}">Вибрати файл .pmtiles і встановити</button>`}<details class="tools-offline-more"><summary>Технічна інформація</summary><div class="tools-offline-map-meta">BBox: ${escapeHtml(toolsBoundsLabel({minLat:area.minLat,minLon:area.minLng,maxLat:area.maxLat,maxLon:area.maxLng}))}<br>Zoom ${area.minZoom}–${area.maxZoom}</div><div class="row wrap"><button type="button" class="btn btn-sm" data-tools-action="show-offline-area" data-area-id="${escapeHtml(area.id)}">Показати межі</button><button type="button" class="btn btn-sm" data-tools-action="edit-offline-area" data-area-id="${escapeHtml(area.id)}">Змінити межі</button><button type="button" class="btn btn-sm" data-tools-action="offline-map-guide" data-area-id="${escapeHtml(area.id)}">Про формат PMTiles</button><button type="button" class="btn btn-sm" data-tools-action="export-offline-area" data-area-id="${escapeHtml(area.id)}">Зберегти параметри (.json)</button><button type="button" class="btn btn-sm btn-danger" data-tools-action="delete-offline-area" data-area-id="${escapeHtml(area.id)}">Видалити область</button></div></details></div>`;}).join('')}</div></div>`;
}
function toolsOfflineHtml(){
  const areas=toolsLoadOfflineAreas(),shown=toolsOfflinePendingBounds,installed=MTOfflineMap.readMeta?.(),mode=MTOfflineMap.getMode?.()||'auto';
  return `${toolsBackButton()}<input type="file" id="toolsOfflineMapFile" accept=".pmtiles,application/octet-stream,.json,application/json" class="hidden"><div class="card"><div class="row between wrap"><strong>Офлайн-карта</strong><select id="toolsMapBaseMode" class="tools-map-mode" aria-label="Режим підкладки"><option value="auto" ${mode==='auto'?'selected':''}>Авто</option><option value="online" ${mode==='online'?'selected':''}>Онлайн</option><option value="offline" ${mode==='offline'?'selected':''}>Офлайн</option></select></div>${!areas.length?`<div class="tools-offline-map-meta" style="margin-top:7px;">${installed?'✅ Офлайн-карта встановлена':'Спочатку додайте область'}</div>`:''}</div>${toolsOfflineAreasHtml(areas)}
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
  const areas=toolsLoadOfflineAreas(),at=areas.findIndex(item=>item.id===toolsOfflineEditingAreaId),base=at>=0?areas[at]:{},area=MTToolsCore.normalizeOfflineArea({...base,...toolsOfflinePendingBounds,name});
  const finish=next=>{if(toolsSaveOfflineAreas(next)){toolsOfflinePendingBounds=null;toolsOfflineEditingAreaId='';closeModal();renderToolsScreen('offline');showToast('✅ Область збережена');}};
  if(at>=0){areas[at]=area;finish(areas);return;}
  const duplicateAt=areas.findIndex(item=>MTToolsCore.offlineAreaDuplicate(item,area));if(duplicateAt<0){areas.push(area);finish(areas);return;}
  const duplicate=areas[duplicateAt];openModal('Схожа область вже існує',`<div class="card">«${escapeHtml(duplicate.name)}» має таку саму назву або майже ті самі межі.</div><div class="row wrap" style="margin-top:10px;"><button type="button" class="btn btn-accent" id="toolsOfflineDuplicateReplace">Замінити існуючу</button><button type="button" class="btn" id="toolsOfflineDuplicateNew">Зберегти як нову</button><button type="button" class="btn" id="toolsOfflineDuplicateCancel">Скасувати</button></div>`,{onOpen:()=>{
    document.getElementById('toolsOfflineDuplicateReplace').onclick=()=>{areas[duplicateAt]=MTToolsCore.normalizeOfflineArea({...duplicate,...toolsOfflinePendingBounds,name,id:duplicate.id,createdAt:duplicate.createdAt});finish(areas);};
    document.getElementById('toolsOfflineDuplicateNew').onclick=()=>{areas.push(area);finish(areas);};
    document.getElementById('toolsOfflineDuplicateCancel').onclick=closeModal;
  }});
}

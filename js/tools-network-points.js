/* Network point editor, details, photos and Telegram actions. Shared state stays in tools-domain.js. */
function toolsNetworkPointPhotoSignature(point){return JSON.stringify((point.photoKeys||[point.photoKey]).filter(Boolean));}
function toolsNetworkPointTelegramText(point){
  const address=MTToolsCore.networkPointAddress(point),location=`https://www.google.com/maps?q=${point.lat},${point.lng}`;
  const metadata={schema:'master-tracker-network-point-v1',id:String(point.id),networkPointType:point.type||'',city:point.city||'',street:point.street||'',house:point.house||'',note:point.note||'',lat:point.lat,lng:point.lng,createdAt:point.createdAt,updatedAt:point.updatedAt};
  return [`📡 ${point.name||point.type}`,address?`Адреса: ${address}`:'',point.note?`Примітка: ${point.note}`:'',`Дата: ${new Date(point.updatedAt).toLocaleString('uk-UA')}`,`Координати: ${point.lat}, ${point.lng}`,location,'NETWORK_POINT_JSON',JSON.stringify(metadata)].filter(Boolean).join('\n');
}
function toolsOpenNetworkPointEditor(id='',defaults={},options={}){
  const existing=toolsNetworkPoints.find(point=>point.id===id)||defaults||{};
  const isNew=!existing.id;
  const cities=[...new Set([...(settings.cities||[]),...tickets.map(ticket=>ticket.city)].filter(Boolean))].sort();
  const streets=[...new Set([...Object.values(settings.streets||{}).flat(),...tickets.map(ticket=>ticket.street)].filter(Boolean))].sort();
  let pointEditorDirty=false;
  const closePointEditor=()=>{if(pointEditorDirty&&!confirm('Повернутись назад? Незбережені дані об’єкта буде втрачено.'))return;document.getElementById('toolsScreenRoot')?.classList.remove('tools-map-editor-open');options.placement?.cancel?.();MTToolsMap.destroyPicker();closeModal();if(options.returnToLinking)toolsReturnToTicketLinking();};
  openModal(existing.id?'Редагувати точку':'Нова точка мережі',`
    <div class="field"><label>Тип</label><select id="toolsPointType">${MTToolsCore.NETWORK_POINT_TYPES.map(type=>`<option ${type===(existing.type||'FOB')?'selected':''}>${escapeHtml(type)}</option>`).join('')}</select></div>
    <div class="field-row"><div class="field"><label>Місто</label><input id="toolsPointCity" name="mt-internal-point-city" autocomplete="off" autocorrect="off" spellcheck="false" list="toolsPointCities" value="${escapeHtml(existing.city||'')}"><datalist id="toolsPointCities">${cities.map(value=>`<option value="${escapeHtml(value)}">`).join('')}</datalist></div><div class="field"><label>Вулиця</label><input id="toolsPointStreet" name="mt-internal-point-street" autocomplete="off" autocorrect="off" spellcheck="false" list="toolsPointStreets" value="${escapeHtml(existing.street||'')}"><datalist id="toolsPointStreets">${streets.map(value=>`<option value="${escapeHtml(value)}">`).join('')}</datalist></div></div>
    <div class="field-row"><div class="field"><label>Будинок / орієнтир</label><input id="toolsPointHouse" name="mt-internal-point-location" autocomplete="off" autocorrect="off" spellcheck="false" value="${escapeHtml(existing.house||'')}"></div><div class="field"><label>Коротка позначка</label><input id="toolsPointLabel" name="mt-internal-point-label" autocomplete="off" value="${escapeHtml(existing.label||'')}"></div></div>
    <div class="field-row"><div class="field"><label>Широта</label><input id="toolsPointLat" inputmode="decimal" value="${existing.lat??''}" placeholder="50.4501"></div><div class="field"><label>Довгота</label><input id="toolsPointLng" inputmode="decimal" value="${existing.lng??''}" placeholder="30.5234"></div></div>
    <div class="row wrap" style="margin:-2px 0 12px;"><button type="button" class="btn" id="toolsPointLocateBtn" style="flex:1;">◎ Поточне місце</button><button type="button" class="btn" id="toolsPointPickBtn" style="flex:1;">🗺 Вказати на карті</button></div>
    <div id="toolsPointPickerPanel" class="hidden tools-map-picker-panel"><div id="toolsPointPickerStatus" class="tools-map-status hidden" role="status"></div><div id="toolsPointPickerMap" class="tools-map tools-map-picker" aria-label="Вибір координат точки"></div><div class="row" style="margin-top:8px;"><button type="button" class="btn btn-accent" id="toolsPointUseMapBtn" style="flex:1;">Використати цю точку</button><button type="button" class="btn" id="toolsPointCancelMapBtn">Скасувати</button></div></div>
    <div class="field"><label>Примітка</label><textarea id="toolsPointNote">${escapeHtml(existing.note||'')}</textarea></div>
    ${isNew?'':`<div class="field"><label>Збережені фото</label><div id="toolsPointExistingPhotos" class="tools-point-existing-photos">${(existing.photoKeys||[existing.photoKey]).filter(Boolean).map((key,index)=>`<div class="tools-point-existing-photo" data-photo-key="${escapeHtml(key)}"><img class="tools-point-existing-photo-preview" data-photo-preview-key="${escapeHtml(key)}" alt="Фото ${index+1}"><span>Фото ${index+1}</span><button type="button" class="btn btn-sm btn-danger tools-point-photo-remove" data-photo-key="${escapeHtml(key)}">🗑 Видалити</button></div>`).join('')||'<span style="color:var(--text-faint);font-size:12px;">Фото немає</span>'}</div></div>`}
    <div class="field"><label>Фото (до 3)</label><input type="file" id="toolsPointPhoto" accept="image/*" multiple></div>
    <div class="tools-point-editor-footer row wrap"><button type="button" class="btn btn-accent" id="toolsPointSaveBtn" style="flex:1;">Зберегти</button><button type="button" class="btn" id="toolsPointCancelBtn" style="flex:1;">Скасувати</button></div>`,{overlayClass:options.placement?'tools-point-editor-overlay':'tools-point-editor-modal',onClose:closePointEditor,onOpen:()=>{
      const latInput=document.getElementById('toolsPointLat'),lngInput=document.getElementById('toolsPointLng'),panel=document.getElementById('toolsPointPickerPanel');
      let mapPicker=null;
      const inputPoint=()=>MTToolsCore.parseCoordinates(`${latInput.value.replace(',','.')},${lngInput.value.replace(',','.')}`);
      const writePoint=point=>{latInput.value=Number(point.lat).toFixed(6);lngInput.value=Number(point.lng).toFixed(6);pointEditorDirty=true;};
      options.placement?.onChange?.(writePoint);
      document.getElementById('modalBody').addEventListener('input',()=>{pointEditorDirty=true;});
      document.getElementById('modalBody').addEventListener('change',()=>{pointEditorDirty=true;});
      document.querySelectorAll('[data-photo-preview-key]').forEach(async image=>{const data=await resolvePhotoAsync(image.dataset.photoPreviewKey,null);if(data)image.src=data;});
      document.querySelectorAll('.tools-point-photo-remove').forEach(button=>button.onclick=async()=>{if(!confirm('Видалити це фото?'))return;button.disabled=true;await toolsRemoveNetworkPointPhoto(existing.id,button.dataset.photoKey);});
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
      const savePoint=async()=>{
        const saveButton=document.getElementById('toolsPointSaveBtn');if(saveButton.disabled)return;saveButton.disabled=true;
        const now=new Date(),type=document.getElementById('toolsPointType').value,label=document.getElementById('toolsPointLabel').value.trim(),base={...existing,name:[type,label].filter(Boolean).join(' '),type,city:document.getElementById('toolsPointCity').value,street:document.getElementById('toolsPointStreet').value,house:document.getElementById('toolsPointHouse').value,label,lat:document.getElementById('toolsPointLat').value.replace(',','.'),lng:document.getElementById('toolsPointLng').value.replace(',','.'),note:document.getElementById('toolsPointNote').value};
        const normalized=MTToolsCore.normalizeNetworkPoint(base,now);if(!normalized){saveButton.disabled=false;showToast('Вкажіть коректні координати');return;}
        const files=[...document.getElementById('toolsPointPhoto').files].slice(0,3),keys=(existing.photoKeys||[existing.photoKey]).filter(Boolean);
        for(const file of files){const key=await toolsStoreCompressedPhoto(file);if(!key){showToast('Не вдалося зберегти фото');return;}keys.push(key);}normalized.photoKeys=[...new Set(keys)].slice(0,3);normalized.photoKey=normalized.photoKeys[0]||'';
        const at=toolsNetworkPoints.findIndex(point=>point.id===normalized.id);if(at>=0)toolsNetworkPoints[at]=normalized;else toolsNetworkPoints.push(normalized);
        if(!toolsSaveNetworkPoints()){saveButton.disabled=false;return;}document.getElementById('toolsScreenRoot')?.classList.remove('tools-map-editor-open');options.placement?.cancel?.();MTToolsMap.destroyPicker();closeModal();if(options.returnToLinking)toolsReturnToTicketLinking(normalized.id);else renderToolsScreen(options.returnView||'map');showToast('Точку збережено локально');await toolsSendNetworkPointTelegram(normalized,{updateExisting:!isNew});
      };
      document.getElementById('toolsPointSaveBtn').onclick=savePoint;
    }});
}
async function toolsSendNetworkPointTelegram(point,options={}){
  const current=toolsNetworkPoints.find(item=>String(item.id)===String(point?.id));if(!current)return false;
  const hasReference=!!telegramNetworkMessageLink(current.telegramChatId,current.telegramMessageId);if(hasReference&&!options.updateExisting&&!options.republish)return true;
  if(toolsNetworkTelegramSending.has(current.id)){showToast('Відправлення вже виконується');return false;}toolsNetworkTelegramSending.add(current.id);
  try{
    const chatId=String(settings.tgBackupChatId||'').trim();if(!String(settings.tgBotToken||'').trim()||!chatId){current.telegramSendPending=true;toolsSaveNetworkPoints();showToast('Точку збережено. Telegram не налаштовано');return false;}
    const text=toolsNetworkPointTelegramText(current),photos=(current.photoKeys||[current.photoKey]).filter(Boolean),photoSignature=toolsNetworkPointPhotoSignature(current);
    const refs=(current.telegramMediaRefs||[]).map(ref=>({...ref}));let mediaOk=true,legacyRemoval=false;
    if(hasReference&&!options.republish){
      const result=await editTelegramTextMessage(current.telegramChatId,current.telegramMessageId,text);
      current.telegramSendPending=!result.ok;
      let legacyKeys=[];try{legacyKeys=JSON.parse(current.telegramPhotoSignature||'[]');}catch(_error){legacyKeys=[];}const previouslyTracked=new Set(refs.map(ref=>ref.photoKey)),untrackedLegacy=legacyKeys.filter(key=>!previouslyTracked.has(key));
      for(const ref of refs.filter(ref=>!photos.includes(ref.photoKey))){const deleted=await deleteTelegramMessageById(current.telegramChatId,ref.messageId);if(deleted.ok)refs.splice(refs.findIndex(item=>item.photoKey===ref.photoKey&&item.messageId===ref.messageId),1);else mediaOk=false;}
      const tracked=new Set(refs.map(ref=>ref.photoKey));
      for(const key of photos.filter(key=>!tracked.has(key)&&!legacyKeys.includes(key))){const sent=await sendTelegramPhotoMessage(current.telegramChatId,key,`${current.name||current.type} · фото`);if(sent.ok&&sent.messageId)refs.push({photoKey:key,messageId:sent.messageId});else mediaOk=false;}
      legacyRemoval=untrackedLegacy.some(key=>!photos.includes(key));
      current.telegramMediaRefs=refs;current.telegramMediaUpdatePending=!result.ok||!mediaOk||legacyRemoval;
      if(result.ok&&mediaOk&&!legacyRemoval)current.telegramPhotoSignature=photoSignature;
      toolsSaveNetworkPoints();
      if(!result.ok)showToast('Об’єкт збережено локально, але Telegram не вдалося оновити.');
      else if(current.telegramMediaUpdatePending)showToast('Текст синхронізовано. Фото збережено в Майстер-Трекері, але старе Telegram-медіа без message ID неможливо безпечно змінити.');
      else showToast('✅ Публікацію Telegram оновлено');
      return result.ok&&mediaOk&&!legacyRemoval;
    }
    const firstResult=await sendToTelegramChat(chatId,text,null,null);const newRefs=[];if(firstResult.ok){for(const key of photos){const sent=await sendTelegramPhotoMessage(chatId,key,`${current.name||current.type} · фото`);if(sent.ok&&sent.messageId)newRefs.push({photoKey:key,messageId:sent.messageId});else mediaOk=false;}}
    if(firstResult.ok&&telegramNetworkMessageLink(firstResult.chatId,firstResult.messageId)){current.telegramChatId=String(firstResult.chatId);current.telegramMessageId=Number(firstResult.messageId);current.telegramMediaRefs=newRefs;current.telegramSendPending=false;current.telegramMediaUpdatePending=!mediaOk;current.telegramPhotoSignature=JSON.stringify(newRefs.map(ref=>ref.photoKey));}else current.telegramSendPending=true;
    toolsSaveNetworkPoints();showToast(firstResult.ok&&mediaOk?'✅ Точку надіслано в Telegram':firstResult.ok?'Точку надіслано, але не всі фото синхронізовано':'Об’єкт збережено локально, але не вдалося надіслати в Telegram');return firstResult.ok&&mediaOk;
  }finally{toolsNetworkTelegramSending.delete(current.id);}
}
function toolsStoreCompressedPhoto(file){
  return new Promise(resolve=>{const reader=new FileReader();reader.onerror=()=>resolve(null);reader.onload=event=>{const image=new Image();image.onerror=()=>resolve(null);image.onload=async()=>{const scale=Math.min(1,800/image.width),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);resolve(await storePhoto(canvas.toDataURL('image/jpeg',.72)));};image.src=event.target.result;};reader.readAsDataURL(file);});
}
function toolsPhotoKeyStillUsed(key,removedPointId){
  const inAnotherPoint=toolsNetworkPoints.some(point=>String(point.id)!==String(removedPointId)&&(point.photoKeys||[point.photoKey]).filter(Boolean).includes(key));
  const inTicket=tickets.some(ticket=>(ticket.photos||[ticket.photo]).filter(Boolean).includes(key));
  return inAnotherPoint||inTicket;
}
async function toolsRemoveNetworkPointPhoto(pointId,key){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(pointId));if(!point||!(point.photoKeys||[point.photoKey]).filter(Boolean).includes(key))return false;
  const previous={...point,photoKeys:(point.photoKeys||[]).slice()},nextKeys=(point.photoKeys||[point.photoKey]).filter(Boolean).filter(value=>value!==key);point.photoKeys=nextKeys;point.photoKey=nextKeys[0]||'';point.updatedAt=new Date().toISOString();
  if(!toolsSaveNetworkPoints()){Object.assign(point,previous);return false;}if(!toolsPhotoKeyStillUsed(key,pointId))await deletePhotoKey(key);await toolsSendNetworkPointTelegram(point,{updateExisting:true});closeModal();toolsOpenNetworkPointEditor(pointId);showToast('Фото видалено з об’єкта');return true;
}
async function toolsDeleteNetworkPoint(id){
  const previous=toolsNetworkPoints,outcome=MTToolsCore.removeNetworkPoint(previous,id);if(!outcome.removed)return false;
  const linked=MTToolsCore.ticketsForNetworkPoint(tickets,id),previousLinks=linked.map(ticket=>({ticket,ids:(ticket.networkPointIds||[]).slice()}));
  MTToolsCore.removeNetworkPointLinks(tickets,id);
  if(linked.length&&!await saveTickets()){previousLinks.forEach(item=>item.ticket.networkPointIds=item.ids);return false;}
  toolsNetworkPoints=outcome.points;
  if(!toolsSaveNetworkPoints()){toolsNetworkPoints=previous;previousLinks.forEach(item=>item.ticket.networkPointIds=item.ids);if(linked.length)await saveTickets();return false;}
  const photoKeys=[...new Set((outcome.removed.photoKeys||[outcome.removed.photoKey]).filter(Boolean))];
  for(const key of photoKeys){if(!toolsPhotoKeyStillUsed(key,id))await deletePhotoKey(key);}
  closeModal();renderToolsScreen(toolsView);showToast('Об’єкт видалено');return true;
}
function toolsConfirmDeleteNetworkPoint(id){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return;
  const linked=MTToolsCore.ticketsForNetworkPoint(tickets,id).length;
  openModal('Видалити об’єкт',`<p style="margin:0 0 14px;">Видалити цей об’єкт?${linked?`<br><strong>Цей об’єкт пов’язаний з ${linked} заявками.</strong> Заявки залишаться, буде видалено лише зв’язок.`:''}</p><div class="row wrap"><button type="button" class="btn btn-danger" id="toolsPointDeleteConfirmBtn" style="flex:1;">Видалити</button><button type="button" class="btn" id="toolsPointDeleteCancelBtn" style="flex:1;">Скасувати</button></div>`,{onOpen:()=>{
    document.getElementById('toolsPointDeleteCancelBtn').onclick=()=>toolsShowNetworkPoint(point.id);
    document.getElementById('toolsPointDeleteConfirmBtn').onclick=async event=>{event.currentTarget.disabled=true;await toolsDeleteNetworkPoint(point.id);};
  }});
}
async function toolsOpenNetworkPhotoViewer(pointId,startIndex=0){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(pointId)),keys=(point?.photoKeys||[point?.photoKey]).filter(Boolean);if(!keys.length)return;
  const images=(await Promise.all(keys.map(key=>resolvePhotoAsync(key,null)))).filter(Boolean);if(!images.length)return;let index=Math.max(0,Math.min(images.length-1,Number(startIndex)||0)),zoom=1;
  openModal('Фото об’єкта',`<div class="tools-photo-viewer"><div class="tools-photo-viewer-stage" id="toolsPhotoViewerStage"><img id="toolsPhotoViewerImage" alt="Фото об’єкта"></div><div class="row wrap tools-photo-viewer-controls"><button class="btn" id="toolsPhotoPrev">‹</button><button class="btn" id="toolsPhotoZoomOut">−</button><button class="btn" id="toolsPhotoZoomReset">100%</button><button class="btn" id="toolsPhotoZoomIn">＋</button><button class="btn" id="toolsPhotoNext">›</button></div></div>`,{overlayClass:'tools-photo-viewer-overlay',onOpen:()=>{const image=document.getElementById('toolsPhotoViewerImage'),stage=document.getElementById('toolsPhotoViewerStage'),draw=(resetScroll=false)=>{image.src=images[index];image.style.width=`${zoom*100}%`;image.classList.toggle('zoomed',zoom>1);document.getElementById('toolsPhotoZoomReset').textContent=`${Math.round(zoom*100)}%`;if(resetScroll){stage.scrollTop=0;stage.scrollLeft=0;}};const move=delta=>{index=(index+delta+images.length)%images.length;zoom=1;draw(true);};document.getElementById('toolsPhotoPrev').onclick=()=>move(-1);document.getElementById('toolsPhotoNext').onclick=()=>move(1);document.getElementById('toolsPhotoZoomOut').onclick=()=>{zoom=Math.max(1,zoom-.5);draw(zoom===1);};document.getElementById('toolsPhotoZoomIn').onclick=()=>{zoom=Math.min(4,zoom+.5);draw();};document.getElementById('toolsPhotoZoomReset').onclick=()=>{zoom=1;draw(true);};image.ondblclick=()=>{zoom=zoom===1?2:1;draw(zoom===1);};let touchX=null;stage.ontouchstart=event=>{touchX=event.touches.length===1?event.touches[0].clientX:null;};stage.ontouchend=event=>{if(zoom!==1||touchX===null||event.changedTouches.length!==1)return;const delta=event.changedTouches[0].clientX-touchX;if(Math.abs(delta)>50)move(delta>0?-1:1);touchX=null;};draw(true);}});
}
function toolsMoveNetworkPoint(id){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return;let picker=null;
  openModal('Перемістити на карті',`<div id="toolsMovePointStatus" class="tools-map-status hidden"></div><div id="toolsMovePointMap" class="tools-map tools-map-picker"></div><div class="row wrap" style="margin-top:8px;"><button class="btn btn-accent" id="toolsMovePointSave" style="flex:1;">Зберегти нове місце</button><button class="btn" id="toolsMovePointCancel">Скасувати</button></div>`,{onClose:()=>{MTToolsMap.destroyPicker();closeModal();},onOpen:()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{picker=MTToolsMap.mountPicker(document.getElementById('toolsMovePointMap'),{initial:point,statusNode:document.getElementById('toolsMovePointStatus')});document.getElementById('toolsMovePointCancel').onclick=()=>{MTToolsMap.destroyPicker();closeModal();toolsShowNetworkPoint(point.id);};document.getElementById('toolsMovePointSave').onclick=async()=>{if(!picker?.hasChanged()){showToast('Перемістіть маркер або торкніться карти');return;}const next=picker.getPoint(),previous={lat:point.lat,lng:point.lng,updatedAt:point.updatedAt};point.lat=next.lat;point.lng=next.lng;point.updatedAt=new Date().toISOString();if(!toolsSaveNetworkPoints()){Object.assign(point,previous);return;}await toolsSendNetworkPointTelegram(point,{updateExisting:true});MTToolsMap.destroyPicker();closeModal();renderToolsScreen('map');showToast('✅ Нове місце збережено');};}))});
}
function toolsShowNetworkPoint(id){
  const point=toolsNetworkPoints.find(item=>item.id===id);if(!point)return;
  toolsSelectedNetworkPointId=String(point.id);toolsHighlightNetworkPointInList(point.id);
  const modalNavigationKey=appNavigationPeek()?.key||'';
  const closePointDetails=()=>{if(modalNavigationKey)appNavigationDrop(modalNavigationKey);closeModal();};
  const address=MTToolsCore.networkPointAddress(point),telegramLink=telegramNetworkMessageLink(point.telegramChatId,point.telegramMessageId),telegramLabel=telegramLink?'✈️ Оновити в Telegram':point.telegramSendPending?'✈️ Повторити відправлення':'✈️ Надіслати в Telegram',linked=MTToolsCore.ticketsForNetworkPoint(tickets,point.id);openModal(point.name||point.type||'Точка мережі',`${appNavigationCanGoBack()?appBackButtonHtml():''}<div style="font-size:13px;line-height:1.6;"><strong>${escapeHtml(point.type)}</strong>${address?`<br>🏘 ${escapeHtml(address)}`:''}<br>📍 ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}<div style="font-size:11.5px;color:var(--text-dim);margin-top:4px;">Створено: ${escapeHtml(new Date(point.createdAt).toLocaleString('uk-UA'))}<br>Оновлено: ${escapeHtml(new Date(point.updatedAt).toLocaleString('uk-UA'))}</div>${point.note?`<div style="white-space:pre-wrap;margin-top:8px;">${escapeHtml(point.note)}</div>`:''}<div id="toolsPointPhotoPreview" class="tools-point-photo-grid" style="margin-top:8px;"></div>${linked.length?`<div class="card" style="margin-top:10px;"><strong>Пов’язані заявки: ${linked.length}</strong>${linked.map(ticket=>`<button class="btn btn-block tools-linked-ticket" data-ticket-id="${escapeHtml(ticket.id)}" style="margin-top:6px;">${escapeHtml(ticket.date||'')} — ${escapeHtml(ticket.type||'Заявка')}</button>`).join('')}</div>`:''}<div class="row wrap" style="margin-top:10px;"><button type="button" class="btn" id="toolsPointMapBtn" style="flex:1;">📍 Показати на карті</button><button type="button" class="btn" id="toolsPointMoveBtn" style="flex:1;">↔ Перемістити на карті</button><button type="button" class="btn" id="toolsPointRouteBtn" style="flex:1;">🗺 Маршрут</button><button type="button" class="btn" id="toolsPointEditBtn" style="flex:1;">✏️ Редагувати</button>${telegramLink?`<button type="button" class="btn btn-accent" id="toolsPointTelegramOpenBtn" style="flex:1 0 100%;">Відкрити в Telegram</button>`:''}<button type="button" class="btn" id="toolsPointTelegramBtn" style="flex:1 0 100%;">${telegramLabel}</button><button type="button" class="btn btn-danger" id="toolsPointDeleteBtn" style="flex:1 0 100%;">Видалити об’єкт</button></div></div>`,{onClose:closePointDetails,onOpen:async()=>{
    document.getElementById('toolsPointMapBtn').onclick=()=>toolsShowNetworkPointOnMap(point);
    document.getElementById('toolsPointRouteBtn').onclick=()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${point.lat},${point.lng}`)}`,'_blank','noopener');
    document.getElementById('toolsPointMoveBtn').onclick=()=>toolsMoveNetworkPoint(point.id);
    document.getElementById('toolsPointEditBtn').onclick=()=>{closeModal();toolsOpenNetworkPointEditor(point.id);};
    document.getElementById('toolsPointDeleteBtn').onclick=()=>toolsConfirmDeleteNetworkPoint(point.id);
    const openTelegramButton=document.getElementById('toolsPointTelegramOpenBtn');if(openTelegramButton)openTelegramButton.onclick=()=>window.open(telegramLink,'_blank','noopener');
    document.getElementById('toolsPointTelegramBtn').onclick=async event=>{
      const button=event.currentTarget,oldText=button.textContent;button.disabled=true;button.textContent='Оновлення…';await toolsSendNetworkPointTelegram(point,{updateExisting:!!telegramLink});button.disabled=false;button.textContent=oldText;
    };
    document.querySelectorAll('.tools-linked-ticket').forEach(button=>button.onclick=()=>{closeModal();editTicket(button.dataset.ticketId);});
    const root=document.getElementById('toolsPointPhotoPreview'),photos=(point.photoKeys||[point.photoKey]).filter(Boolean);for(let index=0;index<photos.length;index++){const data=await resolvePhotoAsync(photos[index],null);if(root&&data)root.insertAdjacentHTML('beforeend',`<button class="tools-point-photo-view" data-photo-index="${index}" aria-label="Відкрити фото"><img src="${data}" alt="Фото точки"></button>`);}root?.querySelectorAll('.tools-point-photo-view').forEach(button=>button.onclick=()=>toolsOpenNetworkPhotoViewer(point.id,button.dataset.photoIndex));
  }});
}
function toolsHighlightNetworkPointInList(id){document.querySelectorAll('.tools-network-object').forEach(button=>button.classList.toggle('selected',String(button.dataset.pointId)===String(id)));}
function toolsFocusNetworkPoint(id){const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return;toolsSelectedNetworkPointId=String(id);MTToolsMap.focusPoint(point,18);toolsHighlightNetworkPointInList(id);document.getElementById('toolsLeafletMap')?.scrollIntoView({behavior:'smooth',block:'center'});toolsShowNetworkPoint(point.id);}

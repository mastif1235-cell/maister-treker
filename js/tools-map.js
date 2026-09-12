/* Interactive OpenStreetMap layer for local-only field tools. */
(function(root){
  'use strict';

  const TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const MAPTILER_TILE_URL='https://api.maptiler.com/maps/hybrid-v4/{z}/{x}/{y}.jpg';
  const MAPTILER_LOGO_URL='https://api.maptiler.com/resources/logo.svg';
  const DEFAULT_CENTER=[48.45,31.2];
  const CATEGORY_META={
    private:{label:'Приватні',icon:'🏠',className:'private'},
    apartment:{label:'Багатоквартирні',icon:'🏢',className:'apartment'},
    FOB:{label:'FOB',icon:'📦',className:'fob'},
    'Муфта':{label:'Муфти',icon:'🔗',className:'splice'},
    'Вузол':{label:'Вузли',icon:'📡',className:'node'},
    'Інше':{label:'Інші',icon:'📍',className:'other'}
  };
  const categories=Object.keys(CATEGORY_META);
  const selected=new Set(categories);
  let map=null;
  let tileLayer=null;
  let savedView=null;
  let groups=new Map();
  let picker=null;
  let userLayer=null;
  let selectionLayer=null;
  let placement=null;
  let unbindLongPress=null;
  const baseStates=new WeakMap();

  function hasLeaflet(){return !!(root.L&&typeof root.L.map==='function');}
  /* Long-press по карті = «додати обʼєкт тут». Один спільний обробник для обох
     рушіїв: він лише визначає жест і віддає координати екрана, а сценарій
     додавання лишається той самий, який уже приходить у onAddHere. */
  function bindMapLongPress(container,handler,options={}){
    if(!container||typeof handler!=='function')return null;
    const holdMs=Number(options.holdMs)>0?Number(options.holdMs):600;
    const tolerance=Number(options.tolerance)>0?Number(options.tolerance):12;
    let timer=null,start=null,pointerId=null,firedAt=0;
    const clearTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
    const cancel=()=>{clearTimer();start=null;pointerId=null;};
    const recent=()=>firedAt>0&&Date.now()-firedAt<900;
    const onPointerDown=event=>{
      if(options.ignore?.())return;
      if(event.pointerType==='mouse'&&event.button!==0)return;
      if(pointerId!==null){cancel();return;} // друга точка дотику — це вже жест масштабування
      pointerId=event.pointerId??'pointer';start={x:Number(event.clientX)||0,y:Number(event.clientY)||0};
      clearTimer();
      timer=setTimeout(()=>{
        timer=null;
        if(!start||options.ignore?.()){cancel();return;}
        firedAt=Date.now();
        const point={x:start.x,y:start.y};
        cancel();
        handler(point.x,point.y);
      },holdMs);
    };
    const onPointerMove=event=>{
      if(!start)return;
      if(pointerId!==null&&event.pointerId!==undefined&&event.pointerId!==pointerId)return;
      const dx=(Number(event.clientX)||0)-start.x,dy=(Number(event.clientY)||0)-start.y;
      if(Math.hypot(dx,dy)>tolerance)cancel(); // користувач веде карту — жест скасовується
    };
    const onPointerEnd=()=>cancel();
    const onClick=event=>{
      if(!recent())return;
      firedAt=0;
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      event.stopPropagation?.();
    };
    const onContextMenu=event=>{
      // Поки палець утримують (або одразу після) браузерне меню не потрібне.
      if(!recent()&&!start)return;
      firedAt=0;
      event.preventDefault?.();
      event.stopPropagation?.();
    };
    container.addEventListener('pointerdown',onPointerDown);
    container.addEventListener('pointermove',onPointerMove);
    container.addEventListener('pointerup',onPointerEnd);
    container.addEventListener('pointercancel',onPointerEnd);
    container.addEventListener('pointerleave',onPointerEnd);
    container.addEventListener('click',onClick,true);
    container.addEventListener('contextmenu',onContextMenu,true);
    return ()=>{
      cancel();
      container.removeEventListener('pointerdown',onPointerDown);
      container.removeEventListener('pointermove',onPointerMove);
      container.removeEventListener('pointerup',onPointerEnd);
      container.removeEventListener('pointercancel',onPointerEnd);
      container.removeEventListener('pointerleave',onPointerEnd);
      container.removeEventListener('click',onClick,true);
      container.removeEventListener('contextmenu',onContextMenu,true);
    };
  }
  function requestedEngine(options={}){
    if(options.engine)return options.engine;
    try{return root.URLSearchParams&&new root.URLSearchParams(root.location?.search||'').get('mapEngine')==='leaflet'?'leaflet':'maplibre';}catch(_error){return'maplibre';}
  }
  function validPoint(value){
    const lat=Number(value?.lat),lng=Number(value?.lng);
    return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
  }
  function categoryFor(item){return CATEGORY_META[item?.category]?item.category:'Інше';}
  function markerLabel(item){
    if(item?.kind==='network')return item.name||item.type||'Точка мережі';
    const profile=item?.profiles?.[0];
    return profile?.address||[item?.city,item?.street,item?.house].filter(Boolean).join(', ')||'Будинок';
  }
  const MARKER_PRESETS={classic:{size:36,border:3},large:{size:40,border:3},compact:{size:30,border:2},contrast:{size:36,border:4}};
  const MARKER_SIZES={small:30,medium:36,large:40},MARKER_SHAPES=['drop','pin','badge','contrast'];
  function iconFor(category,pickerMode=false,presetKey='classic',preferences=null){
    const meta=pickerMode?{icon:'◎',className:'picker'}:CATEGORY_META[category]||CATEGORY_META['Інше'];
    if(!pickerMode&&root.MTMapMarkerRenderer){const preference=root.MTMapMarkerRenderer.preference(preferences?.[category],presetKey),descriptor=root.MTMapMarkerRenderer.descriptor(category,preference,presetKey),src=root.MTMapMarkerRenderer.dataUrl(category,preference,presetKey,root.document),size=descriptor.width+4;return root.L.divIcon({className:'tools-leaflet-icon-shell',html:`<img class="tools-canonical-map-marker" src="${src}" alt="${meta.icon}">`,iconSize:[size,descriptor.height+4],iconAnchor:[Math.round(size/2),descriptor.height+2],tooltipAnchor:[0,-descriptor.height+8]});}
    const preference=preferences?.[category]||{},shape=MARKER_SHAPES.includes(preference.shape)?preference.shape:(presetKey==='contrast'?'contrast':'drop');
    const markerSize=MARKER_SIZES[preference.size]||null,preset=pickerMode?{size:40,border:3}:markerSize?{size:markerSize,border:shape==='contrast'?4:3}:MARKER_PRESETS[presetKey]||MARKER_PRESETS.classic,size=preset.size+4,anchor=Math.round(size/2);
    return root.L.divIcon({
      className:'tools-leaflet-icon-shell',
      html:`<span class="tools-leaflet-pin ${meta.className} marker-${presetKey} shape-${shape}" style="--mt-pin-size:${preset.size}px;--mt-pin-border:${preset.border}px"><span>${meta.icon}</span></span>`,
      iconSize:[size,size],iconAnchor:[anchor,size-2],tooltipAnchor:[0,-size+8]
    });
  }
  function setStatus(statusNode,message=''){
    if(!statusNode)return;
    statusNode.textContent=message;
    statusNode.classList.toggle('hidden',!message);
  }
  function addOnlineBaseLayer(targetMap,statusNode){
    let failed=false;
    const layer=root.L.tileLayer(TILE_URL,{
      maxZoom:19,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      crossOrigin:true,
      referrerPolicy:'strict-origin-when-cross-origin'
    });
    layer.on('tileerror',()=>{
      if(failed)return;
      failed=true;
      setStatus(statusNode,'Онлайн-підкладка недоступна. Збережені точки залишаються на місці.');
    });
    layer.on('tileload',()=>{
      failed=false;
      setStatus(statusNode,'');
    });
    layer.addTo(targetMap);
    layer._mtKind='online';
    return layer;
  }
  function setLayerButtons(state,kind){
    state?.controlNode?.querySelectorAll('[data-mt-base-layer]').forEach(button=>{
      const active=button.dataset.mtBaseLayer===kind;
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    });
  }
  function removeMapTilerLogo(state){if(state?.logoControl){state.logoControl.remove();state.logoControl=null;}}
  function addMapTilerLogo(targetMap,state){
    removeMapTilerLogo(state);
    const control=root.L.control({position:'bottomleft'});
    control.onAdd=()=>{const wrap=root.L.DomUtil.create('div','maptiler-logo-control');wrap.innerHTML=`<a href="https://www.maptiler.com" target="_blank" rel="noopener"><img src="${MAPTILER_LOGO_URL}" alt="MapTiler"></a>`;root.L.DomEvent.disableClickPropagation(wrap);return wrap;};
    control.addTo(targetMap);state.logoControl=control;
  }
  function removeCurrentBase(targetMap,state){
    if(state?.layer&&targetMap.hasLayer(state.layer))targetMap.removeLayer(state.layer);
    state?.coverageCleanup?.();state.coverageCleanup=null;removeMapTilerLogo(state);
  }
  function addSatelliteBaseLayer(targetMap,statusNode,state){
    const key=root.MTMapTilerLocal?.getKey?.();
    if(!key||root.navigator?.onLine===false)return null;
    let failed=false;
    const layer=root.L.tileLayer(`${MAPTILER_TILE_URL}?key=${encodeURIComponent(key)}`,{
      tileSize:512,zoomOffset:-1,minZoom:1,maxZoom:22,crossOrigin:true,referrerPolicy:'strict-origin-when-cross-origin',
      attribution:'&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
    });
    layer.on('tileerror',()=>{
      if(failed||baseStates.get(targetMap)?.layer!==layer)return;failed=true;
      root.MTMapTilerLocal?.saveLayer?.('map');
      switchBaseLayer(targetMap,'map',statusNode,{remember:false,message:'Супутниковий шар недоступний: перевірте ключ або квоту. Відкрито звичайну карту.'});
    });
    layer.on('tileload',()=>{if(!failed)setStatus(statusNode,'');});
    layer.addTo(targetMap);state.kind='satellite';state.layer=layer;addMapTilerLogo(targetMap,state);return layer;
  }
  function setOfflineEmptyState(node,visible){
    if(node)node.classList.toggle('hidden',!visible);
  }
  async function addOfflineBaseLayer(targetMap,statusNode,emptyStateNode){
    const stored=await root.MTOfflineMap?.archive?.();
    if(!stored){setStatus(statusNode,'Для цієї області офлайн-карта ще не завантажена. Маркери доступні без підкладки.');setOfflineEmptyState(emptyStateNode,true);return null;}
    const header=stored.info.header||{};
    const bounds=root.L.latLngBounds([[header.minLat,header.minLon],[header.maxLat,header.maxLon]]);
    const layer=root.pmtiles.leafletRasterLayer(stored.archive,{
      minZoom:header.minZoom,maxNativeZoom:header.maxZoom,maxZoom:19,bounds,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    });
    const updateCoverage=()=>{const covered=bounds.contains(targetMap.getCenter());setStatus(statusNode,covered?'':'Для цієї області офлайн-карта ще не завантажена. Маркери не видалено.');setOfflineEmptyState(emptyStateNode,!covered);};
    targetMap.on('moveend',updateCoverage);
    layer.on('tileerror',()=>setStatus(statusNode,'Не вдалося прочитати плитку офлайн-карти. Маркери не змінено.'));
    layer.addTo(targetMap);layer._mtKind='offline';layer._mtCoverageUpdate=updateCoverage;
    updateCoverage();
    return layer;
  }
  async function addBaseLayer(targetMap,statusNode,requestedMode,emptyStateNode){
    const mode=requestedMode||root.MTOfflineMap?.getMode?.()||'auto';
    const state=baseStates.get(targetMap)||{layer:null,kind:'map',statusNode,emptyStateNode,mode};baseStates.set(targetMap,state);
    if(mode==='online'||(mode==='auto'&&root.navigator?.onLine!==false)){
      setOfflineEmptyState(emptyStateNode,false);
      const preferred=root.MTMapTilerLocal?.getLayer?.()||'map';
      if(preferred==='satellite'&&root.MTMapTilerLocal?.hasKey?.())return addSatelliteBaseLayer(targetMap,statusNode,state);
      state.kind='map';state.layer=addOnlineBaseLayer(targetMap,statusNode);return state.layer;
    }
    state.kind='offline';state.layer=await addOfflineBaseLayer(targetMap,statusNode,emptyStateNode);return state.layer;
  }
  function switchBaseLayer(targetMap,kind,statusNode,options={}){
    if(root.MTToolsMapLibreAdapter?.isMounted?.()&&targetMap===root.MTToolsMapLibreAdapter.getMap())return root.MTToolsMapLibreAdapter.switchBaseLayer(kind,statusNode,options);
    const state=baseStates.get(targetMap)||{layer:null,kind:'map',statusNode,emptyStateNode:null,mode:'auto'};baseStates.set(targetMap,state);
    if(kind==='satellite'){
      if(root.navigator?.onLine===false){setStatus(statusNode,'Супутникова карта доступна лише онлайн. Поточна підкладка не змінена.');return false;}
      if(!root.MTMapTilerLocal?.hasKey?.()){setStatus(statusNode,'Для супутникової карти додайте власний MapTiler API key у Налаштуваннях.');return false;}
    }
    removeCurrentBase(targetMap,state);
    if(kind==='satellite')addSatelliteBaseLayer(targetMap,statusNode,state);
    else{state.kind='map';state.layer=addOnlineBaseLayer(targetMap,statusNode);}
    if(targetMap===map)tileLayer=state.layer;
    if(picker?.map===targetMap)picker.tileLayer=state.layer;
    if(options.remember!==false)root.MTMapTilerLocal?.saveLayer?.(kind);
    setLayerButtons(state,state.kind);setOfflineEmptyState(state.emptyStateNode,false);
    if(options.message)setStatus(statusNode,options.message);
    return true;
  }
  function addLayerSwitcher(targetMap,statusNode){
    const state=baseStates.get(targetMap);if(!state)return null;
    const control=root.L.control({position:'topright'});
    control.onAdd=()=>{
      const wrap=root.L.DomUtil.create('div','tools-map-layer-switcher');
      wrap.innerHTML='<button type="button" data-mt-base-layer="map" aria-pressed="false">🗺️ Карта</button><button type="button" data-mt-base-layer="satellite" aria-pressed="false">🛰️ Супутник</button>';
      root.L.DomEvent.disableClickPropagation(wrap);root.L.DomEvent.disableScrollPropagation(wrap);
      wrap.addEventListener('click',event=>{const button=event.target.closest('[data-mt-base-layer]');if(button)switchBaseLayer(targetMap,button.dataset.mtBaseLayer,statusNode);});
      state.controlNode=wrap;setLayerButtons(state,state.kind);return wrap;
    };
    control.addTo(targetMap);state.control=control;return control;
  }
  function captureView(){
    if(root.MTToolsMapLibreAdapter?.isMounted?.())return root.MTToolsMapLibreAdapter.captureView();
    if(!map)return savedView;
    const center=map.getCenter();
    savedView={lat:center.lat,lng:center.lng,zoom:map.getZoom()};
    return savedView;
  }
  function destroyMap(){
    if(root.MTToolsMapLibreAdapter?.isMounted?.()){
      const view=root.MTToolsMapLibreAdapter.captureView();
      if(view)savedView={lat:view.lat,lng:view.lng,zoom:view.zoom};
      root.MTToolsMapLibreAdapter.destroy();
    }
    if(!map)return;
    captureView();
    cancelPointPlacement();
    unbindLongPress?.();unbindLongPress=null;
    baseStates.delete(map);map.remove();map=null;tileLayer=null;groups=new Map();userLayer=null;selectionLayer=null;
  }
  function currentCenter(){if(root.MTToolsMapLibreAdapter?.isMounted?.())return root.MTToolsMapLibreAdapter.currentCenter();if(!map)return null;const point=map.getCenter();return{lat:point.lat,lng:point.lng};}
  function showUserLocation(point,accuracy){
    const valid=validPoint(point);if(!valid)return false;
    if(root.MTToolsMapLibreAdapter?.isMounted?.())return root.MTToolsMapLibreAdapter.showUserLocation(valid,accuracy);
    if(!map)return false;
    if(userLayer)userLayer.remove();
    userLayer=root.L.layerGroup().addTo(map);
    root.L.circle([valid.lat,valid.lng],{radius:Math.max(1,Number(accuracy)||1),color:'#2a8cff',fillColor:'#2a8cff',fillOpacity:.12,weight:2}).addTo(userLayer);
    root.L.marker([valid.lat,valid.lng],{icon:iconFor('gps',false,'classic',settings?.mapMarkerPreferences),title:'Моє місце'}).bindTooltip(`Моє місце${accuracy?` · точність ≈ ${Math.round(accuracy)} м`:''}`).addTo(userLayer);
    map.setView([valid.lat,valid.lng],Math.max(map.getZoom(),16));return true;
  }
  function cancelPointPlacement(){
    if(root.MTToolsMapLibreAdapter?.isMounted?.())root.MTToolsMapLibreAdapter.cancelPointPlacement();
    if(!placement)return;
    if(map&&placement.clickHandler)map.off('click',placement.clickHandler);
    placement.layer?.remove();
    placement=null;
  }
  function startPointPlacement(options={}){
    if(root.MTToolsMapLibreAdapter?.isMounted?.())return root.MTToolsMapLibreAdapter.startPointPlacement(options);
    if(!map)return null;
    cancelPointPlacement();
    const layer=root.L.layerGroup().addTo(map);
    let marker=null,onChange=null,opened=false;
    const controller={
      getPoint(){if(!marker)return null;const value=marker.getLatLng();return{lat:value.lat,lng:value.lng};},
      onChange(callback){onChange=typeof callback==='function'?callback:null;},
      cancel:cancelPointPlacement
    };
    const setPoint=value=>{
      const point=validPoint(value);if(!point)return null;
      if(!marker){
        marker=root.L.marker([point.lat,point.lng],{icon:iconFor(null,true),draggable:true,title:'Новий об’єкт'}).addTo(layer);
        marker.on('dragend',()=>onChange?.(controller.getPoint()));
      }else marker.setLatLng([point.lat,point.lng]);
      if(!opened){
        opened=true;map.off('click',clickHandler);map.panTo([point.lat,point.lng],{animate:false});
        map.getContainer()?.scrollIntoView({block:'start'});
        options.onPlace?.(controller.getPoint(),controller);
      }
      return controller.getPoint();
    };
    const clickHandler=event=>setPoint(event.latlng);
    placement={layer,clickHandler,controller};
    if(options.initial)setPoint(options.initial);else map.on('click',clickHandler);
    return controller;
  }
  function focusPoint(point,zoom=17){
    const valid=validPoint(point);if(!valid)return false;
    if(root.MTToolsMapLibreAdapter?.isMounted?.())return root.MTToolsMapLibreAdapter.focusPoint(valid,zoom);
    savedView={lat:valid.lat,lng:valid.lng,zoom};
    if(map)map.setView([valid.lat,valid.lng],zoom);
    return true;
  }
  function selectBounds(onDone){
    if(root.MTToolsMapLibreAdapter?.isMounted?.())return root.MTToolsMapLibreAdapter.selectBounds(onDone);
    if(!map)return false;
    if(selectionLayer){selectionLayer.remove();selectionLayer=null;}
    let first=null;
    const click=event=>{
      if(!first){first=event.latlng;selectionLayer=root.L.circleMarker(first,{radius:6,color:'#ff9f1a'}).addTo(map);return;}
      selectionLayer.remove();const bounds=root.L.latLngBounds(first,event.latlng);selectionLayer=root.L.rectangle(bounds,{color:'#ff9f1a',weight:2,fillOpacity:.12}).addTo(map);map.off('click',click);
      onDone?.({minLat:bounds.getSouth(),minLng:bounds.getWest(),maxLat:bounds.getNorth(),maxLng:bounds.getEast()});
    };
    map.on('click',click);return true;
  }
  function drawBounds(value){
    if(root.MTToolsMapLibreAdapter?.isMounted?.())return root.MTToolsMapLibreAdapter.drawBounds(value);
    if(!map||!value)return false;const south=Number(value.minLat),west=Number(value.minLng),north=Number(value.maxLat),east=Number(value.maxLng);if(![south,west,north,east].every(Number.isFinite))return false;
    if(selectionLayer)selectionLayer.remove();const bounds=root.L.latLngBounds([[south,west],[north,east]]);selectionLayer=root.L.rectangle(bounds,{color:'#ff9f1a',weight:2,fillOpacity:.12}).addTo(map);map.fitBounds(bounds,{padding:[18,18],maxZoom:15});return true;
  }
  function setFilterButtons(filterRoot){
    if(!filterRoot)return;
    const allSelected=selected.size===categories.length;
    filterRoot.querySelectorAll('[data-map-filter]').forEach(button=>{
      const key=button.dataset.mapFilter;
      const active=key==='all'?allSelected:key==='none'?selected.size===0:selected.has(key);
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
  }
  function applyFilters(filterRoot){
    if(!map)return;
    groups.forEach((group,key)=>{
      if(selected.has(key)){if(!map.hasLayer(group))group.addTo(map);}
      else if(map.hasLayer(group))map.removeLayer(group);
    });
    setFilterButtons(filterRoot);
  }
  function bindFilters(filterRoot){
    if(!filterRoot)return;
    filterRoot.onclick=event=>{
      const button=event.target.closest('[data-map-filter]');
      if(!button)return;
      const key=button.dataset.mapFilter;
      if(key==='all'){
        selected.clear();categories.forEach(category=>selected.add(category));
      }else if(key==='none'){
        selected.clear();
      }else if(selected.has(key))selected.delete(key);
      else selected.add(key);
      applyFilters(filterRoot);
    };
    setFilterButtons(filterRoot);
  }
  function mount(container,objects=[],options={}){
    if(!container)return null;
    destroyMap();
    if(requestedEngine(options)==='maplibre'&&root.MTToolsMapLibreAdapter?.mount){
      const mounted=root.MTToolsMapLibreAdapter.mount(container,objects,{...options,selectedCategories:selected});
      if(mounted)return mounted;
    }
    const statusNode=options.statusNode||null;
    if(!hasLeaflet()){
      if(statusNode){statusNode.textContent='Модуль карти не завантажився. Дані об’єктів не змінено.';statusNode.classList.remove('hidden');}
      return null;
    }
    map=root.L.map(container,{zoomControl:true,tap:true,worldCopyJump:true});
    const mountedMap=map;
    addBaseLayer(mountedMap,statusNode,options.baseMode,options.emptyStateNode||null).then(layer=>{
      if(map===mountedMap){tileLayer=layer;addLayerSwitcher(mountedMap,statusNode);}
      else if(layer){layer.remove();}
    }).catch(()=>setStatus(statusNode,'Офлайн-підкладку не вдалося відкрити. Маркери не змінено.'));
    categories.forEach(category=>groups.set(category,root.L.layerGroup()));
    const bounds=[];
    objects.forEach(item=>{
      const point=validPoint(item);if(!point)return;
      const category=categoryFor(item),marker=root.L.marker([point.lat,point.lng],{icon:iconFor(category,false,options.markerPreset,options.markerPreferences),keyboard:true,title:markerLabel(item)});
      marker.bindTooltip(markerLabel(item),{direction:'top',offset:[0,-25]});
      marker.on('click',()=>options.onSelect?.(item));
      marker.addTo(groups.get(category));
      bounds.push([point.lat,point.lng]);
    });
    bindFilters(options.filterRoot);
    applyFilters(options.filterRoot);
    if(savedView)map.setView([savedView.lat,savedView.lng],savedView.zoom);
    else if(bounds.length===1)map.setView(bounds[0],16);
    else if(bounds.length>1)map.fitBounds(bounds,{padding:[24,24],maxZoom:17});
    else map.setView(DEFAULT_CENTER,6);
    map.on('moveend zoomend',captureView);
    map.on('contextmenu',event=>options.onAddHere?.({lat:event.latlng.lat,lng:event.latlng.lng}));
    // Довге натискання = той самий сценарій, що й «＋» → клік по карті.
    if(typeof options.onAddHere==='function'){
      unbindLongPress?.();
      const container=map.getContainer();
      unbindLongPress=bindMapLongPress(container,(clientX,clientY)=>{
        if(placement)return; // у режимі розміщення працює звичайний клік
        const rect=container.getBoundingClientRect();
        const point=map.containerPointToLatLng([clientX-rect.left,clientY-rect.top]);
        options.onAddHere({lat:point.lat,lng:point.lng});
      },{ignore:()=>!!placement});
    }
    setTimeout(()=>map?.invalidateSize(),0);
    return map;
  }
  function invalidateSize(){
    if(root.MTToolsMapLibreAdapter?.isMounted?.())return root.MTToolsMapLibreAdapter.resize();
    if(!map)return false;
    requestAnimationFrame(()=>map?.invalidateSize());
    return true;
  }
  function destroyPicker(){
    if(root.MTToolsMapLibreAdapter?.isPickerMounted?.())root.MTToolsMapLibreAdapter.destroyPicker();
    if(!picker)return;
    picker.observer?.disconnect();
    baseStates.delete(picker.map);picker.map.remove();
    picker=null;
  }
  function mountPicker(container,options={}){
    destroyPicker();
    if(requestedEngine(options)==='maplibre'&&root.MTToolsMapLibreAdapter?.mountPicker){const mounted=root.MTToolsMapLibreAdapter.mountPicker(container,options);if(mounted)return mounted;}
    if(!container||!hasLeaflet())return null;
    const initial=validPoint(options.initial);
    const pickerMap=root.L.map(container,{zoomControl:true,tap:true}).setView(initial?[initial.lat,initial.lng]:DEFAULT_CENTER,initial?17:6);
    let pickerTile=null;
    let marker=null;
    let changed=false;
    function setPoint(value,center=true,notify=true){
      const point=validPoint(value);if(!point)return null;
      if(!marker){
        marker=root.L.marker([point.lat,point.lng],{icon:iconFor(null,true),draggable:true,title:'Обрана точка'}).addTo(pickerMap);
        marker.on('dragend',()=>{changed=true;options.onChange?.(getPoint());});
      }else marker.setLatLng([point.lat,point.lng]);
      if(center)pickerMap.setView([point.lat,point.lng],Math.max(pickerMap.getZoom(),17));
      if(notify){changed=true;options.onChange?.(point);}
      return point;
    }
    function getPoint(){if(!marker)return null;const point=marker.getLatLng();return{lat:point.lat,lng:point.lng};}
    pickerMap.on('click',event=>setPoint(event.latlng,false));
    if(initial)setPoint(initial,false,false);
    const observer=new MutationObserver(()=>{if(!container.isConnected)destroyPicker();});
    observer.observe(document.body,{childList:true,subtree:true});
    picker={map:pickerMap,tileLayer:pickerTile,observer,getPoint,setPoint,hasChanged:()=>changed,invalidateSize:()=>pickerMap.invalidateSize(),destroy:destroyPicker};
    const mountedPicker=picker;
    addBaseLayer(pickerMap,options.statusNode||null,options.baseMode,null).then(layer=>{
      if(picker===mountedPicker){picker.tileLayer=layer;addLayerSwitcher(pickerMap,options.statusNode||null);}
      else if(layer){layer.remove();}
    }).catch(()=>setStatus(options.statusNode||null,'Підкладку не вдалося відкрити. Точку можна вказати за координатами.'));
    requestAnimationFrame(()=>requestAnimationFrame(()=>pickerMap.invalidateSize()));
    return picker;
  }
  function handleConnectivityChange(){return root.MTToolsMapLibreAdapter?.isMounted?.()?root.MTToolsMapLibreAdapter.handleConnectivityChange?.()||false:false;}
  root.addEventListener?.('online',()=>{tileLayer?.redraw();picker?.tileLayer?.redraw();});
  root.MTToolsMap={TILE_URL,MAPTILER_TILE_URL,CATEGORY_META,mount,invalidateSize,captureView,currentCenter,showUserLocation,startPointPlacement,cancelPointPlacement,focusPoint,selectBounds,drawBounds,destroyMap,mountPicker,destroyPicker,addBaseLayer,switchBaseLayer,handleConnectivityChange,bindMapLongPress};
})(typeof window!=='undefined'?window:globalThis);

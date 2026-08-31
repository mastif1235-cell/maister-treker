/* Interactive OpenStreetMap layer for local-only field tools. */
(function(root){
  'use strict';

  const TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
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

  function hasLeaflet(){return !!(root.L&&typeof root.L.map==='function');}
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
  function iconFor(category,pickerMode=false){
    const meta=pickerMode?{icon:'◎',className:'picker'}:CATEGORY_META[category]||CATEGORY_META['Інше'];
    return root.L.divIcon({
      className:'tools-leaflet-icon-shell',
      html:`<span class="tools-leaflet-pin ${meta.className}"><span>${meta.icon}</span></span>`,
      iconSize:[38,38],iconAnchor:[19,36],tooltipAnchor:[0,-30]
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
  async function addOfflineBaseLayer(targetMap,statusNode){
    const stored=await root.MTOfflineMap?.archive?.();
    if(!stored){setStatus(statusNode,'Офлайн-карта не встановлена. Маркери доступні без підкладки.');return null;}
    const header=stored.info.header||{};
    const bounds=root.L.latLngBounds([[header.minLat,header.minLon],[header.maxLat,header.maxLon]]);
    const layer=root.pmtiles.leafletRasterLayer(stored.archive,{
      minZoom:header.minZoom,maxNativeZoom:header.maxZoom,maxZoom:19,bounds,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    });
    const updateCoverage=()=>setStatus(statusNode,bounds.contains(targetMap.getCenter())?'':'Поза межами офлайн-карти. Маркери не видалено.');
    targetMap.on('moveend',updateCoverage);
    layer.on('tileerror',()=>setStatus(statusNode,'Не вдалося прочитати плитку офлайн-карти. Маркери не змінено.'));
    layer.addTo(targetMap);layer._mtKind='offline';layer._mtCoverageUpdate=updateCoverage;
    updateCoverage();
    return layer;
  }
  async function addBaseLayer(targetMap,statusNode,requestedMode){
    const mode=requestedMode||root.MTOfflineMap?.getMode?.()||'auto';
    if(mode==='online'||(mode==='auto'&&root.navigator?.onLine!==false))return addOnlineBaseLayer(targetMap,statusNode);
    return addOfflineBaseLayer(targetMap,statusNode);
  }
  function captureView(){
    if(!map)return savedView;
    const center=map.getCenter();
    savedView={lat:center.lat,lng:center.lng,zoom:map.getZoom()};
    return savedView;
  }
  function destroyMap(){
    if(!map)return;
    captureView();
    map.remove();map=null;tileLayer=null;groups=new Map();userLayer=null;selectionLayer=null;
  }
  function currentCenter(){if(!map)return null;const point=map.getCenter();return{lat:point.lat,lng:point.lng};}
  function showUserLocation(point,accuracy){
    const valid=validPoint(point);if(!map||!valid)return false;
    if(userLayer)userLayer.remove();
    userLayer=root.L.layerGroup().addTo(map);
    root.L.circle([valid.lat,valid.lng],{radius:Math.max(1,Number(accuracy)||1),color:'#2a8cff',fillColor:'#2a8cff',fillOpacity:.12,weight:2}).addTo(userLayer);
    root.L.marker([valid.lat,valid.lng],{icon:iconFor(null,true),title:'Моє місце'}).bindTooltip(`Моє місце${accuracy?` · точність ≈ ${Math.round(accuracy)} м`:''}`).addTo(userLayer);
    map.setView([valid.lat,valid.lng],Math.max(map.getZoom(),16));return true;
  }
  function selectBounds(onDone){
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
    if(!map||!value)return false;const south=Number(value.minLat),west=Number(value.minLng),north=Number(value.maxLat),east=Number(value.maxLng);if(![south,west,north,east].every(Number.isFinite))return false;
    if(selectionLayer)selectionLayer.remove();const bounds=root.L.latLngBounds([[south,west],[north,east]]);selectionLayer=root.L.rectangle(bounds,{color:'#ff9f1a',weight:2,fillOpacity:.12}).addTo(map);map.fitBounds(bounds,{padding:[18,18],maxZoom:15});return true;
  }
  function setFilterButtons(filterRoot){
    if(!filterRoot)return;
    const allSelected=selected.size===categories.length;
    filterRoot.querySelectorAll('[data-map-filter]').forEach(button=>{
      const key=button.dataset.mapFilter;
      const active=key==='all'?allSelected:selected.has(key);
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
      }else if(selected.has(key))selected.delete(key);
      else selected.add(key);
      applyFilters(filterRoot);
    };
    setFilterButtons(filterRoot);
  }
  function mount(container,objects=[],options={}){
    if(!container)return null;
    destroyMap();
    const statusNode=options.statusNode||null;
    if(!hasLeaflet()){
      if(statusNode){statusNode.textContent='Модуль карти не завантажився. Дані об’єктів не змінено.';statusNode.classList.remove('hidden');}
      return null;
    }
    map=root.L.map(container,{zoomControl:true,tap:true,worldCopyJump:true});
    const mountedMap=map;
    addBaseLayer(mountedMap,statusNode,options.baseMode).then(layer=>{
      if(map===mountedMap)tileLayer=layer;
      else if(layer){layer.remove();}
    }).catch(()=>setStatus(statusNode,'Офлайн-підкладку не вдалося відкрити. Маркери не змінено.'));
    categories.forEach(category=>groups.set(category,root.L.layerGroup()));
    const bounds=[];
    objects.forEach(item=>{
      const point=validPoint(item);if(!point)return;
      const category=categoryFor(item),marker=root.L.marker([point.lat,point.lng],{icon:iconFor(category),keyboard:true,title:markerLabel(item)});
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
    setTimeout(()=>map?.invalidateSize(),0);
    return map;
  }
  function destroyPicker(){
    if(!picker)return;
    picker.observer?.disconnect();
    picker.map.remove();
    picker=null;
  }
  function mountPicker(container,options={}){
    destroyPicker();
    if(!container||!hasLeaflet())return null;
    const initial=validPoint(options.initial);
    const pickerMap=root.L.map(container,{zoomControl:true,tap:true}).setView(initial?[initial.lat,initial.lng]:DEFAULT_CENTER,initial?17:6);
    let pickerTile=null;
    let marker=null;
    function setPoint(value,center=true){
      const point=validPoint(value);if(!point)return null;
      if(!marker){
        marker=root.L.marker([point.lat,point.lng],{icon:iconFor(null,true),draggable:true,title:'Обрана точка'}).addTo(pickerMap);
        marker.on('dragend',()=>options.onChange?.(getPoint()));
      }else marker.setLatLng([point.lat,point.lng]);
      if(center)pickerMap.setView([point.lat,point.lng],Math.max(pickerMap.getZoom(),17));
      options.onChange?.(point);
      return point;
    }
    function getPoint(){if(!marker)return null;const point=marker.getLatLng();return{lat:point.lat,lng:point.lng};}
    pickerMap.on('click',event=>setPoint(event.latlng,false));
    if(initial)setPoint(initial,false);
    const observer=new MutationObserver(()=>{if(!container.isConnected)destroyPicker();});
    observer.observe(document.body,{childList:true,subtree:true});
    picker={map:pickerMap,tileLayer:pickerTile,observer,getPoint,setPoint,destroy:destroyPicker};
    const mountedPicker=picker;
    addBaseLayer(pickerMap,options.statusNode||null,options.baseMode).then(layer=>{
      if(picker===mountedPicker){picker.tileLayer=layer;}
      else if(layer){layer.remove();}
    }).catch(()=>setStatus(options.statusNode||null,'Підкладку не вдалося відкрити. Точку можна вказати за координатами.'));
    setTimeout(()=>pickerMap.invalidateSize(),0);
    return picker;
  }
  root.addEventListener?.('online',()=>{tileLayer?.redraw();picker?.tileLayer?.redraw();});
  root.MTToolsMap={TILE_URL,CATEGORY_META,mount,captureView,currentCenter,showUserLocation,selectBounds,drawBounds,destroyMap,mountPicker,destroyPicker,addBaseLayer};
})(typeof window!=='undefined'?window:globalThis);

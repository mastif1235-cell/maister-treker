import * as maplibregl from '../vendor/maplibre/maplibre-gl.mjs';

const OSM_TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAPTILER_TILE_URL='https://api.maptiler.com/maps/hybrid-v4/{z}/{x}/{y}.jpg';
const DEFAULT_VIEW={lat:48.45,lng:31.2,zoom:6,bearing:0};
const WORKER_URL=new URL('../vendor/maplibre/maplibre-gl-worker.mjs',import.meta.url).href;
const CATEGORY_COLORS={private:'#3aa76d',apartment:'#5666d8',FOB:'#e1922c','Муфта':'#a368dc','Вузол':'#d94a4a','Інше':'#59636d'};

export function createOsmStyle(){
  return{
    version:8,
    sources:{osm:{type:'raster',tiles:[OSM_TILE_URL],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'}},
    layers:[{id:'osm',type:'raster',source:'osm'}]
  };
}

export function createSatelliteStyle(key){
  return{version:8,sources:{satellite:{type:'raster',tiles:[`${MAPTILER_TILE_URL}?key=${encodeURIComponent(key)}`],tileSize:512,minzoom:1,maxzoom:22,attribution:'© MapTiler © OpenStreetMap contributors'}},layers:[{id:'satellite',type:'raster',source:'satellite'}]};
}

function blankStyle(){return{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#182329'}}]};}
function vectorGeometryLayers(sourceId,vectorLayers){
  const result=[];
  vectorLayers.forEach((layer,index)=>{
    const sourceLayer=String(layer?.id||'');if(!sourceLayer)return;
    const hue=(index*47)%360;
    result.push(
      {id:`mt-offline-fill-${index}`,type:'fill',source:sourceId,'source-layer':sourceLayer,filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':`hsl(${hue},35%,48%)`,'fill-opacity':.38,'fill-outline-color':'#6f8997'}},
      {id:`mt-offline-line-${index}`,type:'line',source:sourceId,'source-layer':sourceLayer,filter:['==',['geometry-type'],'LineString'],paint:{'line-color':`hsl(${hue},65%,68%)`,'line-width':['interpolate',['linear'],['zoom'],5,.5,16,3]}},
      {id:`mt-offline-point-${index}`,type:'circle',source:sourceId,'source-layer':sourceLayer,filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':4,'circle-color':`hsl(${hue},75%,58%)`,'circle-stroke-color':'#111','circle-stroke-width':1}}
    );
  });
  return result;
}

export function accuracyPolygon(point,radius,steps=72){
  const earth=6378137,latRadians=point.lat*Math.PI/180,coordinates=[];
  for(let index=0;index<=steps;index++){
    const angle=index/steps*Math.PI*2;
    coordinates.push([point.lng+(radius*Math.cos(angle)/(earth*Math.cos(latRadians)))*180/Math.PI,point.lat+(radius*Math.sin(angle)/earth)*180/Math.PI]);
  }
  return{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[coordinates]}};
}

export function createMapLibreAdapter(gl,root=globalThis){
  let map=null;
  let picker=null;
  let placement=null;
  let userMarker=null;
  let userPoint=null;
  let userAccuracy=0;
  let objectItems=[];
  let selectedCategories=null;
  let filterRoot=null;
  let currentOptions={};
  let currentBase='map';
  let baseControl=null;
  let savedView=null;
  let offlineProtocol=null;
  let offlineBounds=null;
  let offlineSequence=0;
  const setStatus=(node,message='')=>{if(!node)return;node.textContent=message;node.classList?.toggle?.('hidden',!message);};
  const webgl2Available=()=>{try{return !!root.document?.createElement('canvas')?.getContext('webgl2');}catch(_error){return false;}};
  const captureView=()=>{
    if(!map)return savedView;
    const center=map.getCenter();
    savedView={lat:center.lat,lng:center.lng,zoom:map.getZoom(),bearing:map.getBearing()};
    return savedView;
  };
  const markerElement=(title='Обрана точка')=>{const shell=root.document.createElement('div'),pin=root.document.createElement('span'),icon=root.document.createElement('span');shell.className='tools-leaflet-icon-shell';pin.className='tools-leaflet-pin picker';icon.textContent='◎';pin.appendChild(icon);shell.appendChild(pin);shell.title=title;return shell;};
  const restoreUserLocation=()=>{
    if(!map||!userPoint||!map.isStyleLoaded?.())return;
    const area=accuracyPolygon(userPoint,Math.max(1,userAccuracy));
    const existing=map.getSource?.('mt-user-accuracy');
    if(existing)existing.setData(area);
    else{
      map.addSource('mt-user-accuracy',{type:'geojson',data:area});
      map.addLayer({id:'mt-user-accuracy-fill',type:'fill',source:'mt-user-accuracy',paint:{'fill-color':'#2a8cff','fill-opacity':.14}});
      map.addLayer({id:'mt-user-accuracy-line',type:'line',source:'mt-user-accuracy',paint:{'line-color':'#2a8cff','line-width':2}});
    }
    if(userMarker)userMarker.setLngLat([userPoint.lng,userPoint.lat]);
    else userMarker=new gl.Marker({element:markerElement('Моє місце')}).setLngLat([userPoint.lng,userPoint.lat]).addTo(map);
  };
  const objectGeoJson=items=>({type:'FeatureCollection',features:items.map((item,index)=>{const lat=Number(item?.lat),lng=Number(item?.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;const category=CATEGORY_COLORS[item?.category]?item.category:'Інше';return{type:'Feature',id:index,properties:{index,category,label:item.name||item.type||item.profiles?.[0]?.address||'Об’єкт'},geometry:{type:'Point',coordinates:[lng,lat]}};}).filter(Boolean)});
  const updateFilterButtons=()=>{if(!filterRoot||!selectedCategories)return;const allSelected=selectedCategories.size===Object.keys(CATEGORY_COLORS).length;filterRoot.querySelectorAll('[data-map-filter]').forEach(button=>{const key=button.dataset.mapFilter,active=key==='all'?allSelected:key==='none'?selectedCategories.size===0:selectedCategories.has(key);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});};
  const applyObjectFilters=()=>{if(map?.getLayer?.('mt-objects')&&selectedCategories)map.setFilter('mt-objects',['in',['get','category'],['literal',[...selectedCategories]]]);updateFilterButtons();};
  const bindObjectFilters=()=>{if(!filterRoot||!selectedCategories)return;filterRoot.onclick=event=>{const button=event.target.closest('[data-map-filter]');if(!button)return;const key=button.dataset.mapFilter;if(key==='all'){selectedCategories.clear();Object.keys(CATEGORY_COLORS).forEach(category=>selectedCategories.add(category));}else if(key==='none')selectedCategories.clear();else if(selectedCategories.has(key))selectedCategories.delete(key);else selectedCategories.add(key);applyObjectFilters();};updateFilterButtons();};
  const restoreObjects=options=>{
    if(!map||!map.isStyleLoaded?.())return;
    const data=objectGeoJson(objectItems),existing=map.getSource?.('mt-objects');
    if(existing)existing.setData(data);
    else{
      map.addSource('mt-objects',{type:'geojson',data});
      map.addLayer({id:'mt-objects',type:'circle',source:'mt-objects',paint:{'circle-radius':['interpolate',['linear'],['zoom'],5,4,17,9],'circle-color':['match',['get','category'],...Object.entries(CATEGORY_COLORS).flat(),'#59636d'],'circle-stroke-color':'#ffffff','circle-stroke-width':2}});
      map.on('click','mt-objects',event=>{const index=Number(event.features?.[0]?.properties?.index);if(Number.isInteger(index)&&objectItems[index])options.onSelect?.(objectItems[index]);});
      map.on('mouseenter','mt-objects',()=>{map.getCanvas().style.cursor='pointer';});
      map.on('mouseleave','mt-objects',()=>{map.getCanvas().style.cursor='';});
    }
    applyObjectFilters();
  };
  const updateBaseButtons=()=>baseControl?.querySelectorAll('[data-mt-base-layer]').forEach(button=>{const active=button.dataset.mtBaseLayer===currentBase;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  const updateOfflineCoverage=()=>{
    if(currentBase!=='offline'||!offlineBounds||!map)return;
    const center=map.getCenter(),inside=center.lng>=offlineBounds.minLon&&center.lng<=offlineBounds.maxLon&&center.lat>=offlineBounds.minLat&&center.lat<=offlineBounds.maxLat;
    setStatus(currentOptions.statusNode,inside?'Офлайн-карта активна.':'Центр карти поза межами встановленої офлайн-області.');
  };
  const offlineStyle=async()=>{
    const pm=root.pmtiles,stored=await root.MTOfflineMap?.archive?.();
    if(!stored?.file||!pm?.PMTiles||!pm?.FileSource||!pm?.Protocol)throw new Error('OFFLINE_MAP_UNAVAILABLE');
    const key=`mt-offline-${Date.now()}-${++offlineSequence}`,source=new pm.FileSource(stored.file);source.getKey=()=>key;
    const archive=new pm.PMTiles(source),[header,metadata]=await Promise.all([archive.getHeader(),archive.getMetadata().catch(()=>({}))]);
    offlineProtocol=new pm.Protocol({metadata:true});offlineProtocol.add(archive);gl.removeProtocol?.('pmtiles');gl.addProtocol('pmtiles',offlineProtocol.tile);
    offlineBounds={minLon:Number(header.minLon),minLat:Number(header.minLat),maxLon:Number(header.maxLon),maxLat:Number(header.maxLat)};
    const sourceId='mt-offline',url=`pmtiles://${key}`,attribution=String(metadata?.attribution||stored.info?.attribution||'© OpenStreetMap contributors');
    if(Number(header.tileType)===1){
      const vectorLayers=Array.isArray(metadata?.vector_layers)?metadata.vector_layers:[];if(!vectorLayers.length)throw new Error('VECTOR_LAYERS_METADATA_MISSING');
      return{style:{version:8,sources:{[sourceId]:{type:'vector',url,attribution}},layers:[...blankStyle().layers,...vectorGeometryLayers(sourceId,vectorLayers)]},header};
    }
    if([2,3,4,5].includes(Number(header.tileType)))return{style:{version:8,sources:{[sourceId]:{type:'raster',url,tileSize:256,attribution}},layers:[...blankStyle().layers,{id:'mt-offline-raster',type:'raster',source:sourceId}]},header};
    throw new Error(`UNSUPPORTED_TILE_TYPE_${header.tileType}`);
  };
  const switchBaseLayer=async(kind,statusNode=currentOptions.statusNode,options={})=>{
    if(!map)return false;
    if(kind==='offline'){
      try{const prepared=await offlineStyle();currentBase='offline';map.setStyle(prepared.style);if(options.fit!==false)map.fitBounds?.([[prepared.header.minLon,prepared.header.minLat],[prepared.header.maxLon,prepared.header.maxLat]],{padding:24,maxZoom:Math.min(16,Number(prepared.header.maxZoom)||16)});}
      catch(_error){setStatus(statusNode,'Офлайн-карта не встановлена або недоступна.');return false;}
    }else if(kind==='satellite'){
      if(root.navigator?.onLine===false){setStatus(statusNode,'Супутникова карта доступна лише онлайн.');return false;}
      const key=root.MTMapTilerLocal?.getKey?.();if(!key){setStatus(statusNode,'Для супутникової карти додайте власний MapTiler API key у Налаштуваннях.');return false;}
      currentBase='satellite';map.setStyle(createSatelliteStyle(key));
    }else{currentBase='map';offlineBounds=null;map.setStyle(createOsmStyle());}
    map.once('style.load',()=>{restoreUserLocation();restoreObjects(currentOptions);updateBaseButtons();if(currentBase==='offline')updateOfflineCoverage();else setStatus(statusNode,options.message||'');});
    if(options.remember!==false){if(currentBase==='offline')root.MTOfflineMap?.setMode?.('offline');else root.MTMapTilerLocal?.saveLayer?.(currentBase);}
    updateBaseButtons();return true;
  };
  const addBaseSwitcher=()=>{
    const control={onAdd(){const wrap=root.document.createElement('div');wrap.className='maplibregl-ctrl tools-map-layer-switcher';wrap.innerHTML='<button type="button" data-mt-base-layer="map">🗺️ Карта</button><button type="button" data-mt-base-layer="satellite">🛰️ Супутник</button><button type="button" data-mt-base-layer="offline">📦 Офлайн</button>';wrap.addEventListener('click',event=>{const button=event.target.closest('[data-mt-base-layer]');if(button)switchBaseLayer(button.dataset.mtBaseLayer);});baseControl=wrap;updateBaseButtons();return wrap;},onRemove(){baseControl?.remove();baseControl=null;}};
    map.addControl(control,'top-left');
  };
  const cancelPointPlacement=()=>{if(!placement)return;if(map&&placement.clickHandler)map.off('click',placement.clickHandler);placement.marker?.remove();placement=null;};
  const destroyPicker=()=>{if(!picker)return;picker.map.remove();picker=null;};
  const destroy=()=>{destroyPicker();cancelPointPlacement();userMarker?.remove();userMarker=null;userPoint=null;if(!map)return;captureView();map.remove();map=null;if(offlineProtocol){gl.removeProtocol?.('pmtiles');offlineProtocol=null;}offlineBounds=null;};
  const mount=(container,_objects=[],options={})=>{
    destroy();
    if(!container||!webgl2Available()){
      setStatus(options.statusNode,'MapLibre потребує WebGL2. Використано резервну карту Leaflet.');
      return null;
    }
    currentOptions=options;objectItems=Array.isArray(_objects)?_objects:[];selectedCategories=options.selectedCategories||new Set(Object.keys(CATEGORY_COLORS));filterRoot=options.filterRoot||null;bindObjectFilters();
    const offlineMode=options.baseMode||root.MTOfflineMap?.getMode?.();
    const useOffline=offlineMode==='offline'||(offlineMode==='auto'&&root.navigator?.onLine===false);
    const preferred=!useOffline&&root.navigator?.onLine!==false&&root.MTMapTilerLocal?.getLayer?.()==='satellite'&&root.MTMapTilerLocal?.getKey?.();currentBase=useOffline?'offline':preferred?'satellite':'map';
    const view=options.initialView||savedView||DEFAULT_VIEW;
    map=new gl.Map({
      container,style:useOffline?blankStyle():preferred?createSatelliteStyle(preferred):createOsmStyle(),center:[Number(view.lng),Number(view.lat)],zoom:Number(view.zoom),bearing:Number(view.bearing)||0,pitch:0,
      dragRotate:true,touchZoomRotate:true,attributionControl:false
    });
    map.addControl(new gl.NavigationControl({showCompass:true,showZoom:true,visualizePitch:true}),'top-right');
    map.addControl(new gl.FullscreenControl({container}),'top-right');
    map.addControl(new gl.AttributionControl({compact:true}),'bottom-right');
    addBaseSwitcher();
    map.touchZoomRotate?.enable?.();
    map.touchZoomRotate?.enableRotation?.();
    map.on('moveend',()=>{captureView();updateOfflineCoverage();});
    map.on('load',()=>{if(useOffline)switchBaseLayer('offline',options.statusNode,{remember:false});else{setStatus(options.statusNode,'');restoreUserLocation();restoreObjects(options);}});
    map.on('contextmenu',event=>options.onAddHere?.({lat:event.lngLat.lat,lng:event.lngLat.lng}));
    map.on('error',event=>{if(currentBase==='satellite'){root.MTMapTilerLocal?.saveLayer?.('map');switchBaseLayer('map',options.statusNode,{remember:false,message:'Супутниковий шар недоступний. Відкрито звичайну карту.'});}else setStatus(options.statusNode,`Карта тимчасово недоступна: ${event.error?.message||'помилка завантаження'}`);});
    (root.requestAnimationFrame||((callback)=>setTimeout(callback,0)))(()=>map?.resize());
    return map;
  };
  const resize=()=>{if(!map)return false;(root.requestAnimationFrame||((callback)=>setTimeout(callback,0)))(()=>map?.resize());return true;};
  const currentCenter=()=>{if(!map)return null;const center=map.getCenter();return{lat:center.lat,lng:center.lng};};
  const focusPoint=(point,zoom=17)=>{const lat=Number(point?.lat),lng=Number(point?.lng);if(!map||![lat,lng].every(Number.isFinite))return false;map.easeTo({center:[lng,lat],zoom});return true;};
  const showUserLocation=(point,accuracy)=>{const lat=Number(point?.lat),lng=Number(point?.lng);if(!map||![lat,lng].every(Number.isFinite))return false;userPoint={lat,lng};userAccuracy=Math.max(1,Number(accuracy)||1);restoreUserLocation();map.easeTo({center:[lng,lat],zoom:Math.max(map.getZoom(),16)});return true;};
  const startPointPlacement=(options={})=>{
    if(!map)return null;cancelPointPlacement();let marker=null,onChange=null,opened=false;
    const controller={getPoint:()=>{if(!marker)return null;const value=marker.getLngLat();return{lat:value.lat,lng:value.lng};},onChange:callback=>{onChange=typeof callback==='function'?callback:null;},cancel:cancelPointPlacement};
    const setPoint=value=>{const lat=Number(value?.lat),lng=Number(value?.lng);if(![lat,lng].every(Number.isFinite))return null;if(!marker){marker=new gl.Marker({element:markerElement('Новий об’єкт'),draggable:true}).setLngLat([lng,lat]).addTo(map);marker.on('dragend',()=>onChange?.(controller.getPoint()));placement.marker=marker;}else marker.setLngLat([lng,lat]);if(!opened){opened=true;map.off('click',clickHandler);map.panTo([lng,lat]);options.onPlace?.(controller.getPoint(),controller);}return controller.getPoint();};
    const clickHandler=event=>setPoint(event.lngLat);
    placement={marker,clickHandler,controller};
    if(options.initial)setPoint(options.initial);else map.on('click',clickHandler);
    return controller;
  };
  const mountPicker=(container,options={})=>{
    destroyPicker();if(!container||!webgl2Available())return null;
    const initial=options.initial&&{lat:Number(options.initial.lat),lng:Number(options.initial.lng)};
    const validInitial=initial&&[initial.lat,initial.lng].every(Number.isFinite)?initial:null;
    const pickerMap=new gl.Map({container,style:createOsmStyle(),center:validInitial?[validInitial.lng,validInitial.lat]:[DEFAULT_VIEW.lng,DEFAULT_VIEW.lat],zoom:validInitial?17:6,bearing:0,pitch:0,dragRotate:true,touchZoomRotate:true,attributionControl:false});
    pickerMap.addControl(new gl.NavigationControl({showCompass:true,showZoom:true}),'top-right');pickerMap.addControl(new gl.AttributionControl({compact:true}),'bottom-right');pickerMap.touchZoomRotate?.enable?.();pickerMap.touchZoomRotate?.enableRotation?.();
    let marker=null,changed=false;
    const getPoint=()=>{if(!marker)return null;const value=marker.getLngLat();return{lat:value.lat,lng:value.lng};};
    const setPoint=(value,center=true,notify=true)=>{const lat=Number(value?.lat),lng=Number(value?.lng);if(![lat,lng].every(Number.isFinite))return null;if(!marker){marker=new gl.Marker({element:markerElement(),draggable:true}).setLngLat([lng,lat]).addTo(pickerMap);marker.on('dragend',()=>{changed=true;options.onChange?.(getPoint());});}else marker.setLngLat([lng,lat]);if(center)pickerMap.easeTo({center:[lng,lat],zoom:Math.max(pickerMap.getZoom(),17)});if(notify){changed=true;options.onChange?.({lat,lng});}return{lat,lng};};
    pickerMap.on('click',event=>setPoint(event.lngLat,false));if(validInitial)setPoint(validInitial,false,false);
    picker={map:pickerMap,getPoint,setPoint,hasChanged:()=>changed,invalidateSize:()=>{pickerMap.resize();return true;},destroy:destroyPicker};
    (root.requestAnimationFrame||((callback)=>setTimeout(callback,0)))(()=>pickerMap.resize());return picker;
  };
  return{engine:'maplibre',mount,destroy,resize,captureView,currentCenter,focusPoint,showUserLocation,startPointPlacement,cancelPointPlacement,mountPicker,destroyPicker,objectGeoJson,applyObjectFilters,switchBaseLayer,isMounted:()=>!!map,isPickerMounted:()=>!!picker,getMap:()=>map};
}

maplibregl.setWorkerUrl(WORKER_URL);
const adapter=createMapLibreAdapter(maplibregl,globalThis);
globalThis.MTToolsMapLibreAdapter=adapter;
globalThis.dispatchEvent?.(new Event('mt-maplibre-ready'));

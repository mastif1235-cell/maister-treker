import * as maplibregl from '../vendor/maplibre/maplibre-gl.mjs';
import './map-marker-renderer.js';

const OSM_TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAPTILER_TILE_URL='https://api.maptiler.com/maps/hybrid-v4/{z}/{x}/{y}.jpg';
const DEFAULT_VIEW={lat:48.45,lng:31.2,zoom:6,bearing:0};
const WORKER_URL=new URL('../vendor/maplibre/maplibre-gl-worker.mjs',import.meta.url).href;
const MARKER_RENDERER=globalThis.MTMapMarkerRenderer;
const CATEGORY_COLORS=Object.fromEntries(Object.entries(MARKER_RENDERER.CATEGORIES).filter(([key])=>key!=='gps').map(([key,value])=>[key,value.color]));
const OBJECT_ICON_IDS=Object.fromEntries(Object.keys(CATEGORY_COLORS).map(category=>[category,`mt-object-${category}`]));
export const OBJECT_ICON_SCALE={min:.78,max:1.35};
export const OBJECT_MARKER_PRESETS={classic:OBJECT_ICON_SCALE,large:{min:.9,max:1.45},compact:{min:.62,max:1.08},contrast:{min:.78,max:1.35}};
const OBJECT_SHAPES=MARKER_RENDERER.SHAPES;
const OBJECT_SIZES=Object.keys(MARKER_RENDERER.SIZES);
const markerPreference=(category,options={})=>MARKER_RENDERER.preference(options.markerPreferences?.[category],options.markerPreset);
export const navigationControlOptions=root=>({showCompass:true,showZoom:root.matchMedia?.('(max-width: 600px)')?.matches!==true,visualizePitch:true});

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

function blankStyle(){return{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#eef1ed'}}]};}
const OFFLINE_TEXT_FONT=['Arial','Roboto','Noto Sans','sans-serif'];
const offlineTextField=['coalesce',['get','name:uk'],['get','name'],['get','name:en']];
const sourceLayer=(sourceId,name,layer)=>({id:`mt-offline-${name}`,source:sourceId,'source-layer':layer});
export function createOfflineVectorLayers(sourceId,vectorLayers){
  const available=new Set((vectorLayers||[]).map(layer=>String(layer?.id||'')).filter(Boolean)),result=[];
  const add=(layer,...styles)=>{if(available.has(layer))result.push(...styles.map(style=>({...sourceLayer(sourceId,style.id,layer),...style,id:`mt-offline-${style.id}`})));};
  add('earth',{id:'earth',type:'fill',paint:{'fill-color':'#f2f0e9'}});
  add('landcover',
    {id:'landcover-forest',type:'fill',filter:['in',['get','kind'],['literal',['forest','scrub']]],paint:{'fill-color':'#d4e6ce','fill-opacity':.8}},
    {id:'landcover-grass',type:'fill',filter:['in',['get','kind'],['literal',['grassland','farmland']]],paint:{'fill-color':'#e5edd6','fill-opacity':.72}}
  );
  add('landuse',
    {id:'landuse-residential',type:'fill',filter:['==',['get','kind'],'residential'],paint:{'fill-color':'#e8e7e2','fill-opacity':.7}},
    {id:'landuse-industrial',type:'fill',filter:['in',['get','kind'],['literal',['industrial','commercial','railway']]],paint:{'fill-color':'#e3dfdf','fill-opacity':.72}},
    {id:'landuse-green',type:'fill',filter:['in',['get','kind'],['literal',['park','garden','forest','wood','grass','meadow','recreation_ground','nature_reserve','national_park','cemetery']]],paint:{'fill-color':'#dbe9d2','fill-opacity':.86}}
  );
  add('water',
    {id:'water-fill',type:'fill',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#b8d8ea'}},
    {id:'water-line',type:'line',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#9cc8e1','line-width':['interpolate',['linear'],['zoom'],8,.7,16,2.3]}}
  );
  add('boundaries',{id:'boundaries',type:'line',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#9b9c9a','line-width':['interpolate',['linear'],['zoom'],4,.5,12,1.3],'line-dasharray':[3,2]}});
  add('buildings',
    {id:'buildings',type:'fill',minzoom:13,filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#d6d2c9','fill-outline-color':'#bdb8ad','fill-opacity':.9}}
  );
  add('roads',
    {id:'roads-rail',type:'line',filter:['==',['get','kind'],'rail'],paint:{'line-color':'#aaa49c','line-width':['interpolate',['linear'],['zoom'],8,.6,16,2],'line-dasharray':[2,2]}},
    {id:'roads-casing',type:'line',filter:['in',['get','kind'],['literal',['highway','major_road','minor_road']]],paint:{'line-color':'#c5c1b8','line-width':['interpolate',['linear'],['zoom'],7,1.2,12,3.2,16,8.5]}},
    {id:'roads-highway',type:'line',filter:['==',['get','kind'],'highway'],paint:{'line-color':'#efb77f','line-width':['interpolate',['linear'],['zoom'],7,.8,12,2.4,16,7]}},
    {id:'roads-major',type:'line',filter:['==',['get','kind'],'major_road'],paint:{'line-color':'#f6d8a7','line-width':['interpolate',['linear'],['zoom'],8,.7,12,2.1,16,6.4]}},
    {id:'roads-minor',type:'line',filter:['in',['get','kind'],['literal',['minor_road','path']]],paint:{'line-color':['match',['get','kind'],'path','#dedbd3','#ffffff'],'line-width':['interpolate',['linear'],['zoom'],11,.5,14,1.8,17,4.6]}},
    {id:'road-labels',type:'symbol',minzoom:14,filter:['all',['==',['geometry-type'],'LineString'],['has','name']],layout:{'symbol-placement':'line','text-field':offlineTextField,'text-font':OFFLINE_TEXT_FONT,'text-size':['interpolate',['linear'],['zoom'],14,10,17,13],'text-max-angle':35,'text-padding':3},paint:{'text-color':'#55534f','text-halo-color':'#ffffff','text-halo-width':1.2}}
  );
  add('places',{id:'place-labels',type:'symbol',filter:['all',['==',['geometry-type'],'Point'],['has','name']],layout:{'text-field':offlineTextField,'text-font':OFFLINE_TEXT_FONT,'text-size':['interpolate',['linear'],['zoom'],6,11,12,15],'text-padding':4,'text-allow-overlap':false},paint:{'text-color':'#3d4547','text-halo-color':'#f7f8f4','text-halo-width':1.4}});
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

export function objectMarkerImage(category,shape='drop'){
  return MARKER_RENDERER.imageData(category,{shape,size:'medium'});
}

export function createMapLibreAdapter(gl,root=globalThis){
  let map=null;
  let picker=null;
  let placement=null;
  let unbindLongPress=null;
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
  let selectionBounds=null;
  let selectionClickHandler=null;
  let pickerStatusNode=null;
  let objectEventsBound=false;
  let styleStatusNode=null;
  let styleStatusMessage='';
  let styleGeneration=0;
  let overlayRestorePending=false;
  const setStatus=(node,message='')=>{if(!node)return;node.textContent=message;node.classList?.toggle?.('hidden',!message);};
  const setEmptyState=visible=>currentOptions.emptyStateNode?.classList?.toggle?.('hidden',!visible);
  const webgl2Available=()=>{try{return !!root.document?.createElement('canvas')?.getContext('webgl2');}catch(_error){return false;}};
  const captureView=()=>{
    if(!map)return savedView;
    const center=map.getCenter();
    savedView={lat:center.lat,lng:center.lng,zoom:map.getZoom(),bearing:map.getBearing()};
    return savedView;
  };
  const markerElement=(title='Обрана точка',gps=false)=>{const shell=root.document.createElement('div');shell.className='tools-leaflet-icon-shell';if(gps){const preference=MARKER_RENDERER.preference(currentOptions.markerPreferences?.gps,'classic'),descriptor=MARKER_RENDERER.descriptor('gps',preference,'classic'),image=root.document.createElement('img');image.className='tools-canonical-map-marker';image.src=MARKER_RENDERER.dataUrl('gps',preference,'classic',root.document);image.alt='◎';if(!image.style)image.style={};image.style.width=`${descriptor.width}px`;image.style.height=`${descriptor.height}px`;shell.appendChild(image);}else{const pin=root.document.createElement('span'),icon=root.document.createElement('span');pin.className='tools-leaflet-pin picker';if(pin.style)pin.style.cssText='--mt-pin-size:40px;--mt-pin-border:3px';else pin.style={cssText:'--mt-pin-size:40px;--mt-pin-border:3px'};icon.textContent='◎';pin.appendChild(icon);shell.appendChild(pin);}shell.title=title;return shell;};
  const restoreUserLocation=()=>{
    if(!map||!userPoint||!map.isStyleLoaded?.())return;
    const area=accuracyPolygon(userPoint,Math.max(1,userAccuracy));
    const existing=map.getSource?.('mt-user-accuracy');
    if(existing)existing.setData(area);else map.addSource('mt-user-accuracy',{type:'geojson',data:area});
    if(!map.getLayer?.('mt-user-accuracy-fill'))map.addLayer({id:'mt-user-accuracy-fill',type:'fill',source:'mt-user-accuracy',paint:{'fill-color':'#2a8cff','fill-opacity':.14}});
    if(!map.getLayer?.('mt-user-accuracy-line'))map.addLayer({id:'mt-user-accuracy-line',type:'line',source:'mt-user-accuracy',paint:{'line-color':'#2a8cff','line-width':2}});
    if(userMarker)userMarker.setLngLat([userPoint.lng,userPoint.lat]);
    else userMarker=new gl.Marker({element:markerElement('Моє місце',true)}).setLngLat([userPoint.lng,userPoint.lat]).addTo(map);
  };
  const objectGeoJson=(items,options=currentOptions)=>({type:'FeatureCollection',features:items.map((item,index)=>{const lat=Number(item?.lat),lng=Number(item?.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;const category=CATEGORY_COLORS[item?.category]?item.category:'Інше',preference=markerPreference(category,options),descriptor=MARKER_RENDERER.descriptor(category,preference,options.markerPreset);return{type:'Feature',id:index,properties:{index,category,icon:descriptor.id,label:item.name||item.type||item.profiles?.[0]?.address||'Об’єкт'},geometry:{type:'Point',coordinates:[lng,lat]}};}).filter(Boolean)});
  const updateFilterButtons=()=>{if(!filterRoot||!selectedCategories)return;const allSelected=selectedCategories.size===Object.keys(CATEGORY_COLORS).length;filterRoot.querySelectorAll('[data-map-filter]').forEach(button=>{const key=button.dataset.mapFilter,active=key==='all'?allSelected:key==='none'?selectedCategories.size===0:selectedCategories.has(key);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});};
  const applyObjectFilters=()=>{if(map?.getLayer?.('mt-objects')&&selectedCategories)map.setFilter('mt-objects',['in',['get','category'],['literal',[...selectedCategories]]]);updateFilterButtons();};
  const handleObjectClick=event=>{const index=Number(event.features?.[0]?.properties?.index);if(Number.isInteger(index)&&objectItems[index])currentOptions.onSelect?.(objectItems[index]);};
  const handleObjectEnter=()=>{map.getCanvas().style.cursor='pointer';};
  const handleObjectLeave=()=>{map.getCanvas().style.cursor='';};
  const bindObjectEvents=()=>{if(objectEventsBound)return;map.on('click','mt-objects',handleObjectClick);map.on('mouseenter','mt-objects',handleObjectEnter);map.on('mouseleave','mt-objects',handleObjectLeave);objectEventsBound=true;};
  const bindObjectFilters=()=>{if(!filterRoot||!selectedCategories)return;filterRoot.onclick=event=>{const button=event.target.closest('[data-map-filter]');if(!button)return;const key=button.dataset.mapFilter;if(key==='all'){selectedCategories.clear();Object.keys(CATEGORY_COLORS).forEach(category=>selectedCategories.add(category));}else if(key==='none')selectedCategories.clear();else if(selectedCategories.has(key))selectedCategories.delete(key);else selectedCategories.add(key);applyObjectFilters();};updateFilterButtons();};
  const restoreObjects=options=>{
    if(!map||!map.isStyleLoaded?.())return;
    Object.keys(CATEGORY_COLORS).forEach(category=>OBJECT_SHAPES.forEach(shape=>OBJECT_SIZES.forEach(size=>{const image=MARKER_RENDERER.imageData(category,{shape,size}),id=image.descriptor.id;if(!map.hasImage?.(id))map.addImage?.(id,image,{pixelRatio:2});})));
    const data=objectGeoJson(objectItems,options),existing=map.getSource?.('mt-objects');
    if(existing)existing.setData(data);else map.addSource('mt-objects',{type:'geojson',data});
    if(!map.getLayer?.('mt-objects')){
      map.addLayer({id:'mt-objects',type:'symbol',source:'mt-objects',layout:{'icon-image':['get','icon'],'icon-size':['interpolate',['linear'],['zoom'],5,.78,17,1.35],'icon-anchor':'bottom','icon-allow-overlap':false}});
    }
    bindObjectEvents();
    applyObjectFilters();
  };
  const selectionGeoJson=bounds=>bounds?{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[bounds.minLng,bounds.minLat],[bounds.maxLng,bounds.minLat],[bounds.maxLng,bounds.maxLat],[bounds.minLng,bounds.maxLat],[bounds.minLng,bounds.minLat]]]}}:{type:'FeatureCollection',features:[]};
  const restoreSelection=()=>{
    if(!map||!map.isStyleLoaded?.())return;
    const data=selectionGeoJson(selectionBounds),existing=map.getSource?.('mt-selection-bounds');
    if(existing)existing.setData(data);else map.addSource('mt-selection-bounds',{type:'geojson',data});
    if(!map.getLayer?.('mt-selection-fill'))map.addLayer({id:'mt-selection-fill',type:'fill',source:'mt-selection-bounds',paint:{'fill-color':'#ff9f1a','fill-opacity':.12}});
    if(!map.getLayer?.('mt-selection-line'))map.addLayer({id:'mt-selection-line',type:'line',source:'mt-selection-bounds',paint:{'line-color':'#ff9f1a','line-width':2}});
  };
  const updateBaseButtons=()=>baseControl?.querySelectorAll('[data-mt-base-layer]').forEach(button=>{const active=button.dataset.mtBaseLayer===currentBase;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  const updateOfflineCoverage=()=>{
    if(currentBase!=='offline'||!offlineBounds||!map)return;
    const center=map.getCenter(),inside=center.lng>=offlineBounds.minLon&&center.lng<=offlineBounds.maxLon&&center.lat>=offlineBounds.minLat&&center.lat<=offlineBounds.maxLat;
    setStatus(currentOptions.statusNode,inside?'Офлайн-карта активна.':'Центр карти поза межами встановленої офлайн-області.');
  };
  const restoreApplicationOverlays=()=>{restoreUserLocation();restoreObjects(currentOptions);restoreSelection();updateBaseButtons();if(currentBase==='offline')updateOfflineCoverage();else setStatus(styleStatusNode||currentOptions.statusNode,styleStatusMessage);};
  const scheduleOverlayRestore=(generation=styleGeneration,attempt=0)=>{
    if(!map||generation!==styleGeneration||overlayRestorePending)return;
    overlayRestorePending=true;
    const frame=root.requestAnimationFrame||((callback)=>setTimeout(callback,0));
    frame(()=>{
      overlayRestorePending=false;
      if(!map||generation!==styleGeneration)return;
      if(!map.isStyleLoaded?.()){if(attempt<20)(root.setTimeout||setTimeout)(()=>scheduleOverlayRestore(generation,attempt+1),50);return;}
      try{restoreApplicationOverlays();}catch(_error){if(attempt<20)(root.setTimeout||setTimeout)(()=>scheduleOverlayRestore(generation,attempt+1),50);}
    });
  };
  const handleStyleLifecycle=()=>scheduleOverlayRestore(styleGeneration);
  const offlineStyle=async()=>{
    const pm=root.pmtiles,stored=await root.MTOfflineMap?.archive?.();
    if(!stored?.file||!pm?.PMTiles||!pm?.FileSource||!pm?.Protocol)throw new Error('OFFLINE_MAP_UNAVAILABLE');
    const key=`mt-offline-${Date.now()}-${++offlineSequence}`,source=new pm.FileSource(stored.file);source.getKey=()=>key;
    const archive=new pm.PMTiles(source),[header,metadata]=await Promise.all([archive.getHeader(),archive.getMetadata().catch(()=>({}))]);
    if(!offlineProtocol){offlineProtocol=new pm.Protocol({metadata:true});gl.removeProtocol?.('pmtiles');gl.addProtocol('pmtiles',offlineProtocol.tile);}offlineProtocol.add(archive);
    offlineBounds={minLon:Number(header.minLon),minLat:Number(header.minLat),maxLon:Number(header.maxLon),maxLat:Number(header.maxLat)};
    const sourceId='mt-offline',url=`pmtiles://${key}`,attribution=String(metadata?.attribution||stored.info?.attribution||'© OpenStreetMap contributors');
    if(Number(header.tileType)===1){
      const vectorLayers=Array.isArray(metadata?.vector_layers)?metadata.vector_layers:[];if(!vectorLayers.length)throw new Error('VECTOR_LAYERS_METADATA_MISSING');
      return{style:{version:8,sources:{[sourceId]:{type:'vector',url,attribution}},layers:[...blankStyle().layers,...createOfflineVectorLayers(sourceId,vectorLayers)]},header};
    }
    if([2,3,4,5].includes(Number(header.tileType)))return{style:{version:8,sources:{[sourceId]:{type:'raster',url,tileSize:256,attribution}},layers:[...blankStyle().layers,{id:'mt-offline-raster',type:'raster',source:sourceId}]},header};
    throw new Error(`UNSUPPORTED_TILE_TYPE_${header.tileType}`);
  };
  const switchBaseLayer=async(kind,statusNode=currentOptions.statusNode,options={})=>{
    if(!map)return false;
    styleStatusNode=statusNode;styleStatusMessage=options.message||'';
    const generation=++styleGeneration;
    if(kind==='offline'){
      try{const prepared=await offlineStyle();if(generation!==styleGeneration)return false;currentBase='offline';map.setStyle(prepared.style);if(options.fit!==false)map.fitBounds?.([[prepared.header.minLon,prepared.header.minLat],[prepared.header.maxLon,prepared.header.maxLat]],{padding:24,maxZoom:Math.min(16,Number(prepared.header.maxZoom)||16)});}
      catch(error){if(generation!==styleGeneration)return false;root.MTSafeError?.reportError?.(error,{scope:'map-offline-style'});setEmptyState(true);setStatus(statusNode,'Офлайн-карта не встановлена. Імпортуйте файл .pmtiles у Налаштуваннях.');restoreUserLocation();restoreObjects(currentOptions);restoreSelection();return false;}
    }else if(kind==='satellite'){
      if(root.navigator?.onLine===false){setStatus(statusNode,'Супутникова карта доступна лише онлайн.');return false;}
      const key=root.MTMapTilerLocal?.getKey?.();if(!key){setStatus(statusNode,'Для супутникової карти додайте власний MapTiler API key у Налаштуваннях.');return false;}
      currentBase='satellite';map.setStyle(createSatelliteStyle(key));
    }else{currentBase='map';offlineBounds=null;map.setStyle(createOsmStyle());}
    scheduleOverlayRestore(generation);
    setEmptyState(false);
    if(options.remember!==false){if(currentBase==='offline')root.MTOfflineMap?.setMode?.('offline');else root.MTMapTilerLocal?.saveLayer?.(currentBase);}
    updateBaseButtons();return true;
  };
  const switchPickerBase=async kind=>{
    if(!picker?.map)return false;
    if(kind==='satellite'){
      const key=root.MTMapTilerLocal?.getKey?.();
      if(root.navigator?.onLine===false||!key){picker.map.setStyle(createOsmStyle());setStatus(pickerStatusNode,!key?'Для супутникової карти додайте власний MapTiler API key у Налаштуваннях.':'Супутникова карта доступна лише онлайн.');return false;}
      picker.map.setStyle(createSatelliteStyle(key));setStatus(pickerStatusNode,'');return true;
    }
    if(kind!=='offline'){picker.map.setStyle(createOsmStyle());setStatus(pickerStatusNode,'');return true;}
    try{const prepared=await offlineStyle();picker.map.setStyle(prepared.style);setStatus(pickerStatusNode,'Офлайн-карта активна.');return true;}
    catch(error){root.MTSafeError?.reportError?.(error,{scope:'map-picker-offline-style'});picker.map.setStyle(createOsmStyle());setStatus(pickerStatusNode,'Офлайн-карта не встановлена. Залишено звичайну карту.');return false;}
  };
  const handleConnectivityChange=()=>{
    if(!map||(root.MTOfflineMap?.getMode?.()||'auto')!=='auto')return false;
    const kind=root.navigator?.onLine===false?'offline':root.MTMapTilerLocal?.getLayer?.()==='satellite'&&root.MTMapTilerLocal?.getKey?.()?'satellite':'map';
    switchBaseLayer(kind,currentOptions.statusNode,{remember:false,fit:false});switchPickerBase(kind);return true;
  };
  const addBaseSwitcher=()=>{
    const control={onAdd(){const wrap=root.document.createElement('div');wrap.className='maplibregl-ctrl tools-map-layer-switcher';wrap.innerHTML='<button type="button" data-mt-base-layer="map">🗺️ Карта</button><button type="button" data-mt-base-layer="satellite">🛰️ Супутник</button><button type="button" data-mt-base-layer="offline">📦 Офлайн</button>';wrap.addEventListener('click',event=>{const button=event.target.closest('[data-mt-base-layer]');if(button)switchBaseLayer(button.dataset.mtBaseLayer);});baseControl=wrap;updateBaseButtons();return wrap;},onRemove(){baseControl?.remove();baseControl=null;}};
    map.addControl(control,'top-right');
  };
  const cancelPointPlacement=()=>{if(!placement)return;if(map&&placement.clickHandler)map.off('click',placement.clickHandler);placement.marker?.remove();placement=null;};
  const destroyPicker=()=>{if(!picker)return;picker.map.remove();picker=null;pickerStatusNode=null;if(!map&&offlineProtocol){gl.removeProtocol?.('pmtiles');offlineProtocol=null;}};
  const destroy=()=>{destroyPicker();if(unbindLongPress){unbindLongPress();unbindLongPress=null;}cancelPointPlacement();if(map&&selectionClickHandler)map.off('click',selectionClickHandler);selectionClickHandler=null;selectionBounds=null;userMarker?.remove();userMarker=null;userPoint=null;if(!map)return;if(objectEventsBound){map.off('click','mt-objects',handleObjectClick);map.off('mouseenter','mt-objects',handleObjectEnter);map.off('mouseleave','mt-objects',handleObjectLeave);objectEventsBound=false;}map.off('style.load',handleStyleLifecycle);map.off('styledata',handleStyleLifecycle);map.off('idle',handleStyleLifecycle);styleGeneration++;overlayRestorePending=false;captureView();map.remove();map=null;if(offlineProtocol){gl.removeProtocol?.('pmtiles');offlineProtocol=null;}offlineBounds=null;};
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
    map.addControl(new gl.NavigationControl(navigationControlOptions(root)),'top-left');
    map.addControl(new gl.AttributionControl({compact:true}),'bottom-right');
    addBaseSwitcher();
    map.touchZoomRotate?.enable?.();
    map.touchZoomRotate?.enableRotation?.();
    map.on('style.load',handleStyleLifecycle);map.on('styledata',handleStyleLifecycle);map.on('idle',handleStyleLifecycle);
    map.on('moveend',()=>{captureView();updateOfflineCoverage();});
    map.on('load',()=>{if(useOffline)switchBaseLayer('offline',options.statusNode,{remember:false});else{setEmptyState(false);setStatus(options.statusNode,'');scheduleOverlayRestore(styleGeneration);}});
    map.on('contextmenu',event=>options.onAddHere?.({lat:event.lngLat.lat,lng:event.lngLat.lng}));
    // Той самий long-press, що й у Leaflet: один обробник на обидва рушії.
    if(typeof options.onAddHere==='function'&&typeof root.MTToolsMap?.bindMapLongPress==='function'){
      const container=map.getContainer();
      if(unbindLongPress)unbindLongPress();
      unbindLongPress=root.MTToolsMap.bindMapLongPress(container,(clientX,clientY)=>{
        if(placement)return; // у режимі розміщення точки працює звичайний клік
        const rect=container.getBoundingClientRect();
        const point=map.unproject([clientX-rect.left,clientY-rect.top]);
        options.onAddHere({lat:point.lat,lng:point.lng});
      },{ignore:()=>!!placement});
    }
    map.on('error',event=>{if(currentBase==='satellite'){root.MTMapTilerLocal?.saveLayer?.('map');switchBaseLayer('map',options.statusNode,{remember:false,message:'Супутниковий шар недоступний. Відкрито звичайну карту.'});}else setStatus(options.statusNode,`Карта тимчасово недоступна: ${event.error?.message||'помилка завантаження'}`);});
    (root.requestAnimationFrame||((callback)=>setTimeout(callback,0)))(()=>map?.resize());
    return map;
  };
  const resize=()=>{if(!map)return false;(root.requestAnimationFrame||((callback)=>setTimeout(callback,0)))(()=>map?.resize());return true;};
  const currentCenter=()=>{if(!map)return null;const center=map.getCenter();return{lat:center.lat,lng:center.lng};};
  const focusPoint=(point,zoom=17)=>{const lat=Number(point?.lat),lng=Number(point?.lng);if(!map||![lat,lng].every(Number.isFinite))return false;map.easeTo({center:[lng,lat],zoom});return true;};
  const drawBounds=value=>{
    const minLat=Number(value?.minLat),minLng=Number(value?.minLng),maxLat=Number(value?.maxLat),maxLng=Number(value?.maxLng);if(!map||![minLat,minLng,maxLat,maxLng].every(Number.isFinite))return false;
    selectionBounds={minLat,minLng,maxLat,maxLng};restoreSelection();map.fitBounds?.([[minLng,minLat],[maxLng,maxLat]],{padding:18,maxZoom:15});return true;
  };
  const selectBounds=onDone=>{
    if(!map)return false;if(selectionClickHandler)map.off('click',selectionClickHandler);selectionBounds=null;restoreSelection();let first=null;
    selectionClickHandler=event=>{const point={lat:Number(event.lngLat.lat),lng:Number(event.lngLat.lng)};if(!first){first=point;return;}selectionBounds={minLat:Math.min(first.lat,point.lat),minLng:Math.min(first.lng,point.lng),maxLat:Math.max(first.lat,point.lat),maxLng:Math.max(first.lng,point.lng)};map.off('click',selectionClickHandler);selectionClickHandler=null;restoreSelection();onDone?.({...selectionBounds});};
    map.on('click',selectionClickHandler);return true;
  };
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
    pickerStatusNode=options.statusNode||null;
    const mode=options.baseMode||root.MTOfflineMap?.getMode?.()||'auto',useOffline=mode==='offline'||(mode==='auto'&&root.navigator?.onLine===false);
    const initial=options.initial&&{lat:Number(options.initial.lat),lng:Number(options.initial.lng)};
    const validInitial=initial&&[initial.lat,initial.lng].every(Number.isFinite)?initial:null;
    const pickerMap=new gl.Map({container,style:useOffline?blankStyle():createOsmStyle(),center:validInitial?[validInitial.lng,validInitial.lat]:[DEFAULT_VIEW.lng,DEFAULT_VIEW.lat],zoom:validInitial?17:6,bearing:0,pitch:0,dragRotate:true,touchZoomRotate:true,attributionControl:false});
    pickerMap.addControl(new gl.NavigationControl(navigationControlOptions(root)),'top-right');pickerMap.addControl(new gl.AttributionControl({compact:true}),'bottom-right');pickerMap.touchZoomRotate?.enable?.();pickerMap.touchZoomRotate?.enableRotation?.();
    const baseControl={onAdd(){const wrap=root.document.createElement('div');wrap.className='maplibregl-ctrl tools-map-layer-switcher';wrap.innerHTML='<button type="button" data-mt-picker-base="map">🗺️ Карта</button><button type="button" data-mt-picker-base="satellite">🛰️ Супутник</button><button type="button" data-mt-picker-base="offline">📦 Офлайн</button>';wrap.addEventListener('click',event=>{const button=event.target.closest('[data-mt-picker-base]');if(button)switchPickerBase(button.dataset.mtPickerBase);});return wrap;},onRemove(){}};pickerMap.addControl(baseControl,'top-left');
    let marker=null,changed=false;
    const getPoint=()=>{if(!marker)return null;const value=marker.getLngLat();return{lat:value.lat,lng:value.lng};};
    const setPoint=(value,center=true,notify=true)=>{const lat=Number(value?.lat),lng=Number(value?.lng);if(![lat,lng].every(Number.isFinite))return null;if(!marker){marker=new gl.Marker({element:markerElement(),draggable:true}).setLngLat([lng,lat]).addTo(pickerMap);marker.on('dragend',()=>{changed=true;options.onChange?.(getPoint());});}else marker.setLngLat([lng,lat]);if(center)pickerMap.easeTo({center:[lng,lat],zoom:Math.max(pickerMap.getZoom(),17)});if(notify){changed=true;options.onChange?.({lat,lng});}return{lat,lng};};
    pickerMap.on('click',event=>setPoint(event.lngLat,false));if(validInitial)setPoint(validInitial,false,false);
    picker={map:pickerMap,getPoint,setPoint,hasChanged:()=>changed,invalidateSize:()=>{pickerMap.resize();return true;},destroy:destroyPicker};
    pickerMap.on('load',()=>{if(useOffline)switchPickerBase('offline');});
    (root.requestAnimationFrame||((callback)=>setTimeout(callback,0)))(()=>pickerMap.resize());return picker;
  };
  return{engine:'maplibre',mount,destroy,resize,captureView,currentCenter,focusPoint,selectBounds,drawBounds,showUserLocation,startPointPlacement,cancelPointPlacement,isPointPlacementActive:()=>!!placement,mountPicker,destroyPicker,objectGeoJson,applyObjectFilters,switchBaseLayer,handleConnectivityChange,isMounted:()=>!!map,isPickerMounted:()=>!!picker,getMap:()=>map};
}

maplibregl.setWorkerUrl(WORKER_URL);
const adapter=createMapLibreAdapter(maplibregl,globalThis);
globalThis.MTToolsMapLibreAdapter=adapter;

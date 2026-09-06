import * as maplibregl from '../vendor/maplibre/maplibre-gl.mjs';

const OSM_TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_VIEW={lat:48.45,lng:31.2,zoom:6,bearing:0};
const WORKER_URL=new URL('../vendor/maplibre/maplibre-gl-worker.mjs',import.meta.url).href;

export function createOsmStyle(){
  return{
    version:8,
    sources:{osm:{type:'raster',tiles:[OSM_TILE_URL],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'}},
    layers:[{id:'osm',type:'raster',source:'osm'}]
  };
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
  let savedView=null;
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
  const cancelPointPlacement=()=>{if(!placement)return;if(map&&placement.clickHandler)map.off('click',placement.clickHandler);placement.marker?.remove();placement=null;};
  const destroyPicker=()=>{if(!picker)return;picker.map.remove();picker=null;};
  const destroy=()=>{destroyPicker();cancelPointPlacement();userMarker?.remove();userMarker=null;userPoint=null;if(!map)return;captureView();map.remove();map=null;};
  const mount=(container,_objects=[],options={})=>{
    destroy();
    if(!container||!webgl2Available()){
      setStatus(options.statusNode,'MapLibre потребує WebGL2. Використано резервну карту Leaflet.');
      return null;
    }
    const view=options.initialView||savedView||DEFAULT_VIEW;
    map=new gl.Map({
      container,style:createOsmStyle(),center:[Number(view.lng),Number(view.lat)],zoom:Number(view.zoom),bearing:Number(view.bearing)||0,pitch:0,
      dragRotate:true,touchZoomRotate:true,attributionControl:false
    });
    map.addControl(new gl.NavigationControl({showCompass:true,showZoom:true,visualizePitch:true}),'top-right');
    map.addControl(new gl.FullscreenControl({container}),'top-right');
    map.addControl(new gl.AttributionControl({compact:true}),'bottom-right');
    map.touchZoomRotate?.enable?.();
    map.touchZoomRotate?.enableRotation?.();
    map.on('moveend',captureView);
    map.on('load',()=>{setStatus(options.statusNode,'');restoreUserLocation();});
    map.on('error',event=>setStatus(options.statusNode,`Карта тимчасово недоступна: ${event.error?.message||'помилка завантаження'}`));
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
  return{engine:'maplibre',mount,destroy,resize,captureView,currentCenter,focusPoint,showUserLocation,startPointPlacement,cancelPointPlacement,mountPicker,destroyPicker,isMounted:()=>!!map,isPickerMounted:()=>!!picker,getMap:()=>map};
}

maplibregl.setWorkerUrl(WORKER_URL);
const adapter=createMapLibreAdapter(maplibregl,globalThis);
globalThis.MTToolsMapLibreAdapter=adapter;
globalThis.dispatchEvent?.(new Event('mt-maplibre-ready'));

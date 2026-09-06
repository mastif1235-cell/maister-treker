import * as maplibregl from './vendor/maplibre/maplibre-gl.mjs';

const OPFS_DIRECTORY='master-tracker-maplibre-poc';
const OPFS_FILE='active.pmtiles';
const DEFAULT_CENTER=[31.2,48.45];
const status={
  webgl:document.getElementById('webgl-status'),
  network:document.getElementById('network-status'),
  map:document.getElementById('map-status'),
  pmtiles:document.getElementById('pmtiles-status'),
  opfs:document.getElementById('opfs-status'),
  coords:document.getElementById('coords-status')
};
const input=document.getElementById('pmtiles-file');
const openButton=document.getElementById('open-file');
const installButton=document.getElementById('install-opfs');
const gpsButton=document.getElementById('gps');
let map=null;
let marker=null;
let gpsPoint=null;
let gpsAccuracy=0;
let sourceSequence=0;

function setStatus(node,text,error=false){
  node.textContent=text;
  node.style.borderColor=error?'#d75050':'#35434b';
}
function updateNetworkStatus(){
  const online=navigator.onLine!==false;
  setStatus(status.network,`Мережа: ${online?'ONLINE':'OFFLINE'}`,!online);
}
function hasWebGL2(){
  try{return !!document.createElement('canvas').getContext('webgl2');}catch(_error){return false;}
}
function blankStyle(){
  return{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#182329'}}]};
}
function markerElement(){
  const element=document.createElement('div');
  element.className='poc-marker';
  element.title='Перетягуваний тестовий маркер';
  return element;
}
function accuracyPolygon(point,radius,steps=72){
  const earth=6378137;
  const latRadians=point.lat*Math.PI/180;
  const coordinates=[];
  for(let index=0;index<=steps;index++){
    const angle=index/steps*Math.PI*2;
    const lat=point.lat+(radius*Math.sin(angle)/earth)*180/Math.PI;
    const lng=point.lng+(radius*Math.cos(angle)/(earth*Math.cos(latRadians)))*180/Math.PI;
    coordinates.push([lng,lat]);
  }
  return{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[coordinates]}};
}
function restoreGpsLayers(){
  if(!map||!gpsPoint||!map.isStyleLoaded())return;
  const data=accuracyPolygon(gpsPoint,Math.max(1,gpsAccuracy));
  const existingAccuracy=map.getSource('poc-gps-accuracy');
  const existingPoint=map.getSource('poc-gps-point');
  if(existingAccuracy&&existingPoint){
    existingAccuracy.setData(data);
    existingPoint.setData({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[gpsPoint.lng,gpsPoint.lat]}});
    return;
  }
  map.addSource('poc-gps-accuracy',{type:'geojson',data});
  map.addLayer({id:'poc-gps-accuracy-fill',type:'fill',source:'poc-gps-accuracy',paint:{'fill-color':'#2a8cff','fill-opacity':.16}});
  map.addLayer({id:'poc-gps-accuracy-line',type:'line',source:'poc-gps-accuracy',paint:{'line-color':'#2a8cff','line-width':2}});
  map.addSource('poc-gps-point',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[gpsPoint.lng,gpsPoint.lat]}}});
  map.addLayer({id:'poc-gps-point',type:'circle',source:'poc-gps-point',paint:{'circle-radius':7,'circle-color':'#2a8cff','circle-stroke-color':'#fff','circle-stroke-width':2}});
}
function resetStyle(nextStyle){
  map.setStyle(nextStyle);
  map.once('style.load',restoreGpsLayers);
}
function safeKey(){return `poc-${Date.now()}-${++sourceSequence}`;}
function keyedFileSource(file,key){
  const source=new window.pmtiles.FileSource(file);
  source.getKey=()=>key;
  return source;
}
function geometryLayers(sourceId,vectorLayers){
  const result=[];
  vectorLayers.forEach((layer,index)=>{
    const sourceLayer=String(layer?.id||'');
    if(!sourceLayer)return;
    const hue=(index*47)%360;
    result.push(
      {id:`poc-fill-${index}`,type:'fill',source:sourceId,'source-layer':sourceLayer,filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':`hsl(${hue},35%,48%)`,'fill-opacity':.38,'fill-outline-color':'#6f8997'}},
      {id:`poc-line-${index}`,type:'line',source:sourceId,'source-layer':sourceLayer,filter:['==',['geometry-type'],'LineString'],paint:{'line-color':`hsl(${hue},65%,68%)`,'line-width':['interpolate',['linear'],['zoom'],5,.5,16,3]}},
      {id:`poc-point-${index}`,type:'circle',source:sourceId,'source-layer':sourceLayer,filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':4,'circle-color':`hsl(${hue},75%,58%)`,'circle-stroke-color':'#111','circle-stroke-width':1}}
    );
  });
  return result;
}
async function openPmtilesFile(file,label){
  if(!map)throw new Error('MAP_NOT_READY');
  if(!file||typeof file.slice!=='function'||file.size<127)throw new Error('INVALID_PMTILES_FILE');
  const key=safeKey();
  const archive=new window.pmtiles.PMTiles(keyedFileSource(file,key));
  const [header,metadata]=await Promise.all([archive.getHeader(),archive.getMetadata().catch(()=>({}))]);
  const protocol=new window.pmtiles.Protocol({metadata:true});
  protocol.add(archive);
  maplibregl.addProtocol('pmtiles',protocol.tile);
  const sourceId='poc-pmtiles';
  const sourceUrl=`pmtiles://${key}`;
  const attribution=String(metadata?.attribution||'© OpenStreetMap contributors');
  let style;
  if(header.tileType===1){
    const vectorLayers=Array.isArray(metadata?.vector_layers)?metadata.vector_layers:[];
    if(!vectorLayers.length)throw new Error('VECTOR_LAYERS_METADATA_MISSING');
    style={version:8,sources:{[sourceId]:{type:'vector',url:sourceUrl,attribution}},layers:[{id:'background',type:'background',paint:{'background-color':'#182329'}},...geometryLayers(sourceId,vectorLayers)]};
  }else if([2,3,4,5].includes(header.tileType)){
    style={version:8,sources:{[sourceId]:{type:'raster',url:sourceUrl,tileSize:256,attribution}},layers:[{id:'background',type:'background',paint:{'background-color':'#182329'}},{id:'poc-raster',type:'raster',source:sourceId}]};
  }else throw new Error(`UNSUPPORTED_TILE_TYPE_${header.tileType}`);
  resetStyle(style);
  map.fitBounds([[header.minLon,header.minLat],[header.maxLon,header.maxLat]],{padding:24,maxZoom:Math.min(16,header.maxZoom)});
  setStatus(status.pmtiles,`PMTiles: ${label}; z${header.minZoom}–${header.maxZoom}; читання діапазонами`);
  return{header,metadata};
}
async function opfsFile(create=false){
  if(!navigator.storage?.getDirectory)throw new Error('OPFS_UNAVAILABLE');
  const root=await navigator.storage.getDirectory();
  const directory=await root.getDirectoryHandle(OPFS_DIRECTORY,{create});
  const handle=await directory.getFileHandle(OPFS_FILE,{create});
  return{handle,file:create?null:await handle.getFile()};
}
async function updateOpfsStatus(){
  if(!navigator.storage?.getDirectory){setStatus(status.opfs,'OPFS: недоступний',true);return false;}
  try{
    const {file}=await opfsFile(false);
    setStatus(status.opfs,`OPFS: файл збережено (${Math.round(file.size/1024)} КБ)`);
    return true;
  }catch(error){
    if(error?.name==='NotFoundError'){setStatus(status.opfs,'OPFS: доступний, файл ще не збережено');return true;}
    setStatus(status.opfs,`OPFS: ${error.message||'помилка'}`,true);
    return false;
  }
}
async function installInOpfs(file){
  if(!file?.stream)throw new Error('FILE_STREAM_UNAVAILABLE');
  const {handle}=await opfsFile(true);
  const writable=await handle.createWritable({keepExistingData:false});
  try{await file.stream().pipeTo(writable);}catch(error){await writable.abort?.();throw error;}
  const saved=await handle.getFile();
  if(saved.size!==file.size)throw new Error('OPFS_COPY_INCOMPLETE');
  await navigator.storage.persist?.();
  return saved;
}
async function restoreOpfs(){
  try{
    const {file}=await opfsFile(false);
    if(file?.size)await openPmtilesFile(file,'demo OPFS відновлено');
  }catch(error){
    if(!['NotFoundError','OPFS_UNAVAILABLE'].includes(error?.name)&&error?.message!=='OPFS_UNAVAILABLE')setStatus(status.pmtiles,`PMTiles: OPFS ${error.message}`,true);
  }finally{await updateOpfsStatus();}
}
function showGps(){
  if(!navigator.geolocation){setStatus(status.map,'GPS: Geolocation API недоступний',true);return;}
  gpsButton.disabled=true;
  navigator.geolocation.getCurrentPosition(position=>{
    gpsButton.disabled=false;
    gpsPoint={lng:position.coords.longitude,lat:position.coords.latitude};
    gpsAccuracy=Number(position.coords.accuracy)||1;
    restoreGpsLayers();
    map.easeTo({center:[gpsPoint.lng,gpsPoint.lat],zoom:Math.max(map.getZoom(),16)});
    setStatus(status.map,`GPS: точність ≈ ${Math.round(gpsAccuracy)} м`);
  },error=>{
    gpsButton.disabled=false;
    setStatus(status.map,`GPS: ${error.message||'позицію не отримано'}`,true);
  },{enableHighAccuracy:true,timeout:15000,maximumAge:15000});
}
function init(){
  if(!hasWebGL2()){
    setStatus(status.webgl,'WebGL2: недоступний',true);
    setStatus(status.map,'Карта: MapLibre v6 потребує WebGL2',true);
    return;
  }
  setStatus(status.webgl,'WebGL2: доступний');
  map=new maplibregl.Map({container:'map',style:blankStyle(),center:DEFAULT_CENTER,zoom:5.5,bearing:0,pitch:0,dragRotate:true,touchZoomRotate:true,attributionControl:false});
  map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true,visualizePitch:true}),'top-right');
  map.addControl(new maplibregl.FullscreenControl({container:document.getElementById('map-shell')}),'top-right');
  map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
  map.touchZoomRotate.enable();
  map.touchZoomRotate.enableRotation();
  marker=new maplibregl.Marker({element:markerElement(),draggable:true}).setLngLat(DEFAULT_CENTER).addTo(map);
  marker.on('dragend',()=>{const point=marker.getLngLat();setStatus(status.coords,`Marker: ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`);});
  map.on('click',event=>setStatus(status.coords,`Picker: ${event.lngLat.lat.toFixed(6)}, ${event.lngLat.lng.toFixed(6)}`));
  map.on('load',()=>{setStatus(status.map,`Карта: MapLibre ${maplibregl.getVersion()} запущено`);restoreOpfs();});
  map.on('error',event=>setStatus(status.map,`Карта: ${event.error?.message||'помилка'}`,true));
  window.__maplibrePoc={map,marker,openPmtilesFile,installInOpfs,restoreOpfs,version:maplibregl.getVersion()};
}

input.addEventListener('change',()=>{
  const selected=input.files?.[0]||null;
  openButton.disabled=!selected;
  installButton.disabled=!selected;
  setStatus(status.pmtiles,selected?`PMTiles: обрано ${selected.name} (${Math.round(selected.size/1024)} КБ)`:'PMTiles: файл не вибрано');
});
openButton.addEventListener('click',async()=>{
  openButton.disabled=true;
  try{await openPmtilesFile(input.files?.[0],'локальний FileSource');}catch(error){setStatus(status.pmtiles,`PMTiles: ${error.message}`,true);}finally{openButton.disabled=!input.files?.[0];}
});
installButton.addEventListener('click',async()=>{
  installButton.disabled=true;
  try{
    setStatus(status.pmtiles,'PMTiles: потокове копіювання в demo OPFS…');
    const saved=await installInOpfs(input.files?.[0]);
    await openPmtilesFile(saved,'demo OPFS');
    await updateOpfsStatus();
  }catch(error){setStatus(status.pmtiles,`PMTiles: ${error.message}`,true);}finally{installButton.disabled=!input.files?.[0];}
});
gpsButton.addEventListener('click',showGps);
window.addEventListener('online',updateNetworkStatus);
window.addEventListener('offline',updateNetworkStatus);
updateNetworkStatus();
updateOpfsStatus();
init();

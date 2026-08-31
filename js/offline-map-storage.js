/* Persistent regional PMTiles storage. The archive lives in OPFS, not in SW cache or backups. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTOfflineMap=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const DIRECTORY='master-tracker-offline-maps';
  const SLOTS=['map-a.pmtiles','map-b.pmtiles'];
  const META_KEY='mtOfflineMapMetaV1';
  const MODE_KEY='mtOfflineMapModeV1';
  const RASTER_TILE_TYPES=new Set([2,3,4,5]);

  function storage(){return root.navigator&&root.navigator.storage;}
  function local(){return root.localStorage;}
  function library(){return root.pmtiles;}
  function supported(){return !!(storage()?.getDirectory&&library()?.PMTiles&&library()?.FileSource);}
  function formatBytes(value){
    const bytes=Math.max(0,Number(value)||0);
    if(bytes<1024)return `${Math.round(bytes)} Б`;
    const units=['КБ','МБ','ГБ','ТБ'];let current=bytes/1024,index=0;
    while(current>=1024&&index<units.length-1){current/=1024;index++;}
    return `${current>=100?current.toFixed(0):current>=10?current.toFixed(1):current.toFixed(2)} ${units[index]}`;
  }
  function validBounds(header={}){
    return [header.minLon,header.minLat,header.maxLon,header.maxLat].every(Number.isFinite)
      && header.minLon<header.maxLon&&header.minLat<header.maxLat
      && header.minLon>=-180&&header.maxLon<=180&&header.minLat>=-90&&header.maxLat<=90;
  }
  function cleanHeader(header={}){
    return {
      specVersion:Number(header.specVersion)||0,tileType:Number(header.tileType)||0,
      minZoom:Number(header.minZoom)||0,maxZoom:Number(header.maxZoom)||0,
      minLon:Number(header.minLon),minLat:Number(header.minLat),maxLon:Number(header.maxLon),maxLat:Number(header.maxLat),
      centerZoom:Number(header.centerZoom)||0,centerLon:Number(header.centerLon),centerLat:Number(header.centerLat)
    };
  }
  function readMeta(){
    try{const value=JSON.parse(local()?.getItem(META_KEY)||'null');return value&&SLOTS.includes(value.activeSlot)&&value.header&&validBounds(value.header)?value:null;}catch(_e){return null;}
  }
  function writeMeta(value){local()?.setItem(META_KEY,JSON.stringify(value));}
  function clearMeta(){local()?.removeItem(META_KEY);}
  function getMode(){const value=local()?.getItem(MODE_KEY);return ['auto','online','offline'].includes(value)?value:'auto';}
  function setMode(value){const next=['auto','online','offline'].includes(value)?value:'auto';local()?.setItem(MODE_KEY,next);return next;}
  async function getDirectory(create=true){
    if(!storage()?.getDirectory)throw new Error('OPFS_UNAVAILABLE');
    const rootDirectory=await storage().getDirectory();
    return rootDirectory.getDirectoryHandle(DIRECTORY,{create});
  }
  async function inspectFile(file,pm=library()){
    if(!file||typeof file.slice!=='function'||Number(file.size)<127)throw new Error('INVALID_PMTILES_FILE');
    if(file.name&&!/\.pmtiles$/i.test(file.name))throw new Error('INVALID_PMTILES_EXTENSION');
    if(!pm?.PMTiles||!pm?.FileSource)throw new Error('PMTILES_LIBRARY_UNAVAILABLE');
    const archive=new pm.PMTiles(new pm.FileSource(file));
    const header=cleanHeader(await archive.getHeader());
    if(header.specVersion<3||!validBounds(header))throw new Error('INVALID_PMTILES_HEADER');
    if(!RASTER_TILE_TYPES.has(header.tileType))throw new Error('PMTILES_RASTER_REQUIRED');
    let metadata={};try{metadata=await archive.getMetadata()||{};}catch(_e){}
    return {
      fileName:String(file.name||'region.pmtiles').slice(0,240),size:Number(file.size)||0,header,
      name:String(metadata.name||metadata.description||'').slice(0,240),
      attribution:String(metadata.attribution||'© OpenStreetMap contributors').slice(0,1000)
    };
  }
  async function quotaFor(size){
    try{
      const estimate=await storage()?.estimate?.();
      const quota=Number(estimate?.quota),usage=Number(estimate?.usage);
      const available=Number.isFinite(quota)&&Number.isFinite(usage)?Math.max(0,quota-usage):null;
      return{quota:Number.isFinite(quota)?quota:null,usage:Number.isFinite(usage)?usage:null,available,enough:available===null?null:available>=Number(size)*1.08};
    }catch(_e){return{quota:null,usage:null,available:null,enough:null};}
  }
  async function writeFile(handle,file){
    const writable=await handle.createWritable({keepExistingData:false});
    try{
      if(file.stream&&typeof file.stream==='function'&&typeof file.stream().pipeTo==='function')await file.stream().pipeTo(writable);
      else{await writable.write(file);await writable.close();}
    }catch(error){try{await writable.abort?.();}catch(_e){}throw error;}
  }
  async function removeSlot(directory,slot){try{await directory.removeEntry(slot);}catch(_e){}}
  async function install(file,prepared=null,options={}){
    const inspected=prepared||await inspectFile(file),previous=readMeta();
    const active=previous?.activeSlot,theSlot=active===SLOTS[0]?SLOTS[1]:SLOTS[0];
    const directory=await getDirectory(true),handle=await directory.getFileHandle(theSlot,{create:true});
    try{
      await storage()?.persist?.();
      await writeFile(handle,file);
      const savedFile=await handle.getFile(),verified=await inspectFile(savedFile);
      if(savedFile.size!==file.size)throw new Error('PMTILES_COPY_INCOMPLETE');
      const meta={...verified,activeSlot:theSlot,sourceName:inspected.fileName,areaId:String(options.areaId||''),importedAt:new Date().toISOString()};
      writeMeta(meta);
      if(active&&active!==theSlot)await removeSlot(directory,active);
      return meta;
    }catch(error){await removeSlot(directory,theSlot);throw error;}
  }
  async function installed(){
    const meta=readMeta();if(!meta)return null;
    try{
      const directory=await getDirectory(false),handle=await directory.getFileHandle(meta.activeSlot),file=await handle.getFile();
      if(!file.size)throw new Error('EMPTY_OFFLINE_MAP');
      return{info:{...meta,size:file.size},file};
    }catch(_e){clearMeta();return null;}
  }
  async function archive(){
    const current=await installed();if(!current)return null;
    const pm=library();return{...current,archive:new pm.PMTiles(new pm.FileSource(current.file))};
  }
  async function remove(){
    const meta=readMeta();if(!meta)return true;
    try{const directory=await getDirectory(false);await removeSlot(directory,meta.activeSlot);clearMeta();return true;}catch(_e){return false;}
  }

  return{DIRECTORY,META_KEY,MODE_KEY,RASTER_TILE_TYPES,supported,formatBytes,validBounds,cleanHeader,inspectFile,quotaFor,install,installed,archive,remove,getMode,setMode,readMeta};
});

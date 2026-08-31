'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

class FakeFile{
  constructor(name,size=2048){this.name=name;this.size=size;}
  slice(){return new ArrayBuffer(256);}
}
class FakeFileHandle{
  constructor(name,files,failWrite=false){this.name=name;this.files=files;this.failWrite=failWrite;}
  async getFile(){if(!this.files.has(this.name))throw new Error('missing');return new FakeFile(this.name,this.files.get(this.name).size);}
  async createWritable(){
    const self=this;
    return{async write(file){if(self.failWrite)throw new Error('disk full');self.files.set(self.name,{size:file.size});},async close(){},async abort(){}};
  }
}
class FakeDirectory{
  constructor(){this.files=new Map();this.failSlot='';}
  async getDirectoryHandle(){return this;}
  async getFileHandle(name,{create}={}){if(!create&&!this.files.has(name))throw new Error('missing');return new FakeFileHandle(name,this.files,name===this.failSlot);}
  async removeEntry(name){this.files.delete(name);}
}
function loadModule(){
  const local=new Map(),directory=new FakeDirectory();
  const storage={getDirectory:async()=>directory,estimate:async()=>({quota:10_000_000,usage:1000}),persist:async()=>true};
  class Source{constructor(file){this.file=file;}}
  class Archive{constructor(source){this.source=source;}async getHeader(){return{specVersion:3,tileType:2,minZoom:9,maxZoom:17,minLon:36,minLat:47,maxLon:39,maxLat:50,centerZoom:12,centerLon:37.5,centerLat:48.5};}async getMetadata(){return{name:'Test area',attribution:'OSM'};}}
  const context={module:{exports:{}},exports:{},console,Date,Number,Set,JSON,ArrayBuffer,localStorage:{getItem:key=>local.has(key)?local.get(key):null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)},navigator:{storage},pmtiles:{PMTiles:Archive,FileSource:Source}};
  context.globalThis=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js','offline-map-storage.js'),'utf8'),context);
  return{api:context.module.exports,local,directory};
}

(async()=>{
  const {api,local,directory}=loadModule();
  assert.equal(api.supported(),true);
  assert.equal(api.formatBytes(684*1024*1024),'684 МБ');
  const prepared=await api.inspectFile(new FakeFile('region.pmtiles',4096));
  assert.equal(prepared.header.maxZoom,17);assert.equal(prepared.size,4096);
  await assert.rejects(()=>api.inspectFile(new FakeFile('wrong.txt')),/INVALID_PMTILES_EXTENSION/);
  const quota=await api.quotaFor(4096);assert.equal(quota.enough,true);

  const first=await api.install(new FakeFile('first.pmtiles',4096),prepared,{areaId:'area-a'});
  assert.equal(first.areaId,'area-a','installed PMTiles is linked to the selected saved area');
  assert.equal(first.activeSlot,'map-a.pmtiles');assert.equal((await api.installed()).file.size,4096,'installed archive survives a fresh read');
  const unrelated={tickets:3};local.set('unrelated',JSON.stringify(unrelated));
  directory.failSlot='map-b.pmtiles';
  await assert.rejects(()=>api.install(new FakeFile('replacement.pmtiles',8192),{...prepared,size:8192,fileName:'replacement.pmtiles'}),/disk full/);
  assert.equal((await api.installed()).info.activeSlot,'map-a.pmtiles','failed replacement keeps the working slot');
  assert.equal(JSON.parse(local.get('unrelated')).tickets,3,'offline map failure does not touch user data');
  directory.failSlot='';
  const second=await api.install(new FakeFile('replacement.pmtiles',8192),{...prepared,size:8192,fileName:'replacement.pmtiles'});
  assert.equal(second.activeSlot,'map-b.pmtiles');assert.equal(directory.files.has('map-a.pmtiles'),false,'old slot is removed only after successful replacement');
  assert.equal(await api.remove(),true);assert.equal(await api.installed(),null);assert.equal(JSON.parse(local.get('unrelated')).tickets,3,'map deletion removes only PMTiles');
  console.log('PASS PMTiles validation, quota, persistence, safe replacement and isolated deletion');
})().catch(error=>{console.error(error);process.exitCode=1;});

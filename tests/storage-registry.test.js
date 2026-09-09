'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'js/storage-registry.js'),'utf8'),context={};context.window=context;vm.createContext(context);vm.runInContext(source,context);
const registry=context.MTStorageRegistry;
const values=new Map(),removed=[];const storage={getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value),removeItem:key=>removed.push(key),clear:()=>{throw new Error('must not clear');}};

assert.deepEqual(registry.safeJsonGet(storage,'missing',{safe:true}),{safe:true});
values.set('legacy','{"old":true}');assert.equal(registry.safeJsonGet(storage,'legacy',null).old,true,'valid legacy JSON remains readable');
values.set('broken','{');assert.equal(registry.safeJsonGet(storage,'broken','fallback'),'fallback','corrupted JSON falls back without mutation');
assert.deepEqual(removed,[],'reads never remove unknown or corrupt keys');assert.equal(values.has('legacy'),true);
assert.equal(registry.entries.settings.secret,true);assert.equal(registry.entries.mapTilerKey.secret,true);assert.equal(registry.entries.ticketDraft.key,'ticketDraft');assert.equal(registry.entries.writerLease.key,'mt-single-writer-lease-v1');assert.equal(registry.entries.mapLayer.key,'mt-map-layer-v1');

const local=fs.readFileSync(path.join(root,'js/local-state-storage.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
assert.match(local,/MTStorageRegistry\.safeJsonGet/);assert.doesNotMatch(source,/\.clear\(|removeItem\(/,'registry performs no mass deletion or migration');
assert.ok(html.indexOf('js/storage-registry.js')<html.indexOf('js/settings-core.js'));assert.match(sw,/\.\/js\/storage-registry\.js/);
for(const [file,literal] of [['js/ticket-editor-domain.js','ticketDraft'],['js/single-writer-lock.js','mt-single-writer-lease-v1'],['js/maptiler-local-config.js','mt-map-layer-v1'],['js/offline-map-storage.js','mtOfflineMapMetaV1']])assert.ok(fs.readFileSync(path.join(root,file),'utf8').includes(literal),`${literal} remains backward compatible`);
assert.match(fs.readFileSync(path.join(root,'docs/STORAGE.md'),'utf8'),/Unknown or legacy browser-storage keys are deliberately preserved/);
console.log('PASS storage inventory, stable keys, safe JSON fallback and non-destructive legacy preservation');

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');

const security=fs.readFileSync(path.join(root,'js','security-runtime-v65-9.js'),'utf8');
const securitySlice=security.slice(security.indexOf('function securityRuntimeSafeHref'),security.indexOf('// Last-line defense'))+
  security.slice(security.indexOf('function securityRuntimeHasPrototypeKeys'),security.indexOf('function securityRuntimeNormalizeCatalogSettings'));
const sec={URL,location:{href:'https://example.test/app',origin:'https://example.test'}};vm.createContext(sec);vm.runInContext(securitySlice,sec);
const uuid='31ba1a72-e191-4fca-8cf0-c43eec2d35ca';
const legacy={id:uuid,photo:'idb:old',photos:['idb:old'],tags:['repair'],customFutureField:{kept:true},content:'legacy'};
const first=sec.securityRuntimeSanitizeTicket(legacy,4),second=sec.securityRuntimeSanitizeTicket(first,4);
assert.equal(first.id,uuid,'UUID stable id is preserved');
assert.equal('createdAtMs' in first,false,'missing legacy timestamp is not invented');
assert.deepEqual(JSON.parse(JSON.stringify(second)),JSON.parse(JSON.stringify(first)),'normalized ticket is identical on a second pass');
assert.deepEqual(first.photos,['idb:old'],'already migrated photos are not duplicated');
assert.deepEqual(first.tags,['repair'],'tags are not duplicated');
assert.deepEqual(first.customFutureField,{kept:true},'unknown fields are preserved');
assert.equal(sec.securityRuntimeSanitizeTicket({id:'',content:'old'},7).id,'legacy-ticket-7','invalid missing id fallback is deterministic');

const photoSource=fs.readFileSync(path.join(root,'js','photo-telegram-domain.js'),'utf8');
const migrationSource=photoSource.slice(photoSource.indexOf('async function migrateLegacyPhotosToIdb'),photoSource.indexOf('\nfunction telegramMessageLink'));
let stores=0,saves=0;
const photo={photoDb:{},tickets:[{id:1,photo:'data:image/jpeg;base64,AA=='}],storePhoto:async()=>{stores++;return'idb:migrated';},saveTickets:()=>{saves++;}};
vm.createContext(photo);vm.runInContext(migrationSource,photo);
(async()=>{
  await photo.migrateLegacyPhotosToIdb();const once=JSON.stringify(photo.tickets);
  await photo.migrateLegacyPhotosToIdb();
  assert.equal(JSON.stringify(photo.tickets),once,'second photo migration is data-identical');
  assert.equal(stores,1,'legacy single photo is stored once');assert.equal(saves,1,'already migrated data is not rewritten');
  console.log('PASS legacy ticket/photo migrations are deterministic, repeat-safe and data-preserving');
})().catch(error=>{console.error(error);process.exitCode=1;});

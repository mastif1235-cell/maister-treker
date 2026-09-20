'use strict';
/* Stage 2B regression: additive ticket → AddressBook links.
   Requirements pinned here:
     1) City and Street keep separate UUIDs (Шевченко ↔ Вул Шевченко);
     2) Таромское/Таромське — aliases of ONE city; Привокзальна/Привокзальная
        and Новопокровська/Новопокровская — aliases of ONE street;
     3) the same street name in two cities keeps two different streetId;
     4) a legacy ticket without ids still works and keeps its text/id untouched;
     5) a new or edited ticket stores cityId/streetId only for a unique match —
        ambiguous/unknown addresses stay unlinked, foreign ids are never judged;
     6) an old (Stage 2A / pre-2A) backup imports unchanged; a new backup
        round-trips the ids;
     7) the Sheets payload is additive: a legacy ticket produces a payload
        without ids (so nothing is re-synced), a linked one carries them inside
        повніДаніJSON while the 8 canonical columns stay the same. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const root=path.join(__dirname,'..');
const AB=require('../js/address-book');
const LINK=require('../js/address-book-link');
const LINKER=require('../js/address-book-linker');

/* ---------- directory fixture (synthetic names only) ---------- */
const book=AB.fromLegacy({
  cities:['Шевченко','Таромське','Ясний'],
  streets:{
    'Шевченко':['Вул Шевченко','Вул Кобзаря','Вул Теплична'],
    'Таромське':['Вул Привокзальна','Вул Садова'],
    'Ясний':['Новопокровська']
  }
});
const cityId=name=>book.cities.find(c=>c.name===name).id;
const streetId=(city,street)=>book.streets.find(s=>s.cityId===cityId(city)&&s.name===street).id;
AB.update(book,'cities',cityId('Таромське'),{aliases:['Таромское']});
AB.update(book,'streets',streetId('Таромське','Вул Привокзальна'),{aliases:['Вул Привокзальная','Привокзальна','Привокзальная','ул Привокзальная']});
AB.update(book,'streets',streetId('Ясний','Новопокровська'),{aliases:['Новопокровская']});

/* ---------- A) city and street identities never share a UUID ---------- */
assert.notEqual(cityId('Шевченко'),streetId('Шевченко','Вул Шевченко'),'city Шевченко and street Вул Шевченко have different UUIDs');
assert.equal(new Set(book.cities.map(c=>c.id)).size,book.cities.length);
assert.equal(new Set(book.streets.map(s=>s.id)).size,book.streets.length);
/* the same street name in another city is a different street */
const kobzaryaTarom=AB.add(book,'streets','Вул Кобзаря',cityId('Таромське'));
assert.notEqual(kobzaryaTarom.id,streetId('Шевченко','Вул Кобзаря'),'same street name, other city → other streetId');

/* ---------- B) alias resolution ---------- */
assert.deepEqual(LINK.linkResolution(book,'Таромское','Вул Привокзальна'),{status:'ALIAS_EXACT',cityId:cityId('Таромське'),streetId:streetId('Таромське','Вул Привокзальна')},'Таромское is an alias of Таромське');
assert.deepEqual(LINK.linkResolution(book,'Таромське','Привокзальная'),{status:'ALIAS_EXACT',cityId:cityId('Таромське'),streetId:streetId('Таромське','Вул Привокзальна')},'Привокзальная is an alias of Вул Привокзальна');
assert.equal(LINK.linkResolution(book,'Ясний','Новопокровская').status,'ALIAS_EXACT','Новопокровская is an alias of Новопокровська');
assert.equal(LINK.linkResolution(book,'Ясний','Новопокровская').streetId,streetId('Ясний','Новопокровська'));
assert.equal(LINK.linkResolution(book,'Таромське','Вул Садова').status,'EXACT');
assert.equal(LINK.linkResolution(book,'Таромське','Вул Кобзаря').streetId,kobzaryaTarom.id);

/* ---------- C) legacy ticket: text never rewritten, no invented ids ---------- */
const legacy={id:'legacy-1',date:'03.06.2026',time:'17:54',content:'Таромське Вул Привокзальна 3б кв.1',sum:369,tags:[],
  city:'Таромское',street:'Привокзальная',house:'3б',apartment:'1',address:'Вул Привокзальная 3б, кв. 1'};
const legacySnapshot=JSON.stringify(legacy);
assert.equal(LINK.linkState(book,legacy),'none','a legacy ticket starts without ids');
assert.equal(LINK.applyToTicket(legacy,book),true,'a unique alias match links the ticket');
assert.equal(legacy.cityId,cityId('Таромське'));
assert.equal(legacy.streetId,streetId('Таромське','Вул Привокзальна'));
delete legacy.cityId;delete legacy.streetId;
assert.equal(JSON.stringify(legacy),legacySnapshot,'linking never rewrites city/street/house/apartment/address/content/id');
const unknown={id:'t-unknown',date:'03.06.2026',time:'10:00',content:'',sum:0,tags:[],city:'Шевченко',street:'Вул Неіснуюча',house:'1'};
assert.equal(LINK.applyToTicket(unknown,book),false,'no match → no link');
assert.equal(unknown.cityId,undefined);
/* text changed away from the linked address → the wrong link is re-pointed */
const moved={id:'t-moved',date:'03.06.2026',time:'10:00',content:'',sum:0,tags:[],city:'Таромське',street:'Вул Садова',house:'19',
  cityId:cityId('Таромське'),streetId:streetId('Таромське','Вул Привокзальна')};
assert.equal(LINK.linkState(book,moved),'stale');
assert.equal(LINK.applyToTicket(moved,book),true,'a stale link follows the address the text names');
assert.equal(moved.streetId,streetId('Таромське','Вул Садова'));
/* links from ANOTHER device directory are never judged and never dropped */
const foreign={id:'t-foreign',date:'03.06.2026',time:'10:00',content:'',sum:0,tags:[],city:'Таромське',street:'Вул Садова',
  cityId:'0f9ae2f2-1111-4222-8333-444455556666',streetId:'0f9ae2f2-7777-4888-8999-aaaabbbbcccc'};
const foreignSnapshot=JSON.stringify(foreign);
assert.equal(LINK.linkState(book,foreign),'foreign');
assert.equal(LINK.applyToTicket(foreign,book),false,'foreign ids are not touched');
assert.equal(JSON.stringify(foreign),foreignSnapshot);

/* ---------- E) backup compatibility ---------- */
const stage2aBackup={cities:['Шевченко','Таромське','Ясний'],streets:{'Шевченко':['Вул Шевченко'],'Таромське':['Вул Привокзальна'],'Ясний':['Новопокровська']}};
const importedOld=AB.importSettings(stage2aBackup,{cities:[],streets:{}});
assert.equal(importedOld.addressBook.version,1);
assert.equal(importedOld.addressBook.cities.length,3);
assert.equal(importedOld.addressBook.streets.length,3);
const importedLegacy=AB.importSettings({cities:['Старе село'],streets:{'Старе село':['Вул Стара']}},importedOld);
assert.equal(importedLegacy.addressBook.cities.find(c=>c.name==='Старе село').id.length,36,'a pre-Stage-2A backup still gets identities');
const exported=JSON.parse(JSON.stringify({addressBook:book,...AB.projection(book)}));
const restored=AB.importSettings(exported,{cities:[],streets:{}});
assert.deepEqual(restored.addressBook,book,'directory UUIDs survive the round-trip');
const linkedTicket={...legacy,cityId:cityId('Таромське'),streetId:streetId('Таромське','Вул Привокзальна')};
const restoredTickets=JSON.parse(JSON.stringify([linkedTicket,foreign]));
assert.equal(LINK.linkState(restored.addressBook,restoredTickets[0]),'linked','restored tickets keep a valid directory link');
assert.equal(LINK.linkState(restored.addressBook,restoredTickets[1]),'foreign','foreign ids stay foreign after restore');

/* ---------- F) Sheets payload stays additive and diff-neutral ---------- */
const ctx=vm.createContext({});
vm.runInContext('function formatDate(d){const p=n=>String(n).padStart(2,"0");return p(d.getDate())+"."+p(d.getMonth()+1)+"."+d.getFullYear();}function formatTime(d){const p=n=>String(n).padStart(2,"0");return p(d.getHours())+":"+p(d.getMinutes());}',ctx);
const utils=path.join(root,'js','app-format-utils.js');
vm.runInContext(fs.readFileSync(utils,'utf8'),ctx,{filename:utils});
const appSource=fs.readFileSync(path.join(root,'app.js'),'utf8');
vm.runInContext(appSource.slice(appSource.indexOf('function ticketToSyncPayload'),appSource.indexOf('function shiftToSyncPayload'))+
  '\nglobalThis.ticketToSyncPayload = ticketToSyncPayload;',ctx,{filename:'app.js:ticketToSyncPayload'});
const payload=ctx.ticketToSyncPayload;
const legacyRow={id:'legacy-2',date:'03.06.2026',time:'17:54',content:'текст',sum:369,tags:['tag'],
  city:'Таромське',street:'Вул Садова',house:'19',apartment:'2',address:'Вул Садова 19, кв. 2'};
const legacyRowSnapshot=JSON.stringify(legacyRow);
assert.equal(payload(legacyRow).fullDataJson.includes('cityId'),false,'a legacy ticket produces an unchanged payload (no mass re-sync)');
assert.equal(payload(legacyRow).fullDataJson.includes('streetId'),false);
assert.equal(JSON.stringify(legacyRow),legacyRowSnapshot,'building the payload never mutates the ticket');
const linkedRow={...legacyRow,cityId:cityId('Таромське'),streetId:streetId('Таромське','Вул Садова')};
const full=JSON.parse(payload(linkedRow).fullDataJson);
assert.equal(full.cityId,linkedRow.cityId);
assert.equal(full.streetId,linkedRow.streetId);
assert.equal(full.city,'Таромське','the historical text still travels with the ids');
assert.equal(full.house,'19');
assert.deepEqual(Object.keys(payload(linkedRow)),['id','date','time','content','sum','tags','backupNote','fullDataJson'],'the Sheets row keeps its 8 canonical columns');
assert.equal(payload(linkedRow).backupNote.includes('cityId'),false,'ids never leak into the human-readable note');
/* the cloud row is restored with its ids (restore-from-sheets copies every
   fullDataJson key), and a row without ids still restores as legacy */
const restoreSource=fs.readFileSync(path.join(root,'js','restore-from-sheets.js'),'utf8');
assert.ok(/Object\.keys\(fullData\)\.forEach\(key=>\{ ticket\[key\] = fullData\[key\]; \}\);/.test(restoreSource),'restore copies the ids from повніДаніJSON into the local ticket');

/* ---------- H) import hardening ---------- */
/* A backup file is user input: the imported ids are bounded exactly like the
   other short ticket fields, and an unknown/oversized value is never turned
   into an identity claim — it stays visible as foreign and is never rewritten. */
const securitySource=fs.readFileSync(path.join(root,'js','security-runtime-v65-9.js'),'utf8');
const bounded=securitySource.match(/const short=\[([^\]]*)\]/);
assert.ok(bounded,'the short-field bound list exists');
assert.match(bounded[1],/'cityId'/,'cityId is bounded on import');
assert.match(bounded[1],/'streetId'/,'streetId is bounded on import');
const hostile={id:'t-hostile',date:'03.06.2026',time:'10:00',content:'',sum:0,tags:[],city:'Таромське',street:'Вул Привокзальна',house:'3б',
  cityId:'X'.repeat(4096),streetId:'<script>alert(1)</script>'};
const beforeHostile=JSON.stringify(hostile);
assert.equal(LINK.linkState(book,hostile),'partial','a malformed id pair is partial — suspicious, never judged');
LINK.applyToTicket(hostile,{cityId:cityId('Таромське'),streetId:streetId('Таромське','Вул Привокзальна')});
assert.equal(JSON.stringify(hostile),beforeHostile,'a partial/foreign-linked row is left byte-identical');

/* ---------- G) wiring ---------- */
const ui=fs.readFileSync(path.join(root,'js','address-book-ui.js'),'utf8');
assert.ok(ui.includes('function mtTicketAddressApply'),'the UI exposes one link entry point');
const editor=fs.readFileSync(path.join(root,'js','ticket-editor-domain.js'),'utf8');
assert.ok(editor.includes('mtTicketAddressApply(calcState)'),'the ticket editor links the saved ticket');
const profile=fs.readFileSync(path.join(root,'js','ticket-profile-editor.js'),'utf8');
assert.ok(profile.includes('mtTicketAddressApply(t)'),'the profile editor re-links every touched ticket');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.ok(html.includes('js/address-book-link.js'),'the 2B module is registered in index.html');
assert.ok(fs.readFileSync(path.join(root,'sw.js'),'utf8').includes('./js/address-book-link.js'),'the new modules are precached for offline boot');

console.log('PASS Stage 2B: additive ticket address links (identity, aliases, legacy safety, foreign ids, stale relink, backup and Sheets payload)');

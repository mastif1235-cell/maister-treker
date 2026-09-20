'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8').replace(/\r\n/g,'\n');
const source=read('js/ticket-profile-editor.js'),html=read('index.html');
assert.equal(crypto.createHash('sha256').update(source.slice(source.indexOf('// NEW: редагування')).trim()).digest('hex'),
  'd369a62fe145b76ac6b32426803f734648a2d91803973ed16834e87369f743f2');
assert.doesNotMatch(read('js/ticket-address-domain.js'),/function showEditAbonentProfile\(/);
assert.ok(html.indexOf('src="js/ticket-profile-editor.js"')>html.indexOf('src="js/ticket-address-domain.js"'));
assert.equal((read('sw.js').match(/'\.\/js\/ticket-profile-editor\.js'/g)||[]).length,1);
let elements={},opens=0,saves=0,renders=0,confirmed=false;
const data={ids:['a'],city:'City',street:'Street',house:'1',apartment:'2',clientName:'Client',phone:'123',note:'Note',login:'',password:'',contractNumber:''};
const fields={City:'city',Street:'street',House:'house',Apartment:'apartment',Name:'clientName',Phone:'phone',Note:'note',Login:'login',Password:'password',Contract:'contractNumber'};
const context={tickets:[{id:'a',city:'City',street:'Street',sum:10},{id:'b',city:'Other',sum:20}],settings:{cities:['City'],streets:{City:['Street']}},
  escapeHtml:s=>String(s),formatPhoneInput(){},renderAddressNav(){renders++;},confirm:()=>confirmed,openConfirmModal:async()=>confirmed,saveTickets(){saves++;},showToast(){},buildTicketContent:t=>t.clientName,
  document:{getElementById:id=>elements[id]||(elements[id]={value:'',innerHTML:'',events:{},addEventListener(type,fn){assert.equal(this.events[type],undefined,'one listener per modal element');this.events[type]=fn;}}),querySelectorAll:()=>[]},
  openModal(title,body,options){opens++;elements={};for(const [suffix,key] of Object.entries(fields))context.document.getElementById('abonentEdit'+suffix).value=data[key];options.onOpen();}
};
vm.createContext(context);vm.runInContext('let addrNavState = {};',context);vm.runInContext(source,context);
;(async()=>{
const before=JSON.stringify(context.tickets);
assert.equal(opens,0,'loading script does not open modal');
context.showEditAbonentProfile('invalid');assert.equal(opens,0);
context.showEditAbonentProfile(JSON.stringify(data));
assert.equal(JSON.stringify(context.tickets),before,'opening profile leaves data unchanged');
assert.match(elements.abonentEditCityDatalist.innerHTML,/City/);
assert.match(elements.abonentEditStreetDatalist.innerHTML,/Street/);
elements.abonentEditCity.value='Different';
await elements.abonentEditSaveBtn.events.click();
assert.equal(saves,0,'cancel address change performs no persistence');
assert.equal(JSON.stringify(context.tickets),before);
elements.abonentEditCity.value='City';elements.abonentEditName.value='Updated';
await elements.abonentEditSaveBtn.events.click();
assert.equal(saves,1);assert.equal(context.tickets[0].clientName,'Updated');
assert.equal(context.tickets[0].content,'Updated');assert.equal(context.tickets[1].city,'Other');
assert.equal(context.tickets[1].clientName,undefined);assert.equal(vm.runInContext('addrNavState.city',context),'City');
context.showEditAbonentProfile(JSON.stringify(data));
assert.equal(opens,2,'reopen creates new modal-scoped listeners, no script-level binding');
assert.equal(renders,1);
// Stage 2B: the same modal keeps or re-resolves the directory link per ticket,
// using the address BEFORE the edit as the baseline (rename-safe, foreign-safe).
const AB=require('../js/address-book'),LINK=require('../js/address-book-link');
if(!globalThis.crypto)globalThis.crypto=require('node:crypto').webcrypto;
const book=AB.fromLegacy({cities:['City'],streets:{City:['Street','Second']}});
const [cityId]=book.cities.map(c=>c.id),[streetId,secondId]=book.streets.map(s=>s.id);
context.mtTicketAddressApply=(ticket,previous)=>LINK.applyToTicket(ticket,book,previous);
const foreignPair={cityId:'0f9ae2f2-1111-4222-8333-444455556666',streetId:'0f9ae2f2-7777-4888-8999-aaaabbbbcccc'};
context.tickets=[{id:'a',city:'City',street:'Street',cityId,streetId,sum:10},{id:'c',city:'City',street:'Street',sum:5},{id:'f',city:'City',street:'Street',...foreignPair,sum:1},{id:'b',city:'Other',sum:20}];
const linkedData={...data,ids:['a','c','f']};
AB.update(book,'streets',streetId,{name:'Renamed Street'}); // rename without alias: text «Street» no longer resolves
context.showEditAbonentProfile(JSON.stringify(linkedData));
elements.abonentEditName.value='Renamed only';
await elements.abonentEditSaveBtn.events.click();
assert.deepEqual([context.tickets[0].cityId,context.tickets[0].streetId],[cityId,streetId],'unrelated profile edit keeps the pair even after a directory rename without alias');
assert.equal(context.tickets[1].cityId,undefined,'legacy ticket whose text no longer resolves is not guessed');
assert.deepEqual([context.tickets[2].cityId,context.tickets[2].streetId],[foreignPair.cityId,foreignPair.streetId],'foreign pair survives an unrelated edit');
assert.equal(context.tickets[0].street,'Street','historical text untouched');
context.showEditAbonentProfile(JSON.stringify(linkedData));
elements.abonentEditStreet.value='Second';confirmed=true;
await elements.abonentEditSaveBtn.events.click();
assert.deepEqual([context.tickets[0].cityId,context.tickets[0].streetId],[cityId,secondId],'address change re-resolves the street');
assert.deepEqual([context.tickets[1].cityId,context.tickets[1].streetId],[cityId,secondId],'legacy ticket gets the unique link of its new address');
assert.deepEqual([context.tickets[2].cityId,context.tickets[2].streetId],[cityId,secondId],'foreign pair is replaced when the address changes — it no longer describes this ticket');
assert.equal(context.tickets[3].cityId,undefined,'tickets outside the profile are untouched');
context.showEditAbonentProfile(JSON.stringify({...linkedData,street:'Second'}));
elements.abonentEditStreet.value='Nowhere';
await elements.abonentEditSaveBtn.events.click();
for(const index of [0,1,2])assert.deepEqual(['cityId' in context.tickets[index],'streetId' in context.tickets[index]],[false,false],`ticket ${index}: unknown street leaves no stale or invented UUID`);
assert.equal(context.tickets[0].street,'Nowhere');
console.log('PASS profile extraction: exact body, global API, modal lifecycle, lookups, cancel, matched-only save, Stage 2B links follow the address');
})().catch(error=>{console.error(error);process.exitCode=1;});

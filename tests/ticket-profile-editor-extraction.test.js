'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8').replace(/\r\n/g,'\n');
const source=read('js/ticket-profile-editor.js'),html=read('index.html');
assert.equal(crypto.createHash('sha256').update(source.slice(source.indexOf('// NEW: редагування')).trim()).digest('hex'),
  '0200c6e70a44ad22c64432372859d4837b1cb9f2450c93734522f0d3086c0036');
assert.doesNotMatch(read('js/ticket-address-domain.js'),/function showEditAbonentProfile\(/);
assert.ok(html.indexOf('src="js/ticket-profile-editor.js"')>html.indexOf('src="js/ticket-address-domain.js"'));
assert.equal((read('sw.js').match(/'\.\/js\/ticket-profile-editor\.js'/g)||[]).length,1);
let elements={},opens=0,saves=0,renders=0,confirmed=false;
const data={ids:['a'],city:'City',street:'Street',house:'1',apartment:'2',clientName:'Client',phone:'123',note:'Note',login:'',password:'',contractNumber:''};
const fields={City:'city',Street:'street',House:'house',Apartment:'apartment',Name:'clientName',Phone:'phone',Note:'note',Login:'login',Password:'password',Contract:'contractNumber'};
const context={tickets:[{id:'a',city:'City',street:'Street',sum:10},{id:'b',city:'Other',sum:20}],settings:{cities:['City'],streets:{City:['Street']}},
  escapeHtml:s=>String(s),formatPhoneInput(){},renderAddressNav(){renders++;},confirm:()=>confirmed,saveTickets(){saves++;},showToast(){},buildTicketContent:t=>t.clientName,
  document:{getElementById:id=>elements[id]||(elements[id]={value:'',innerHTML:'',events:{},addEventListener(type,fn){assert.equal(this.events[type],undefined,'one listener per modal element');this.events[type]=fn;}}),querySelectorAll:()=>[]},
  openModal(title,body,options){opens++;elements={};for(const [suffix,key] of Object.entries(fields))context.document.getElementById('abonentEdit'+suffix).value=data[key];options.onOpen();}
};
vm.createContext(context);vm.runInContext('let addrNavState = {};',context);vm.runInContext(source,context);
const before=JSON.stringify(context.tickets);
assert.equal(opens,0,'loading script does not open modal');
context.showEditAbonentProfile('invalid');assert.equal(opens,0);
context.showEditAbonentProfile(JSON.stringify(data));
assert.equal(JSON.stringify(context.tickets),before,'opening profile leaves data unchanged');
assert.match(elements.abonentEditCityDatalist.innerHTML,/City/);
assert.match(elements.abonentEditStreetDatalist.innerHTML,/Street/);
elements.abonentEditCity.value='Different';
elements.abonentEditSaveBtn.events.click();
assert.equal(saves,0,'cancel address change performs no persistence');
assert.equal(JSON.stringify(context.tickets),before);
elements.abonentEditCity.value='City';elements.abonentEditName.value='Updated';
elements.abonentEditSaveBtn.events.click();
assert.equal(saves,1);assert.equal(context.tickets[0].clientName,'Updated');
assert.equal(context.tickets[0].content,'Updated');assert.equal(context.tickets[1].city,'Other');
assert.equal(context.tickets[1].clientName,undefined);assert.equal(vm.runInContext('addrNavState.city',context),'City');
context.showEditAbonentProfile(JSON.stringify(data));
assert.equal(opens,2,'reopen creates new modal-scoped listeners, no script-level binding');
assert.equal(renders,1);
console.log('PASS profile extraction: exact body, global API, modal lifecycle, lookups, cancel, matched-only save');

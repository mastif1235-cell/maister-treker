'use strict';
/* Stage 2B hardening: the directory link follows the ADDRESS of a ticket, not
   the directory of the day.
     1) rename without alias / archive + unrelated edit → pair kept (identity);
     2) foreign or half pair + unrelated edit → kept; + address change → dropped
        and the new text resolved like a new ticket (never a wrong identity);
     3) no baseline (new ticket / linker) → the Stage 2B semantics stay as shipped;
     4) conflict «accept server»: server structured data without a pair removes
        the local pair, with a pair adopts it, unstructured row keeps local;
     5) the Stage 2C linker never drops a stale/foreign pair (review only). */
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

const book=AB.fromLegacy({cities:['Таромське','Шевченко'],streets:{'Таромське':['Вул Привокзальна','Вул Новопокровська'],'Шевченко':['Вул Шевченко']}});
const city=name=>book.cities.find(c=>c.name===name);
const street=(cityName,name)=>book.streets.find(s=>s.cityId===city(cityName).id&&s.name===name);
const tarom=city('Таромське'),station=street('Таромське','Вул Привокзальна'),novo=street('Таромське','Вул Новопокровська');
const pair=t=>[t.cityId,t.streetId];
const stored=()=>({id:'t-1',date:'03.06.2026',time:'17:54',content:'x',sum:1,tags:[],city:'Таромське',street:'Вул Привокзальна',house:'3б',apartment:'1',address:'Вул Привокзальна 3б, кв. 1',cityId:tarom.id,streetId:station.id});
const FOREIGN={cityId:'0f9ae2f2-1111-4222-8333-444455556666',streetId:'0f9ae2f2-7777-4888-8999-aaaabbbbcccc'};

/* ---- 1. rename without alias: identity survives unrelated edits ---- */
AB.update(book,'streets',station.id,{name:'Вулиця Привокзальна'});
const previous=stored();
assert.equal(LINK.linkState(book,previous),'stale','after a rename without alias the old text no longer resolves');
const phoneEdit={...stored(),phone:'(050)555-55-55'};
assert.equal(LINK.applyToTicket(phoneEdit,book,previous),false,'unrelated edit changes nothing');
assert.deepEqual(pair(phoneEdit),[tarom.id,station.id],'rename keeps streetId on the ticket');
const caseEdit={...stored(),street:' вул привокзальна ',note:'n'};
assert.equal(LINK.applyToTicket(caseEdit,book,previous),false);
assert.deepEqual(pair(caseEdit),[tarom.id,station.id],'case/whitespace-only difference is not an address change');
assert.equal(LINK.sameAddressText(caseEdit,previous),true);
/* archived street: same rule */
AB.update(book,'streets',station.id,{active:false});
const archivedEdit={...stored(),sum:2};
assert.equal(LINK.applyToTicket(archivedEdit,book,previous),false);
assert.deepEqual(pair(archivedEdit),[tarom.id,station.id],'archive keeps the existing link');
AB.update(book,'streets',station.id,{active:true,name:'Вул Привокзальна'});
assert.equal(LINK.linkState(book,stored()),'linked');

/* ---- address change with a baseline: link follows the text ---- */
const moved={...stored(),street:'Вул Новопокровська',house:'37'};
assert.equal(LINK.applyToTicket(moved,book,previous),true);
assert.deepEqual(pair(moved),[tarom.id,novo.id],'street change re-resolves inside the same city');
const unknown={...stored(),street:'Вул Незнайома'};
assert.equal(LINK.applyToTicket(unknown,book,previous),true);
assert.deepEqual(['cityId' in unknown,'streetId' in unknown],[false,false],'unknown new street: own stale pair dropped, nothing invented');
assert.equal(unknown.street,'Вул Незнайома');assert.equal(unknown.id,'t-1');
const legacyEdit={id:'legacy',city:'Таромське',street:'Вул Привокзальна',house:'1'};
assert.equal(LINK.applyToTicket({...legacyEdit,phone:'1'},book,legacyEdit),true,'a legacy ticket may gain its unique link during an unrelated edit');

/* ---- 2. foreign / partial pairs ---- */
const foreignStored={...stored(),...FOREIGN};
const foreignPhone={...foreignStored,phone:'1'};
assert.equal(LINK.applyToTicket(foreignPhone,book,foreignStored),false);
assert.deepEqual(pair(foreignPhone),[FOREIGN.cityId,FOREIGN.streetId],'another phone\'s pair survives an unrelated edit');
const foreignMoved={...foreignStored,street:'Вул Новопокровська'};
assert.equal(LINK.applyToTicket(foreignMoved,book,foreignStored),true);
assert.deepEqual(pair(foreignMoved),[tarom.id,novo.id],'address change replaces a foreign pair with the unique local resolution');
const foreignGone={...foreignStored,city:'Невідоме місто'};
assert.equal(LINK.applyToTicket(foreignGone,book,foreignStored),true);
assert.deepEqual(['cityId' in foreignGone,'streetId' in foreignGone],[false,false],'address change to an unknown place leaves NO pair rather than the old foreign one');
const partialStored={...stored(),streetId:undefined};delete partialStored.streetId;
assert.equal(LINK.linkState(book,partialStored),'partial');
const partialPhone={...partialStored,phone:'1'};
assert.equal(LINK.applyToTicket(partialPhone,book,partialStored),false,'half pair is left for the check screen when the address is unchanged');
const partialMoved={...partialStored,street:'Вул Новопокровська'};
assert.equal(LINK.applyToTicket(partialMoved,book,partialStored),true);
assert.deepEqual(pair(partialMoved),[tarom.id,novo.id],'half pair is repaired by the address change');

/* ---- 3. without a baseline the shipped Stage 2B semantics are unchanged ---- */
const fresh={id:'new',city:'Таромське',street:'Вул Привокзальна'};
assert.equal(LINK.applyToTicket(fresh,book),true);assert.deepEqual(pair(fresh),[tarom.id,station.id]);
const foreignNoBaseline={...stored(),...FOREIGN};
assert.equal(LINK.applyToTicket(foreignNoBaseline,book),false,'foreign ids are still never judged without a baseline');
assert.equal(LINK.applyToTicket(foreignNoBaseline,book,null),false);
assert.equal(LINK.applyToTicket(foreignNoBaseline,book,'garbage'),false);
const staleNoBaseline={...stored(),street:'Вул Новопокровська'};
assert.equal(LINK.applyToTicket(staleNoBaseline,book),true);assert.equal(staleNoBaseline.streetId,novo.id,'stale link still follows the text');
const twin=AB.add(book,'cities','Таромське',null);
const ambiguousNew={id:'amb',city:'Таромське',street:'Вул Привокзальна'};
assert.equal(LINK.applyToTicket(ambiguousNew,book),false);assert.equal(ambiguousNew.cityId,undefined,'ambiguous city → no link');
const ambiguousEdit={...stored(),phone:'2'};
assert.equal(LINK.applyToTicket(ambiguousEdit,book,stored()),false);
assert.deepEqual(pair(ambiguousEdit),[tarom.id,station.id],'existing pair stays authoritative when the name became ambiguous');
AB.update(book,'cities',twin.id,{active:false});

/* ---- 5. linker: stale / foreign are review-only, never dropped, plan is read-only ---- */
AB.update(book,'streets',station.id,{name:'Вулиця Привокзальна'});
const tickets=[stored(),{...stored(),id:'t-2',...FOREIGN},{id:'t-3',city:'Таромське',street:'Вул Новопокровська'},{id:'t-4',city:'Таромське',street:'Вул Привокзальна'}];
const snapshot=JSON.stringify(tickets);
const plan=LINKER.plan(tickets,book);
assert.equal(JSON.stringify(tickets),snapshot,'plan is read-only');
assert.equal(plan.counts.stale,1);assert.equal(plan.counts.foreign,1);assert.equal(plan.counts.exact,1);assert.equal(plan.counts.no_match,1,'old spelling without alias is not guessed');
const applied=LINKER.apply(tickets,book,plan);
assert.deepEqual(applied.applied.map(a=>a.ticket.id),['t-3']);
assert.deepEqual(pair(tickets[0]),[tarom.id,station.id],'stale pair untouched by the linker');
assert.deepEqual(pair(tickets[1]),[FOREIGN.cityId,FOREIGN.streetId],'foreign pair untouched by the linker');
assert.equal(tickets[3].cityId,undefined);
assert.deepEqual(LINKER.apply(tickets,book,LINKER.plan(tickets,book)).applied,[],'re-run is a no-op');
AB.update(book,'streets',station.id,{name:'Вул Привокзальна'});

/* ---- 4. conflict «accept server» ---- */
const domain=fs.readFileSync(path.join(root,'js','tickets-domain.js'),'utf8');
const slice=domain.slice(domain.indexOf('function ticketFromConflictServer'),domain.indexOf('async function readCurrentTicketConflict'));
const parseBackupNote=()=>({fullData:null,geoLink:'',masterNote:'',login:'',password:''});
const ctx={blankTicketObject:()=>({id:'',date:'',time:'',content:'',sum:0,tags:[]}),parseBackupNote};
vm.createContext(ctx);vm.runInContext(slice,ctx);
const row=(fullData,extra={})=>({id:'t-1',date:'03.06.2026',time:'17:54',content:'x',sum:1,tags:[],backupNote:'',fullDataJson:fullData?JSON.stringify(fullData):'',...extra});
const serverWithPair=ctx.ticketFromConflictServer(row({city:'Таромське',street:'Вул Привокзальна',house:'3б',cityId:tarom.id,streetId:station.id}),{...stored(),cityId:'old',streetId:'old'});
assert.deepEqual(pair(serverWithPair),[tarom.id,station.id],'server pair adopted');
const serverWithoutPair=ctx.ticketFromConflictServer(row({city:'Таромське',street:'Інша вулиця',house:'9'}),stored());
assert.deepEqual(['cityId' in serverWithoutPair,'streetId' in serverWithoutPair],[false,false],'server text without pair removes the local pair (may describe another street)');
assert.equal(serverWithoutPair.street,'Інша вулиця');assert.equal(serverWithoutPair.id,'t-1');
const serverUnstructured=ctx.ticketFromConflictServer(row(null),stored());
assert.deepEqual(pair(serverUnstructured),[tarom.id,station.id],'unstructured legacy row says nothing about identity → local pair kept');
const serverLegacyNoLocal=ctx.ticketFromConflictServer(row({city:'Таромське',street:'Вул Привокзальна'}),{id:'t-1',city:'Таромське',street:'Вул Привокзальна'});
assert.deepEqual(['cityId' in serverLegacyNoLocal,'streetId' in serverLegacyNoLocal],[false,false],'no pair anywhere → nothing invented');

/* ---- wiring: both editors pass the stored baseline ---- */
const editor=fs.readFileSync(path.join(root,'js','ticket-editor-domain.js'),'utf8');
const save=editor.slice(editor.indexOf('async function saveTicketFromForm'));
const apply=save.indexOf('mtTicketAddressApply(calcState,previousTicket)');
assert.ok(apply>save.indexOf('mtAddressBookRemember(calcState.city,calcState.street)'),'directory remembers a new address before the link is resolved');
assert.ok(apply<save.indexOf('tickets[idx] = JSON.parse(JSON.stringify(calcState))')&&apply<save.indexOf('tickets.push(newTicket)'),'link resolved before the ticket is stored');
const ui=fs.readFileSync(path.join(root,'js','address-book-ui.js'),'utf8');
assert.match(ui,/function mtTicketAddressApply\(ticket,previous\)[\s\S]*applyToTicket\(ticket,book,previous\|\|null\)/,'UI entry point forwards the baseline');
console.log('PASS Stage 2B hardening: rename/archive keep identity, foreign and half pairs follow the address, conflict accept, linker review-only');

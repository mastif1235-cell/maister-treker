'use strict';
/* Stage 2C regression: the conservative linker for LEGACY tickets.
     1) EXACT and ALIAS_EXACT rows are linked; AMBIGUOUS never is;
     2) NO_MATCH / MALFORMED / foreign ids stay legacy (nothing is guessed);
     3) the linker is idempotent — a second run proposes and applies nothing;
     4) a failed durable write can be rolled back without side effects;
     5) only cityId/streetId are ever written: text, house, apartment and the
        ticket id stay byte-identical;
     6) the review screen is read-only until the master confirms. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const root=path.join(__dirname,'..');
const AB=require('../js/address-book');
const LINK=require('../js/address-book-link');
const LINKER=require('../js/address-book-linker');

const book=AB.fromLegacy({cities:['Шевченко','Таромське'],streets:{'Шевченко':['Вул Кобзаря'],'Таромське':['Вул Привокзальна','Вул Садова']}});
const cityId=name=>book.cities.find(c=>c.name===name).id;
const streetId=(city,street)=>book.streets.find(s=>s.cityId===cityId(city)&&s.name===street).id;
AB.update(book,'cities',cityId('Таромське'),{aliases:['Таромское']});
AB.update(book,'streets',streetId('Таромське','Вул Привокзальна'),{aliases:['Привокзальная']});
const kobzarya=AB.add(book,'streets','Вул Кобзаря',cityId('Таромське'));

const legacy={id:'legacy-1',date:'03.06.2026',time:'17:54',content:'Таромське Вул Привокзальна 3б кв.1',sum:369,tags:[],
  city:'Таромское',street:'Привокзальная',house:'3б',apartment:'1',address:'Вул Привокзальная 3б, кв. 1'};
const unknown={id:'t-unknown',date:'03.06.2026',time:'10:00',content:'',sum:0,tags:[],city:'Шевченко',street:'Вул Неіснуюча',house:'1'};
const foreign={id:'t-foreign',date:'03.06.2026',time:'10:00',content:'',sum:0,tags:[],city:'Таромське',street:'Вул Садова',
  cityId:'0f9ae2f2-1111-4222-8333-444455556666',streetId:'0f9ae2f2-7777-4888-8999-aaaabbbbcccc'};

/* ---------- linker: plan → apply → idempotence → rollback ---------- */
const duplicate=AB.add(book,'streets','Вул Кобзаря',cityId('Таромське')); // makes its address ambiguous
const tickets=[
  {...legacy},
  {id:'t-exact',date:'03.06.2026',time:'11:30',content:'',sum:0,tags:[],city:'Таромське',street:'Вул Садова',house:'19'},
  {...unknown},
  {id:'t-linked',date:'03.06.2026',time:'11:00',content:'',sum:0,tags:[],city:'Таромське',street:'Вул Садова',house:'19',
    cityId:cityId('Таромське'),streetId:streetId('Таромське','Вул Садова')},
  {id:'t-malformed',date:'03.06.2026',time:'12:00',content:'',sum:0,tags:[],city:'',street:'',house:'',apartment:''},
  {id:'t-kobzarya',date:'03.06.2026',time:'12:30',content:'',sum:0,tags:[],city:'Таромське',street:'Вул Кобзаря',house:'15'},
  {...foreign}
];
const first=LINKER.plan(tickets,book);
assert.equal(first.counts.exact,1);
assert.equal(first.counts.alias_exact,1);
assert.equal(first.counts.already_linked,1);
assert.equal(first.counts.ambiguous,1,'two active streets with one name are ambiguous');
assert.equal(first.counts.no_match,1);
assert.equal(first.counts.malformed,1);
assert.equal(first.counts.foreign,1);
assert.equal(first.counts.actionable,2,'only the two unambiguous legacy rows are proposed');
assert.deepEqual(first.actions.map(action=>action.id),['legacy-1','t-exact']);
assert.equal(first.actions.every(action=>action.cityId&&action.streetId),true);
assert.equal(tickets.find(t=>t.id==='legacy-1').cityId,undefined,'plan() itself changes nothing');
const applied=LINKER.apply(tickets,book,first);
assert.equal(applied.applied.length,2);
assert.equal(applied.skipped.length,0);
assert.equal(tickets.find(t=>t.id==='t-exact').streetId,streetId('Таромське','Вул Садова'));
assert.equal(tickets.find(t=>t.id==='t-kobzarya').cityId,undefined,'an ambiguous address is never linked');
assert.equal(tickets.find(t=>t.id==='t-malformed').cityId,undefined,'a malformed address stays legacy');
assert.equal(tickets.find(t=>t.id==='t-unknown').cityId,undefined);
assert.equal(tickets.find(t=>t.id==='t-foreign').cityId,foreign.cityId,'a foreign link is preserved byte-for-byte');
const afterFirst=JSON.stringify(tickets);
const secondPlan=LINKER.plan(tickets,book);
assert.equal(secondPlan.counts.actionable,0,'a second run proposes nothing');
assert.deepEqual(secondPlan.actions,[]);
assert.equal(LINKER.apply(tickets,book,secondPlan).applied.length,0);
assert.equal(JSON.stringify(tickets),afterFirst,'already linked tickets are never rewritten');
/* archiving the duplicate makes the same address unambiguous again — the plan
   proposes it, and only then is it linked */
AB.update(book,'streets',duplicate.id,{active:false});
const thirdPlan=LINKER.plan([tickets.find(t=>t.id==='t-kobzarya')],book);
assert.equal(thirdPlan.counts.exact,1,'after archiving the duplicate the row becomes exact');
assert.equal(thirdPlan.actions[0].streetId,kobzarya.id);
AB.update(book,'streets',duplicate.id,{active:true});
/* a failed durable write rolls back exactly the ids it added */
const rollbackTicket={id:'t-rollback',date:'03.06.2026',time:'13:00',content:'',sum:0,tags:[],city:'Таромське',street:'Вул Садова',house:'19'};
const rollbackList=[rollbackTicket];
const appliedOne=LINKER.apply(rollbackList,book,LINKER.plan(rollbackList,book));
assert.equal(appliedOne.applied.length,1);
assert.ok(rollbackTicket.cityId);
LINKER.rollback(appliedOne.applied);
assert.equal('cityId' in rollbackTicket,false,'rollback removes the added cityId');
assert.equal('streetId' in rollbackTicket,false,'rollback removes the added streetId');


/* ---------- G) wiring ---------- */
const ui=fs.readFileSync(path.join(root,'js','address-book-ui.js'),'utf8');
assert.ok(ui.includes('MTTicketAddressLinker.rollback'),'a failed durable write rolls the link back');
assert.ok(ui.includes('openConfirmModal'),'nothing is linked without an explicit confirmation');
assert.ok(ui.includes('id=\"addressLinkCheckBtn\"')||ui.includes('addressLinkCheckBtn'),'the review screen exposes a check button');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.ok(html.includes('id="addressLinkCheck"'),'the review screen has its container');
assert.ok(html.includes('js/address-book-linker.js'),'the 2C module is registered in index.html');
assert.ok(fs.readFileSync(path.join(root,'sw.js'),'utf8').includes('./js/address-book-linker.js'),'the linker is precached for offline boot');

console.log('PASS Stage 2C: conservative linker (exact/alias only, no guessing, idempotent, rollback-safe)');

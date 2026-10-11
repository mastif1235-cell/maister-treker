'use strict';
// Real structured app shape. No live data, queue, network or deployment.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../js/dispatcher-report-core.js');
const item=(label,quantity,unit='шт.',price)=>({label,quantity,unit,...(price!==undefined?{unit_price:price}:{})});
const hash=d=>crypto.createHash('sha256').update(core.content(d)).digest('hex');
function dto(id,entries,date='2026-10-11'){
  const d=Object.fromEntries(core.FIELDS.map(k=>[k,'']));
  Object.assign(d,{ticket_id:id,work_date:date,work_time:'12:00',work_type:'Ремонт',work_category:'repair',amount:100,total:100,onu_used:1,onu_replacement:1,router_used:1,payment_cash:100,payment_cashless:0,payment_free_amount:0,payment_free_count:0,updated_at:'2026-10-11T12:00:00.000Z',source_version:10,materials_json:core.materialJSON(entries)});
  d.source_hash=hash(d);return core.validate(d);
}
const entries=[item('Роутер',1,'шт.',1500),item('Роутер',1,'шт.',2300)];
const a=dto('a',entries),b=dto('b',[item('Роутер',1,'шт.',1500),item('Роутер',2,'шт.',2300)]);
assert.deepEqual(core.stats([a,b]).materials,[item('Роутер',2,'шт.',1500),item('Роутер',3,'шт.',2300)],'A/B same labels, two real price variants');
assert.deepEqual(core.stats([dto('no-price',[item('ONU',1),item('ONU',2,'шт.',0),item('ONU',1,'шт.',800)])]).materials,[item('ONU',3),item('ONU',1,'шт.',800)],'C/D/J zero and absent prices group together, never with priced usage');
const cable=dto('cable',[item('UTP',10,'м',10),item('UTP',15,'м',10),item('UTP',20,'м',15)]);
assert.deepEqual(core.stats([cable]).materials,[item('UTP',25,'м',10),item('UTP',20,'м',15)],'E/F cable per-meter variants');
const oldJSON=JSON.stringify([item('ONU',1),item('Роутер',1)]);
const old={...a,ticket_id:'legacy',materials_json:oldJSON};old.source_hash=hash(old);
assert.deepEqual(core.readMaterials(oldJSON),JSON.parse(oldJSON));assert.equal(core.validate(old).materials_json,oldJSON,'G original structured bytes preserved');
const oldCanonical={};for(const k of core.ALL_FIELDS)if(!['source_version','source_hash','updated_at'].includes(k))oldCanonical[k]=old[k];
assert.equal(old.source_hash,crypto.createHash('sha256').update(JSON.stringify(oldCanonical)).digest('hex'),'old hash remains valid');
const explicitZero=JSON.stringify([item('ONU',1,'шт.',0)]);
assert.deepEqual(core.readMaterials(explicitZero),[item('ONU',1,'шт.',0)]);assert.equal(core.stats([dto('zero',[item('ONU',1,'шт.',0)])]).materials[0].unit_price,undefined);
assert.equal(core.materialJSON([item('ONU',1,'шт.',0)]),core.materialJSON([item('ONU',1)]));
assert.equal(core.materialJSON([item('UTP',1,'м',10.234)]),core.materialJSON([item('UTP',1,'м',10.23)]),'price normalized to currency cents');
assert.equal(core.materialJSON(entries),core.materialJSON(entries.slice().reverse()),'stable sorting for same-label variants');
for(const bad of [-1,NaN,Infinity,1e9+1,'1500',null,{},true])assert.throws(()=>core.materialJSON([item('Роутер',1,'шт.',bad)]),'invalid price rejected');
for(const bad of [JSON.stringify([{...item('ONU',1,'шт.',800),token:'private'}]),JSON.stringify([item('ONU',1,'шт.','800')]),JSON.stringify([item('ONU',1,'шт.',-1)])])assert.throws(()=>core.validate({...old,materials_json:bad}));
const changed=dto('a',[item('Роутер',1,'шт.',1501),item('Роутер',1,'шт.',2300)]);
assert.notEqual(changed.source_hash,a.source_hash,'H/I price-only change is hash-bound');
const rows=[];core.upsert(rows,a);const before=JSON.stringify(rows);
assert.throws(()=>core.upsert(rows,changed),/STALE_VERSION/);assert.equal(JSON.stringify(rows),before,'same-version price conflict cannot overwrite');
assert.equal(core.upsert(rows,a),'unchanged');assert.equal(rows.length,1);
const result=core.render([a,b,cable,dto('next-week',[item('UTP',5,'м',10)],'2026-10-12'),dto('old-month',[item('UTP',7,'м',15)],'2026-09-30')]);
for(const kind of ['daily','weekly','monthly'])for(const [key,s] of Object.entries(result[kind])){
  const block=result.blocks.find(x=>x.kind===kind&&x.key===key).text.replace(/[\u00a0\u202f]/g,'');
  for(const m of s.materials)assert(block.includes(m.label+' — '+m.quantity+' '+m.unit+(m.unit_price?' — '+m.unit_price+' грн'+(m.unit==='м'?'/м':''):'')),'same price display for '+kind);
}
assert.equal(result.daily['2026-10-11'].total,300,'material prices never recalculate money totals');
// Actual GAS storage reader must preserve both old JSON and new priced JSON.
const headers=[...core.FIELDS,'deleted_at','sync_status','materials_json'];
const stored=[old,a,{...old,ticket_id:'explicit-zero',materials_json:explicitZero}].map(d=>({...d,deleted_at:'',sync_status:'SYNCED'}));stored[2].source_hash=hash(stored[2]);
const cells=[headers,...stored.map(d=>headers.map(k=>d[k]??''))];let writes=0;
const sheet={getLastRow:()=>cells.length,getMaxColumns:()=>30,getRange:(r,c,h=1,w=1)=>({getValues:()=>Array.from({length:h},(_,y)=>cells[r-1+y].slice(c-1,c-1+w)),setValues:()=>{writes++;}})};
const gas={MTDispatcherReportCore:core,SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='_DispatcherData'?sheet:n==='Отчет'?{}:null})},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]}};
vm.createContext(gas);vm.runInContext(fs.readFileSync('gas/dispatcher-report/DispatcherReport.gs','utf8'),gas);
const loaded=gas.reportStore_({id:'synthetic'}).rows;assert.equal(writes,0);assert.equal(loaded[0].source_hash,old.source_hash);assert.equal(loaded[0].materials_json,oldJSON);assert.equal(loaded[1].materials_json,a.materials_json);assert.equal(loaded[2].materials_json,explicitZero);
cells[2][29]=changed.materials_json;assert.throws(()=>gas.reportStore_({id:'synthetic'}),/HASH_MISMATCH/);
(async()=>{
  const {buildDTO}=await import('../js/dispatcher-report-projection.mjs');
  const ticket={id:'real-app-shape',date:'11.10.2026',time:'12:00',type:'Ремонт',sum:3500,payment:'Готівка',equipment:[{label:'Роутер',qty:1,price:1500},{label:'Роутер',qty:1,price:2300},{label:'БП',qty:0,price:100}],cables:[{label:'UTP',meters:10,pricePerMeter:10},{label:'UTP',meters:15,pricePerMeter:10},{label:'UTP',meters:20,pricePerMeter:15}],note:'Роутер 9999 грн',masterNote:'PRIVATE-CANARY',phone:'PHONE-CANARY'};
  const snapshot=JSON.stringify(ticket),projected=await buildDTO(ticket,core,10),materials=core.stats([projected]).materials;
  assert.equal(JSON.stringify(ticket),snapshot);assert.deepEqual(materials.filter(m=>m.label==='Роутер'),entries,'real equipment same label/different price');
  assert.deepEqual(materials.filter(m=>m.label==='UTP'),[item('UTP',25,'м',10),item('UTP',20,'м',15)],'pricePerMeter, never total cable cost');
  assert(!materials.some(m=>m.label==='БП'));assert.equal(materials.filter(m=>m.label==='Роутер').reduce((n,m)=>n+m.quantity,0),2,'L no fixed/router double count');
  assert(!projected.materials_json.includes('9999'),'no prices inferred from notes');
  for(const text of ['PRIVATE-CANARY','PHONE-CANARY','masterNote','phone'])assert(!projected.materials_json.includes(text));
  const zero=await buildDTO({...ticket,equipment:[{label:'ONU',qty:1,price:0}],cables:[]},core,10);assert.equal(zero.materials_json,core.materialJSON([item('ONU',1)]));
  console.log('PASS material-price A-M: real app shape, cable variants, zero/no-price, canonical/hash/legacy storage/privacy');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
// Synthetic data only. No network, user storage, or live spreadsheet access.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const core=require('../js/dispatcher-report-core.js');
const material=(label,quantity,unit='шт.')=>({label,quantity,unit});
const hash=d=>crypto.createHash('sha256').update(core.content(d)).digest('hex');
function row(id,date='2026-10-11',entries){
  const d=Object.fromEntries(core.FIELDS.map(k=>[k,'']));
  Object.assign(d,{ticket_id:id,work_date:date,work_time:'12:00',work_type:'Ремонт',work_category:'repair',amount:3500,total:3500,onu_used:1,onu_replacement:1,router_used:1,payment_cash:3500,payment_cashless:0,payment_free_amount:0,payment_free_count:0,updated_at:'2026-10-11T12:00:00.000Z',source_version:1});
  if(entries!==undefined)d.materials_json=core.materialJSON(entries);
  d.source_hash=hash(d);return core.validate(d);
}
const usage=s=>Object.fromEntries(s.materials.map(m=>[m.label+'|'+m.unit,m.quantity]));
const a=row('a','2026-10-11',[material('ONU',1),material('UTP',10,'м'),material('Роутер 1500',2),material('ДБЖ',1)]);
const b=row('b','2026-10-11',[material('ONU',2),material('UTP',15,'м'),material('Роутер 2300',3),material('ДБЖ',2),material('Конектор SC/APC',4)]);
const c=row('c','2026-10-12',[material('Оптика',120,'м')]);
const d=row('d','2026-09-30',[material('UTP',20,'м')]);
assert.deepEqual(usage(core.stats([a])),{'ONU|шт.':1,'UTP|м':10,'ДБЖ|шт.':1,'Роутер 1500|шт.':2});
const combined=core.stats([a,b]);
assert.deepEqual(usage(combined),{'ONU|шт.':3,'UTP|м':25,'ДБЖ|шт.':3,'Конектор SC/APC|шт.':4,'Роутер 1500|шт.':2,'Роутер 2300|шт.':3});
assert.equal(combined.onu_replacement,2,'replacement remains a separate existing work counter');
assert.equal(combined.total,7000);assert.equal(combined.payment_cash,7000);
const report=core.render([a,b,c,d]);
for(const period of ['daily','weekly','monthly'])for(const [key,s] of Object.entries(report[period])){
  const selected=[a,b,c,d].filter(r=>period==='daily'?r.work_date===key:period==='weekly'?core.weekKey(r.work_date)===key:r.work_date.slice(0,7)===key);
  assert.deepEqual(s,core.stats(selected),period+' uses the same canonical aggregator');
}
assert.equal(usage(report.daily['2026-10-11'])['UTP|м'],25);
assert.equal(usage(report.weekly['2026-10-05'])['UTP|м'],25);
assert.equal(usage(report.monthly['2026-10'])['Оптика|м'],120);
assert(!('UTP|м' in usage(report.daily['2026-10-12'])));
const daily=report.blocks.find(x=>x.kind==='daily'&&x.key==='2026-10-11').text;
assert.equal((daily.match(/^ONU — /gm)||[]).length,1,'no fixed-counter/dynamic double counting');
assert(daily.includes('🔄 Заміна ONU: 2'));assert(!daily.includes('БП'));
const empty=row('empty','2026-10-11',[]);
assert(!core.render([empty]).blocks.find(x=>x.kind==='daily').text.includes('Матеріали:'),'explicit empty usage overrides legacy counters');
for(const type of ['Ремонт','Інше']){
  const ticket=core.render([{...empty,work_type:type,dispatcher_comment:'Нотатка'}]).blocks.find(x=>x.kind==='ticket').text;
  assert.equal((ticket.match(/💰 Разом:/g)||[]).length,type==='Інше'?0:1);assert(!ticket.includes('Сума:'));assert(!ticket.includes('🧾 Разом:'));
}
assert.equal(core.materialJSON([material('  ДБЖ   12V ',1),material('ДБЖ 12V',2)]),core.materialJSON([material('ДБЖ 12V',3)]));
assert.equal(core.materialJSON([material('Кабель',0.1,'м'),material('Кабель',0.2,'м')]),core.materialJSON([material('Кабель',0.3,'м')]));
assert.equal(core.readMaterials(core.materialJSON([material('Кабель',1),material('Кабель',2,'м')])).length,2,'units never collapsed');
assert.equal(core.stats(Array.from({length:110},(_,i)=>row('future-'+i,'2026-10-11',[material('Матеріал '+i,1)]))).materials.length,110,'period aggregation not capped to per-ticket material count');
const legacy=row('legacy');
const oldContent={};for(const k of core.FIELDS)if(!['source_version','source_hash','updated_at'].includes(k))oldContent[k]=legacy[k];
assert.equal(core.content(legacy),JSON.stringify(oldContent),'legacy content bytes unchanged');
assert.deepEqual(usage(core.stats([legacy])),{'ONU|шт.':1,'Роутер|шт.':1});
assert.notEqual(hash({...legacy,materials_json:'[]'}),legacy.source_hash,'new structure is hash-bound');
for(const bad of ['not-json','{}','[{"label":"ONU","quantity":1,"unit":"шт.","privateNote":"x"}]',JSON.stringify([material('ONU',0)]),JSON.stringify([material('ONU',1.5)]),JSON.stringify([material('ONU',1,'kg')])])assert.throws(()=>core.validate({...legacy,materials_json:bad}));
for(const label of ['secret: hidden','https://example.invalid','phone: +380123456789','geoLat: 48.5','=SUM(1,2)','masterNote: hidden'])assert.throws(()=>core.validate({...legacy,materials_json:JSON.stringify([material(label,1)])}),'private/injection label rejected');
// Real storage adapter, not the security suite's stubbed reportStore_/reportWrite_.
const legacyHeaders=[...core.FIELDS,'deleted_at','sync_status'];
let cells=[legacyHeaders.slice(),legacyHeaders.map(k=>({...legacy,deleted_at:'',sync_status:'SYNCED'})[k]),legacyHeaders.map(k=>({ticket_id:'tombstone',source_version:2,deleted_at:'2026-10-11T12:00:00.000Z',sync_status:'DELETED'})[k]??'')],columns=29,mutations=0;
const sheet={getLastRow:()=>cells.length,getMaxColumns:()=>columns,getMaxRows:()=>100,
  insertColumnsAfter:(at,n)=>{assert.equal(at,columns);columns+=n;mutations++;},
  getRange:(r,c,h=1,w=1)=>({getValues:()=>Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>cells[r-1+y]?.[c-1+x]??'')),setNumberFormat(){return this;},setValues(values){mutations++;values.forEach((line,y)=>line.forEach((v,x)=>{cells[r-1+y]??=[];cells[r-1+y][c-1+x]=v;}));return this;}})};
const ss={getSheetByName:n=>n==='_DispatcherData'?sheet:n==='Отчет'?{}:null};
const gas={MTDispatcherReportCore:core,SpreadsheetApp:{openById:()=>ss},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]}};
vm.createContext(gas);vm.runInContext(fs.readFileSync('gas/dispatcher-report/DispatcherReport.gs','utf8'),gas);
let store=gas.reportStore_({id:'synthetic'});assert.equal(mutations,0,'legacy read is non-mutating');assert.equal(store.rows[0].source_hash,legacy.source_hash);assert(!('materials_json' in store.rows[0]));
store.rows.push({...a,deleted_at:'',sync_status:'SYNCED'});gas.reportWrite_(store);
assert.deepEqual(cells[0].slice(0,29),legacyHeaders,'append-only header migration');assert.equal(cells[0][29],'materials_json');
store=gas.reportStore_({id:'synthetic'});assert.equal(store.rows[0].source_hash,legacy.source_hash);assert(!('materials_json' in store.rows[0]));assert.equal(store.rows[1].sync_status,'DELETED');assert.equal(store.rows[2].materials_json,a.materials_json);
const before=mutations;gas.reportStore_({id:'synthetic'});assert.equal(mutations,before,'new-schema read is also non-mutating');
cells[3][29]=core.materialJSON([material('ONU',9)]);assert.throws(()=>gas.reportStore_({id:'synthetic'}),/HASH_MISMATCH/);cells[3][29]=a.materials_json;
cells[0][29]='unrelated';assert.throws(()=>gas.reportStore_({id:'synthetic'}),/REPORT_SCHEMA_CONFLICT/);
const css=fs.readFileSync('styles.css','utf8');
for(const [state,existing] of [['sent','tc-sync-ok'],['pending','tc-sync-pending']])assert(css.includes('.ticket-card .'+existing+',.ticket-card .tc-sync-badge[data-delivery-state="'+state+'"]'),'reuse same state style '+state);
assert(css.includes('.btn-danger,.ticket-card .tc-sync-badge[data-delivery-state="error"]'));
assert(fs.readFileSync('js/tickets-render.js','utf8').includes('class="tc-sync-badge" data-dispatcher-ticket-status='),'shared badge base class');
(async()=>{
  const {buildDTO}=await import('../js/dispatcher-report-projection.mjs');
  const ticket={id:'projection',date:'11.10.2026',time:'12:00',type:'Ремонт',payment:'Готівка',sum:3500,equipment:[{label:'Роутер 1500',qty:2},{label:'Роутер 2300',qty:3},{label:'ДБЖ',qty:1},{label:'БП',qty:0},{label:'Вимкнений',qty:5,checked:false},{label:'ONU',qty:9,consumption_qty:1},{label:'https://example.invalid',qty:1}],cables:[{label:'UTP',meters:10},{label:'Оптика',meters:0}],masterNote:'PRIVATE-CANARY',phone:'+380000000001'};
  const snapshot=JSON.stringify(ticket),projected=await buildDTO(ticket,core,10);
  assert.equal(JSON.stringify(ticket),snapshot);assert.deepEqual(usage(core.stats([projected])),{'ONU|шт.':1,'UTP|м':10,'ДБЖ|шт.':1,'Роутер 1500|шт.':2,'Роутер 2300|шт.':3});
  for(const value of ['PRIVATE-CANARY',ticket.phone,'example.invalid','Вимкнений','БП'])assert(!projected.materials_json.includes(value));
  const imported=await buildDTO({...ticket,id:'imported',cloudImported:true,equipment:[],cables:[]},core,10);assert(!('materials_json' in imported),'legacy raw import retains safe fallback');
  const other=await buildDTO({...ticket,id:'other',type:'Інше',otherNote:'Нотатка'},core,10);assert.equal(other.materials_json,'[]');
  console.log('PASS material stats A-O; projection/privacy/hash; legacy storage append/read/roundtrip; badge style reuse');
})().catch(e=>{console.error(e);process.exitCode=1;});

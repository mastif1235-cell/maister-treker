'use strict';
const assert=require('node:assert/strict');
const core=require('../js/dispatcher-report-core.js');
(async()=>{
const {buildDTO,confirmedRepairOnuCount,previewHistoricalOnuCorrection,HISTORICAL_ONU_CORRECTION_IDS}=await import('../js/dispatcher-report-projection.mjs');

const base={date:'18.08.2026',time:'12:00',type:'Ремонт',sum:800,payment:'Готівка',note:'',equipment:[],cables:[]};
const record=(id,patch={})=>({ticket_id:id,work_category:'repair',onu_used:0,onu_replacement:0,...patch});

// A: an old free-text replacement heuristic is fully masked by NO_ONU.
const noOnu=await buildDTO({...base,id:'1778579833958',content:'Поменял ONU, поставил блок питания'},core,100);
assert.equal(noOnu.onu_used,0);assert.equal(noOnu.onu_replacement,0);

// B: explicit OUR_ONU is enough even when parser/equipment have no evidence.
const ourOnu=await buildDTO({...base,id:'1787044186198',content:'Поставил ону бесплатно'},core,101);
assert.equal(ourOnu.onu_used,1);assert.equal(ourOnu.onu_replacement,0);

// C: an absent override preserves the existing parser behavior exactly.
const withoutOverride=await buildDTO({...base,id:'1778579833958',content:'Поменял ONU'},core,100,{});
assert.equal(withoutOverride.onu_used,1);assert.equal(withoutOverride.onu_replacement,1);

// D: a manual NO_ONU decision wins over selected structured equipment too.
const structuredButNo=await buildDTO({...base,id:'1776093623146',equipment:[{label:'ONU',checked:true,qty:1}]},core,102);
assert.equal(structuredButNo.onu_used,0);assert.equal(structuredButNo.onu_replacement,0);
assert.equal(core.readMaterials(structuredButNo.materials_json).filter(x=>core.isOnuEquipment(x)).length,1,'override changes the physical counter only');

// E: UNKNOWN decisions and parser-only guesses do not enter confirmed count.
assert.equal(confirmedRepairOnuCount([
  record('cca10ba0-41a2-4571-ac3c-02b57e2a19bc',{onu_used:1}),
  record('1774458317609',{onu_used:1}),
  record('parser-only',{onu_used:1,materials_display:'',materials_json:'[]'})
],core),0);
const unknownProjection=await buildDTO({...base,id:'cca10ba0-41a2-4571-ac3c-02b57e2a19bc',content:'Поменял ONU'},core,102);
assert.equal(unknownProjection.onu_used,1);assert.equal(unknownProjection.onu_replacement,1,'UNKNOWN is not a physical override');

// F: 27 active + 2 missing structured rows = the same 29 structured records;
// add five exact legacy lines and one manually confirmed ticket. NO/UNKNOWN
// rows are excluded and a duplicate ticket id is counted once.
const structured=Array.from({length:27},(_,i)=>record('structured-'+i,{equipment:[{label:'ONU',checked:true,qty:1}]}));
const missingStructured=['1786990035908','1786951228806'].map(id=>record(id,{equipment:[{label:'ONU',checked:true,qty:1}]}));
const legacy=Array.from({length:5},(_,i)=>record('legacy-'+i,{materials_display:'ONU — 1 шт. — 800 грн'}));
const countFixture=[...structured,...missingStructured,...legacy,record('1787044186198'),
  record('1778579833958',{onu_used:1}),record('1776093623146',{onu_used:1}),
  record('cca10ba0-41a2-4571-ac3c-02b57e2a19bc',{onu_used:1}),record('1774458317609',{onu_used:1}),
  missingStructured[0]];
assert.equal(confirmedRepairOnuCount(countFixture,core),35);

// G/H: override projection does not recalculate money; repeat projection at
// the same source version yields the same hash/content for idempotency.
const sumBefore=base.sum;
const sameA=await buildDTO({...base,id:'1787044186198'},core,103),sameB=await buildDTO({...base,id:'1787044186198'},core,103);
assert.equal(sameA.total,sumBefore);assert.equal(sameA.amount,sumBefore);assert.equal(base.sum,sumBefore);
assert.equal(sameA.source_hash,sameB.source_hash);assert.equal(core.content(sameA),core.content(sameB));

// Dry-run is canonical-ticket-only, read-only, and restricted to the two
// manually approved IDs/dates/current parser values. It never returns a DTO.
const corrections=[
  {...base,id:'1778579833958',date:'12.05.2026',time:'12:57',sum:1600,content:'Поменял ONU, поставил блок питания'},
  {...base,id:'1776093623146',date:'13.04.2026',time:'18:20',sum:300,content:'ONU куплена клиентом'}
];
const snapshot=JSON.stringify(corrections),preview=await previewHistoricalOnuCorrection(corrections,core,300);
assert.deepEqual([...HISTORICAL_ONU_CORRECTION_IDS],['1778579833958','1776093623146']);
assert.equal(JSON.stringify(corrections),snapshot,'dry-run leaves canonical tickets untouched');
assert.deepEqual(preview.map(x=>[x.ticket_id,x.date,x.time,x.before.onu_used,x.before.onu_replacement,x.after.onu_used,x.after.onu_replacement,x.before.total,x.after.total]),[
  ['1778579833958','2026-05-12','12:57',1,1,0,0,1600,1600],
  ['1776093623146','2026-04-13','18:20',1,0,0,0,300,300]
]);
await assert.rejects(()=>previewHistoricalOnuCorrection([...corrections,{...corrections[0]}],core,301),/HISTORICAL_DUPLICATE_LOCAL_TICKET/);
await assert.rejects(()=>previewHistoricalOnuCorrection([corrections[0]],core,301),/HISTORICAL_TICKET_NOT_FOUND/);
await assert.rejects(()=>previewHistoricalOnuCorrection(corrections.map(t=>({...t,id:'1786990035908'})),core,301),/HISTORICAL_TICKET_NOT_FOUND/);

console.log('PASS historical ONU overrides, confirmed count and read-only addressed projection');
})().catch(error=>{console.error(error);process.exitCode=1;});

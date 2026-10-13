'use strict';
const assert=require('node:assert/strict');
const core=require('../js/dispatcher-report-core.js');
(async()=>{
const {buildDTO,confirmedRepairOnuCount,prepareAddressedHistoricalUpsert}=await import('../js/dispatcher-report-projection.mjs');

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

// Missing-row preparation uses the ordinary canonical projection, preserves
// ticket id/saved sum, and returns a request envelope without writing/sending.
const missing={...base,id:'1786990035908',sum:1400,equipment:[{label:'ONU',checked:true,qty:1}]};
const snapshot=JSON.stringify(missing),prepared=await prepareAddressedHistoricalUpsert(missing,core,200,'request-test-1');
assert.equal(JSON.stringify(missing),snapshot);assert.equal(prepared.action,'report_upsert');
assert.equal(prepared.request_id,'request-test-1');assert.equal(prepared.tickets[0].ticket_id,missing.id);
assert.equal(prepared.tickets[0].total,1400);assert.equal(prepared.tickets[0].source_version,200);
assert.match(prepared.tickets[0].source_hash,/^[a-f\d]{64}$/);
await assert.rejects(()=>prepareAddressedHistoricalUpsert({...missing,id:'unrelated'},core,201,'request-test-2'),/HISTORICAL_TICKET_NOT_ALLOWLISTED/);
const secondMissing={...missing,id:'1786951228806',sum:800};
const secondPrepared=await prepareAddressedHistoricalUpsert(secondMissing,core,202,'request-test-3');
assert.equal(secondPrepared.tickets[0].ticket_id,secondMissing.id);assert.equal(secondPrepared.tickets[0].total,800);

console.log('PASS historical ONU overrides, confirmed count and read-only addressed projection');
})().catch(error=>{console.error(error);process.exitCode=1;});

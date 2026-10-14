'use strict';
const assert=require('node:assert/strict');
const core=require('../js/dispatcher-report-core.js');
(async()=>{
const {classifyConnectionOnu,projectTicket,dryRunHistoricalOnu}=await import('../js/dispatcher-report-projection.mjs');

const base={id:'conn',date:'13.10.2026',time:'12:00',type:'Підключення',sum:800,payment:'Готівка',equipment:[],cables:[]};
const classify=t=>classifyConnectionOnu({...base,...t},core);

// Modern selected checkbox wins even if stale prose says customer-owned.
assert.equal(classify({equipment:[{id:'onu',label:'ONU',checked:true}],note:'ONU клиента'}).classification,'OUR_ONU_EXPLICIT');
assert.equal(classify({equipment:[{id:'onu',label:'ONU',checked:false}]}).classification,'CUSTOMER_ONU_EXPLICIT');

// RU/UA explicit ownership patterns, with safe snippets limited to the match.
for(const note of ['Своя ONU','Поставили его ONU','сам купил ONU','ONU клиента','ONU абонента','власна ONU','ONU користувача']){
  const result=classify({equipment:undefined,note});
  assert.equal(result.classification,'CUSTOMER_ONU_EXPLICIT',note);
  assert.equal(result.onu_connection,0,note);
  assert.equal(result.evidence.toLowerCase().includes('телефон'),false);
}

// No ownership clue uses the approved default only for legacy/imported data.
assert.equal(classify({equipment:undefined,cloudImported:true,note:'Подключение'}).classification,'LEGACY_PROVABLE_OUR_ONU');
assert.equal(classify({equipment:[],cloudImported:false,note:'Подключение'}).classification,'UNKNOWN');
assert.equal(classify({equipment:undefined,cloudImported:true,note:'ONU не своя'}).classification,'LEGACY_PROVABLE_OUR_ONU','negated ownership is not a customer-ONU match');

const canonical={...base,equipment:undefined,cloudImported:true,note:'Обычное подключение'};
const dto=projectTicket(canonical,core,100);
assert.equal(dto.onu_used,1);
assert.equal(dto.total,800,'legacy classification must preserve ticket.sum');

const fixture=[
  {...base,id:'legacy-our',date:'13.10.2026',equipment:undefined,cloudImported:true,note:'Обычное подключение'},
  {...base,id:'customer',date:'13.10.2026',equipment:undefined,cloudImported:true,note:'Клиент сам купил ONU; телефон +380501234567'},
  {...base,id:'unknown',date:'13.10.2026',equipment:[],cloudImported:false,note:'Подключение'},
  {...base,id:'repair-onu',date:'13.10.2026',type:'Ремонт',equipment:[{id:'onu',label:'ONU',checked:true,qty:1}],note:''}
];
const dryRun=dryRunHistoricalOnu(fixture,core);
assert.deepEqual(JSON.parse(JSON.stringify(dryRun.months)),[{
  month:'2026-10',connections_total:3,connection_our_onu:1,connection_customer_onu:1,connection_unknown:1,repair_onu:1,total_physical_onu:2
}]);
assert.equal(dryRun.customerOnuTickets.length,1);
assert.equal(dryRun.customerOnuTickets[0].ticket_id,'customer');
assert.equal(dryRun.customerOnuTickets[0].evidence,'сам купил onu');
assert.equal(JSON.stringify(dryRun).includes('+380501234567'),false,'dry-run must not leak surrounding PII');
assert.throws(()=>dryRunHistoricalOnu(null,core),/HISTORICAL_SOURCE_UNAVAILABLE/);

console.log('PASS historical connection ONU policy: modern priority, RU/UA customer matcher, legacy default, UNKNOWN, repair separation, privacy-safe dry-run, sum unchanged');
})().catch(error=>{console.error(error);process.exitCode=1;});

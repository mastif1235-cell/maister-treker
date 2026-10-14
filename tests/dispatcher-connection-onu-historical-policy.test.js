'use strict';
const assert=require('node:assert/strict');
const core=require('../js/dispatcher-report-core.js');
(async()=>{
const {classifyConnectionOnu,projectTicket,dryRunHistoricalOnu}=await import('../js/dispatcher-report-projection.mjs');

const base={id:'conn',date:'13.10.2026',time:'12:00',type:'Підключення',sum:800,payment:'Готівка',equipment:[],cables:[]};
const classify=t=>classifyConnectionOnu({...base,...t},core);

// No reliable schema marker exists. Legacy false/empty is not customer proof;
// explicit customer text wins even over a selected row in an old template.
assert.equal(classify({equipment:[{id:'onu',label:'ONU',checked:true}],note:'ONU клиента'}).classification,'CUSTOMER_ONU_EXPLICIT');
for(const cloudImported of [true,false,undefined]){
  for(const equipment of [undefined,[],[{id:'onu',label:'ONU',checked:false}]]){
    const ticket={...base,equipment,cloudImported};
    const snapshot=JSON.stringify(ticket),result=classifyConnectionOnu(ticket,core),dto=projectTicket(ticket,core,100);
    assert.equal(result.classification,'LEGACY_DEFAULT_OUR_ONU');
    assert.equal(result.onu_connection,1);assert.equal(dto.onu_used,1);
    assert.equal(dto.total,ticket.sum);assert.equal(dto.onu_replacement,0);
    assert.equal(JSON.stringify(ticket),snapshot,'classification/projection must not edit canonical tickets');
  }
}
assert.equal(classify({equipment:[{id:'onu',label:'ONU',checked:true}]}).classification,'OUR_ONU_EXPLICIT');

// RU/UA explicit ownership patterns, with safe snippets limited to the match.
for(const note of ['Своя ONU','Поставили его ONU','сам купил ONU','ONU клиента','ONU абонента','власна ONU','ONU користувача']){
  const result=classify({equipment:undefined,note});
  assert.equal(result.classification,'CUSTOMER_ONU_EXPLICIT',note);
  assert.equal(result.onu_connection,0,note);
  assert.equal(result.evidence.toLowerCase().includes('телефон'),false);
}

// Neither cloudImported nor an empty array proves a modern checkbox format.
assert.equal(classify({equipment:undefined,cloudImported:true,note:'Подключение'}).classification,'LEGACY_DEFAULT_OUR_ONU');
assert.equal(classify({equipment:[],cloudImported:false,note:'Подключение'}).classification,'LEGACY_DEFAULT_OUR_ONU');
assert.equal(classify({equipment:undefined,cloudImported:true,note:'ONU не своя'}).classification,'LEGACY_DEFAULT_OUR_ONU','negated ownership is not a customer-ONU match');

const canonical={...base,equipment:undefined,cloudImported:true,note:'Обычное подключение'};
const dto=projectTicket(canonical,core,100);
assert.equal(dto.onu_used,1);
assert.equal(dto.total,800,'legacy classification must preserve ticket.sum');
const headerOnly={...base,type:'',cloudImported:true,content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ',equipment:[{id:'onu',label:'ONU',checked:false}]};
assert.equal(projectTicket(headerOnly,core,100).onu_used,1,'legacy header-derived connection also receives the policy');
assert.equal(projectTicket({...headerOnly,note:'у них своя ONU'},core,100).onu_used,0);

const fixture=[
  {...base,id:'legacy-our',date:'13.10.2026',equipment:undefined,cloudImported:true,note:'Обычное подключение'},
  {...base,id:'customer',date:'13.10.2026',equipment:undefined,cloudImported:true,note:'Клиент сам купил ONU; телефон +380501234567'},
  {...base,id:'empty-legacy',date:'13.10.2026',equipment:[],cloudImported:false,note:'Подключение'},
  // User-confirmed fragment only, not a fetched production canonical object.
  {...base,id:'1783937356209',date:'02.07.2026',time:'15:17',equipment:[{id:'onu',label:'ONU',checked:false}],note:'у них своя ONU'},
  {...base,id:'repair-onu',date:'13.10.2026',type:'Ремонт',equipment:[{id:'onu',label:'ONU',checked:true,qty:1}],note:''}
];
const dryRun=dryRunHistoricalOnu(fixture,core);
assert.deepEqual(JSON.parse(JSON.stringify(dryRun.months)),[{
  month:'2026-07',connections_total:1,connection_our_onu:0,connection_customer_onu:1,connection_unknown:0,repair_onu:0,total_physical_onu:0
},{
  month:'2026-10',connections_total:3,connection_our_onu:2,connection_customer_onu:1,connection_unknown:0,repair_onu:1,total_physical_onu:3
}]);
assert.equal(dryRun.customerOnuTickets.length,2);
assert.equal(dryRun.customerOnuTickets[0].ticket_id,'1783937356209');
assert.equal(dryRun.customerOnuTickets[0].evidence,'своя onu');
assert.equal(dryRun.customerOnuTickets[1].ticket_id,'customer');
assert.equal(dryRun.customerOnuTickets[1].evidence,'сам купил onu');
assert.equal(JSON.stringify(dryRun).includes('+380501234567'),false,'dry-run must not leak surrounding PII');
assert.throws(()=>dryRunHistoricalOnu(null,core),/HISTORICAL_SOURCE_UNAVAILABLE/);

console.log('PASS historical connection ONU policy: legacy false/empty defaults to OUR, explicit RU/UA customer evidence wins, user-confirmed July example, repair separation, privacy-safe dry-run, sum unchanged');
})().catch(error=>{console.error(error);process.exitCode=1;});

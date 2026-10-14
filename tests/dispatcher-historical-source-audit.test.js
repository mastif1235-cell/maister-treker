'use strict';
const assert=require('node:assert/strict'),core=require('../js/dispatcher-report-core.js');
(async()=>{
  const {reconcileHistoricalTickets,resolveHistoricalWorkType,dryRunHistoricalOnu,HISTORICAL_WORK_TYPE_OVERRIDES}=await import('../js/dispatcher-report-projection.mjs');
  const connection=(id,patch={})=>({id,date:'13.10.2026',time:'12:00',type:'Підключення',tags:['connect'],content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\nFixture job '+id,equipment:[],cables:[],sum:800,payment:'Готівка',...patch});
  const repair=(id,patch={})=>connection(id,{type:'Ремонт',tags:['repair'],content:'📋 ЗАЯВКА: РЕМОНТ\nFixture job '+id,equipment:[{id:'onu',label:'ONU',checked:true,qty:1,price:800}],...patch});
  const pairs=[
    ['1783937356200','1783435135970'],['1783937356201','1783420836005'],
    ['1783937356203','1783343460359'],['1783937356205','1783075798413'],
    ['1783937356209','1782994943831'],['1783937356210','1782905435476'],
    ['1783937356211','1782829354711'],['1783937356224','1782381630879'],
    ['1783937356225','1782308060945'],['1783937356226','1782297313220']
  ];
  // Reconstructed regression fixture from user-supplied pair IDs/counts.
  // Dates/content except the confirmed July customer fragment are synthetic.
  const current=pairs.map(([id],i)=>connection(id,{date:i<6?'02.07.2026':'24.06.2026',time:i===4?'15:17':'12:'+String(i).padStart(2,'0'),content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\nFixture physical job '+i+(i===4?'\nУ них своя ONU':''),equipment:[{id:'onu',label:'ONU',checked:false}]}));
  const archive=current.map((ticket,i)=>({...ticket,id:pairs[i][1],content:ticket.content.replaceAll('\n','\r\n')}));
  const before=JSON.stringify({current,archive});
  const result=dryRunHistoricalOnu({current,archive},core);
  assert.equal(result.duplicate_count,10);assert.equal(result.same_id_count,0);
  assert.equal(result.source_mode,'CURRENT_AND_ARCHIVE');assert.equal(result.current_count,10);assert.equal(result.archive_count,10);assert.equal(result.physical_jobs,10);
  assert.deepEqual(result.duplicates.map(d=>[d.kept_id,d.suppressed_id]).sort(),pairs.slice().sort());
  assert(result.duplicates.every(d=>d.kept_source==='current'&&d.suppressed_source==='archive'));
  assert.equal(result.months.reduce((n,m)=>n+m.connections_physical,0),10,'20 source rows represent 10 physical jobs');
  assert.equal(result.customerOnuTickets.length,1,'duplicate customer ONU is counted once');
  assert.equal(result.customerOnuTickets[0].ticket_id,'1783937356209');
  assert.equal(result.customerOnuTickets[0].evidence,'своя onu');
  assert.equal(result.months.find(m=>m.month==='2026-06').connection_our_onu,4);
  assert.equal(result.months.find(m=>m.month==='2026-07').connection_our_onu,5);
  assert.equal(result.months.find(m=>m.month==='2026-07').connection_customer_onu,1);
  assert.equal(JSON.stringify({current,archive}),before,'source tickets/sums are untouched');

  const currentVersion=connection('same-id',{sum:999}),oldVersion=connection('same-id',{content:'different historical content',sum:123});
  const sameId=reconcileHistoricalTickets([currentVersion],[oldVersion],core);
  assert.equal(sameId.records.length,1);assert.equal(sameId.records[0].ticket,currentVersion);
  assert.equal(sameId.records[0].ticket.sum,999);assert.equal(sameId.duplicates[0].reason,'SAME_TICKET_ID');
  assert.throws(()=>reconcileHistoricalTickets([currentVersion,currentVersion],[],core),/HISTORICAL_DUPLICATE_SOURCE_ID/);
  const almost=connection('different-content',{content:currentVersion.content+' '});
  assert.equal(reconcileHistoricalTickets([currentVersion],[almost],core).records.length,2,'full content is not trimmed/fuzzily matched');
  assert.equal(reconcileHistoricalTickets([connection('no-content-a',{content:''})],[connection('no-content-b',{content:''})],core).records.length,2,'empty content is not duplicate proof');
  assert.equal(reconcileHistoricalTickets([connection('time-a',{time:'09:05'})],[connection('time-b',{time:'9:05',content:connection('time-a').content})],core).records.length,1,'normalize HH:MM before exact comparison');

  // Strong conflicts reported by the user; fixture carries only stated evidence.
  const strong=[
    connection('1784113153627',{content:'📋 ЗАЯВКА: РЕМОНТ',tags:['ремонт']}),
    connection('1784048596976',{content:'📋 ЗАЯВКА: РЕМОНТ',tags:['ремонт']}),
    repair('1783937356212',{content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\nВідновлення / ONU'}),
    connection('1783937356216',{content:'📋 ЗАЯВКА: РЕМОНТ\nРемонт кабелю',tags:[]}),
    repair('1777287852811',{content:'📋 ЗАЯВКА: ПОДКЛЮЧЕНИЕ',tags:['ЗаменаОну','ремонт']}),
    repair('1775815433108',{content:'📋 ЗАЯВКА: ПОДКЛЮЧЕНИЕ\nЗаменили ONU',tags:['ремонт']})
  ].map((ticket,i)=>({...ticket,time:'13:'+String(i).padStart(2,'0')}));
  const otherConflicts=['1783336285098','1781882915421','1781880526066','1781871158184','1781716436224','1781179383203','1781104713848','1780498750666','1780498841441','1779469363834','1774458317619','1774458317612']
    .map((id,i)=>connection(id,{time:'14:'+String(i).padStart(2,'0'),tags:['ремонт'],content:'Fixture repair evidence '+id}));
  const conflicts=dryRunHistoricalOnu({current:[...strong,...otherConflicts],archive:[]},core);
  assert.equal(conflicts.type_conflict_count,18);
  assert.equal(conflicts.unknownTypes.length,13);
  assert.deepEqual(conflicts.unknownTypes.map(t=>t.ticket_id).sort(),['1783937356212',...otherConflicts.map(t=>t.id)].sort());
  assert.equal(conflicts.months[0].connections_physical,0,'UNKNOWN_TYPE does not receive default connection ONU');
  assert.deepEqual(Object.keys(HISTORICAL_WORK_TYPE_OVERRIDES).sort(),['1784113153627','1784048596976','1783937356216','1777287852811','1775815433108'].sort());
  assert.equal(resolveHistoricalWorkType(strong[0],{}),'REPAIR','heading + repair tag overrides old JSON connection');
  assert.equal(resolveHistoricalWorkType(strong[4],{}),'REPAIR','JSON repair + replacement tag remains repair');
  assert.equal(resolveHistoricalWorkType(strong[5],{}),'REPAIR','JSON repair + replacement text remains repair');
  assert.equal(resolveHistoricalWorkType(strong[2]),'UNKNOWN_TYPE','restore/ONU with connection heading is unresolved');
  assert.equal(resolveHistoricalWorkType(connection('type-only',{tags:[],content:'',callFee:500,tariff:300})),'UNKNOWN_TYPE','canonical type alone is insufficient');
  assert.equal(resolveHistoricalWorkType(connection('header-finance',{type:'',tags:[],content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ',callFee:500,tariff:300})),'CONNECTION');
  assert.equal(resolveHistoricalWorkType(connection('header-other-conflict',{type:'',tags:['other'],content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ',callFee:500,tariff:300})),'UNKNOWN_TYPE');
  assert.equal(resolveHistoricalWorkType(connection('other-only',{type:'Інше',tags:[],content:''})),'UNKNOWN_TYPE');
  assert.equal(resolveHistoricalWorkType(connection('other-aligned',{type:'Інше',tags:['other'],content:'Інше'})),'OTHER');
  assert.equal(resolveHistoricalWorkType(connection('loss-conflict',{content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\nred loss'})),'UNKNOWN_TYPE');
  assert.equal(resolveHistoricalWorkType(connection('routine-splice',{content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\nПайка оптики — 100 грн'})),'CONNECTION','routine work does not override three agreeing type sources');
  assert.equal(resolveHistoricalWorkType(connection('splice-old-json',{tags:[],content:'Пайка оптики'})),'UNKNOWN_TYPE','old JSON alone plus splice is not a connection');
  assert.equal(resolveHistoricalWorkType(repair('power-supply',{content:'📋 ЗАЯВКА: ПОДКЛЮЧЕНИЕ\nЗаменили блок питания ONU'}),{}),'UNKNOWN_TYPE','PSU replacement is not strong ONU replacement evidence');
  assert.throws(()=>resolveHistoricalWorkType(connection('invalid'),{invalid:'invented'}),/INVALID_HISTORICAL_WORK_TYPE_OVERRIDE/);

  const october=[...Array.from({length:6},(_,i)=>connection('oct-connection-'+i,{time:'10:'+String(i).padStart(2,'0'),equipment:[{id:'onu',label:'ONU',checked:false}]})),...Array.from({length:4},(_,i)=>repair('oct-repair-'+i,{time:'11:'+String(i).padStart(2,'0')}))];
  const octBefore=JSON.stringify(october),oct=dryRunHistoricalOnu({current:october,archive:[]},core).months[0];
  assert.equal(oct.connections_physical,6);assert.equal(oct.connection_our_onu,6);assert.equal(oct.connection_customer_onu,0);assert.equal(oct.unknown_type,0);assert.equal(oct.repair_onu,4);assert.equal(oct.total_physical_onu,10);
  assert.equal(JSON.stringify(october),octBefore);
  console.log('PASS historical source audit: 10 exact pairs, current precedence, one customer job, 18 type conflicts / 13 held UNKNOWN in supplied-evidence fixture, October 6+4, source/sums unchanged');
})().catch(error=>{console.error(error);process.exitCode=1;});

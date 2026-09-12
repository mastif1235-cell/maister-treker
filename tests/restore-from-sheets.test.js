'use strict';
const assert=require('node:assert/strict');
const restore=require('../js/restore-from-sheets.js');

function ticketToSyncPayload(t){
  const fullData={
    type:t.type||'', city:t.city||'', street:t.street||'', house:t.house||'',
    clientName:t.clientName||'', phone:t.phone||'', masterNote:t.masterNote||'',
    login:t.login||'', password:t.password||'', geoLink:t.geoLink||'', extra:t.extra||''
  };
  return {
    id:String(t.id||''), date:String(t.date||''), time:String(t.time||''),
    content:String(t.content||''), sum:Number(t.sum)||0,
    tags:Array.isArray(t.tags)?t.tags:[], backupNote:'',
    fullDataJson:JSON.stringify(fullData)
  };
}

function parseBackupNote(note){
  const result={geoLink:'',masterNote:'',login:'',password:'',fullData:null};
  String(note||'').replace(/\r\n?/g,'\n').split('\n').forEach(line=>{
    let m=line.match(/^Геолокація:\s*(.+)$/);if(m){result.geoLink=m[1].trim();return;}
    m=line.match(/^Приватна примітка майстра:\s*(.*)$/);if(m){result.masterNote=m[1].trim();return;}
    m=line.match(/^Логін:\s*(.+)$/);if(m){result.login=m[1].trim();return;}
    m=line.match(/^Пароль:\s*(.+)$/);if(m){result.password=m[1].trim();return;}
  });
  return result;
}

const deps={blankTicketObject:()=>({}),parseBackupNote,ticketToSyncPayload};
const core=(id,content)=>({id,date:'01.09.2026',time:'10:00',content,sum:100,tags:['підключення']});
const full=(city='Київ',client='Іван')=>({city,street:'Хрещатик',clientName:client,masterNote:'примітка',login:'login',password:'pass',geoLink:'https://maps.example/x',extra:'same'});
const row=(id,content,data)=>({id,date:'01.09.2026',time:'10:00',content,sum:100,tags:['підключення'],backupNote:'',fullDataJson:JSON.stringify(data)});
const local=(id,content,data)=>Object.assign({},core(id,content),full(data.city,data.clientName),data);

// validateCloudListPayload
assert.deepEqual(restore.validateCloudListPayload({status:'ok',tickets:[],shifts:[]}),{ok:true,tickets:[],shifts:[],states:null});
assert.equal(restore.validateCloudListPayload({status:'ok',tickets:[]}).ok,false,'missing shifts');
assert.equal(restore.validateCloudListPayload({status:'error',code:'AUTH_FAILED',tickets:[],shifts:[]}).code,'AUTH_FAILED');
const polluted=JSON.parse('{"__proto__":{"x":1},"status":"ok","tickets":[],"shifts":[]}');
assert.equal(restore.validateCloudListPayload(polluted).ok,false,'unsafe keys rejected');

// bulk states: valid payload becomes a lookup map the client can seed from
const validStates={ticket:[{id:'t1',revision:7,tombstone:false},{id:'gone',revision:9,tombstone:true}],shift:[{id:'s1',revision:0,tombstone:false}]};
const validPayload=restore.validateCloudListPayload({status:'ok',tickets:[],shifts:[],states:validStates});
assert.equal(validPayload.ok,true);
assert.equal(validPayload.states.ticket.get('t1').revision,7);
assert.equal(validPayload.states.ticket.get('gone').tombstone,true);
assert.equal(validPayload.states.shift.get('s1').revision,0);
assert.equal(restore.validateCloudListPayload({status:'ok',tickets:[],shifts:[],states:null}).states,null,'absent states keep the fallback');

// damaged or unsafe states must fail closed (no silent per-entity fallback)
const badStates=[
  {ticket:'nope',shift:[]},
  {ticket:[{id:'t1',revision:'7',tombstone:false}]},
  {ticket:[{id:'t1',revision:-1,tombstone:false}]},
  {ticket:[{id:'t1',revision:1.5,tombstone:false}]},
  {ticket:[{id:'t1',revision:1,tombstone:'yes'}]},
  {ticket:[{id:'',revision:1,tombstone:false}]},
  {ticket:[{id:'t1',revision:1,tombstone:false},{id:'t1',revision:2,tombstone:false}]},
  {ticket:[]},
  {other:[]},
  JSON.parse('{"ticket":[{"id":"t1","revision":1,"tombstone":false,"__proto__":{"x":1}}]}')
];
badStates.forEach((states,index)=>{
  const result=restore.validateCloudListPayload({status:'ok',tickets:[],shifts:[],states});
  assert.equal(result.ok,false,`damaged states rejected #${index}`);
  assert.equal(result.code,'MALFORMED');
});
assert.equal(restore.validateCloudListPayload(JSON.parse('{"status":"ok","tickets":[],"shifts":[],"states":{"__proto__":[]}}')).ok,false,'unsafe states keys rejected');

// baselineFromStates: revisions from list, revision 0 when the server has no
// state row, tombstone -> skipCloud (never imported)
const statesMap=validPayload.states;
const fromStates=restore.baselineFromStates([
  {entity:'ticket',id:'t1'},
  {entity:'ticket',id:'gone'},
  {entity:'ticket',id:'no-state'},
  {entity:'shift',id:'s1'}
],statesMap);
assert.deepEqual(fromStates.baselines,[
  {entity:'ticket',id:'t1',revision:7,tombstone:false},
  {entity:'ticket',id:'no-state',revision:0,tombstone:false},
  {entity:'shift',id:'s1',revision:0,tombstone:false}
]);
assert.equal(fromStates.skipCloud.ticket.has('gone'),true,'tombstone goes to skipCloud');
assert.equal(fromStates.baselines.some(entry=>entry.id==='gone'),false,'tombstone never seeded as baseline');
assert.deepEqual(restore.baselineFromStates([],statesMap),{baselines:[],skipCloud:{ticket:new Set(),shift:new Set()}});

// 1. empty local + valid cloud -> import all
let plan=restore.buildTicketPlan([],[row('t1','a',full()),row('t2','b',full('Львів','Оля'))],deps);
assert.deepEqual(plan.stats,{cloudCount:2,newCount:2,matchCount:0,conflictCount:0,invalidCount:0,localOnlyCount:0});
assert.equal(restore.applyTicketPlan([],[row('t1','a',full()),row('t2','b',full('Львів','Оля'))],{},deps).length,2);

// 2/9. partial data: new + match + conflict + local-only kept
const localSet=[local('t1','same',full()),local('t3','local-only',full('Одеса','Петро'))];
plan=restore.buildTicketPlan(localSet,[
  row('t1','same',full()),          // match
  row('t2','new',full('Львів','Оля')), // new
  row('t3','different-cloud',full('Одеса','Петро')) // conflict (content differs)
],deps);
assert.equal(plan.stats.matchCount,1);
assert.equal(plan.stats.newCount,1);
assert.equal(plan.stats.conflictCount,1);
assert.equal(plan.stats.localOnlyCount,0);

plan=restore.buildTicketPlan([local('t1','x',full())],[row('t2','new',full('Львів','Оля'))],deps);
assert.equal(plan.stats.localOnlyCount,1,'local-only counted');
const applied=restore.applyTicketPlan([local('t1','x',full())],[row('t2','new',full('Львів','Оля'))],{},deps);
assert.equal(applied.filter(t=>String(t.id)==='t1').length,1,'local-only survives apply');

// 3. identical -> no conflict
plan=restore.buildTicketPlan([local('t1','same',full())],[row('t1','same',full())],deps);
assert.equal(plan.stats.conflictCount,0);
assert.equal(plan.stats.matchCount,1);

// 4. same id, different data -> conflict
plan=restore.buildTicketPlan([local('t1','same',full())],[row('t1','same',full('Київ','Змінено'))],deps);
assert.equal(plan.stats.conflictCount,1);

// conflict decisions respect local/cloud/skip
const conflictLocal=local('t1','local-content',full());
const conflictCloud=row('t1','cloud-content',full('Київ','Хмара'));
assert.equal(restore.applyTicketPlan([conflictLocal],[conflictCloud],{t1:'local'},deps)[0].content,'local-content');
assert.equal(restore.applyTicketPlan([conflictLocal],[conflictCloud],{t1:'cloud'},deps)[0].content,'cloud-content');
assert.equal(restore.applyTicketPlan([conflictLocal],[conflictCloud],{t1:'skip'},deps)[0].content,'local-content');
assert.deepEqual(restore.defaultDecisions({items:[{kind:'conflict',id:'t1'},{kind:'match',id:'t2'}]},'cloud'),{t1:'cloud'});

// 5. invalid fullDataJson -> counted invalid, not imported
const badRow={id:'bad',date:'01.09.2026',time:'10:00',content:'x',sum:1,tags:[],backupNote:'',fullDataJson:'{not json'};
plan=restore.buildTicketPlan([],[badRow],deps);
assert.equal(plan.stats.invalidCount,1);
assert.equal(plan.items[0].reason,'INVALID_JSON');
assert.equal(restore.applyTicketPlan([],[badRow],{},deps).length,0,'broken fullDataJson not imported silently');

// 13. idempotent apply
const once=restore.applyTicketPlan([],[row('t1','a',full())],{},deps);
const twice=restore.applyTicketPlan(once,[row('t1','a',full())],{},deps);
assert.equal(twice.length,1);
assert.equal(twice[0].content,'a');

// shifts: classify/plan/apply
const shiftRow=(id,date,hours,coworker)=>({id,date,hours,coworker});
assert.deepEqual(restore.cloudShiftToLocal(shiftRow('s1','01.09.2026',8,'Сам')),{invalid:false,shift:{id:'s1',date:'01.09.2026',hours:8,coworker:'Сам'}});
assert.equal(restore.cloudShiftToLocal(shiftRow('s1','2026-09-01',8,'Сам')).invalid,true,'invalid date rejected');
assert.equal(restore.cloudShiftToLocal(shiftRow('s1','01.09.2026',49,'Сам')).invalid,true,'out-of-range hours rejected');

const shiftPlan=restore.buildShiftPlan([{id:'s1',date:'01.09.2026',hours:8,coworker:'Сам'}],[shiftRow('s1','01.09.2026',8,'Сам'),shiftRow('s2','02.09.2026',6,'Оля')]);
assert.equal(shiftPlan.stats.matchCount,1);
assert.equal(shiftPlan.stats.newCount,1);
assert.equal(shiftPlan.stats.conflictCount,0);
const mergedShifts=restore.applyShiftPlan([{id:'s1',date:'01.09.2026',hours:8,coworker:'Сам'}],[shiftRow('s1','01.09.2026',8,'Сам'),shiftRow('s2','02.09.2026',6,'Оля')],{});
assert.equal(mergedShifts.length,2);
assert.equal(restore.applyShiftPlan([{id:'s1',date:'01.09.2026',hours:8,coworker:'Сам'}],[shiftRow('s1','01.09.2026',10,'Сам')],{s1:'cloud'})[0].hours,10);
assert.equal(restore.applyShiftPlan([{id:'s1',date:'01.09.2026',hours:8,coworker:'Сам'}],[shiftRow('s1','01.09.2026',10,'Сам')],{s1:'local'})[0].hours,8);

console.log('PASS sheets restore pure merge/validation/conflict rules');

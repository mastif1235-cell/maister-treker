'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../js/sync-engine-core.js');
const {Engine}=require('../js/sync-engine-runtime.js');

function storage(seed){let value=JSON.parse(JSON.stringify(seed));return{load:async()=>JSON.parse(JSON.stringify(value)),save:async next=>{value=JSON.parse(JSON.stringify(next));},value:()=>value};}
const payload=(id,content)=>({id,date:'30.08.2026',time:'12:00',content,sum:1,tags:[]});
const baseRecord=(id)=>({entity:'ticket',id,committedRevision:1,tombstone:false,head:null,tail:null,conflict:null});
const enqueueEdit=(state,id,content)=>core.enqueue(state,{entity:'ticket',id,payload:payload(id,content)},()=>`request_${id}_${content}_abcdefghijkl`);

(async()=>{
  let state={records:{'ticket:A':baseRecord('A'),'ticket:B':baseRecord('B')}};
  state=enqueueEdit(state,'A','device-B');
  state=enqueueEdit(state,'B','independent');
  const db=storage(state),calls=[],timers=[];
  const engine=new Engine({core,storage:db,payload:(_entity,item)=>item,online:()=>true,setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout:()=>{},transport:{send:async item=>{
    calls.push(`${item.id}:${item.revision}`);
    if(item.id==='A')return{ok:false,result:{status:'error',code:'CONFLICT',state:{revision:2,tombstone:false,fingerprint:'server'}}};
    return{ok:true,state:{revision:item.revision,tombstone:false}};
  }}});
  await engine.init();await engine.loop;
  assert.deepEqual(calls,['A:2','B:2'],'conflict does not block another entity');
  assert.equal(timers.length,0,'permanent conflict has no automatic retry timer');
  assert.equal(engine.pendingCount(),1,'only conflicted entity remains pending');
  assert.equal(engine.conflictFor('ticket','A').code,'CONFLICT','conflict is durable journal state');

  let reloadCalls=0;
  const restarted=new Engine({core,storage:db,payload:(_entity,item)=>item,online:()=>true,setTimeout:()=>{throw new Error('conflict must not schedule retry');},clearTimeout:()=>{},transport:{send:async()=>{reloadCalls++;return{ok:true,state:{revision:2,tombstone:false}};}}});
  await restarted.init();await restarted.loop;
  assert.equal(reloadCalls,0,'reload does not resend a parked conflict');
  assert.equal(restarted.conflictFor('ticket','A').server.revision,2,'reload preserves server conflict state');
  await restarted.acceptServerConflict('ticket','A',{revision:2,tombstone:false});
  assert.equal(restarted.pendingCount(),0,'accept-server clears only the conflict');
  assert.equal(db.value().records['ticket:A'].committedRevision,2,'accept-server reconciles the server revision');

  let localState={records:{'ticket:L':baseRecord('L')}};
  localState=enqueueEdit(localState,'L','local-choice');
  localState=core.markConflict(localState,'ticket','L',{revision:2,tombstone:false,fingerprint:'server'});
  const localDb=storage(localState),localCalls=[];
  const localEngine=new Engine({core,storage:localDb,payload:(_entity,item)=>item,online:()=>true,transport:{send:async item=>{localCalls.push({action:item.action,revision:item.revision,body:item.body});return{ok:true,state:{revision:item.revision,tombstone:false}};}}});
  await localEngine.init();await localEngine.keepLocalConflict('ticket','L',{revision:2,tombstone:false},payload('L','local-choice'));
  assert.equal(localCalls.length,1,'keep-local performs one explicit replacement mutation');
  assert.equal(localCalls[0].revision,3,'keep-local uses current server revision plus one');
  assert.equal(localCalls[0].body.revision,3,'keep-local body revision matches the envelope mutation');
  assert.equal(localEngine.pendingCount(),0,'keep-local is acknowledged normally');
  await localEngine.recordDiff('ticket',[payload('L','local-choice')],[payload('L','later-edit')]);await localEngine.loop;
  assert.equal(localCalls[1].revision,4,'normal edits continue after conflict resolution');
  assert.throws(()=>core.keepLocalConflict(core.markConflict(enqueueEdit({records:{'ticket:T':baseRecord('T')}},'T','x'),'ticket','T',{revision:2,tombstone:true}),'ticket','T',{revision:2,tombstone:true},payload('T','x'),()=> 'unused_request_abcdefghijkl'),/TOMBSTONED/,'delete-wins prevents local resurrection');

  const root=path.join(__dirname,'..');
  const render=fs.readFileSync(path.join(root,'js','tickets-render.js'),'utf8');
  const bindings=fs.readFileSync(path.join(root,'js','tickets-bindings.js'),'utf8');
  assert.match(render,/resolve-sync-conflict-btn/,'ticket card shows a dedicated conflict indicator');
  assert.match(bindings,/showTicketConflictResolution/,'conflict indicator opens explicit resolution UI');
  const ticketDomain=fs.readFileSync(path.join(root,'js','tickets-domain.js'),'utf8');
  const uiContext={blankTicketObject:()=>({}),parseBackupNote:()=>({}),console};
  vm.createContext(uiContext);vm.runInContext(ticketDomain,uiContext);
  const merged=uiContext.ticketFromConflictServer({id:'A',date:'30.08.2026',time:'13:00',content:'server version',sum:5,tags:['server'],backupNote:'',fullDataJson:JSON.stringify({city:'Server City'})},{id:'A',content:'local version',photo:'idb:photo',tgBackedUp:true,city:'Local City'});
  assert.equal(merged.content,'server version','accept-server replaces synchronized business content');
  assert.equal(merged.city,'Server City','accept-server restores structured server fields');
  assert.equal(merged.photo,'idb:photo','accept-server preserves local-only photo reference');
  assert.equal(merged.tgBackedUp,true,'accept-server preserves local-only Telegram metadata');
  console.log('PASS durable conflict parking, independent sync, reload, accept-server and keep-local resolution');
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
const assert = require('node:assert/strict');
const core = require('../js/sync-engine-core.js');
let seq = 0; const random = ()=>`random_${++seq}_abcdefghijklmnop`;
const initial = ()=>({records:{}});
const put = (s, payload, extra={})=>core.enqueue(s, {entity:'ticket', id:'t1', payload, ...extra}, random);

let s = put(initial(), {content:'create'});
assert.equal(core.pending(s)[0].action, 'addTicket');
s = put(s, {content:'edit'});
assert.equal(core.pending(s).length, 1, 'unattempted create+edit coalesces');
assert.equal(core.pending(s)[0].body.content, 'edit');
s = core.markAttempted(s, 'ticket', 't1');
const immutable = JSON.stringify(core.pending(s)[0]);
s = put(s, {content:'rapid-1'}); s = put(s, {content:'rapid-2'});
assert.equal(JSON.stringify(core.pending(s)[0]), immutable, 'attempted head immutable');
assert.equal(s.records['ticket:t1'].tail.body.content, 'rapid-2', 'rapid edits coalesce in tail');
assert.equal([s.records['ticket:t1'].head,s.records['ticket:t1'].tail].filter(Boolean).length,2,'at most two pending mutations per entity');
assert.equal(s.records['ticket:t1'].tail.revision, 2);
assert.equal(s.records['ticket:t1'].tail.action, 'updateTicket', 'edit behind attempted create is update');
s = put(s, {}, {delete:true});
assert.equal(s.records['ticket:t1'].tail.action, 'deleteTicket', 'delete wins tail');
s = put(s, {content:'ignored'});
assert.equal(s.records['ticket:t1'].tail.action, 'deleteTicket', 'edit cannot overtake delete');
core.assertInvariants(s);
s = core.acknowledge(s, 'ticket', 't1', 1);
assert.equal(core.pending(s)[0].action, 'deleteTicket');
s = core.markAttempted(s, 'ticket', 't1');
s = core.acknowledge(s, 'ticket', 't1', 2);
assert.equal(s.records['ticket:t1'].tombstone, true);
assert.throws(()=>put(s, {content:'resurrect'}), /TOMBSTONED/);

let cancelled = put(initial(), {content:'new'});
cancelled = put(cancelled, {}, {delete:true});
assert.equal(core.pending(cancelled).length, 0, 'unattempted create+delete cancels remote mutation');
assert.equal(cancelled.records['ticket:t1'].tombstone, true, 'local tombstone remains durable');

let lost = put(initial(), {content:'lost response'});
const stableRequest = core.pending(lost)[0].requestId;
lost = core.markAttempted(lost, 'ticket', 't1');
const restarted = JSON.parse(JSON.stringify(lost));
assert.equal(core.pending(restarted)[0].requestId, stableRequest, 'restart/lost-response retry keeps requestId');
restarted.records['ticket:t1'].head.attempted = true;
let reconciled = core.reconcile(restarted, 'ticket', 't1', {revision:1,tombstone:false});
assert.equal(core.pending(reconciled).length, 0, 'server state repairs lost response without full sync');

let tomb = put(initial(), {content:'x'}); tomb = core.markAttempted(tomb,'ticket','t1');
tomb = core.reconcile(tomb,'ticket','t1',{revision:7,tombstone:true});
assert.equal(tomb.records['ticket:t1'].tombstone,true);
assert.equal(core.pending(tomb).length,0);

for(const entity of ['ticket','shift']){
  const id=entity+'-parity'; const makePayload=n=>entity==='ticket'?{content:n}:{date:'23.08.2026',hours:n,coworker:'Сам'};
  let parity=core.enqueue(initial(),{entity,id,payload:makePayload(1)},random);
  assert.equal(parity.records[`${entity}:${id}`].head.action,entity==='ticket'?'addTicket':'addShift');
  parity=core.markAttempted(parity,entity,id);
  parity=core.enqueue(parity,{entity,id,payload:makePayload(2)},random);
  parity=core.enqueue(parity,{entity,id,payload:{},delete:true},random);
  assert.equal(parity.records[`${entity}:${id}`].tail.action,entity==='ticket'?'deleteTicket':'deleteShift');
  core.assertInvariants(parity);
}

console.log('PASS bounded journal create/edit/delete/rapid/restart/lost-response/tombstone invariants');

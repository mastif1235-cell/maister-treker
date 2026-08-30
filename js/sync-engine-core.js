(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.MTSyncEngineCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  function copy(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function key(entity, id){ return entity + ':' + String(id); }
  function isDelete(action){ return action === 'deleteTicket' || action === 'deleteShift'; }
  function requestId(random){ return 'mt.' + random().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80); }
  function nextAction(entity, hasCommittedCreate, deleting){
    if(deleting) return entity === 'ticket' ? 'deleteTicket' : 'deleteShift';
    if(!hasCommittedCreate) return entity === 'ticket' ? 'addTicket' : 'addShift';
    return entity === 'ticket' ? 'updateTicket' : 'updateShift';
  }
  function mutation(entity, id, action, revision, payload, random){
    const body = Object.assign({}, copy(payload || {}), {action, id:String(id), revision});
    return {entity, id:String(id), action, revision, requestId:requestId(random), body, attempted:false};
  }

  function enqueue(state, input, random){
    state = copy(state || {records:{}}); state.records = state.records || {};
    const recordKey = key(input.entity, input.id);
    const current = state.records[recordKey] || {entity:input.entity, id:String(input.id), committedRevision:0, tombstone:false, head:null, tail:null};
    if(current.tombstone) throw new Error('TOMBSTONED');
    const deleting = !!input.delete;
    const pending = current.tail || current.head;
    if(pending && isDelete(pending.action)) return state;
    const revision = pending ? pending.revision + (current.head && current.tail ? 0 : 1) : current.committedRevision + 1;
    const hasCommittedCreate = current.committedRevision > 0 || !!(current.head && (current.head.action==='addTicket'||current.head.action==='addShift'));
    let next = mutation(input.entity, input.id, nextAction(input.entity, hasCommittedCreate, deleting), revision, input.payload, random);

    if(!current.head) current.head = next;
    else if(!current.head.attempted){
      next.revision = current.head.revision;
      if(isDelete(next.action) && current.committedRevision===0 && (current.head.action==='addTicket'||current.head.action==='addShift')){
        current.head = null; current.tail = null; current.tombstone = true;
      } else {
        if(current.head.action==='addTicket'||current.head.action==='addShift'){
          next.action=current.head.action; next.body.action=current.head.action;
        }
        current.head = next;
      }
    } else {
      next.revision = current.head.revision + 1;
      if(current.tail && isDelete(current.tail.action)) return state;
      current.tail = next;
    }
    state.records[recordKey] = current;
    return state;
  }

  function markAttempted(state, entity, id){
    state = copy(state); const record = state.records[key(entity,id)];
    if(record && record.head) record.head.attempted = true;
    return state;
  }
  function acknowledge(state, entity, id, revision){
    state = copy(state); const record = state.records[key(entity,id)];
    if(!record || !record.head || record.head.revision !== revision) return state;
    record.committedRevision = revision;
    record.conflict = null;
    if(isDelete(record.head.action)) record.tombstone = true;
    record.head = record.tail; record.tail = null;
    return state;
  }
  function reconcile(state, entity, id, server){
    state = copy(state); const record = state.records[key(entity,id)];
    if(!record) return state;
    if(server.tombstone){ record.tombstone = true; record.committedRevision = server.revision; record.head = null; record.tail = null; record.conflict = null; return state; }
    while(state.records[key(entity,id)] && state.records[key(entity,id)].head && state.records[key(entity,id)].head.revision <= server.revision) {
      state = acknowledge(state, entity, id, state.records[key(entity,id)].head.revision);
    }
    return state;
  }
  function markConflict(state, entity, id, server){
    state = copy(state); const record = state.records[key(entity,id)];
    if(!record || !record.head) return state;
    record.conflict = {code:'CONFLICT', requestId:record.head.requestId, server:copy(server||{})};
    return state;
  }
  function conflictFor(state, entity, id){
    const record = state && state.records && state.records[key(entity,id)];
    return record && record.conflict ? copy(record.conflict) : null;
  }
  function acceptServerConflict(state, entity, id, server){
    state = copy(state); const record = state.records[key(entity,id)];
    if(!record || !record.conflict) throw new Error('NO_CONFLICT');
    record.committedRevision = Number(server && server.revision) || 0;
    record.tombstone = !!(server && server.tombstone);
    record.head = null; record.tail = null; record.conflict = null;
    return state;
  }
  function keepLocalConflict(state, entity, id, server, payload, random){
    state = copy(state); const record = state.records[key(entity,id)];
    if(!record || !record.conflict) throw new Error('NO_CONFLICT');
    if(server && server.tombstone) throw new Error('TOMBSTONED');
    const serverRevision = Number(server && server.revision) || 0;
    const deleting = isDelete((record.tail || record.head).action);
    const action = nextAction(entity, serverRevision > 0, deleting);
    record.committedRevision = serverRevision;
    record.tombstone = false;
    record.head = mutation(entity, id, action, serverRevision + 1, payload, random);
    record.tail = null; record.conflict = null;
    return state;
  }
  function recoverUncommittedAddTicketGap(state, item, server, random){
    state = copy(state);
    if(!item || item.entity !== 'ticket' || item.action !== 'addTicket') return {recovered:false,state};
    if(!server || Number(server.revision) !== 0 || Number(server.rowIndex) !== -1 || server.tombstone !== false) return {recovered:false,state};
    const record = state.records && state.records[key('ticket', item.id)];
    if(!record || record.tombstone || record.tail || !record.head || record.head.requestId !== item.requestId) return {recovered:false,state};
    const originalGap = item.revision === 2 && record.committedRevision === 1 && record.head.action === 'addTicket' && record.head.revision === 2;
    const malformedRebase = item.revision === 1 && record.committedRevision === 0 && record.head.action === 'addTicket' && record.head.revision === 1 &&
      record.head.body && record.head.body.action === 'addTicket' && String(record.head.body.id) === String(item.id) && Number(record.head.body.revision) === 2;
    if(!originalGap && !malformedRebase) return {recovered:false,state};
    record.committedRevision = 0;
    record.head = mutation('ticket', item.id, 'addTicket', 1, item.body, random);
    return {recovered:true,state};
  }
  function pending(state){
    return Object.keys((state && state.records) || {}).sort().map(k=>state.records[k]).filter(r=>r.head).map(r=>{
      const item=copy(r.head); if(r.conflict) item.conflict=copy(r.conflict); return item;
    });
  }
  function assertInvariants(state){
    Object.values((state && state.records) || {}).forEach(r=>{
      if(r.tail && !r.head) throw new Error('TAIL_WITHOUT_HEAD');
      if(r.tail && !r.head.attempted) throw new Error('TAIL_BEHIND_UNATTEMPTED_HEAD');
      if(r.tail && r.tail.revision !== r.head.revision + 1) throw new Error('REVISION_GAP');
      if(r.tombstone && (r.head || r.tail)) throw new Error('TOMBSTONE_HAS_PENDING');
      if(r.head && r.head.revision !== r.committedRevision + 1) throw new Error('HEAD_REVISION_GAP');
      if(r.conflict && (!r.head || r.conflict.requestId !== r.head.requestId)) throw new Error('INVALID_CONFLICT');
    });
    return true;
  }
  return {key, enqueue, markAttempted, acknowledge, reconcile, markConflict, conflictFor, acceptServerConflict, keepLocalConflict, recoverUncommittedAddTicketGap, pending, assertInvariants};
});

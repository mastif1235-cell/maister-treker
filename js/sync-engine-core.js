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
    const hasCommittedCreate = current.committedRevision > 0;
    let next = mutation(input.entity, input.id, nextAction(input.entity, hasCommittedCreate, deleting), revision, input.payload, random);

    if(!current.head) current.head = next;
    else if(!current.head.attempted){
      next.revision = current.head.revision;
      if(isDelete(next.action) && !hasCommittedCreate){
        current.head = null; current.tail = null; current.tombstone = true;
      } else current.head = next;
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
    if(isDelete(record.head.action)) record.tombstone = true;
    record.head = record.tail; record.tail = null;
    if(!record.head && !record.tombstone) delete state.records[key(entity,id)];
    return state;
  }
  function reconcile(state, entity, id, server){
    state = copy(state); const record = state.records[key(entity,id)];
    if(!record) return state;
    if(server.tombstone){ record.tombstone = true; record.committedRevision = server.revision; record.head = null; record.tail = null; return state; }
    while(state.records[key(entity,id)] && state.records[key(entity,id)].head && state.records[key(entity,id)].head.revision <= server.revision) {
      state = acknowledge(state, entity, id, state.records[key(entity,id)].head.revision);
    }
    return state;
  }
  function pending(state){
    return Object.keys((state && state.records) || {}).sort().map(k=>state.records[k]).filter(r=>r.head).map(r=>copy(r.head));
  }
  function assertInvariants(state){
    Object.values((state && state.records) || {}).forEach(r=>{
      if(r.tail && !r.head) throw new Error('TAIL_WITHOUT_HEAD');
      if(r.tail && !r.head.attempted) throw new Error('TAIL_BEHIND_UNATTEMPTED_HEAD');
      if(r.tail && r.tail.revision !== r.head.revision + 1) throw new Error('REVISION_GAP');
      if(r.tombstone && (r.head || r.tail)) throw new Error('TOMBSTONE_HAS_PENDING');
      if(r.head && r.head.revision !== r.committedRevision + 1) throw new Error('HEAD_REVISION_GAP');
    });
    return true;
  }
  return {key, enqueue, markAttempted, acknowledge, reconcile, pending, assertInvariants};
});

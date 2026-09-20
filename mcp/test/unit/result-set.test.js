import test from 'node:test';
import assert from 'node:assert/strict';

import {createResultSet, sanitizeIncomingResultSet, RESULT_SET_TTL_MS} from '../../src/ask/result-set.js';
import {validateTicketId} from '../../src/ask/ticket-id.js';

test('ticket ids are validated exactly and never repaired or clipped', () => {
  assert.equal(validateTicketId('  A.b:c-_9  '), 'A.b:c-_9');
  assert.equal(validateTicketId('A/B'), null);
  assert.equal(validateTicketId('x'.repeat(129)), null);
});

test('dot, colon, 65–128 char ids and «12.3» ≠ «123» survive exactly', () => {
  const ids = ['.', ':', '12.3', '123', 'x'.repeat(65), 'y'.repeat(128)];
  assert.equal(validateTicketId('.'), '.');
  assert.equal(validateTicketId(':'), ':');
  assert.equal(validateTicketId('12.3'), '12.3');
  assert.notEqual(validateTicketId('12.3'), validateTicketId('123'));
  assert.equal(validateTicketId('y'.repeat(128)), 'y'.repeat(128));
  assert.equal(validateTicketId('y'.repeat(129)), null);
  const built = createResultSet(ids.map(function(id){ return {id:id}; }), ids.length, 'chat-session-1', Date.now());
  assert.deepEqual(built.resultSet.ticketIds, ids, 'every id round-trips byte-for-byte');
  const round = sanitizeIncomingResultSet(built.resultSet, 'chat-session-1', Date.now());
  assert.equal(round.ok, true);
  assert.deepEqual(round.value.ticketIds, ids);
});

test('the filters key travels with the set and is bounded', () => {
  const long = '{"city":"' + 'x'.repeat(400) + '"}';
  const built = createResultSet([{id:'A:1'}], 1, 'chat-session-1', Date.now(), long);
  assert.ok(built.resultSet.filtersKey.length <= 300);
  assert.equal(sanitizeIncomingResultSet(built.resultSet, 'chat-session-1', Date.now()).value.filtersKey, built.resultSet.filtersKey);
  const none = createResultSet([{id:'A:1'}], 1, 'chat-session-1', Date.now());
  assert.equal(none.resultSet.filtersKey, null);
});

test('result set is chat-bound, server-timed, deduplicated and rejects bad ids', () => {
  const now = Date.UTC(2026, 8, 20, 12);
  const built = createResultSet([{id:'A:1'},{id:'A:1'},{id:'bad id'},{id:'B.2'}], 4, 'chat-session-1', now);
  assert.deepEqual(built.resultSet.ticketIds, ['A:1','B.2']);
  assert.equal(built.skippedInvalid, 1);
  assert.equal(built.resultSet.expiresAt - built.resultSet.createdAt, RESULT_SET_TTL_MS);
  assert.equal(sanitizeIncomingResultSet(built.resultSet, 'chat-session-1', now + 1).ok, true);
  assert.equal(sanitizeIncomingResultSet(built.resultSet, 'chat-session-2', now + 1).code, 'SESSION_MISMATCH');
  assert.equal(sanitizeIncomingResultSet(built.resultSet, 'chat-session-1', built.resultSet.expiresAt).code, 'EXPIRED');
});

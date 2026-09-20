import test from 'node:test';
import assert from 'node:assert/strict';

import {createResultSet, sanitizeIncomingResultSet, RESULT_SET_TTL_MS} from '../../src/ask/result-set.js';
import {validateTicketId} from '../../src/ask/ticket-id.js';

test('ticket ids are validated exactly and never repaired or clipped', () => {
  assert.equal(validateTicketId('  A.b:c-_9  '), 'A.b:c-_9');
  assert.equal(validateTicketId('A/B'), null);
  assert.equal(validateTicketId('x'.repeat(129)), null);
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


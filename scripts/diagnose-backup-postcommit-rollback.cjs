'use strict';
// Local fault injection only. No network, production data or browser profile.
// Exit 1 means the release safety requirement is NOT satisfied.
const assert = require('node:assert/strict');
const {createDevice, createServer, clone} = require('../tests/helpers/sync-gas-harness');

(async () => {
  const device = await createDevice({server:createServer(), online:false, modules:['backup']});
  await device.addTicket({id:'synthetic-review', content:'unsent', sum:100});
  const previous = clone(device.journal());
  device.engine.onChange = () => { throw new Error('synthetic notification failure after durable save'); };
  await assert.rejects(
    () => device.restoreFileBackup({tickets:[], syncJournal:{records:{}}}),
    /synthetic notification failure/
  );
  console.log(JSON.stringify({
    before_records:Object.keys(previous.records).length,
    after_records:Object.keys(device.journal().records).length,
    ticket_restored:!!device.ticket('synthetic-review'),
    badge_synced:device.isSynced('ticket','synthetic-review')
  }));
  assert.deepEqual(device.journal(), previous, 'Restore rollback must retain the original pending journal');
  assert.equal(device.isSynced('ticket','synthetic-review'), false);
})().catch(error => { console.error(error.message); process.exitCode = 1; });

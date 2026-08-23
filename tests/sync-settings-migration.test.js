'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/settings-core.js','utf8');
const start = source.indexOf('const SYNC_V66_SETTINGS_MIGRATION_VERSION');
const end = source.indexOf('\nfunction loadSettings()');
assert.ok(start >= 0 && end > start, 'migration helpers are present');
const context = {URL, Date};
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '\nthis.migrateSyncSettingsV66=migrateSyncSettingsV66;', context);

const legacyTicket = 'https://script.google.com/macros/s/ticket/exec?secret=old-value';
const legacyShifts = 'https://script.google.com/macros/s/shifts/exec?syncSecret=old-value';
const pending = context.migrateSyncSettingsV66({
  scriptUrl:legacyTicket,
  shiftsScriptUrl:legacyShifts,
  syncSecret:'legacy-secret'
}, {
  scriptUrl:legacyTicket,
  shiftsScriptUrl:legacyShifts,
  syncSecret:'legacy-secret',
  syncHmacSecret:''
}, '2026-08-23T10:00:00.000Z');

assert.equal(pending.scriptUrl, 'https://script.google.com/macros/s/ticket/exec');
assert.equal(pending.shiftsScriptUrl, 'https://script.google.com/macros/s/shifts/exec');
assert.equal('syncSecret' in pending, false);
assert.equal(pending.syncV66Migration.status, 'pending');
assert.equal(pending.syncV66Migration.legacySecretWasPresent, true);
assert.equal(pending.syncV66Migration.legacyTicketEndpoint, pending.scriptUrl);
assert.equal(pending.syncV66Migration.legacyShiftsEndpoint, pending.shiftsScriptUrl);

pending.scriptUrl = 'https://script.google.com/macros/s/canonical/exec';
pending.syncHmacSecret = 'x'.repeat(32);
const complete = context.migrateSyncSettingsV66(pending, pending, '2026-08-23T11:00:00.000Z');
assert.equal(complete.syncV66Migration.status, 'complete');
assert.equal(complete.syncV66Migration.canonicalEndpoint, complete.scriptUrl);
assert.equal(complete.syncV66Migration.completedAt, '2026-08-23T11:00:00.000Z');
assert.equal(complete.syncV66Migration.legacyTicketEndpoint, 'https://script.google.com/macros/s/ticket/exec');
assert.equal(complete.syncV66Migration.legacyShiftsEndpoint, 'https://script.google.com/macros/s/shifts/exec');

complete.scriptUrl = '';
complete.syncHmacSecret = '';
context.migrateSyncSettingsV66(complete, complete, '2026-08-23T12:00:00.000Z');
assert.equal(complete.syncV66Migration.status, 'complete', 'completed marker is one-time and durable');
console.log('PASS safe one-time v66 sync settings migration marker and legacy endpoint retention');

'use strict';

/* Regression: «STALE після відновлення з файлового бекапу».
 *
 * Сценарій аудиту: заявка X на сервері вже revision 3 → звичайний повний
 * файловий бекап → відновлення на чистому пристрої → правка X → sync. До
 * фіксу клієнт надсилав addTicket revision 1, сервер відповідав читабельним
 * STALE (нічого не записавши), а рушій підтверджував це як успіх: черга
 * порожня, ✅ на картці, у Google Sheets (і в AI через MCP) — стара версія.
 *
 * Тут виконується СПРАВЖНІЙ Code.gs у vm з емуляцією Google Sheets і
 * СПРАВЖНІЙ браузерний стек (sync-contract → sync-transport → core → Engine →
 * backup-system.js → restore-from-sheets.js). Жодного продакшн-ресурсу.
 *
 * A  server r3 → file backup → clean restore → edit → sync → правка не губиться
 * B  STALE не знищує мовчки несинхронізовану локальну правку (конфлікт + рішення)
 * C  черга не вважається обробленою, доки сервер не прийняв
 * D  старий бекап без syncJournal відновлюється як і раніше (правка → конфлікт, не втрата)
 * E  «Відновити з Google Sheets» працює як раніше (baseline r3 → update r4 APPLIED)
 * F  звичайна синхронізація без відновлення — без регресії
 * G  створення нової заявки — без регресії
 * H  правка існуючої заявки — без регресії
 */

const assert = require('node:assert/strict');
const {createServer, createDevice, clone} = require('./helpers/sync-gas-harness');

const TICKET = {id: 'X', date: '19.09.2026', time: '10:00', content: 'v1', sum: 100, city: 'Дніпро', street: 'Робоча', house: '1'};

async function serverWithTicketAtRevision3(){
  const server = createServer();
  const A = await createDevice({server, name: 'A', modules: ['backup']});
  await A.addTicket(TICKET);
  await A.editTicket('X', {content: 'v2', sum: 200});
  await A.editTicket('X', {content: 'v3', sum: 300});
  assert.equal(server.state('ticket', 'X').revision, 3, 'precondition: server holds X at revision 3');
  assert.equal(server.ticketRow('X').content, 'v3');
  assert.deepEqual(A.sendLog.map(entry => entry.outcome), ['APPLIED', 'APPLIED', 'APPLIED']);
  return {server, A};
}

/* What the MCP Worker (and therefore the AI) reads: signed GET `list`. */
async function cloudView(device, id){
  const list = await device.listFromServer();
  const row = list.tickets.find(t => String(t.id) === String(id));
  const state = list.states.ticket.find(s => String(s.id) === String(id));
  return {content: row ? row.content : null, sum: row ? row.sum : null, revision: state ? state.revision : 0};
}

(async () => {
  /* ---------- A + F/G/H: file backup now carries the sync baseline ---------- */
  {
    const {server, A} = await serverWithTicketAtRevision3();
    await A.ctx.exportJsonBackup();
    assert.equal(A.encrypted.length, 1, 'exportJsonBackup encrypts exactly one payload');
    const payload = A.encrypted[0];
    assert.equal(payload.backupVersion, 6, 'backup schema version unchanged (old files stay compatible)');
    assert.ok(payload.syncJournal && payload.syncJournal.records, 'A: ordinary full file backup now contains the sync journal');
    assert.equal(payload.syncJournal.records['ticket:X'].committedRevision, 3, 'A: journal baseline for X is the server revision');
    assert.equal(A.ctx.MTBackupSystem.validatePayload(A.intoRealm(payload)), true, 'payload with syncJournal passes the existing validator');
    assert.equal(JSON.stringify(payload).includes(server.secret), false, 'HMAC secret never leaks into the backup');

    const B = await createDevice({server, name: 'B', modules: ['backup']});
    assert.deepEqual(B.journal(), {records: {}}, 'B starts as a clean device');
    assert.equal(await B.restoreFileBackup(payload), true, 'file restore succeeds on the clean device');
    assert.equal(B.ticket('X').content, 'v3', 'restored ticket content');
    assert.equal(B.record('ticket', 'X').committedRevision, 3, 'A: restore seeds the baseline from the backup journal');
    assert.equal(B.engine.pendingCount(), 0, 'restore itself enqueues nothing');
    assert.deepEqual(B.sendLog, [], 'restore sends nothing to the cloud');

    await B.editTicket('X', {content: 'v4 (edited on the new phone)', sum: 400});
    assert.deepEqual(B.sendLog.map(e => ({action: e.action, revision: e.revision, outcome: e.outcome})),
      [{action: 'updateTicket', revision: 4, outcome: 'APPLIED'}], 'A: edit after restore is an update on top of the server revision');
    assert.equal(server.state('ticket', 'X').revision, 4, 'A: server advanced to revision 4');
    assert.equal(server.ticketRow('X').content, 'v4 (edited on the new phone)', 'A: Google Sheets received the edit');
    assert.equal(server.ticketIds().length, 1, 'no duplicate row');
    assert.equal(B.engine.pendingCount(), 0);
    assert.equal(B.isSynced('ticket', 'X'), true, '✅ badge is truthful');
    assert.deepEqual(await cloudView(B, 'X'), {content: 'v4 (edited on the new phone)', sum: 400, revision: 4}, 'A: AI/MCP list shows the edited version');

    /* G — new ticket on the restored device */
    await B.addTicket({id: 'N1', date: '20.09.2026', time: '09:00', content: 'нова', sum: 50});
    assert.deepEqual(B.sendLog.at(-1), {entity: 'ticket', id: 'N1', action: 'addTicket', revision: 1, ok: true, outcome: 'APPLIED', serverRevision: 1}, 'G: new ticket is created as before');
    assert.equal(server.ticketRow('N1').content, 'нова');

    /* H — second ordinary edit of the existing ticket */
    await B.editTicket('X', {content: 'v5'});
    assert.deepEqual(B.sendLog.at(-1), {entity: 'ticket', id: 'X', action: 'updateTicket', revision: 5, ok: true, outcome: 'APPLIED', serverRevision: 5}, 'H: ordinary edit is an update as before');
    assert.equal(server.ticketRow('X').content, 'v5');

    /* F — the original device keeps syncing normally (its baseline is behind now: honest conflict, no silent loss) */
    await A.editTicket('X', {content: 'v6 from A'});
    const fromA = A.sendLog.at(-1);
    assert.equal(fromA.action, 'updateTicket');
    assert.equal(fromA.revision, 4, 'A sends its next revision');
    assert.equal(fromA.outcome, 'STALE', 'server refuses the behind-the-times revision');
    assert.ok(A.conflict('ticket', 'X'), 'F/B: the two-device divergence is surfaced as a conflict, not swallowed');
    assert.equal(server.ticketRow('X').content, 'v5', 'server keeps the newer version');
  }

  /* ---------- D: OLD backup file without syncJournal (pre-fix format) ---------- */
  {
    const {server, A} = await serverWithTicketAtRevision3();
    await A.ctx.exportJsonBackup();
    const oldPayload = clone(A.encrypted[0]);
    delete oldPayload.syncJournal; // exactly what every backup produced before this fix
    assert.equal(A.ctx.MTBackupSystem.validatePayload(A.intoRealm(oldPayload)), true);

    const B = await createDevice({server, name: 'B-old', modules: ['backup']});
    assert.equal(await B.restoreFileBackup(oldPayload), true, 'D: old backup without journal still restores');
    assert.equal(B.ticket('X').content, 'v3');
    assert.deepEqual(B.journal(), {records: {}}, 'D: no journal in the file → journal untouched (no baseline available)');
    assert.equal(B.engine.pendingCount(), 0);

    await B.editTicket('X', {content: 'v4 after old-format restore', sum: 400});
    const sent = B.sendLog.at(-1);
    assert.deepEqual({action: sent.action, revision: sent.revision, outcome: sent.outcome, serverRevision: sent.serverRevision},
      {action: 'addTicket', revision: 1, outcome: 'STALE', serverRevision: 3}, 'D: without a baseline the client still sends revision 1 and the server answers STALE');
    assert.equal(server.ticketRow('X').content, 'v3', 'server did not write anything on STALE');
    assert.equal(server.state('ticket', 'X').revision, 3);

    /* B + C — STALE is not a success any more */
    assert.equal(B.engine.pendingCount(), 1, 'C: the queue item is NOT considered processed');
    assert.equal(B.isSynced('ticket', 'X'), false, 'B: the card does not show ✅ for an unsent edit');
    const conflict = B.conflict('ticket', 'X');
    assert.ok(conflict, 'B: the edit is parked as an explicit conflict');
    assert.equal(conflict.server.revision, 3, 'conflict carries the current server revision');
    assert.equal(B.record('ticket', 'X').committedRevision, 0, 'B: baseline is not advanced past the unsent edit');
    assert.equal(B.ticket('X').content, 'v4 after old-format restore', 'local edit is preserved');
    assert.deepEqual(await cloudView(B, 'X'), {content: 'v3', sum: 300, revision: 3}, 'cloud/AI still has v3 — and the app now says so instead of ✅');

    /* no retry storm: a further flush does not resend a parked conflict */
    const sentBefore = B.sendLog.length;
    await B.flush();
    assert.equal(B.sendLog.length, sentBefore, 'C: parked conflict is not retried automatically');

    /* B — user keeps the local version through the existing conflict UI path
       (keepLocalTicketConflict → engine.keepLocalConflict with the server state) */
    const state = (await B.transport.getEntityState('ticket', 'X')).result.state;
    assert.equal(state.revision, 3);
    await B.engine.keepLocalConflict('ticket', 'X', state, B.ctx.ticketToSyncPayload(B.ticket('X')));
    await B.flush();
    const rebased = B.sendLog.at(-1);
    assert.deepEqual({action: rebased.action, revision: rebased.revision, outcome: rebased.outcome}, {action: 'updateTicket', revision: 4, outcome: 'APPLIED'}, 'B: keep-local rebases onto server revision + 1 and is applied');
    assert.equal(server.ticketRow('X').content, 'v4 after old-format restore', 'B: the edit reached Google Sheets');
    assert.equal(B.engine.pendingCount(), 0);
    assert.equal(B.isSynced('ticket', 'X'), true);
    assert.equal(B.conflict('ticket', 'X'), null);
    assert.deepEqual(await cloudView(B, 'X'), {content: 'v4 after old-format restore', sum: 400, revision: 4}, 'AI/MCP sees the edit');
    assert.equal(server.ticketIds().length, 1, 'still one row, same id');
  }

  /* ---------- B (accept-server branch): the other resolution also ends consistent ---------- */
  {
    const {server, A} = await serverWithTicketAtRevision3();
    await A.ctx.exportJsonBackup();
    const oldPayload = clone(A.encrypted[0]); delete oldPayload.syncJournal;
    const B = await createDevice({server, name: 'B-accept', modules: ['backup']});
    await B.restoreFileBackup(oldPayload);
    await B.editTicket('X', {content: 'local that will be discarded by choice'});
    assert.ok(B.conflict('ticket', 'X'));
    const state = (await B.transport.getEntityState('ticket', 'X')).result.state;
    await B.engine.acceptServerConflict('ticket', 'X', state);
    assert.equal(B.engine.pendingCount(), 0);
    assert.equal(B.record('ticket', 'X').committedRevision, 3, 'accept-server aligns the baseline to the server revision');
    await B.editTicket('X', {content: 'v4 after accepting server'});
    assert.deepEqual({action: B.sendLog.at(-1).action, revision: B.sendLog.at(-1).revision, outcome: B.sendLog.at(-1).outcome}, {action: 'updateTicket', revision: 4, outcome: 'APPLIED'}, 'next edit after accept-server syncs normally');
    assert.equal(server.ticketRow('X').content, 'v4 after accepting server');
  }

  /* ---------- E: «Відновити з Google Sheets» control path unchanged ---------- */
  {
    const {server} = await serverWithTicketAtRevision3();
    const C = await createDevice({server, name: 'C', modules: ['backup', 'restore']});
    const list = await C.listFromServer();
    const validation = C.ctx.MTRestoreFromSheets.validateCloudListPayload(list);
    assert.equal(validation.ok, true);
    const deps = C.ctx.MTSheetsRestoreRuntime.mtRestoreDeps();
    const ticketPlan = C.ctx.MTRestoreFromSheets.buildTicketPlan([], validation.tickets, deps);
    const baselineResult = C.ctx.MTRestoreFromSheets.baselineFromStates(C.ctx.MTRestoreFromSheets.baselineRequests(ticketPlan), validation.states);
    const applied = await C.ctx.MTSheetsRestoreRuntime.mtApplyRestore({
      ticketPlan, shiftPlan: null, cloudTickets: validation.tickets, cloudShifts: [], decisions: {tickets: {}, shifts: {}}, deps,
      baselines: baselineResult.baselines, skipCloud: baselineResult.skipCloud
    });
    assert.equal(applied.ok, true, 'E: Sheets restore applies');
    assert.equal(C.record('ticket', 'X').committedRevision, 3, 'E: Sheets restore seeds baseline r3 (as before)');
    await C.editTicket('X', {content: 'v4 via Sheets-restored phone'});
    assert.deepEqual({action: C.sendLog.at(-1).action, revision: C.sendLog.at(-1).revision, outcome: C.sendLog.at(-1).outcome}, {action: 'updateTicket', revision: 4, outcome: 'APPLIED'}, 'E: edit after Sheets restore is applied');
    assert.equal(server.ticketRow('X').content, 'v4 via Sheets-restored phone');
    assert.equal(C.engine.pendingCount(), 0);
  }

  /* ---------- Producers: every backup payload carries the journal; restore keeps pending work ---------- */
  {
    const {server, A} = await serverWithTicketAtRevision3();
    // external daily payload (photo-free by design) — journal included, photoData still absent
    await A.ctx.downloadExternalDailyBackup({dateKey: '2026-09-21'});
    const external = A.encrypted.at(-1);
    assert.ok(external.syncJournal && external.syncJournal.records['ticket:X'], 'external daily backup carries the journal');
    assert.equal(Object.prototype.hasOwnProperty.call(external, 'photoData'), false, 'external daily payload still has no photoData (intentional)');
    // daily IndexedDB slot
    await A.ctx.maybeRunDailyBackup();
    const slotKey = [...A.backupDbStore.keys()].find(key => /^\d{4}-\d{2}-\d{2}$/.test(key));
    assert.ok(slotKey, 'daily slot written');
    assert.equal(A.backupDbStore.get(slotKey).syncJournal.records['ticket:X'].committedRevision, 3, 'daily IndexedDB slot carries the journal');
    // downloadDailyBackup re-exports the slot with its journal
    await A.ctx.downloadDailyBackup(slotKey);
    assert.equal(A.encrypted.at(-1).syncJournal.records['ticket:X'].committedRevision, 3, 'daily slot download keeps the slot journal');
    // legacy slot without journal → download has no journal (no fabrication)
    A.backupDbStore.set('legacy-1', {app: 'master-tracker', backupVersion: 6, exportedAt: '2026-01-01T00:00:00.000Z', tickets: [], shifts: [], settings: {}, legacyMigrated: true});
    await A.ctx.downloadDailyBackup('legacy-1');
    assert.equal(Object.prototype.hasOwnProperty.call(A.encrypted.at(-1), 'syncJournal'), false, 'legacy slot without journal is exported without one');
    // degraded mode (no engine): payload without journal, restore of it leaves the journal alone
    const savedEngine = A.ctx.syncEngine; A.ctx.syncEngine = null;
    await A.ctx.exportJsonBackup();
    assert.equal(Object.prototype.hasOwnProperty.call(A.encrypted.at(-1), 'syncJournal'), false, 'without an engine no empty journal is written into the backup');
    A.ctx.syncEngine = savedEngine;

    // Restoring a journal snapshot that has a pending (unsent) mutation keeps it pending and sends it after restore.
    const A2 = await createDevice({server, name: 'A2', modules: ['backup'], online: false});
    A2.ctx.tickets = [clone(A.ticket('X'))]; A2.ctx.syncTicketsSnapshot = clone(A2.ctx.tickets);
    await A2.engine.seedBaselines([{entity: 'ticket', id: 'X', revision: 3, tombstone: false}]);
    await A2.editTicket('X', {content: 'offline edit'}); // offline: stays queued
    assert.equal(A2.engine.pendingCount(), 1);
    await A2.ctx.exportJsonBackup();
    const withPending = A2.encrypted.at(-1);
    assert.ok(withPending.syncJournal.records['ticket:X'].head, 'pending mutation is part of the backup journal');
    const B2 = await createDevice({server, name: 'B2', modules: ['backup']});
    await B2.restoreFileBackup(withPending);
    assert.equal(B2.engine.pendingCount(), 1, 'restored journal keeps the pending mutation');
    await B2.flush();
    assert.deepEqual({action: B2.sendLog.at(-1).action, revision: B2.sendLog.at(-1).revision, outcome: B2.sendLog.at(-1).outcome}, {action: 'updateTicket', revision: 4, outcome: 'APPLIED'}, 'pending mutation from the backup is delivered after restore');
    assert.equal(server.ticketRow('X').content, 'offline edit');
  }

  console.log('PASS file-backup restore keeps the sync baseline; readable STALE parks the edit as a conflict instead of a fake ✅ (real Code.gs + real sync stack)');
})().catch(error => { console.error(error); process.exitCode = 1; });

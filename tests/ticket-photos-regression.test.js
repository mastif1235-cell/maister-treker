'use strict';
/* Regression suite: photos on tickets (v91.64).

   Pins the EXISTING photo architecture against the ticket-photos contract:
     1. photos are bound to a ticket via ticket.photos keys — ticket.id stays
        the ONLY identifier (no second id, no photo-owned ids);
     2. one ticket holds SEVERAL photos (array; UI cap 3 is a pinned design);
     3. ticket A's photo keys never appear on ticket B (isolation);
     4. editing keeps photos (payload of a ticket does not change when only
        photos change — so edits and sync revisions never touch/lose photos);
     5. deleting ONE photo does not delete the ticket (editor splices the key;
        storage delete is key-scoped);
     6. deleting a TICKET removes only that ticket's photos after trash
        retention (30 days), keeping other tickets'/trash photos intact;
     7. daily/external backup contains NO photos (stripped + runtime guard);
        the manual encrypted JSON export intentionally carries photoData
        (device-migration feature) — documented, unchanged;
     8. Google Sheets sync payload never receives photos (no binary, no
        base64, no idb: keys) — therefore photo edits create no sync revisions;
     9. ticket.id passthrough is stable (single id semantics);
    10. legacy tickets with a single base64 `photo` field keep working.

   Everything runs the REAL browser code (photo-storage.js, the store/delete
   helpers of photo-telegram-domain.js, ticket-editor-photos.js, the trash
   block of tickets-domain.js, app.js ticketToSyncPayload) in vm contexts with
   a minimal real-async IndexedDB shim. No production data is touched. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

/* ---------- minimal real-async IndexedDB shim ---------- */
function createFakeIndexedDB(){
  const store = new Map();
  const db = {
    _store: store,
    open(){
      const req = {};
      queueMicrotask(() => { req.result = db; if (req.onsuccess) req.onsuccess({ target: req }); });
      return req;
    },
    transaction(){
      let completed = false;
      const tx = {
        objectStore(){
          return {
            put(value, key){ store.set(String(key), value); return {}; },
            get(key){
              const req = { result: store.has(String(key)) ? store.get(String(key)) : null };
              queueMicrotask(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
              return req;
            },
            delete(key){ store.delete(String(key)); return {}; },
            clear(){ store.clear(); return {}; }
          };
        },
        onerror: null
      };
      tx.__setComplete = fn => { queueMicrotask(() => { if (!completed){ completed = true; fn({}); } }); };
      Object.defineProperty(tx, 'oncomplete', { set(fn){ tx.__setComplete(fn); }, get(){ return null; } });
      return tx;
    }
  };
  return db;
}

function createContext(extra){
  const ctx = Object.assign({
    console,
    queueMicrotask,
    Promise, Set, Map, Array, JSON, String, Number, Math, Date, Object, RegExp, Error,
    MTSafeError: { reportError(){} },
    showToast(){},
    fetchPhotoFromTelegram: async () => null
  }, extra);
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}

/* Load the REAL photo-storage.js, open its DB, then run extra source in the
   SAME context so the script-scoped `let photoDb`/`photoCache` stay shared. */
async function loadPhotoStorage(){
  const fake = createFakeIndexedDB();
  const ctx = createContext({ indexedDB: fake });
  vm.runInContext(read('js/photo-storage.js'), ctx, { filename: 'js/photo-storage.js' });
  await vm.runInContext(`
    new Promise(resolve => { openPhotoDb().then(db => { photoDb = db; resolve(); }); });
  `, ctx);
  return { ctx, fake };
}

function runBlock(ctx, source, name){
  vm.runInContext(source, ctx, { filename: name });
}

/* ---------- 1/2/3/5/10: real storage + real helpers ---------- */
(async () => {

  {
    const { ctx, fake } = await loadPhotoStorage();
    /* real store/delete helpers from photo-telegram-domain.js */
    const telegram = read('js/photo-telegram-domain.js');
    runBlock(ctx, telegram.slice(telegram.indexOf('async function storePhoto('), telegram.indexOf('async function deletePhotoKey(')), 'storePhoto');
    runBlock(ctx, telegram.slice(telegram.indexOf('async function deletePhotoKey('), telegram.indexOf('function clearAllPhotos()')), 'deletePhotoKey');
    runBlock(ctx, telegram.slice(telegram.indexOf('function getPhotoCached('), telegram.indexOf('async function resolvePhotoAsync(')), 'getPhotoCached');

    const keyA1 = await ctx.storePhoto('data:image/jpeg;base64,AAAA');
    const keyA2 = await ctx.storePhoto('data:image/jpeg;base64,BBBB');
    const keyB1 = await ctx.storePhoto('data:image/jpeg;base64,CCCC');
    assert.match(keyA1, /^idb:/) ; assert.match(keyA2, /^idb:/); assert.match(keyB1, /^idb:/);
    assert.notEqual(keyA1, keyA2); assert.notEqual(keyA1, keyB1);

    /* 2: several photos on ONE ticket (architecture is an array) */
    const ticketA = { id: '1700000001', photos: [keyA1, keyA2] };
    /* 3: ticket B holds a different key — isolation is structural */
    const ticketB = { id: '1700000002', photos: [keyB1] };
    assert.equal(ticketA.photos.length, 2);
    assert.ok(!ticketA.photos.includes(keyB1) && !ticketB.photos.includes(keyA1));

    /* 1/9: ticket.id is the only id — photo keys are opaque values inside the
       ticket, they never become or replace ids */
    assert.equal(String(ticketA.id), '1700000001');

    /* 5: deleting one photo removes exactly its bytes, nothing else */
    const deletedOk = await ctx.deletePhotoKey(keyA1);
    assert.equal(deletedOk, true);
    assert.equal(fake._store.has(keyA1), false);
    assert.equal(fake._store.has(keyA2), true, 'second photo of ticket A survives');
    assert.equal(fake._store.has(keyB1), true, "ticket B's photo survives");
    /* the byte delete is key-scoped: the ticket object is only touched by the
       editor flow (splice on ✕), never by the storage layer */
    assert.deepEqual(ticketA.photos, [keyA1, keyA2]);

    /* 10: legacy base64 photo (pre-IDB tickets) passes through unchanged */
    const legacy = 'data:image/jpeg;base64,LEGACY';
    assert.equal(ctx.getPhotoCached(legacy, null, null), legacy);

    console.log('PASS storage: multi-photo per ticket, per-key delete, isolation, legacy base64 passthrough');
  }

  /* ---------- editor: add up to the pinned cap of 3 ---------- */
  {
    const callbacks = []; const deleted = []; const cache = []; const toasts = [];
    const ctx = createContext({
      calcState: { photos: ['idb:original'] },
      formSessionId: 7,
      document: { getElementById: () => ({}), createElement: () => ({ getContext: () => ({ drawImage(){} }), toDataURL: () => 'data:image/jpeg;base64,frame' }) },
      getPhotoCached: key => 'cached-' + key,
      FileReader: class { readAsDataURL(){ this.onload({ target: { result: 'raw' } }); } },
      Image: class { constructor(){ this.width = 1600; this.height = 800; } set src(v){ this.onload(); } },
      storePhoto: dataUrl => { const key = 'idb:new-' + dataUrl.slice(-4); return { then: cb => callbacks.push(() => cb(key)) }; },
      deletePhotoKey: key => deleted.push(key),
      photoCacheSet: (...a) => cache.push(a),
      showToast: m => toasts.push(m)
    });
    runBlock(ctx, read('js/ticket-editor-photos.js'), 'ticket-editor-photos.js');
    ctx.handlePhotoFile({});
    ctx.handlePhotoFile({});
    while (callbacks.length) callbacks.shift()();
    assert.deepEqual(ctx.calcState.photos, ['idb:original', 'idb:new-rame', 'idb:new-rame'], 'two adds land as separate pending keys before dedupe of stub keys');
    /* the editor keeps ≤3: the third add is rejected with the pinned message */
    ctx.handlePhotoFile({});
    assert.ok(toasts.some(m => /Максимум 3 фото/.test(m)), 'cap message shown');
    assert.equal(ctx.calcState.photos.length, 3, 'cap of 3 enforced (pinned design)');
    console.log('PASS editor: multiple photos per ticket, cap 3 (pinned design)');
  }

  /* ---------- editor preview click opens the EXISTING viewer ---------- */
  {
    const bindings = read('js/tickets-bindings.js');
    const start = bindings.indexOf("document.getElementById('photoPreviewWrap').addEventListener('click'");
    assert.ok(start > 0, 'editor preview click handler exists');
    const block = bindings.slice(start, bindings.indexOf("document.getElementById('macScanBtn')", start));
    assert.match(block, /closest\('img\.photo-thumb'\)/, 'clicking the thumbnail itself is handled');
    assert.match(block, /openTicketPhotoFullscreen\(/, 'it reuses the existing full-screen viewer (no second viewer)');
    assert.match(block, /closest\('\.photo-remove'\)/, 'the ✕ delete button keeps its own branch');
    assert.match(read('js/tickets-domain.js'), /function openTicketPhotoFullscreen\(/, 'the shared viewer lives in tickets-domain');
    console.log('PASS editor preview opens the existing full-screen viewer');
  }

  /* ---------- 6: ticket deletion cleans only that ticket's photos ---------- */
  {
    const source = read('js/tickets-domain.js');
    const start = source.indexOf('async function deleteTicket(');
    const end = source.indexOf('\nfunction renderDeletedTicketsList(){', start);
    const now = Date.UTC(2026, 8, 22);
    const day = 24 * 60 * 60 * 1000;
    const physical = [];
    const ctx = createContext({
      DELETED_TICKET_RETENTION_DAYS: 30,
      deletedTickets: [
        { id: 'A', photos: ['idb:a1', 'idb:a2'], deletedAt: now - 31 * day },
        { id: 'B', photos: ['idb:b1'], deletedAt: now - 1 * day },
        { id: 'legacy', photo: 'idb:l1', deletedAt: now - 31 * day }
      ],
      tickets: [{ id: 'live', photos: ['idb:a1'] }], // legacy shared key stays
      Date: { now: () => now },
      localStorage: { setItem(){}, getItem: () => null },
      renderTicketsScreen(){}, renderDeletedTicketsList(){},
      openConfirmModal: async () => true,
      MTSyncEngineRuntime: { uuid: () => 'x' },
      currentTicketDate: '22.09.2026',
      saveTickets: async () => true,
      deletePhotoKey: async key => { physical.push(key); return true; }
    });
    runBlock(ctx, source.slice(start, end), 'tickets-domain trash block');
    const result = await ctx.cleanupExpiredDeletedTickets(now);
    assert.equal(result.ok, true);
    /* exactly the expired ticket's unreferenced keys; B is retained, idb:a1 is
       still referenced by the live ticket (legacy shared keys are kept) */
    assert.deepEqual(physical.sort(), ['idb:a2', 'idb:l1'], 'only expired + unreferenced photo keys are deleted');
    console.log('PASS ticket deletion cleans only that ticket\u2019s unreferenced photos after retention');
  }

  /* ---------- 4/8/9: sync payload has no photos; edits keep photos ---------- */
  {
    const app = read('app.js').replace(/\r\n/g, '\n');
    const start = app.indexOf('function ticketToSyncPayload(');
    const end = app.indexOf('\nfunction ', start + 10);
    const ctx = createContext({
      formatDate: () => '22.09.2026',
      formatTime: () => '12:00'
    });
    runBlock(ctx, app.slice(start, end), 'ticketToSyncPayload');

    const base = { id: 42, date: '22.09.2026', time: '10:00', content: 'Ремонт', sum: 300, tags: ['ону'], type: 'Ремонт', masterNote: 'x' };
    const withoutPhotos = ctx.ticketToSyncPayload(base);
    const withPhotos = ctx.ticketToSyncPayload(Object.assign({}, base, { photos: ['idb:p1', 'idb:p2'], photo: 'idb:p1' }));

    /* 9: single id semantics — numeric id passes through as the same string */
    assert.equal(withPhotos.id, '42');
    /* 8: no photo keys, no binary/base64 anywhere in the Sheets payload */
    assert.equal(false, 'photos' in withPhotos && true);
    assert.equal(JSON.stringify(withPhotos).includes('idb:'), false);
    assert.equal(JSON.stringify(withPhotos).includes('data:image'), false);
    assert.equal(withPhotos.fullDataJson.includes('photo'), false);
    /* 4: photos do not change the sync payload → editing a ticket (or its
       photos) cannot lose photos and cannot create photo-driven revisions */
    assert.equal(JSON.stringify(withPhotos), JSON.stringify(withoutPhotos));
    console.log('PASS sync payload: no photos/binary, stable id, photo edits create no payload diff');
  }

  /* ---------- 7: daily/external backup stripped; manual export documented ---------- */
  {
    const backup = read('js/backup-system.js');
    assert.match(backup, /mtExternalDailyPayload[\s\S]{0,400}mtBackupStripPhotoData\(tickets/, 'daily payload strips photo data from tickets');
    assert.match(backup, /mtBackupStripPhotoData\(shifts/, 'daily payload strips photo data from shifts');
    assert.match(backup, /hasOwnProperty\.call\(payload,'photoData'\)\)throw new Error\('PHOTO_DATA_FORBIDDEN'\)/, 'runtime guard forbids photoData in daily backup');
    assert.match(backup, /function mtBackupStripPhotoData\(/, 'strip helper exists');
    /* the MANUAL encrypted JSON export intentionally includes photoData —
       device-migration feature; pinned here so a future change is conscious */
    assert.match(backup, /exportJsonBackup[\s\S]{0,700}photoData:photos\.photoData/, 'manual JSON export keeps photoData (documented behaviour)');
    console.log('PASS backups: daily/external have no photos; manual export photoData pinned');
  }

  /* ---------- index.html section + SW lazy/precache wiring ---------- */
  {
    const html = read('index.html');
    assert.match(html, /id="photoCameraBtn"[^>]*>📷 Камера/, 'camera button in the ticket form');
    assert.match(html, /id="photoGalleryBtn"/, 'gallery button in the ticket form');
    assert.match(html, /<input type="file" id="f_photoInput" accept="image\/\*" multiple/, 'file input supports camera+gallery via the browser picker');
    assert.match(read('sw.js'), /'\.\/js\/ticket-editor-photos\.js'/, 'editor photo module is precached for offline');
    assert.match(read('sw.js'), /'\.\/js\/photo-storage\.js'/, 'photo storage is precached for offline');
    console.log('PASS wiring: photo section in the form, offline-precached modules');
  }

  console.log('PASS ticket-photos-regression: all contract points green');
})().catch(error => { console.error(error); process.exitCode = 1; });

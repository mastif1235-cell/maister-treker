'use strict';
// Пункт 11 (аудит v91.27): ручна повна відправка локальної бази в Google
// Sheets. Перевіряється РУЧНИЙ сценарій: confirm → постановка ВСІХ локальних
// записів у безпечний журнал → flush → звіт (скільки заявок/змін надіслано,
// чи були помилки). Хмарні дані, що виявились свіжішими, не перезаписуються
// мовчки (STALE/CONFLICT потрапляють у звіт), offline лишає мутації в
// журналі, tombstone/конфліктні записи пропускаються без ламання журналу.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../js/sync-engine-core.js');
const { Engine } = require('../js/sync-engine-runtime.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'sync-full-push.js'), 'utf8');

function journal(seed = { records: {} }){
  let value = JSON.parse(JSON.stringify(seed));
  return {
    load: async () => JSON.parse(JSON.stringify(value)),
    save: async v => { value = JSON.parse(JSON.stringify(v)); },
    value: () => value
  };
}

function makeContext({ online = true, scriptUrl = 'https://script.example', confirm = true, tickets = [], shifts = [], seed = { records: {} }, send } = {}){
  const storage = journal(seed);
  const sent = [];
  const transport = {
    send: async mutation => {
      sent.push({ entity: mutation.entity, id: mutation.id, action: mutation.action, revision: mutation.revision });
      return send ? send(mutation) : { ok: true, state: { revision: mutation.revision, tombstone: false }, result: { status: 'ok', outcome: 'APPLIED' } };
    }
  };
  const engine = new Engine({
    core, storage, transport,
    payload: (entity, item) => (entity === 'ticket' ? { id: String(item.id), content: String(item.content || '') } : { id: String(item.id), date: String(item.date || ''), hours: Number(item.hours) || 0, coworker: String(item.coworker || 'Сам') }),
    online: () => online,
    setTimeout: () => 0, clearTimeout: () => {},
    onChange: () => {}
  });
  const toasts = [], modals = [];
  const context = {
    console,
    syncEngine: engine,
    tickets, shifts,
    navigator: { onLine: online },
    getScriptUrl: () => scriptUrl,
    showToast: m => toasts.push(m),
    openConfirmModal: async () => confirm,
    openModal: (title, html) => { modals.push({ title, html }); },
    renderSyncQueueBanner: () => {},
    MTSafeError: { reportError: () => {} }
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'js/sync-full-push.js' });
  return { context, engine, storage, transport, sent, toasts, modals };
}

const ticket = (id, content) => ({ id, content: content || 'заявка ' + id, date: '01.09.2026', time: '10:00', sum: 100 });
const shift = (id, hours) => ({ id, date: '01.09.2026', hours: hours || 8, coworker: 'Сам' });

(async () => {
  /* 1. Щасливий шлях: уся локальна база надсилається поштучно через журнал */
  {
    const env = makeContext({ tickets: [ticket('t1'), ticket('t2')], shifts: [shift('s1')] });
    await env.engine.init();
    const ok = await env.context.mtSyncFullPushLocalDatabase({});
    assert.equal(ok, true, 'повна відправка успішна');
    assert.deepEqual(env.sent.map(x => x.entity + ':' + x.id).sort(), ['shift:s1', 'ticket:t1', 'ticket:t2'], 'надіслано ВСІ локальні записи, не лише зміни');
    assert.ok(env.sent.every(x => x.action === 'addTicket' || x.action === 'addShift'), 'нові сутності йдуть як add-мутації журналу');
    assert.equal(env.engine.pendingCount(), 0, 'журнал порожній після відправки');
    assert.equal(env.modals.length, 1, 'показано підсумковий звіт');
    assert.match(env.modals[0].html, /Заявки:<\/strong> надіслано 2 із 2/, 'звіт: заявки');
    assert.match(env.modals[0].html, /Зміни:<\/strong> надіслано 1 із 1/, 'звіт: зміни');
    assert.match(env.modals[0].html, /Усю локальну базу надіслано/, 'звіт без помилок');
    assert.equal(env.storage.value().records['ticket:t1'].committedRevision, 1, 'журнал зафіксував revision');
  }

  /* 2. Повторна відправка вже синхронізованої бази — update-мутації, без дублів */
  {
    const env = makeContext({ tickets: [ticket('t1')], shifts: [] });
    await env.engine.init();
    await env.context.mtSyncFullPushLocalDatabase({});
    env.sent.length = 0;
    await env.context.mtSyncFullPushLocalDatabase({});
    assert.deepEqual(env.sent.map(x => x.action), ['updateTicket'], 'другий прохід — update, журнал не ламається');
    assert.equal(env.engine.pendingCount(), 0);
  }

  /* 3. Хмара свіжіша (STALE): локальна мутація не перезаписує хмару, звіт чесний */
  {
    const env = makeContext({
      tickets: [ticket('t1'), ticket('t2')], shifts: [],
      send: m => (m.id === 't1'
        ? { ok: true, state: { revision: 55, tombstone: false }, result: { status: 'ok', outcome: 'STALE' } }
        : { ok: true, state: { revision: m.revision, tombstone: false }, result: { status: 'ok', outcome: 'APPLIED' } })
    });
    await env.engine.init();
    await env.context.mtSyncFullPushLocalDatabase({});
    assert.match(env.modals[0].html, /надіслано 1 із 2/, 'одна заявка реально надіслана');
    assert.match(env.modals[0].html, /у хмарі новіше — не перезаписано: 1/, 'STALE показано у звіті, а не проковтнуто');
    assert.match(env.modals[0].html, /свіжіша версія — вона НЕ перезаписана/, 'STALE не ховається за загальним «усе надіслано»');
  }

  /* 4. Конфлікт: журнал позначає conflict, звіт показує його */
  {
    const env = makeContext({
      tickets: [], shifts: [shift('s1')],
      send: () => ({ ok: false, result: { status: 'error', code: 'CONFLICT', state: { revision: 9, tombstone: false } } })
    });
    await env.engine.init();
    await env.context.mtSyncFullPushLocalDatabase({});
    assert.match(env.modals[0].html, /конфлікти: 1/, 'конфлікт у звіті');
    const record = env.engine.state.records['shift:s1'];
    assert.ok(record && record.conflict, 'конфлікт лишився в журналі для явного розбору');
  }

  /* 5. Мережева/серверна помилка: мутації лишаються в черзі, звіт показує помилку */
  {
    const env = makeContext({ tickets: [ticket('t1')], shifts: [], send: () => ({ ok: false, result: { status: 'error', code: 'SERVER_ERROR' } }) });
    await env.engine.init();
    await env.context.mtSyncFullPushLocalDatabase({});
    assert.match(env.modals[0].html, /помилки відправки: 1/, 'серверна помилка у звіті');
    assert.ok(env.engine.pendingCount() >= 1, 'невідправлене лишається в журналі для автоповтора');
  }

  /* 6. Offline: confirm → усе в журнал, жодної мережевої спроби, звіт про offline */
  {
    const env = makeContext({ online: false, tickets: [ticket('t1')], shifts: [shift('s1')] });
    await env.engine.init();
    const ok = await env.context.mtSyncFullPushLocalDatabase({});
    assert.equal(ok, true, 'offline-сценарій не падає');
    assert.equal(env.sent.length, 0, 'жодної відправки без мережі');
    assert.equal(env.engine.pendingCount(), 2, 'мутації збережені в журналі й підуть автоматично після появи мережі');
    assert.match(env.modals[0].html, /Немає з'єднання/, 'звіт пояснює offline-стан');
    assert.match(env.modals[0].html, /лишилось у черзі: 1/, 'черга показана по сутностях');
  }

  /* 7. Скасування confirm: нічого не відбувається */
  {
    const env = makeContext({ confirm: false, tickets: [ticket('t1')], shifts: [shift('s1')] });
    await env.engine.init();
    const ok = await env.context.mtSyncFullPushLocalDatabase({});
    assert.equal(ok, false, 'скасовано користувачем');
    assert.equal(env.sent.length, 0);
    assert.equal(env.engine.pendingCount(), 0, 'журнал не чіпали');
    assert.equal(env.modals.length, 0, 'без звіту');
  }

  /* 8. Вартові: немає URL / немає рушія — зрозумілий тост, без записів */
  {
    const noUrl = makeContext({ scriptUrl: '', tickets: [ticket('t1')], shifts: [] });
    await noUrl.engine.init();
    assert.equal(await noUrl.context.mtSyncFullPushLocalDatabase({}), false);
    assert.match(noUrl.toasts.join(' | '), /URL Apps Script/);
    assert.equal(noUrl.engine.pendingCount(), 0);

    const noEngine = makeContext({ tickets: [ticket('t1')], shifts: [] });
    await noEngine.engine.init();
    noEngine.context.syncEngine = null;
    assert.equal(await noEngine.context.mtSyncFullPushLocalDatabase({}), false);
    assert.match(noEngine.toasts.join(' | '), /недоступна/);
  }

  /* 9. Tombstone і невирішений конфлікт пропускаються, журнал не ламається */
  {
    const conflictHead = { entity: 'ticket', id: 'c1', action: 'updateTicket', revision: 4, requestId: 'mt.conflict_req', body: { action: 'updateTicket', id: 'c1', revision: 4 }, attempted: true };
    const seed = { records: {
      'ticket:gone': { entity: 'ticket', id: 'gone', committedRevision: 3, tombstone: true, head: null, tail: null, conflict: null },
      'ticket:c1': { entity: 'ticket', id: 'c1', committedRevision: 3, tombstone: false, head: conflictHead, tail: null, conflict: { code: 'CONFLICT', requestId: 'mt.conflict_req', server: { revision: 9 } } }
    } };
    const env = makeContext({ tickets: [ticket('gone'), ticket('c1'), ticket('fresh')], shifts: [], seed });
    await env.engine.init();
    const ok = await env.context.mtSyncFullPushLocalDatabase({});
    assert.equal(ok, true);
    assert.deepEqual(env.sent.map(x => x.id), ['fresh'], 'tombstone і конфліктний записи не відправляються');
    assert.match(env.modals[0].html, /видалені в хмарі — 1, з невирішеним конфліктом — 1/, 'пропуски пояснені у звіті');
    assert.equal(env.engine.pendingCount(), 1, 'наявний конфлікт лишився недоторканим');
    core.assertInvariants(env.engine.state);
  }

  /* 10. Порожня база — дія відхиляється до confirm */
  {
    const env = makeContext({ tickets: [], shifts: [] });
    await env.engine.init();
    assert.equal(await env.context.mtSyncFullPushLocalDatabase({}), false);
    assert.match(env.toasts.join(' | '), /порожня/);
  }

  /* 11. Автоматичного запуску немає: модуль не виконує відправку при завантаженні */
  {
    assert.equal(/DOMContentLoaded|window\.addEventListener\('load'|setInterval|setTimeout\([^)]*mtSyncFullPush/.test(source), false, 'жодних авто-тригерів у модулі');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /id="fullPushLocalDbBtn"/, 'кнопка в налаштуваннях синхронізації');
    const settingsDomain = fs.readFileSync(path.join(__dirname, '..', 'js', 'settings-domain.js'), 'utf8');
    assert.match(settingsDomain, /fullPushLocalDbBtn'\)\.addEventListener\('click'/, 'кнопка прив’язана до ручної дії');
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    assert.ok(sw.includes("'./js/sync-full-push.js'"), 'модуль у precache sw.js');
  }

  console.log('PASS manual full push: confirm-gated, journal-safe, cloud-newer protected, offline/error aware, reported');
})().catch(error => { console.error(error); process.exitCode = 1; });

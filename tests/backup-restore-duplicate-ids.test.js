'use strict';
// Пункт 18 (аудит v91.27): регресійний тест дедуплікації ID при відновленні
// JSON-бекапу. Один backup-файл містить дві заявки з однаковим ID (включно з
// парою 2 / '2', яка збігається лише після String(id)) і дві зміни з однаковим
// ID. Після restore в базі не повинно існувати двох сутностей з однаковим
// String(id), але жоден запис не повинен бути втрачений.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'backup-system.js'), 'utf8')
  .replace('  async function mtBackupMigrateLegacySlots(){', '  globalThis.__mtBackupRestore=mtBackupRestore;\n  async function mtBackupMigrateLegacySlots(){');

function harness(){
  const state = { ticketWrites: 0, shiftWrites: 0, savedTickets: null, savedShifts: null };
  const context = {
    console, crypto: webcrypto, TextEncoder, TextDecoder, Blob,
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    setTimeout: () => 1, clearTimeout: () => {}, btoa, atob,
    window: {}, document: { getElementById: () => null, createElement: () => ({ click(){} }) },
    prompt: () => null, confirm: () => true,
    openConfirmModal: async () => true, showToast: () => {},
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    backupDbGet: async () => null, backupDbPut: async () => true, backupDbDelete: async () => true,
    localDateKey: () => '', blankTicketObject: () => ({}),
    securityRuntimeSanitizeTicket: value => value,
    securitySanitizeSettingsForBackup: value => value,
    securityMergeImportedSettings: value => value,
    saveSettings(){}, settings: { theme: 'dark' },
    tickets: [], shifts: [], syncTicketsSnapshot: [], syncShiftsSnapshot: [],
    MTSyncEngineRuntime: { uuid: () => 'generated-uuid' },
    saveTicketsLocalOnly: async () => { state.ticketWrites++; state.savedTickets = JSON.parse(JSON.stringify(context.tickets)); return true; },
    saveShiftsLocalOnly: async () => { state.shiftWrites++; state.savedShifts = JSON.parse(JSON.stringify(context.shifts)); return true; },
    photoDbPut: async () => true, migrateLegacyPhotosToIdb: async () => {},
    renderTicketsScreen(){}, renderShiftsScreen(){}, renderSettingsScreen(){},
    state
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'js/backup-system.js' });
  return context;
}

(async () => {
  const ctx = harness();
  const payload = {
    app: 'master-tracker',
    tickets: [
      { id: 't1', content: 'перша заявка' },
      { id: 't1', content: 'друга заявка з тим самим id' },
      { id: 2, content: 'числовий id' },
      { id: '2', content: 'строковий id, дублікатує числовий після String(id)' }
    ],
    shifts: [
      { id: 's1', date: '01.01.2026', hours: 5, coworker: 'Сам' },
      { id: 's1', date: '02.01.2026', hours: 6, coworker: 'Сам' }
    ]
  };

  const restored = await ctx.__mtBackupRestore(vm.runInContext('(' + JSON.stringify(payload) + ')', ctx));
  assert.equal(restored, true, 'відновлення з дублікатами ID успішне');

  // Жоден запис не втрачено.
  assert.equal(ctx.tickets.length, 4, 'усі 4 заявки відновлено');
  assert.equal(ctx.shifts.length, 2, 'обидві зміни відновлені');
  assert.equal(JSON.stringify(ctx.tickets.map(t => t.content)), JSON.stringify([
    'перша заявка', 'друга заявка з тим самим id', 'числовий id', 'строковий id, дублікатує числовий після String(id)'
  ]), 'вміст усіх заявок збережено');

  // Унікальність String(id) після відновлення.
  const ticketIds = ctx.tickets.map(t => String(t.id));
  assert.equal(new Set(ticketIds).size, ticketIds.length, 'немає двох заявок з однаковим String(id)');
  const shiftIds = ctx.shifts.map(s => String(s.id));
  assert.equal(new Set(shiftIds).size, shiftIds.length, 'немає двох змін з однаковим String(id)');

  // Перший запис у кожній парі дублікатів зберігає свій оригінальний ID.
  assert.equal(String(ctx.tickets[0].id), 't1', 'перша заявка зберігає id');
  assert.notEqual(String(ctx.tickets[1].id), 't1', 'дублікат отримав новий id');
  assert.equal(String(ctx.tickets[2].id), '2', 'числовий id першого з пари збережено');
  assert.notEqual(String(ctx.tickets[3].id), '2', 'дублікат 2/\'2\' розведений через String(id)');
  assert.equal(String(ctx.shifts[0].id), 's1', 'перша зміна зберігає id');
  assert.notEqual(String(ctx.shifts[1].id), 's1', 'дублікат зміни отримав новий id');

  // Дедуплікація сталася ДО фінального запису: збережений стан уже без дублікатів.
  assert.equal(ctx.state.ticketWrites, 1, 'одна атомарна запис заявок');
  assert.equal(ctx.state.shiftWrites, 1, 'одна атомарна запис змін');
  const savedTicketIds = ctx.state.savedTickets.map(t => String(t.id));
  assert.equal(new Set(savedTicketIds).size, savedTicketIds.length, 'у записаному стані немає дублікатів String(id)');
  const savedShiftIds = ctx.state.savedShifts.map(s => String(s.id));
  assert.equal(new Set(savedShiftIds).size, savedShiftIds.length, 'у записаних змінах немає дублікатів String(id)');

  // Sync-знімки вирівняні з відновленими даними (жодних додаткових мутацій хмари).
  assert.equal(JSON.stringify(ctx.syncTicketsSnapshot), JSON.stringify(ctx.tickets), 'знімок заявок вирівняний');
  assert.equal(JSON.stringify(ctx.syncShiftsSnapshot), JSON.stringify(ctx.shifts), 'знімок змін вирівняний');

  // Бекап без дублікатів поводиться як раніше: ID не змінюються.
  const clean = harness();
  await clean.__mtBackupRestore(vm.runInContext('(' + JSON.stringify({
    app: 'master-tracker',
    tickets: [{ id: 'a1', content: 'x' }, { id: 'a2', content: 'y' }],
    shifts: [{ id: 's1', date: '01.01.2026', hours: 8, coworker: 'Сам' }]
  }) + ')', clean));
  assert.equal(JSON.stringify(clean.tickets.map(t => String(t.id))), JSON.stringify(["a1","a2"]), 'чистий бекап не змінює id');
  assert.equal(JSON.stringify(clean.shifts.map(s => String(s.id))), JSON.stringify(["s1"]), 'чисті зміни не змінюють id');

  console.log('PASS backup restore deduplicates String(id) duplicates inside one backup file');
})().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';
const assert = require('node:assert/strict');
const {parseLegacyShifts} = require('../scripts/legacy-shifts-migration');

const rows = [
  ['📅 МІСЯЦЬ: 2026-03'],
  ['Дата','День','Години','Напарник'],
  ['02.03.2026','пн','8,5','Петя','shift-2'],
  ['03.03.2026','вт','7','Сам','shift-3'],
  ['📊 РАЗОМ ЗА МІСЯЦЬ:','','15,5','2 упряжок'],
  [],
  ['📅 МІСЯЦЬ: 2026-02'],
  ['Дата','День','Години','Напарник'],
  ['27.02.2026','пт','8','Женя','shift-1'],
  ['📊 РАЗОМ ЗА МІСЯЦЬ:','','8','1 упряжок']
];

const result = parseLegacyShifts(rows);
assert.deepEqual(result.canonicalHeaders, ['id','date','hours','coworker']);
assert.deepEqual(result.canonicalRecords, [
  {id:'shift-1',date:'27.02.2026',hours:8,coworker:'Женя'},
  {id:'shift-2',date:'02.03.2026',hours:8.5,coworker:'Петя'},
  {id:'shift-3',date:'03.03.2026',hours:7,coworker:'Сам'}
]);
assert.equal(result.diagnostics.monthHeaders.length, 2);
assert.equal(result.diagnostics.columnHeaders.length, 2);
assert.equal(result.diagnostics.totals.length, 2);
assert.equal(result.diagnostics.blankRows.length, 1);
assert.deepEqual(result.diagnostics.unknownRows, []);
assert.deepEqual(result.diagnostics.duplicateIds, []);
assert.ok(result.diagnostics.totalParity.every(item=>item.hoursMatch && item.countMatch));

const duplicate = parseLegacyShifts([
  ['📅 МІСЯЦЬ: 2026-03'],
  ['Дата','День','Години','Напарник'],
  ['02.03.2026','пн','8','Петя','same-id'],
  ['03.03.2026','вт','8','Петя','same-id']
]);
assert.deepEqual(duplicate.diagnostics.duplicateIds, ['same-id']);
console.log('PASS legacy shift presentation/raw split, canonical mapping and parity');

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const context = vm.createContext({
  Array, Date, JSON, Math, Number, Object, RegExp, String,
  SpreadsheetApp:{BorderStyle:{SOLID:'SOLID', SOLID_MEDIUM:'SOLID_MEDIUM'}}
});
vm.runInContext(source, context, {filename:'Code.gs'});

const calls = [];
function reportRange(row, column, count, width) {
  const call = {row, column, count, width};
  calls.push(call);
  const range = {
    breakApart(){ call.breakApart = true; return range; },
    clearContent(){ call.clearContent = true; return range; },
    setBackground(value){ call.background = value; return range; },
    setFontWeight(value){ call.fontWeight = value; return range; },
    setBorder(top, left, bottom, right, vertical, horizontal, color, style){
      (call.borders || (call.borders = [])).push({top, left, bottom, right, vertical, horizontal, color, style});
      return range;
    },
    setValues(values){ call.values = values; return range; },
    setNumberFormat(value){ call.numberFormat = value; return range; }
  };
  return range;
}

const report = {
  getLastRow(){ return 8; },
  getRange:reportRange,
  showColumns(column){ calls.push({showColumns:column}); },
  hideColumns(column){ calls.push({hideColumns:column}); },
  setColumnWidth(column, width){ calls.push({setColumnWidth:[column, width]}); }
};
const storageRows = [['old-shift-id', '31.07.2026', 7.5, 'Сам']];
const storage = {
  getLastRow(){ return 2; },
  getLastColumn(){ return 4; },
  getRange(row, column, count, width){
    if (row === 1) return {getDisplayValues(){ return [['id','date','hours','coworker'].slice(column - 1, column - 1 + width)]; }};
    return {getValues(){ return storageRows.slice(0, count).map(item=>item.slice(column - 1, column - 1 + width)); }};
  }
};
const workbook = {
  getSpreadsheetTimeZone(){ return 'Europe/Kiev'; },
  getSheetByName(name){
    if (name === '_ShiftsData') return storage;
    if (name === 'Зміни') return report;
    return null;
  }
};

context.refreshShiftReport_(workbook);

const clear = calls.find(call=>call.row === 1 && call.column === 1 && call.count === 8 && call.width === 6 && call.clearContent);
assert.ok(clear, 'redraw clears A:F so legacy A:E content and the new F service column cannot leak');
const write = calls.find(call=>call.row === 1 && call.column === 2 && call.width === 5 && call.values);
assert.ok(write, 'visual report is written to B:F');
assert.equal(write.values[2][0], '31.07.2026', 'existing canonical shift date is preserved');
assert.equal(write.values[2][2], 7.5, 'existing canonical shift hours are preserved');
assert.equal(write.values[2][3], 'Сам', 'existing canonical shift coworker is preserved');
assert.equal(write.values[2][4], 'old-shift-id', 'stable ID is written to column F');
assert.equal(calls.some(call=>call.column === 1 && call.values), false, 'column A remains empty');
assert.equal(calls.some(call=>call.hideColumns === 6), true, 'service ID column F is hidden');
assert.equal(calls.some(call=>call.showColumns === 1), true, 'spacer column A remains visible');
assert.equal(calls.some(call=>Array.isArray(call.setColumnWidth) && call.setColumnWidth[0] === 1 && call.setColumnWidth[1] >= 8 && call.setColumnWidth[1] <= 16), true, 'column A is a narrow spacer');
assert.equal(calls.some(call=>call.showColumns === 5), true, 'visible coworker column E is not left hidden by the legacy layout');

console.log('PASS shift report layout uses empty A, visible B:E and hidden stable ID F without data loss');

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

function formattingSheet() {
  const styles = new Map();
  return {
    styles,
    getRange(row, column, count, width) {
      const key = `${row}:${column}:${count}:${width}`;
      if (!styles.has(key)) styles.set(key, {});
      const style = styles.get(key);
      const range = {
        setBackground(value) { style.background = value; return range; },
        setFontWeight(value) { style.fontWeight = value; return range; }
      };
      return range;
    }
  };
}

const shifts = [
  {id:'jun-22', date:'22.06.2026', hours:8, coworker:'A'},
  {id:'jun-24', date:'24.06.2026', hours:8, coworker:'A'},
  {id:'jun-29', date:'29.06.2026', hours:8, coworker:'A'},
  {id:'jul-01', date:'01.07.2026', hours:8, coworker:'A'},
  {id:'jul-06', date:'06.07.2026', hours:8, coworker:'A'},
  {id:'jul-27', date:'27.07.2026', hours:8, coworker:'A'},
  {id:'aug-01', date:'01.08.2026', hours:8, coworker:'A'},
  {id:'aug-24', date:'24.08.2026', hours:8, coworker:'A'},
  {id:'aug-26', date:'26.08.2026', hours:8, coworker:'A'},
  {id:'aug-31', date:'31.08.2026', hours:8, coworker:'A'}
];
const rows = JSON.parse(JSON.stringify(context.buildShiftReportRows_(shifts)));
const sheet = formattingSheet();
context.formatShiftReport_(sheet, rows);

function rowStyle(firstCell) {
  const index = rows.findIndex((row)=>row[0] === firstCell);
  assert.notEqual(index, -1, `row ${firstCell} exists`);
  return sheet.styles.get(`${index + 1}:2:1:4`);
}

assert.equal(rowStyle('22.06.2026').background, rowStyle('24.06.2026').background, 'June dates in one calendar week share a color');
assert.notEqual(rowStyle('24.06.2026').background, rowStyle('29.06.2026').background, 'the following June week changes color');
assert.equal(rowStyle('29.06.2026').background, rowStyle('01.07.2026').background, 'one calendar week keeps its color across the June/July boundary');
assert.notEqual(rowStyle('01.07.2026').background, rowStyle('06.07.2026').background, 'the next July week changes color');
assert.equal(rowStyle('27.07.2026').background, rowStyle('01.08.2026').background, 'one calendar week keeps its color across the July/August boundary');
assert.equal(rowStyle('24.08.2026').background, rowStyle('26.08.2026').background, 'August dates in one calendar week share a color');
assert.notEqual(rowStyle('26.08.2026').background, rowStyle('31.08.2026').background, 'the following August week changes color');

const monthRows = rows.filter((row)=>String(row[0]).startsWith('📅 МІСЯЦЬ: '));
const totalRows = rows.filter((row)=>row[0] === '📊 РАЗОМ ЗА МІСЯЦЬ:');
for (const row of monthRows.concat(totalRows)) {
  const index = rows.indexOf(row);
  const style = sheet.styles.get(`${index + 1}:2:1:4`);
  assert.equal(style.fontWeight, 'bold', 'month and total rows have explicit bold styling');
  assert.ok(style.background && !['#f3f4f6', '#eaf3ff', '#edf7ed'].includes(style.background), 'month and total rows do not inherit a weekly color');
}

assert.match(source, /reportRange\.clearContent\(\);\s*reportRange\.setBackground\(null\);\s*reportRange\.setFontWeight\('normal'\);\s*reportRange\.setBorder\(false, false, false, false, false, false\);/, 'full redraw clears stale backgrounds, bold and borders');

console.log('PASS shift report weeks and reset formatting for June, July and August 2026');

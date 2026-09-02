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

function borderSheet(initialBorders) {
  const horizontal = new Map(initialBorders || []);
  const calls = [];
  return {
    horizontal,
    calls,
    getRange(row, column, count, width) {
      const range = {
        setBorder(top, left, bottom, right, vertical, innerHorizontal, color, style) {
          calls.push({row, column, count, width, top, left, bottom, right, vertical, innerHorizontal, color, style});
          const apply = (line, enabled)=>{
            if (enabled === false) horizontal.delete(line);
            if (enabled === true) horizontal.set(line, style || 'DEFAULT');
          };
          apply(row - 1, top);
          apply(row + count - 1, bottom);
          if (innerHorizontal !== null && innerHorizontal !== undefined) {
            for (let line = row; line < row + count - 1; line += 1) apply(line, innerHorizontal);
          }
          return range;
        }
      };
      return range;
    }
  };
}

function clearAllBorders(sheet, rowCount) {
  sheet.getRange(1, 1, rowCount, 5).setBorder(false, false, false, false, false, false);
}

const expandedMonth = [
  ['📅 МІСЯЦЬ: 2026-08','','','',''],
  ['Дата','День','Години','Напарник',''],
  ['23.08.2026','нд',8,'Сам','s1'],
  ['24.08.2026','пн',8,'Сам','s2'],
  ['25.08.2026','вт',8,'Сам','s3'],
  ['📊 РАЗОМ ЗА МІСЯЦЬ:','',24,'3 упряжок','']
];

const reportRows = JSON.parse(JSON.stringify(context.buildShiftReportRows_([
  {id:'stable-shift-id', date:'25.08.2026', hours:8, coworker:'Сам'}
])));
assert.equal(reportRows.every((row)=>row.length === 5), true, 'report data keeps its five-column schema');
assert.equal(reportRows[2][4], 'stable-shift-id', 'stable shift ID remains in hidden column E');

const afterLaterShift = borderSheet([[4, 'SOLID_MEDIUM']]);
clearAllBorders(afterLaterShift, expandedMonth.length);
context.formatShiftReportBorders_(afterLaterShift, expandedMonth);
assert.equal(afterLaterShift.horizontal.get(4), 'SOLID', 'old month end becomes an ordinary internal border');
assert.equal(afterLaterShift.horizontal.get(5), 'SOLID', 'monthly total starts with an ordinary thin internal border');
assert.equal(afterLaterShift.horizontal.get(6), 'SOLID_MEDIUM', 'thick bottom border moves to the actual month end');
const visibleBorderCalls = afterLaterShift.calls.filter((call)=>call.top !== false);
assert.equal(visibleBorderCalls.every((call)=>call.column === 1 && call.width === 4), true, 'all visual borders are limited to visible columns A:D');
assert.equal(
  visibleBorderCalls.some((call)=>call.top === true && call.right === true && call.width === 4),
  true,
  'monthly outer border ends immediately after visible column D'
);
const internalCallIndex = afterLaterShift.calls.findIndex((call)=>call.width === 4 && call.vertical === true && call.innerHorizontal === true);
const outerCallIndex = afterLaterShift.calls.findIndex((call)=>call.width === 4 && call.top === true && call.left === true && call.bottom === true && call.right === true);
assert.ok(internalCallIndex > -1 && outerCallIndex > internalCallIndex, 'closed A:D outer border is applied after all internal separators');
const blockClearCallIndex = afterLaterShift.calls.findIndex((call)=>call.width === 4 && call.top === false && call.left === false && call.bottom === false && call.right === false && call.vertical === false && call.innerHorizontal === false);
assert.ok(blockClearCallIndex > -1 && blockClearCallIndex < internalCallIndex, 'each A:D month block clears all old borders before rebuilding them');
assert.equal(outerCallIndex, afterLaterShift.calls.length - 1, 'the closed A:D outer border is the final border operation for the month');
assert.equal(
  afterLaterShift.calls.some((call)=>call.width === 5 && call.top === false && call.right === false),
  true,
  'stale border cleanup still covers the full A:E report footprint'
);

const afterBackdatedShift = borderSheet([[3, 'SOLID_MEDIUM']]);
clearAllBorders(afterBackdatedShift, expandedMonth.length);
context.formatShiftReportBorders_(afterBackdatedShift, expandedMonth);
assert.equal(afterBackdatedShift.horizontal.get(3), 'SOLID', 'backdated insertion also removes the stale former month end');
assert.equal(afterBackdatedShift.horizontal.get(6), 'SOLID_MEDIUM', 'backdated insertion preserves the new actual month end');

const twoMonths = expandedMonth.concat([
  ['','','','',''],
  ['📅 МІСЯЦЬ: 2026-07','','','',''],
  ['Дата','День','Години','Напарник',''],
  ['31.07.2026','пт',7,'Сам','j1'],
  ['📊 РАЗОМ ЗА МІСЯЦЬ:','',7,'1 упряжок','']
]);
const neighboringMonths = borderSheet();
clearAllBorders(neighboringMonths, twoMonths.length);
context.formatShiftReportBorders_(neighboringMonths, twoMonths);
assert.equal(neighboringMonths.horizontal.get(6), 'SOLID_MEDIUM', 'first month keeps its own bottom border');
assert.equal(neighboringMonths.horizontal.get(11), 'SOLID_MEDIUM', 'neighboring month keeps its own bottom border');
assert.equal(
  neighboringMonths.calls.some((call)=>call.top !== false && call.row <= 7 && call.row + call.count - 1 >= 7),
  false,
  'blank separator row is not included in either formatted month block'
);

assert.match(
  source,
  /reportRange\.clearContent\(\);\s*reportRange\.setBackground\(null\);\s*reportRange\.setFontWeight\('normal'\);\s*reportRange\.setBorder\(false, false, false, false, false, false\);/,
  'refresh clears stale backgrounds, bold and borders across the previous and current report footprint'
);

console.log('PASS shift report month borders are rebuilt without stale internal month ends');

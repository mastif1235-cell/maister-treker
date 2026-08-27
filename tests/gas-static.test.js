'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const gas = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8').replace(/\r\n/g, '\n');
const gsFiles = fs.readdirSync(root).filter((name)=>name.endsWith('.gs'));
const allGas = gsFiles.map((name)=>fs.readFileSync(path.join(root, name), 'utf8')).join('\n');

assert.deepEqual(gsFiles, ['Code.gs'], 'Code.gs must be the only GAS source');
assert.equal((allGas.match(/\bfunction\s+doGet\s*\(/g) || []).length, 1, 'exactly one doGet');
assert.equal((allGas.match(/\bfunction\s+doPost\s*\(/g) || []).length, 1, 'exactly one doPost');
assert.equal(/var\s+(?:SYNC_SECRET|SECURE_AUTH_HMAC_SECRET)\s*=/.test(allGas), false, 'no source secret variable');
assert.equal(allGas.includes("getProperty(SYNC_HMAC_PROPERTY)"), true, 'secret read from Script Properties');
assert.equal(allGas.includes("getProperty(SYNC_SHIFTS_SPREADSHEET_PROPERTY)"), true, 'shift workbook read from Script Properties');
assert.match(allGas, /syncExecuteEntityMutation_\(syncSpreadsheetForEntity_\(envelope\.entity\)/, 'mutations use entity storage router');
assert.match(allGas, /var shiftSs = syncShiftSpreadsheet_\(\)/, 'list uses separate shift workbook');
assert.equal(/getSheetByName\('Зміни'\)/.test(allGas.match(/function syncTicketSpreadsheet_\([\s\S]*?function syncShiftSpreadsheet_/)[0]), false, 'ticket owner does not select shifts sheet');
assert.equal(allGas.includes('CacheService.getScriptCache()'), true, 'replay cache enabled');
assert.equal(allGas.includes('LockService.getScriptLock()'), true, 'atomic lock enabled');
assert.match(allGas, /existingIndex !== -1[\s\S]*writeTicketRow\(sheet, existingIndex \+ 2, t\)/, 'legacy ticket adoption uses idempotent upsert');
assert.equal(allGas.includes('setRowHeightsAuto'), false, 'unsupported Sheet row-height API is absent');
assert.match(allGas, /sheet\.autoResizeRows\(rowIndex, 1\)/, 'ticket row height uses supported Apps Script API');

const referenceSource = fs.readFileSync(path.join(root, 'js', 'apps-script-reference.js'), 'utf8');
const reference = vm.runInNewContext(referenceSource + '\n;APPS_SCRIPT_CODE');
assert.equal(reference, gas, 'copyable Apps Script reference matches Code.gs exactly');

console.log('PASS single GAS source/entrypoints/properties/cache/lock checks');
console.log('PASS browser copy reference matches canonical Code.gs');

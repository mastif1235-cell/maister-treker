'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const context={};vm.createContext(context);vm.runInContext(fs.readFileSync('js/app-format-utils.js','utf8'),context);
assert.equal(context.formatUaDate(new Date(2026,7,23)),'23 серпня 2026 р.');
assert.deepEqual(JSON.parse(JSON.stringify(context.parseBackupNote('Геолокація: https://maps.example/x\nЛогін: user\nПароль: pass\nПовніДаніJSON: {"id":1}'))),{geoLink:'https://maps.example/x',masterNote:'',login:'user',password:'pass',fullData:{id:1}});
assert.equal(context.parseBackupNote('ПовніДаніJSON: {bad').fullData,null);console.log('PASS pure date and backup-note parsing');

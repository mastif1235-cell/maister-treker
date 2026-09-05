'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','shift-utils.js'),'utf8');
const context={parseDate:value=>{const [day,month,year]=String(value).split('.').map(Number);return new Date(year,month-1,day);}};
vm.createContext(context);vm.runInContext(source,context);
const shifts=[
  {id:'550e8400-e29b-41d4-a716-446655440001',date:'05.09.2026'},
  {id:'550e8400-e29b-41d4-a716-446655440003',date:'04.09.2026'},
  {id:'550e8400-e29b-41d4-a716-446655440003',date:'05.09.2026'},
  {id:'550e8400-e29b-41d4-a716-446655440002',date:'05.09.2026'}
];
assert.deepEqual(Array.from(context.sortShiftsByDateDesc(shifts),item=>item.id),[
  '550e8400-e29b-41d4-a716-446655440003',
  '550e8400-e29b-41d4-a716-446655440002',
  '550e8400-e29b-41d4-a716-446655440001',
  '550e8400-e29b-41d4-a716-446655440003'
]);
console.log('PASS UUID shifts use a deterministic same-date tie-break');

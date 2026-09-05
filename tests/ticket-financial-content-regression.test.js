'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const financeSource = fs.readFileSync(path.join(root, 'js', 'finance-utils.js'), 'utf8');
const editorSource = fs.readFileSync(path.join(root, 'js', 'ticket-editor-domain.js'), 'utf8');
const context = {
  fmtMoney:value=>`${Number(value)} грн`,
  normalizeOnuSignal:()=>''
};
vm.createContext(context);
vm.runInContext(financeSource, context, {filename:'finance-utils.js'});

const base = {
  type:'Ремонт', date:'05.09.2026', time:'10:00', payment:'Готівка',
  callFee:0, tariff:0, equipment:[], cables:[], presetWorks:[], additionalWork:[]
};

const equipmentText = context.buildTicketContent({...base,equipment:[{id:'onu',label:'ONU',price:500}]},500);
assert.match(equipmentText, /ONU/, 'A: saved equipment without checked remains in ticket content');

const workText = context.buildTicketContent({...base,presetWorks:[{id:'work1',label:'Робота',price:200,qty:1}]},200);
assert.match(workText, /Робота/, 'B: saved preset work without checked remains in ticket content');

const uncheckedText = context.buildTicketContent({
  ...base,
  equipment:[{id:'onu',label:'Hidden ONU',price:500,checked:false}],
  presetWorks:[{id:'work1',label:'Hidden work',price:200,qty:1,checked:false}]
},0);
assert.doesNotMatch(uncheckedText, /Hidden ONU|Hidden work/, 'C: explicitly unchecked items stay out of ticket content');

assert.doesNotThrow(()=>context.buildTicketContent({type:'Ремонт',payment:'Готівка',callFee:0,tariff:0},0), 'D: incomplete legacy ticket arrays are optional');

const freeCall = {
  ...base,
  callFee:300,
  freeRepairCallThreshold:800,
  equipment:[{id:'onu',label:'ONU',price:900}]
};
const freeCalculation = context.calculateTicketTotal(freeCall);
assert.equal(freeCalculation.callFee,0,'E: repair call is free at the equipment threshold');
assert.equal(freeCalculation.total,900,'E: total excludes the free repair call');
const freeText = context.buildTicketContent(freeCall,freeCalculation.total);
assert.doesNotMatch(freeText,/Виклик:\s*300/,'E: content does not show the stale paid call');
const freeItems = context.buildMixedPaymentItemsFromTicket(freeCall);
assert.equal(freeItems.some(item=>item.key==='callFee'),false,'E: mixed items exclude the free repair call');
assert.equal(freeItems.reduce((sum,item)=>sum+item.amount,0),freeCalculation.total,'E: mixed item sum matches total');

const paidRepair = {...freeCall,equipment:[{id:'onu',label:'ONU',price:700}]};
const paidCalculation = context.calculateTicketTotal(paidRepair);
assert.equal(paidCalculation.callFee,300,'F: repair call remains paid below threshold');
assert.equal(paidCalculation.total,1000,'F: below-threshold repair total is unchanged');

const connection = {...freeCall,type:'Підключення'};
const connectionCalculation = context.calculateTicketTotal(connection);
assert.equal(connectionCalculation.callFee,300,'G: repair threshold never makes another ticket type free');
assert.equal(connectionCalculation.total,1200,'G: non-repair total includes its call fee');

assert.match(
  editorSource,
  /calcState\.callFee\s*=\s*effectiveTicketCallFee\([\s\S]*?freeRepairCallThreshold/,
  'saved ticket persists the canonical effective call fee'
);

console.log('PASS saved selections, incomplete tickets and canonical repair call fee stay financially consistent');

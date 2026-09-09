'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const source = read('js/ticket-editor-financial.js');
const editor = read('js/ticket-editor-domain.js');
const html = read('index.html');
const sw = read('sw.js');
// Pin the original block, including comments: extraction must not rewrite behavior.
assert.equal(crypto.createHash('sha256').update(source.slice(source.indexOf('function computeTotal(){')).trim()).digest('hex'),
  'b8c753fb84407387c8f8ba8225b495df80b4773394604c81dfca5b2b6a42798e');
for (const name of ['computeTotal','buildMixedPaymentItems','renderMixedPaymentItems','updateMixedPaymentVisibility']) {
  assert.equal((source.match(new RegExp('function '+name+'\\(', 'g')) || []).length, 1);
  assert.doesNotMatch(editor, new RegExp('function '+name+'\\('));
}
assert.doesNotMatch(source, /addEventListener|setInterval|setTimeout/);
assert.ok(html.indexOf('src="js/ticket-editor-domain.js"') < html.indexOf('src="js/ticket-editor-financial.js"'));
assert.ok(html.indexOf('src="js/ticket-editor-financial.js"') < html.indexOf('src="js/tickets-bindings.js"'));
assert.equal((sw.match(/'\.\/js\/ticket-editor-financial\.js'/g) || []).length, 1);
const elements = {};
for (const id of ['f_rawSum','f_payment','f_callFee','f_tariff','calcTotal','mixedPaymentItemsWrap','mixedPaymentHint','mixedPaymentWrap']) {
  elements[id] = {value:'0', innerHTML:'', textContent:'', classList:{toggle(name,value){this[name]=value;}}};
}
const context = {document:{getElementById:id=>elements[id]}, calcState:{baseCallFee:150,equipment:[],cables:[],additionalWork:[],presetWorks:[]},
  settings:{freeRepairCallThreshold:0}, fmtMoney:value=>String(value), escapeHtml:value=>String(value), getEffectiveType:()=> 'Ремонт'};
vm.createContext(context);
vm.runInContext(read('js/finance-utils.js'), context);
vm.runInContext(source, context);
assert.equal(elements.calcTotal.textContent, '', 'loading declarations has no initialization effects');
elements.f_callFee.value='150';
elements.f_tariff.value='100';
elements.f_payment.value='Готівка';
assert.equal(context.computeTotal(),250);
elements.f_payment.value='Безкоштовно';
assert.equal(context.computeTotal(),0);
context.calcState.cloudImported=true;
elements.f_rawSum.value='321';
assert.equal(context.computeTotal(),321);
context.calcState.cloudImported=false;
elements.f_payment.value='Змішана';
assert.equal(context.computeTotal(),250);
assert.equal(context.calcState.cashAmount,250);
const items=context.buildMixedPaymentItems();
context.calcState.itemPayments[items[0].key]='card';
context.updateMixedPaymentVisibility();
assert.equal(context.calcState.cardAmount,items[0].amount);
assert.equal(context.calcState.cashAmount+context.calcState.cardAmount,250);
assert.equal(elements.mixedPaymentWrap.classList.hidden,false);
elements.f_payment.value='Готівка';
context.updateMixedPaymentVisibility();
assert.equal(elements.mixedPaymentWrap.classList.hidden,true);
console.log('PASS editor financial extraction: exact body, classic API/load order, totals and mixed payment');

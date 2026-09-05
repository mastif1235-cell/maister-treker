'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const finance=read('js/finance-utils.js'),editor=read('js/ticket-editor-domain.js'),bindings=read('js/tickets-bindings.js'),form=read('js/ticket-form-domain.js'),app=read('app.js');
const context={fmtMoney:value=>`${value} грн`,normalizeOnuSignal:()=>''};vm.createContext(context);vm.runInContext(finance,context);
const equipment=price=>[{id:'onu',label:'ONU',price,checked:true}];
const repair=(baseCallFee,price)=>({type:'Ремонт',baseCallFee,callFee:baseCallFee,freeRepairCallThreshold:1000,equipment:equipment(price),cables:[],presetWorks:[],additionalWork:[]});

let result=context.calculateTicketTotal(repair(200,250));
assert.equal(result.callFee,200,'CALL-1 manual base remains effective below threshold');assert.equal(result.total,450);
assert.match(context.buildTicketContent({...repair(200,250),payment:'Готівка'},result.total),/Виклик: 200 грн/);
assert.match(context.buildWorkSummaryLines({...repair(200,250),payment:'Готівка'}).join('\n'),/Виклик: 200 грн/);
assert.equal(context.buildMixedPaymentItemsFromTicket(repair(200,250)).reduce((sum,item)=>sum+item.amount,0),450);
const thresholdRepair=repair(200,1000);assert.equal(context.calculateTicketTotal(thresholdRepair).callFee,0,'CALL-2 threshold makes only the effective fee free');
assert.equal(context.buildMixedPaymentItemsFromTicket(thresholdRepair).some(item=>item.key==='callFee'),false);
assert.deepEqual([250,1000,250].map(price=>context.calculateTicketTotal(repair(200,price)).callFee),[200,0,200],'CALL-3 manual base survives threshold crossing');
assert.deepEqual([250,1000,250].map(price=>context.calculateTicketTotal(repair(300,price)).callFee),[300,0,300],'CALL-4 automatic base survives threshold crossing');
assert.equal(context.calculateTicketTotal(repair(150,1000)).callFee,0,'CALL-5 latest manual base can be discounted');assert.equal(context.calculateTicketTotal(repair(150,250)).callFee,150);

const saved=JSON.parse(JSON.stringify({...repair(200,1000),callFee:0}));
saved.equipment=equipment(250);
assert.equal(context.calculateTicketTotal(saved).callFee,200,'CALL-6 save/reload/edit restores the persisted manual base');
const connection={...repair(200,1500),type:'Підключення'};
assert.equal(context.calculateTicketTotal(connection).callFee,200,'CALL-7 repair threshold never discounts a connection');
assert.equal(context.calculateTicketTotal({type:'Ремонт',callFee:175,freeRepairCallThreshold:1000,equipment:equipment(250)}).callFee,175,'CALL-8 legacy paid repair uses its stored callFee');
assert.equal(context.calculateTicketTotal({type:'Ремонт',freeRepairCallThreshold:1000,equipment:[]}).callFee,0,'CALL-9 incomplete legacy ticket stays finite');

assert.match(form,/baseCallFee:0, callFee:0/,'new ticket model stores base and effective fee');
assert.match(bindings,/calcState\.baseCallFee=safeNonNegativeNumber\(event\.target\.value\)/,'manual input records the latest base fee');
assert.match(editor,/function loadTicketIntoForm[\s\S]*hasOwnProperty\.call\(calcState,'baseCallFee'\)[\s\S]*calcState\.callFee/,'legacy edit state derives base without a mass migration');
assert.match(editor,/function applyDefaultCallFee[\s\S]*feeIsAutoDefault[\s\S]*ticketBaseCallFee\(calcState\)[\s\S]*effectiveTicketCallFee/,'equipment changes preserve manual base and recompute only effective fee');
assert.match(editor,/function syncFormToState[\s\S]*calcState\.callFee=effectiveTicketCallFee/,'save state persists the effective fee');
assert.match(app,/baseCallFee:t\.baseCallFee, callFee:t\.callFee/,'existing fullData JSON naturally carries the base fee');
console.log('PASS manual repair call fee survives threshold and save/reload/edit roundtrip');

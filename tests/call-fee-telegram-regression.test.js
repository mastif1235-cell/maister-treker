'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js','finance-utils.js'),'utf8');
const context={fmtMoney:value=>`${Number(value)} грн`,normalizeOnuSignal:()=>''};
vm.createContext(context);vm.runInContext(source,context);
const common={type:'Ремонт',payment:'Готівка',tariff:0,equipment:[{id:'onu',label:'ONU',price:800}],cables:[],presetWorks:[],additionalWork:[]};
const lines=ticket=>context.buildTicketContent(ticket,context.calculateTicketTotal(ticket).total);
const savedFree={...common,baseCallFee:300,callFee:0};
assert.equal(context.calculateTicketTotal({...savedFree,freeRepairCallThreshold:800}).total,800,'total stays 800');
assert.doesNotMatch(lines(savedFree),/💎 Виклик:/,'saved numeric zero never revives the base fee');
assert.doesNotMatch(lines({...savedFree,callFee:'0'}),/💎 Виклик:/,'saved string zero never revives the base fee');
assert.doesNotMatch(lines({...common,baseCallFee:300}),/💎 Виклик:/,'missing effective fee never invents 300');
assert.match(lines({...common,baseCallFee:150,callFee:150}),/💎 Виклик: 150 грн/,'real saved fee is shown');
assert.match(lines({...common,baseCallFee:300,callFee:300}),/💎 Виклик: 300 грн/,'real saved 300 is shown');
assert.doesNotMatch(context.buildWorkSummaryLines(savedFree).join('\n'),/💎 Виклик:/,'ticket-card formatter shares persisted effective fee');
assert.equal(context.buildMixedPaymentItemsFromTicket(savedFree).some(item=>item.key==='callFee'),false,'mixed-payment formatter does not re-add the free call');
const editor=fs.readFileSync(path.join(root,'js','ticket-editor-domain.js'),'utf8');
assert.match(editor,/state\.callFee=effectiveTicketCallFee\(state\)[\s\S]*buildTicketContent\(state, total\)/,'new and edited unsaved form preview uses the effective fee');
console.log('PASS zero call fee remains absent through saved, edited and re-sent formatter paths');

// Sheets receives exactly the persisted common formatter output, not a Telegram-only variant.
const appSource=fs.readFileSync(path.join(root,'app.js'),'utf8');
const payloadSource=appSource.slice(appSource.indexOf('function ticketToSyncPayload'),appSource.indexOf('function shiftToSyncPayload'));
const payloadContext={formatDate:()=> '14.09.2026',formatTime:()=> '12:00',Date};
vm.createContext(payloadContext);vm.runInContext(payloadSource,payloadContext);
function sheetContent(ticket){
  const total=context.calculateTicketTotal(ticket).total;
  const content=context.buildTicketContent(ticket,total);
  return {total,content,payload:payloadContext.ticketToSyncPayload({...ticket,id:'call-fee-sheet',date:'14.09.2026',time:'12:00',content,sum:total,tags:[]})};
}
const zeroForSheets=sheetContent({...common,baseCallFee:300,callFee:0,freeRepairCallThreshold:800});
assert.equal(zeroForSheets.total,800,'SHEETS-CALL-0 ONU 800 with call=0 still totals 800');
assert.equal(zeroForSheets.payload.content,zeroForSheets.content,'SHEETS-CALL-0 sync payload uses the shared saved content');
assert.doesNotMatch(zeroForSheets.payload.content,/💎 Виклик: 300 грн/,'SHEETS-CALL-0 transmitted Google Sheets content cannot revive a zero call fee');
const paidForSheets=sheetContent({...common,baseCallFee:300,callFee:300});
assert.equal(paidForSheets.total,1100,'SHEETS-CALL-300 total includes the real call fee');
assert.match(paidForSheets.payload.content,/💎 Виклик: 300 грн/,'SHEETS-CALL-300 saved/transmitted Google Sheets content retains the real call line');
console.log('PASS Google Sheets payload shares the zero/nonzero call-fee formatter');

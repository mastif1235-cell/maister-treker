'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../js/dispatcher-report-core.js'),restore=require('../js/restore-from-sheets.js'),backup=require('../js/backup-system.js');
const {createServer,createDevice}=require('./helpers/sync-gas-harness');
const read=file=>fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8');
(async()=>{
  const p=await import('../js/dispatcher-report-projection.mjs');
  const base={id:'modern-contract',date:'14.10.2026',time:'12:00',type:'Підключення',tags:['connect'],content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ',payment:'Готівка',sum:800,callFee:500,tariff:300,cables:[]};
  const money=t=>[t.sum,t.payment,t.callFee,t.tariff,t.cashAmount,t.cardAmount];
  const serializer=read('app.js').split('function ticketToSyncPayload(')[1].split('function shiftToSyncPayload(')[0];
  const server=createServer(),device=await createDevice({server,online:false,modules:['backup']});
  vm.runInContext('function ticketToSyncPayload('+serializer,device.ctx);
  device.engine.payload=(_entity,ticket)=>device.ctx.ticketToSyncPayload(ticket);
  for(const checked of [true,false]){
    const ticket={...base,id:'modern-'+checked,onuAccountingVersion:1,equipment:checked?[{id:'onu',label:'ONU',price:0}]:[]};
    const before=JSON.stringify(ticket),dto=await p.buildDTO(ticket,core,100);
    assert.equal(dto.onu_used,checked?1:0);assert.equal(dto.onu_replacement,0);assert.equal(dto.total,800);
    assert.equal(JSON.stringify(ticket),before);
    assert.equal(p.projectTicket({...ticket,equipment:[{id:'onu',label:'ONU',checked,price:800}]},core,100).onu_used,checked?1:0);
    assert.equal(p.projectTicket({...ticket,note:checked?'Старое примечание: своя ONU':''},core,100).onu_used,checked?1:0,'modern selection wins over legacy text');
    await device.addTicket(ticket);
    const pending=JSON.parse(device.record('ticket',ticket.id).head.body.fullDataJson);
    assert.equal(pending.onuAccountingVersion,1);
    device.setOnline(true);await device.flush();
    const row=server.ticketRow(ticket.id);assert.equal(JSON.parse(row.fullDataJson).onuAccountingVersion,1);
    const restored=restore.cloudTicketToLocal(JSON.parse(JSON.stringify(row))).ticket;
    assert.equal(restored.onuAccountingVersion,1);assert.equal(p.projectTicket(restored,core,100).onu_used,checked?1:0);
    assert.deepEqual(money(restored),money(ticket));
    const payload={app:'master-tracker',tickets:[ticket]},encrypted=await backup.encrypt(payload,'test-only-password');
    const decrypted=await backup.decrypt(encrypted,'test-only-password');
    assert.deepEqual(decrypted,payload);
    const local=await createDevice({server,online:false,modules:['backup']});
    await local.restoreFileBackup(decrypted);
    assert.equal(local.ticket(ticket.id).onuAccountingVersion,1);assert.equal(p.projectTicket(local.ticket(ticket.id),core,100).onu_used,checked?1:0);
    device.setOnline(false);
  }
  const legacy={...base,equipment:[{id:'onu',label:'ONU',checked:false}]},before=JSON.stringify(legacy);
  for(const equipment of [legacy.equipment,[],undefined])assert.equal(p.projectTicket({...legacy,equipment},core,100).onu_used,1);
  assert.equal(p.projectTicket({...legacy,note:'у них своя ONU'},core,100).onu_used,0);
  assert.equal(JSON.stringify(legacy),before);
  assert(!Object.hasOwn(JSON.parse(device.ctx.ticketToSyncPayload(legacy).fullDataJson),'onuAccountingVersion'));
  const legacyRestore=restore.cloudTicketToLocal(JSON.parse(JSON.stringify(device.ctx.ticketToSyncPayload(legacy)))).ticket;
  assert(!Object.hasOwn(legacyRestore,'onuAccountingVersion'));
  for(const invalid of [{onuAccountingVersion:2,equipment:[]},{onuAccountingVersion:'1',equipment:[]},{onuAccountingVersion:1,equipment:undefined},{onuAccountingVersion:1,equipment:[{id:'onu',checked:'false'}]}]){
    const ticket={...base,...invalid};assert.equal(p.classifyConnectionOnu(ticket,core).classification,'REVIEW_REQUIRED');
    assert.throws(()=>p.projectTicket(ticket,core,100),/ONU_SELECTION_REVIEW_REQUIRED/);
    const audit=p.dryRunHistoricalOnu([ticket],core);assert.equal(audit.connectionReviews.length,1);assert.equal(audit.months[0].connection_unknown,1);
    const {dryRunHistoricalCorrection}=await import('../js/dispatcher-historical-plan.mjs');
    const plan=await dryRunHistoricalCorrection({current:[ticket],archive:[],reportRows:[]},core,100);assert.equal(plan.ready,false);assert(plan.blocks.some(b=>b.code==='ONU_SELECTION_REVIEW_REQUIRED'));
  }
  const context=vm.createContext({settings:{defaultConnectFee:500,defaultTariff:300},formatDate:()=>base.date,formatTime:()=>base.time,getEquipmentConfig:()=>[{id:'onu',label:'ONU',price:800}],getCableTypesConfig:()=>[],getWorkTypesConfig:()=>[],isTicketOnuEquipment:core.isOnuEquipment});
  vm.runInContext(read('js/finance-utils.js')+read('js/ticket-form-domain.js')+read('js/ticket-editor-core.js'),context);
  const blank=vm.runInContext('blankTicketObject()',context),fresh=vm.runInContext('blankCalcState()',context);
  assert(!Object.hasOwn(blank,'onuAccountingVersion'));assert.equal(fresh.onuAccountingVersion,1);assert.equal(fresh.equipment[0].checked,true);
  assert(!read('js/ticket-editor-domain.js').slice(read('js/ticket-editor-domain.js').indexOf('function loadTicketIntoForm('),read('js/ticket-editor-domain.js').indexOf('function loadTicketIntoForm(')+600).includes('onuAccountingVersion'));
  console.log('PASS modern ONU contract: ON/OFF, sparse save, signed sync/restore, encrypted export/import, no legacy marker assignment, unchanged money/canonical, malformed marker review');
})().catch(error=>{console.error(error);process.exitCode=1;});

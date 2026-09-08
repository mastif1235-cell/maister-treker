'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const full=fs.readFileSync(path.join(root,'js','ticket-editor-domain.js'),'utf8');
const source=full.slice(0,full.indexOf('// NEW: "бригада на сьогодні"'));
const memory=new Map(),deleted=[];
const context={
  console,Date,TYPE_TAG_MAP:{Repair:'repair'},MTToolsCore:{explicitCoordinates:()=>null},
  calcState:{},calcOriginalPhotoKeys:[],editingTicketId:null,formTouchedByUser:false,
  syncFormToState(){},deletePhotoKey:key=>deleted.push(key),formatDate:()=>'',formatTime:()=>'',
  loadTicketIntoForm(state){context.calcState=state;},switchTab(){},showToast(){},confirm:()=>true,
  document:{getElementById:()=>({textContent:'',classList:{remove(){}}})},
  localStorage:{getItem:key=>memory.has(key)?memory.get(key):null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)}
};
vm.createContext(context);vm.runInContext(source,context);
const blank=()=>({signal:'',otherNote:'',city:'',address:'',street:'',house:'',clientName:'',phone:'',note:'',masterNote:'',photo:null,photos:[],macAddress:'',cloudImported:false,login:'',password:'',type:'Repair',contractNumber:'',geoLink:'',callFee:0,tariff:0,cables:[],equipment:[],presetWorks:[],additionalWork:[],tags:['repair']});

context.calcState=blank();context.formTouchedByUser=true;context.saveDraftToLocalStorage();
assert.equal(memory.has('ticketDraft'),false,'empty form does not create a draft');
context.calcState={...blank(),city:'Dnipro'};context.formTouchedByUser=false;context.saveDraftToLocalStorage();
assert.equal(memory.has('ticketDraft'),false,'untouched prefill does not create a false draft');
context.formTouchedByUser=true;context.editingTicketId='ticket-existing';context.calcOriginalPhotoKeys=['idb:original'];context.calcState={...blank(),city:'Dnipro',photos:['idb:original','idb:new']};context.saveDraftToLocalStorage();
const saved=JSON.parse(memory.get('ticketDraft'));
assert.equal(saved.editingTicketId,'ticket-existing','edited ticket id is persisted');
assert.deepEqual(saved.originalPhotoKeys,['idb:original'],'original photo ownership is persisted');
context.calcState=blank();context.editingTicketId=null;context.restoreDraftIfAny();
assert.equal(context.editingTicketId,'ticket-existing','reload restores editing id');
assert.equal(context.calcState.city,'Dnipro','reload restores entered values');

memory.set('ticketDraft',JSON.stringify(saved));context.confirm=()=>false;context.restoreDraftIfAny();
assert.deepEqual(deleted,['idb:new'],'discard removes only a new unsaved photo');
assert.equal(memory.has('ticketDraft'),false,'discard clears the draft record');
memory.set('ticketDraft','{broken');assert.doesNotThrow(()=>context.restoreDraftIfAny());assert.equal(memory.has('ticketDraft'),false,'malformed draft is safely removed');

context.calcState={...blank(),cloudImported:true,content:'changed',_origContent:'old',sum:20,_origSum:10};context.formTouchedByUser=true;context.editingTicketId='cloud';context.saveDraftToLocalStorage();
assert.equal(JSON.parse(memory.get('ticketDraft')).state.content,'changed','cloud-imported raw content change is saved');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
assert.match(app,/controllerchange[\s\S]*saveDraftToLocalStorage\(\)[\s\S]*window\.location\.reload\(\)/,'SW-controlled reload saves draft first');
console.log('PASS ticket draft save, restore, discard, malformed and SW-update safety');

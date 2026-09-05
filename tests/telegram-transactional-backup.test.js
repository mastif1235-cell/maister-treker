'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','js','photo-telegram-domain.js'),'utf8');
const response=data=>({status:200,headers:{get:()=>null},json:async()=>data});

function makeHarness({photo=true,failAt=''}){
  const oldIds=[11,12,13,14];
  const ticket={id:'tx-ticket',type:'Ремонт',date:'05.09.2026',time:'12:00',content:'backup text',photos:photo?['idb:photo']:[],tgBackedUp:true,tgBackupPending:true,tgSepMsgId:11,tgTextMsgId:12,tgPhotoMsgId:13,tgPhotoMsgIds:[13],tgPhotoFileId:'old-file',tgPhotoFileIds:['old-file'],tgJsonMsgId:14};
  const live=new Set(oldIds),deleted=[];let nextId=100;
  const context={AbortController,Blob,FormData,clearTimeout,setTimeout,console:{error(){}},navigator:{onLine:true},settings:{tgBotToken:'token',tgBackupChatId:'chat'},tickets:[ticket],
    refreshTicketCardDom(){},saveTicketsLocalOnly:async()=>true,resolvePhotoAsync:async()=>photo?'data:image/jpeg;base64,AA==':null,
    fetch:async(url,opts)=>{
      if(String(url).startsWith('data:')) return {blob:async()=>new Blob(['photo'],{type:'image/jpeg'})};
      if(/deleteMessage$/.test(String(url))){const id=JSON.parse(opts.body).message_id;deleted.push(id);live.delete(id);return response({ok:true});}
      throw new Error('unexpected direct fetch');
    }
  };
  vm.createContext(context);vm.runInContext(source,context);
  context.resolvePhotoAsync=async()=>photo?'data:image/jpeg;base64,AA==':null;
  context.fetchWithRetry=async url=>{
    const endpoint=String(url).match(/\/(sendMessage|sendPhoto|sendDocument)$/)?.[1];
    if(endpoint===failAt) return response({ok:false,description:'planned failure'});
    const id=++nextId;live.add(id);
    const result={message_id:id};
    if(endpoint==='sendPhoto') result.photo=[{file_id:`file-${id}`}];
    return response({ok:true,result});
  };
  return {context,ticket,live,deleted,oldIds};
}

(async()=>{
  const a=makeHarness({failAt:'sendPhoto'});
  assert.equal(await a.context.backupTicketToTelegramNow(a.ticket),false,'TG-A partial photo failure is not acknowledged');
  assert.deepEqual(a.oldIds.filter(id=>a.live.has(id)),a.oldIds,'TG-A old confirmed copy remains');
  assert.equal(a.live.size,a.oldIds.length,'TG-A known new separator/text/JSON messages are cleaned up');
  assert.equal(a.ticket.tgSepMsgId,11);assert.equal(a.ticket.tgTextMsgId,12);assert.deepEqual(a.ticket.tgPhotoMsgIds,[13]);assert.equal(a.ticket.tgJsonMsgId,14);
  assert.equal(a.ticket.tgBackedUp,true,'TG-A previous Telegram state is restored');
  assert.equal(a.ticket.tgBackupPending,true,'TG-A failed attempt remains pending');

  assert.equal(await a.context.backupTicketToTelegramNow(a.ticket),false,'TG-B second partial attempt also fails safely');
  assert.equal(a.live.size,a.oldIds.length,'TG-B repeated partial attempts do not grow orphan messages');

  const c=makeHarness({});
  assert.equal(await c.context.backupTicketToTelegramNow(c.ticket),true,'TG-C complete attempt succeeds');
  assert.equal(c.oldIds.some(id=>c.live.has(id)),false,'TG-C old confirmed copy is removed only after success');
  assert.equal(c.live.size,4,'TG-C separator/text/photo/JSON from the new copy remain');
  assert.equal(c.ticket.tgBackedUp,true);assert.equal(c.ticket.tgBackupPending,false);

  const d=makeHarness({failAt:'sendDocument'});
  assert.equal(await d.context.backupTicketToTelegramNow(d.ticket),false,'TG-D JSON failure is not acknowledged');
  assert.deepEqual(d.oldIds.filter(id=>d.live.has(id)),d.oldIds,'TG-D old confirmed copy remains');
  assert.equal(d.live.size,d.oldIds.length,'TG-D known separator/text/photo messages are cleaned up');

  const e=makeHarness({photo:false});
  assert.equal(await e.context.backupTicketToTelegramNow(e.ticket),true,'TG-E no-photo backup succeeds');
  assert.equal(e.ticket.tgBackedUp,true);assert.equal(e.ticket.tgBackupPending,false);
  console.log('PASS transactional Telegram backup cleans known partial messages without touching confirmed copies');
})().catch(error=>{console.error(error);process.exitCode=1;});

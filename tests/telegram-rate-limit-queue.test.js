'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js','photo-telegram-domain.js'),'utf8');
const editor=fs.readFileSync(path.join(root,'js','ticket-editor-domain.js'),'utf8');
const tickets=[
  {id:'A',content:'ticket A',tgBackedUp:false,tgBackupPending:false,tgPhotoFileIds:[],tgPhotoMsgIds:[]},
  {id:'B',content:'ticket B',tgBackedUp:false,tgBackupPending:false,tgPhotoFileIds:[],tgPhotoMsgIds:[]}
];
const order=[],delays=[];let active=0,maxActive=0,nextMessage=10,firstA=true,googleSaves=0;
const response=(data,status=200)=>({status,headers:{get:()=>null},json:async()=>data});
const context={AbortController,Blob,FormData,console:{error(){}},navigator:{onLine:true},settings:{tgBotToken:'token',tgBackupChatId:'chat'},tickets,
  refreshTicketCardDom(){},resolvePhotoAsync:async()=>null,saveTickets:async()=>{googleSaves++;},saveTicketsLocalOnly:async()=>true,
  clearTimeout(){},setTimeout(fn,delay){delays.push(delay);if(delay<10000)queueMicrotask(fn);return delays.length;},
  fetch:async(url,opts)=>{
    active++;maxActive=Math.max(maxActive,active);
    const body=opts && opts.body;let label='document';
    if(typeof body==='string'){const parsed=JSON.parse(body);label=parsed.text.includes('ticket A')||parsed.text.includes('ЗАЯВКА')&&firstA?'A':'B';}
    order.push(label);
    await Promise.resolve();active--;
    if(firstA && /sendMessage$/.test(String(url))){firstA=false;return response({ok:false,error_code:429,parameters:{retry_after:3}},429);}
    return response({ok:true,result:{message_id:nextMessage++}});
  }
};
vm.createContext(context);vm.runInContext(source,context);

(async()=>{
  await Promise.all([context.backupTicketToTelegram(tickets[0]),context.backupTicketToTelegram(tickets[1])]);
  assert.equal(maxActive,1,'different tickets share one global Telegram backup slot');
  assert.ok(delays.includes(3000),'Telegram retry_after controls the delayed retry');
  assert.equal(delays.filter(delay=>delay===3000).length,1,'429 schedules one calm delayed retry, not a hot loop');
  assert.equal(tickets[0].tgBackupPending,false,'first ticket clears pending only after success');
  assert.equal(tickets[1].tgBackupPending,false,'second ticket completes after the first job');
  assert.equal(googleSaves,0,'Telegram queue never enters Google persistence');

  const same=tickets[0];same.tgBackupPending=true;let release;
  context.fetch=async()=>response({ok:false,error_code:429,parameters:{retry_after:2}},429);
  context.setTimeout=(fn,delay)=>{delays.push(delay);release=fn;return 99;};
  const cancelled=context.backupTicketToTelegram(same,{pendingOnly:true});
  while(!release) await Promise.resolve();
  same.tgBackupPending=false;release();
  assert.equal(await cancelled,false,'delayed retry stops when the ticket is no longer pending');

  assert.doesNotMatch(editor,/await\s+backupTicketToTelegram\(/,'local ticket save does not wait for Telegram backup');
  assert.match(source,/const telegramBackupQueues = new Map\(\)/,'per-ticket serialization remains present');
  assert.match(source,/telegramBackupGlobalQueue/,'all ordinary ticket backups use the global queue');
  console.log('PASS Telegram global queue, Retry-After delay, pending guard and Google/local isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});

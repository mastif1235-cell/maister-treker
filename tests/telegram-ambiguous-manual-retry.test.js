'use strict';
// Если ответ Telegram потерялся, заявка помечается tgBackupAmbiguous и
// автоматический повтор выключается (защита от дублей). Такую заявку нельзя
// оставить без копии навсегда: теперь есть явное действие мастера с
// предупреждением о возможном дубле. Автозащита при этом не ослабляется.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js','photo-telegram-domain.js'),'utf8');
const renderSource=fs.readFileSync(path.join(root,'js','tickets-render.js'),'utf8');
const bindingsSource=fs.readFileSync(path.join(root,'js','tickets-bindings.js'),'utf8');
const addressSource=fs.readFileSync(path.join(root,'js','ticket-address-domain.js'),'utf8');

const start=source.indexOf('async function forceRetryTelegramBackup(id){');
const end=source.indexOf('/* ---- Надіслати заявку диспетчеру через бота',start);
assert.ok(start>=0&&end>start,'manual ambiguous retry exists in the Telegram domain');
const block=source.slice(start,end);

let unhandled=0;
process.on('unhandledRejection',()=>{unhandled++;});

function harness(options={}){
  const prompts=[];
  const toasts=[];
  const ticket={id:'t1',content:'заявка',tgBackupAmbiguous:true,tgBackupPending:false};
  let saveCalls=0,backupCalls=0;
  const context={console,Promise,Error,String,Object,Array,
    tickets:[ticket],
    settings:{tgBotToken:options.token===undefined?'123456:TEST_TOKEN':options.token,tgBackupChatId:options.chatId===undefined?'-100500':options.chatId},
    showToast:message=>toasts.push(String(message)),
    openConfirmModal:async opts=>{prompts.push(opts);return options.confirm===undefined?true:options.confirm;},
    saveTicketsLocalOnly:async()=>{saveCalls++;return true;},
    backupTicketToTelegram:async()=>{backupCalls++;if(options.backupThrows)throw new Error('network lost');return options.backupResult===undefined?true:options.backupResult;}};
  vm.createContext(context);vm.runInContext(block,context);
  return{context,ticket,prompts,toasts,counts:()=>({saveCalls,backupCalls})};
}

(async()=>{
  const cancelled=harness({confirm:false});
  assert.equal(await cancelled.context.forceRetryTelegramBackup('t1'),false,'cancelled retry does not send anything');
  assert.equal(cancelled.ticket.tgBackupAmbiguous,true,'cancelling keeps the ambiguous marker');
  assert.equal(cancelled.counts().backupCalls,0,'no backup call when the user cancels');
  assert.equal(cancelled.prompts.length,1,'the risk is explained before retrying');
  assert.match(cancelled.prompts[0].message,/ДРУГА копія|друга/i,'warning mentions a possible duplicate');
  assert.equal(cancelled.prompts[0].danger,true,'duplicate risk is presented as a dangerous action');

  const confirmed=harness({backupResult:true});
  assert.equal(await confirmed.context.forceRetryTelegramBackup('t1'),true,'confirmed retry reports success');
  assert.equal(confirmed.ticket.tgBackupAmbiguous,false,'successful manual retry clears the ambiguous marker');
  assert.equal(confirmed.counts().saveCalls,1,'state is persisted before sending');
  assert.equal(confirmed.counts().backupCalls,1,'backup runs exactly once');
  assert.match(confirmed.toasts[0],/Копію надіслано/,'user sees the success toast');

  const failed=harness({backupResult:false});
  assert.equal(await failed.context.forceRetryTelegramBackup('t1'),false,'failed manual retry is reported as failure');
  assert.match(failed.toasts[0],/Не вдалося надіслати копію/,'user sees the failure toast');

  const thrown=harness({backupThrows:true});
  assert.equal(await thrown.context.forceRetryTelegramBackup('t1'),false,'a transport error resolves false instead of rejecting');
  assert.match(thrown.toasts.at(-1),/Не вдалося надіслати копію/,'transport error is surfaced through the toast');

  const misconfigured=harness({token:''});
  assert.equal(await misconfigured.context.forceRetryTelegramBackup('t1'),false,'manual retry needs bot credentials');
  assert.equal(misconfigured.prompts.length,0,'no confirmation dialog without credentials');
  assert.equal(misconfigured.ticket.tgBackupAmbiguous,true,'marker untouched when credentials are missing');

  const missing=harness();
  assert.equal(await missing.context.forceRetryTelegramBackup('unknown'),false,'unknown ticket id is ignored');
  assert.equal(missing.prompts.length,0,'no dialog for an unknown ticket');

  // Автоматическая защита от дублей остаётся включённой.
  assert.match(source,/if\(current\?\.tgBackupAmbiguous===true\)return false;/,'automatic retry stays blocked for ambiguous tickets');
  assert.match(source,/if\(t\.tgBackupAmbiguous===true\)return false;/,'direct backup call stays blocked for ambiguous tickets');
  assert.match(renderSource,/retry-tg-ambiguous-btn/,'card shows the explicit retry action');
  assert.match(renderSource,/🔁 Копію ще раз/,'explicit action is labelled for the master');
  assert.match(bindingsSource,/retryTgAmbiguousBtn[\s\S]*forceRetryTelegramBackup/,'ticket list binds the explicit retry');
  assert.match(addressSource,/retry-tg-ambiguous-btn[\s\S]*forceRetryTelegramBackup/,'address navigator binds the explicit retry');

  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(unhandled,0,'manual retry never leaks an unhandled rejection');
  console.log('PASS ambiguous Telegram backups can be resent explicitly without re-enabling automatic duplicates');
})().catch(error=>{console.error(error);process.exitCode=1;});

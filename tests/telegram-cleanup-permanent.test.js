'use strict';

// Видалення старої Telegram-копії може не вдатись назавжди (вік повідомлення,
// права в групі). Це не має зупиняти надсилання нової копії, крутити нескінченні
// повтори і не має виглядати як втрата даних.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-telegram-domain.js'), 'utf8');
const response = data=>({status:200, headers:{get:()=>null}, json:async()=>data});

function harness(options){
  options = options || {};
  const sends = [], deletions = [];
  let nextId = 500;
  const ticket = {
    id:'tg-clean', type:'Ремонт', date:'05.09.2026', time:'12:00', content:'backup text',
    photos:[], sum:0, tgBackedUp:true, tgBackupPending:true,
    tgSepMsgId:11, tgTextMsgId:12, tgPhotoMsgId:13, tgPhotoMsgIds:[13], tgJsonMsgId:14,
    tgBackupCleanupMsgIds:options.cleanupIds || [], tgBackupCleanupAttempts:{}, tgBackupStaleMsgIds:[]
  };
  const toasts = [];
  const context = {
    AbortController, Blob, FormData, clearTimeout, setTimeout, console:{error(){}},
    navigator:{onLine:true}, settings:{tgBotToken:'token', tgBackupChatId:'chat'},
    tickets:[ticket], refreshTicketCardDom(){}, saveTicketsLocalOnly:async()=>true,
    resolvePhotoAsync:async()=>null, showToast(message){toasts.push(message);},
    fetch:async(url, init)=>{
      if(/deleteMessage$/.test(String(url))){
        const id = Number(JSON.parse(init.body).message_id);
        deletions.push(id);
        return options.deleteResponse ? options.deleteResponse(id) : {status:200, json:async()=>({ok:true})};
      }
      throw new Error('unexpected direct fetch');
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context, {filename:'js/photo-telegram-domain.js'});
  context.fetchWithRetry = async (url, opts)=>{
    const endpoint = String(url).match(/\/(sendMessage|sendPhoto|sendDocument|editMessageText)$/)?.[1];
    if(endpoint === 'editMessageText') return response({ok:true, result:{message_id:JSON.parse(opts?.body || '{}').message_id}});
    const id = ++nextId;
    sends.push({endpoint, id, body:String(opts?.body || '').length});
    if(endpoint === 'sendPhoto') return response({ok:true, result:{message_id:id, photo:[{file_id:'file-' + id}]}});
    return response({ok:true, result:{message_id:id}});
  };
  return {context, ticket, sends, deletions, toasts};
}
const jsonSends = harnessStack=>harnessStack.sends.filter(item=>String(item.endpoint) === 'sendDocument').length;

const permanent = ()=>harness({
  cleanupIds:[41, 42],
  deleteResponse:()=>({status:400, json:async()=>({ok:false, error_code:400, description:"Bad Request: message can't be deleted"})})
});
const transient = ()=>harness({
  cleanupIds:[51],
  deleteResponse:()=>{ throw new TypeError('network down'); }
});
const successful = ()=>harness({cleanupIds:[61], deleteResponse:()=>({status:200, json:async()=>({ok:true})})});

(async()=>{
  /* 1. успішна очистка: старі id забрано, нова копія надсилається як завжди */

  const ok = successful();
  await ok.context.backupTicketToTelegramNow(ok.ticket);
  assert.ok(ok.deletions.includes(61), 'старе повідомлення з черги очистки видалено');
  assert.deepEqual(Array.from(ok.ticket.tgBackupCleanupMsgIds), [], 'черга очистки порожня');
  assert.equal(ok.ticket.tgBackupPending, false, 'після успішної очистки заявка не вважається pending');
  assert.equal(jsonSends(ok), 0, 'успішна очистка не створює зайвих JSON — актуальна копія вже в групі');
  assert.equal(ok.ticket.tgBackedUp, true);

  /* 2. тимчасова помилка: id лишається в черзі, нову копію не плодимо */

  const temp = transient();
  await temp.context.backupTicketToTelegramNow(temp.ticket);
  assert.deepEqual(Array.from(temp.ticket.tgBackupCleanupMsgIds), [51], 'тимчасово невдалий id лишається в черзі');
  assert.equal(temp.ticket.tgBackupPending, true, 'заявка лишається pending для повтору');
  assert.equal(jsonSends(temp), 0, 'поки очистка не вдалась, нова копія не створюється');
  assert.equal(temp.ticket.tgBackupCleanupAttempts['51'], 1, 'спроба порахована');

  /* 3. постійна помилка: id більше не турбуємо, нова копія таки надсилається */

  const perm = permanent();
  await perm.context.backupTicketToTelegramNow(perm.ticket);
  assert.deepEqual(Array.from(perm.ticket.tgBackupCleanupMsgIds), [], 'постійно невдалі id прибрано з черги повторів');
  assert.deepEqual(Array.from(perm.ticket.tgBackupStaleMsgIds), [41, 42], 'вони позначені як такі, що можуть лишитися в Telegram');
  assert.equal(perm.ticket.tgBackupPending, false, 'постійна відмова не тримає заявку в pending');
  assert.equal(jsonSends(perm), 0, 'через невдалу очистку нових JSON не створюємо — актуальна копія вже є');
  assert.match(perm.toasts.join(' | '), /Стару копію в Telegram не вдалося видалити/, 'користувач отримує ненав’язливе попередження');
  assert.equal(perm.ticket.tgJsonMsgId, 14, 'посилання на актуальну копію не змінюється через невдалу очистку');

  /* 4. повторний запуск не смикає Telegram за старими id і не плодить JSON */

  const sendsAfterFirst = perm.sends.length, deletionsAfterFirst = perm.deletions.length;
  await perm.context.backupTicketToTelegramNow(perm.ticket);
  const laterDeletions = perm.deletions.slice(deletionsAfterFirst);
  assert.equal(laterDeletions.includes(41) || laterDeletions.includes(42), false, 'постійно невдалі id більше не смикаються');
  assert.equal(perm.sends.length - sendsAfterFirst, 1, 'звичайне наступне збереження надсилає свою копію як раніше, а не «додаткову заради очистки»');
  assert.deepEqual(Array.from(perm.ticket.tgBackupStaleMsgIds), [41, 42], 'список «може лишитися» не дублюється');

  /* 5. «повідомлення вже немає» не вважається помилкою */

  const gone = harness({cleanupIds:[71], deleteResponse:()=>({status:400, json:async()=>({ok:false, description:'Bad Request: message to delete not found'})})});
  await gone.context.backupTicketToTelegramNow(gone.ticket);
  assert.deepEqual(Array.from(gone.ticket.tgBackupCleanupMsgIds), [], 'відсутнє повідомлення не залишається в черзі');
  assert.deepEqual(Array.from(gone.ticket.tgBackupStaleMsgIds), [], 'і не позначається як таке, що лишилось');
  assert.equal(jsonSends(gone), 0);

  /* 6. навіть «дивна» постійна помилка не крутиться вічно: після ліміту спроб id стає stale */

  const capped = harness({cleanupIds:[81], deleteResponse:()=>({status:200, json:async()=>({ok:false, error_code:503, description:'server busy'})})});
  for(let attempt = 0; attempt < 4 && capped.ticket.tgBackupCleanupMsgIds.length; attempt++){
    await capped.context.backupTicketToTelegramNow(capped.ticket);
  }
  const cappedQueue = Array.from(capped.ticket.tgBackupCleanupMsgIds);
  assert.equal(cappedQueue.includes(81), false, 'після ліміту спроб id перестає повторюватись');
  assert.ok(Array.from(capped.ticket.tgBackupStaleMsgIds).includes(81), 'id позначено як такий, що може лишитися в Telegram');
  assert.equal(capped.deletions.filter(id=>id === 81).length <= 3, true, 'спроб видалення не більше ліміту');
  assert.equal(jsonSends(capped), 0, 'вичерпання спроб очистки не створює нових копій');
  assert.equal(capped.ticket.tgBackupPending, false, 'черга очистки не лишається вічно заблокованою');

  console.log('PASS telegram cleanup: permanent failures stop blocking new backups, transient ones still retry, nothing is reported as data loss');
})().catch(error=>{console.error(error); process.exitCode = 1;});

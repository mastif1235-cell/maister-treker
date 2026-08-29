'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'photo-telegram-domain.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const ticket = {
  id: 'telegram-retry-test',
  content: 'Telegram retry test',
  tgBackedUp: false,
  tgBackupPending: false,
  tgPhotoFileIds: [],
  tgPhotoMsgIds: []
};
let online = false;
let messagePosts = 0;
let documentPosts = 0;
let persistedTickets = [];
let googleSaveCalls = 0;

const context = {
  AbortController,
  Blob,
  FormData,
  clearTimeout,
  console: {error(){}},
  navigator: {get onLine(){ return online; }},
  refreshTicketCardDom(){},
  resolvePhotoAsync: async()=>null,
  saveTickets: async()=>{
    googleSaveCalls++;
    throw new Error('Telegram metadata must not use Google recordDiff persistence');
  },
  saveTicketsLocalOnly: async()=>{
    persistedTickets = JSON.parse(JSON.stringify(context.tickets));
    return true;
  },
  setTimeout,
  settings: {tgBotToken:'test-token', tgBackupChatId:'test-chat'},
  tickets: [ticket],
  fetch: async()=>{ throw new Error('offline'); }
};

vm.createContext(context);
vm.runInContext(source, context);

(async()=>{
  await context.backupTicketToTelegram(ticket);
  assert.equal(ticket.tgBackupPending, true, 'failed attempted backup remains pending');
  assert.equal(ticket.tgBackedUp, false, 'failed backup is not acknowledged');

  online = true;
  context.fetchWithRetry = async()=>{
    messagePosts++;
    return {json:async()=>({ok:true, result:{message_id:100 + messagePosts}})};
  };
  context.fetch = async url=>{
    assert.match(String(url), /sendDocument$/);
    documentPosts++;
    return {json:async()=>({ok:true, result:{message_id:200 + documentPosts}})};
  };

  await Promise.all([
    context.retryPendingTelegramBackups(),
    context.retryPendingTelegramBackups()
  ]);

  assert.equal(messagePosts, 2, 'one backup sends one separator and one text');
  assert.equal(documentPosts, 1, 'one backup sends one JSON document');
  assert.equal(ticket.tgBackedUp, true, 'successful retry is acknowledged');
  assert.equal(ticket.tgBackupPending, false, 'successful retry clears pending');

  context.tickets = JSON.parse(JSON.stringify(persistedTickets));
  assert.equal(context.tickets[0].tgBackupPending, false, 'restart reloads cleared pending state');
  await context.retryPendingTelegramBackups();
  assert.equal(messagePosts, 2, 'cleared pending is not resent after restart/online');
  assert.equal(documentPosts, 1, 'cleared pending document is not resent');
  assert.equal(googleSaveCalls, 0, 'Telegram metadata never enters Google recordDiff persistence');

  assert.match(source, /t\.tgBackupPending === true/, 'retry selects only explicit pending tickets');
  assert.doesNotMatch(source, /await saveTickets\(\)/, 'Telegram backup never calls Google diff persistence');
  assert.match(source, /await saveTicketsLocalOnly\(\)/, 'Telegram backup persists metadata locally');
  assert.doesNotMatch(source, /filter\([^\n]*!t\.tgBackedUp[^\n]*pending/i, 'tgBackedUp=false is not the retry criterion');
  assert.match(app, /window\.addEventListener\('online'[\s\S]*retryPendingTelegramBackups\(\)/, 'online event starts Telegram pending retry');
  console.log('PASS Telegram offline pending retries once on online and stays acknowledged');
})().catch(error=>{
  console.error(error);
  process.exitCode = 1;
});

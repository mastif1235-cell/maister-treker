'use strict';

// Відновлення заявки з Telegram-архіву: справжнє відновлення відсутньої
// заявки працює як раніше, а повторний імпорт JSON заявки, яка вже є локально,
// не створює копію, здатної редагувати/видаляти Telegram-бекап оригінала.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-telegram-domain.js'), 'utf8');

function harness(seedTickets){
  const state = {saves:0, renders:0, toasts:[]};
  const context = {
    console:{error(){}}, AbortController, Blob, FormData, clearTimeout, setTimeout,
    navigator:{onLine:true}, settings:{tgBotToken:'token', tgBackupChatId:'chat'},
    tickets:JSON.parse(JSON.stringify(seedTickets)),
    MTSyncEngineRuntime:{uuid:()=> 'restored-' + Math.random().toString(36).slice(2, 10)},
    saveTickets(){ state.saves++; },
    renderTicketsScreen(){ state.renders++; },
    refreshTicketCardDom(){}, showToast(message){ state.toasts.push(message); },
    currentTicketDate:null, state
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, {filename:'js/photo-telegram-domain.js'});
  return context;
}

const localTicket = {
  id:'abc-123', type:'Ремонт', date:'05.09.2026', time:'12:00', content:'текст заявки', sum:100,
  tgBackedUp:true, tgBackupPending:false, tgSepMsgId:11, tgTextMsgId:12, tgPhotoMsgId:13, tgPhotoMsgIds:[13], tgJsonMsgId:14,
  tgPhotoFileId:'file-13', tgPhotoFileIds:['file-13'], tgPhotoKeys:['idb:photo'], tgBackupCleanupMsgIds:[], tgBackupAmbiguous:false
};
const jsonOf = ticket=>JSON.stringify(ticket);

/* 1. справжнє відновлення відсутньої заявки: нова заявка + старі Telegram-посилання живі */

const missing = harness([]);
assert.equal(missing.restoreTicketFromTelegramJson(jsonOf(localTicket)), true, 'відсутня заявка відновлюється');
assert.equal(missing.tickets.length, 1);
const restored = missing.tickets[0];
assert.notEqual(restored.id, localTicket.id, 'відновлена заявка отримує власний id');
assert.equal(restored.tgJsonMsgId, 14, 'посилання на старий JSON збережено — його можна відкрити з картки');
assert.equal(restored.tgTextMsgId, 12);
assert.equal(restored.tgSepMsgId, 11);
assert.match(restored.content, /текст заявки/);
assert.equal(missing.state.saves, 1, 'відновлення зберігає заявку локально');
assert.equal(missing.tickets.filter(ticket=>ticket.tgJsonMsgId === 14).length, 1, 'у групі лишається один власник старого бекапу');

/* 2. повторний імпорт JSON заявки, яка вже є локально: копія не створюється */

const duplicate = harness([localTicket]);
assert.equal(duplicate.restoreTicketFromTelegramJson(jsonOf(localTicket)), false, 'повторний імпорт відхилено');
assert.equal(duplicate.tickets.length, 1, 'жодної копії не створено');
assert.deepEqual(duplicate.tickets[0], localTicket, 'локальна заявка не змінилась');
assert.equal(duplicate.state.saves, 0, 'нічого не збережено');
assert.match(duplicate.state.toasts.join(' | '), /Ця заявка вже є в застосунку/, 'майстер бачить зрозуміле повідомлення');

/* 3. нова копія не може керувати Telegram-повідомленнями оригінала */

const guarded = harness([localTicket]);
guarded.restoreTicketFromTelegramJson(jsonOf(Object.assign({}, localTicket, {content:'той самий JSON, але змінений текст'})));
assert.equal(guarded.tickets.length, 1, 'навіть змінений JSON тієї самої заявки не створює другу сутність');
const owners = guarded.tickets.filter(ticket=>ticket.tgJsonMsgId === 14 || ticket.tgTextMsgId === 12);
assert.equal(owners.length, 1, 'лише оригінал володіє Telegram-бекапом');
assert.equal(String(owners[0].id), 'abc-123', 'власник — саме оригінальна заявка');

/* 4. справжнє відновлення після видалення оригінала не блокується */

const afterDelete = harness([]);
afterDelete.restoreTicketFromTelegramJson(jsonOf(localTicket));
afterDelete.tickets[0].content = 'відредагована відновлена заявка';
assert.equal(afterDelete.tickets.length, 1, 'відновлена заявка редагується як звичайна');
assert.equal(afterDelete.tickets[0].tgPhotoFileId, 'file-13', 'старе фото в Telegram лишається доступним через file_id');

/* 5. legacy JSON без id, але з відомими message_id — теж розпізнається як дубль */

const legacyDuplicate = harness([localTicket]);
const legacyWithoutId = Object.assign({}, localTicket, {tgJsonMsgId:14});
delete legacyWithoutId.id;
assert.equal(legacyDuplicate.restoreTicketFromTelegramJson(jsonOf(legacyWithoutId)), false, 'legacy-файл без id знайдено за message_id');
assert.equal(legacyDuplicate.tickets.length, 1);

/* 6. legacy JSON без id і без Telegram-полів імпортується як раніше */

const legacyFresh = harness([]);
const oldFormat = {type:'Ремонт', date:'01.09.2026', time:'10:00', content:'старий формат', sum:50};
assert.equal(legacyFresh.restoreTicketFromTelegramJson(jsonOf(oldFormat)), true, 'старий формат без id і без Telegram-полів відновлюється');
assert.equal(legacyFresh.tickets.length, 1);
assert.equal(legacyFresh.tickets[0].tgJsonMsgId, undefined, 'новій заявці не приписуються чужі Telegram-id');

/* 7. зламаний або сторонній JSON не створює нічого */

const broken = harness([localTicket]);
assert.equal(broken.restoreTicketFromTelegramJson('{'), false);
assert.equal(broken.restoreTicketFromTelegramJson(JSON.stringify({hello:'world'})), false);
assert.equal(broken.tickets.length, 1, 'невалідний JSON не змінює базу');

console.log('PASS telegram JSON restore: real restore keeps old references, duplicate import never creates a Telegram-owning copy');

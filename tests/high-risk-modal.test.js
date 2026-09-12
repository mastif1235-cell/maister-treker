'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const ui=read('js/ui-orchestration.js'),settings=read('js/settings-domain.js'),backup=read('js/backup-system.js'),address=read('js/ticket-address-domain.js'),restore=read('js/restore-from-sheets.js');

assert.match(ui,/role="dialog" aria-modal="true" aria-labelledby=/,'application modal is announced accessibly');
assert.match(ui,/event\.key==='Escape'[\s\S]*doClose\(\)/,'Escape uses the safe close path');
assert.match(ui,/event\.key!=='Tab'[\s\S]*focusable[\s\S]*last\.focus/,'focus remains trapped in the dialog');
assert.match(ui,/data-modal-cancel[\s\S]*\.focus/,'cancel receives initial focus');
assert.match(ui,/if\(settled\)return;settled=true/,'confirm promise settles once');
assert.match(ui,/confirmBtn\.disabled=true;cancelBtn\.disabled=true/,'double submit is disabled before completion');
assert.match(address,/typeof mtModalCleanup==='function'/,'direct modal close removes lifecycle listeners');

const clear=settings.slice(settings.indexOf("document.getElementById('clearAllBtn')"),settings.indexOf('bindSettingsCatalogControls'));
assert.ok(clear.indexOf('await openConfirmModal')<clear.indexOf('tickets = []; shifts = []'),'cancel occurs before any wipe mutation');
assert.doesNotMatch(clear,/\bconfirm\s*\(/,'wipe no longer uses browser confirm');
const lock=settings.slice(settings.indexOf("document.getElementById('appLockToggle')"),settings.indexOf("document.getElementById('appLockChangePwBtn')"));
assert.ok(lock.indexOf('await openConfirmModal')<lock.indexOf('settings.appLockEnabled = false'),'lock state changes only after explicit confirm');
assert.doesNotMatch(lock,/\bconfirm\s*\(/,'disable-lock no longer uses browser confirm');
assert.match(backup,/await openConfirmModal\(\{title:'Відновити резервну копію\?'/,'restore-over-current-data uses app confirmation');
assert.match(backup,/await openConfirmModal\(\{title:'Імпортувати незашифрований бекап\?'/,'legacy unencrypted import uses app confirmation');
assert.doesNotMatch(backup,/if\(!confirm\(/,'high-risk backup paths no longer use browser confirm');

// Irreversible ticket/shift operations, bulk cleanup and cloud restores must use
// the in-app modal as well: a browser-level confirm() can be suppressed by the
// browser ("не показувати діалоги"), and then the destructive action silently
// proceeds or silently does nothing.
const tickets=read('js/tickets-domain.js'),shifts=read('js/shifts-domain.js'),reports=read('js/reports-domain.js'),bindings=read('js/tickets-bindings.js'),telegram=read('js/photo-telegram-domain.js');
const deleteTicketBlock=tickets.slice(tickets.indexOf('async function deleteTicket('),tickets.indexOf('/* ---- Кошик видалених заявок'));
assert.match(deleteTicketBlock,/await openConfirmModal/,'ticket deletion asks through the app modal');
assert.doesNotMatch(deleteTicketBlock,/\bconfirm\s*\(/,'ticket deletion no longer uses browser confirm');
const purgeBlock=tickets.slice(tickets.indexOf('async function purgeDeletedTicket('),tickets.indexOf('function renderDeletedTicketsList('));
assert.match(purgeBlock,/await openConfirmModal/,'permanent trash purge asks through the app modal');
assert.doesNotMatch(purgeBlock,/\bconfirm\s*\(/,'permanent trash purge no longer uses browser confirm');
const shiftDeleteBlock=shifts.slice(shifts.indexOf('async function deleteShift('),shifts.indexOf('/* Текстовий звіт за обраний місяць'));
assert.match(shiftDeleteBlock,/await openConfirmModal/,'shift deletion asks through the app modal');
assert.doesNotMatch(shiftDeleteBlock,/\bconfirm\s*\(/,'shift deletion no longer uses browser confirm');
const dedupBlock=reports.slice(reports.indexOf('async function dedupTickets('),reports.indexOf('async function repairCorruptedTickets('));
assert.match(dedupBlock,/await openConfirmModal/,'duplicate cleanup asks through the app modal');
assert.doesNotMatch(dedupBlock,/\bconfirm\s*\(/,'duplicate cleanup no longer uses browser confirm');
const repairBlock=reports.slice(reports.indexOf('async function repairCorruptedTickets('),reports.indexOf('async function runBulkImport('));
assert.match(repairBlock,/await openConfirmModal/,'corrupted-ticket repair asks through the app modal');
assert.doesNotMatch(repairBlock,/\bconfirm\s*\(/,'corrupted-ticket repair no longer uses browser confirm');
const tagDeleteBlock=bindings.slice(bindings.indexOf("document.getElementById('tagFilterChips')"),bindings.indexOf("document.getElementById('calPrevMonth')"));
assert.match(tagDeleteBlock,/await openConfirmModal/,'bulk tag deletion asks through the app modal');
assert.doesNotMatch(tagDeleteBlock,/\bconfirm\s*\(/,'bulk tag deletion no longer uses browser confirm');
const restoreCloudBlock=settings.slice(settings.indexOf("document.getElementById('restoreCloudBtn')"),settings.indexOf("document.getElementById('sendAllBtn')"));
assert.match(restoreCloudBlock,/restoreFromGoogleSheets\('tickets'\)/,'cloud ticket restore delegates to the in-app restore flow');
assert.doesNotMatch(restoreCloudBlock,/\bconfirm\s*\(/,'cloud ticket restore no longer uses browser confirm');
const restoreShiftsBlock=settings.slice(settings.indexOf("document.getElementById('restoreShiftsCloudBtn')"),settings.indexOf("document.getElementById('sendShiftsAllBtn')"));
assert.match(restoreShiftsBlock,/restoreFromGoogleSheets\('shifts'\)/,'cloud shift restore delegates to the in-app restore flow');
assert.doesNotMatch(restoreShiftsBlock,/\bconfirm\s*\(/,'cloud shift restore no longer uses browser confirm');
assert.match(restore,/await openConfirmModal\(\{title:'Застосувати відновлення з Google Sheets\?'/,'Google Sheets restore confirms before applying');
assert.match(restore,/openModal\(/,'Google Sheets restore uses the in-app analysis/conflict modals');
assert.doesNotMatch(restore,/\bconfirm\s*\(/,'Google Sheets restore never uses browser confirm');
const resyncBlock=telegram.slice(telegram.indexOf('async function resyncAllTicketsToTelegram('),telegram.indexOf('/* Поділитися заявкою'));
assert.match(resyncBlock,/await openConfirmModal/,'full Telegram archive rewrite asks through the app modal');
assert.doesNotMatch(resyncBlock,/\bconfirm\s*\(/,'full Telegram archive rewrite no longer uses browser confirm');
console.log('PASS high-risk app modals default to cancel, prevent double submit and gate all mutations');

'use strict';
/* Регресія аудиту (P0 №3 — приватність): відкритий пароль абонента більше не
   потрапляє в Google Sheets. У стовпці «нотатки_майстра» лишається лише
   позначка `Пароль: @local-only`. Вимоги:
     1) payload не містить ні самого пароля, ні похідних від нього рядків;
     2) логін (людиночитанка довідка) — лишається;
     3) зворотний шлях: маркер НЕ стає паролем при парсингу/restore;
     4) старі рядки з відкритим паролем парсяться як і раніше (сумісність);
     5) хмарний рядок із маркером не генерує зраливих «конфліктів»;
     6) «прийняти хмару» не витирає локальний пароль, бо в хмарі його вже немає. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const restore=require('../js/restore-from-sheets.js');

function loadAppSide(){
  const ctx={console,globalThis:{},TextEncoder,TextDecoder};
  ctx.window=ctx;ctx.globalThis=ctx;
  vm.createContext(ctx);
  vm.runInContext('function formatDate(d){const p=n=>String(n).padStart(2,"0");return p(d.getDate())+"."+p(d.getMonth()+1)+"."+d.getFullYear();}function formatTime(d){const p=n=>String(n).padStart(2,"0");return p(d.getHours())+":"+p(d.getMinutes());}',ctx);
  const utils=path.join(root,'js','app-format-utils.js');
  vm.runInContext(fs.readFileSync(utils,'utf8'),ctx,{filename:utils});
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  vm.runInContext(app.slice(app.indexOf('function ticketToSyncPayload'),app.indexOf('function shiftToSyncPayload'))+
    '\nglobalThis.ticketToSyncPayload = ticketToSyncPayload;',ctx,{filename:'app.js:ticketToSyncPayload'});
  return ctx;
}
const app=loadAppSide();
const deps={ticketToSyncPayload:app.ticketToSyncPayload,parseBackupNote:app.parseBackupNote};

const SECRET='Sup3r-S3cret!';
const ticket={id:'777',date:'12.09.2026',time:'10:20',content:'м.Київ, Хрещатик, 1 — підключення',sum:600,tags:[],
  city:'Київ',login:'abonent777',password:SECRET,masterNote:'не дзвонити після 22:00',
  geoLink:'https://maps.google.com/?q=50.4,30.5'};

(async()=>{
  // 1) Incoming payload: no password in the note, no marker in the data.
  const payload=app.ticketToSyncPayload(ticket);
  assert.ok(payload.backupNote.includes('Логін: abonent777'),'human-readable login in the note — like before');
  assert.ok(payload.backupNote.includes('Пароль: @local-only'),'marker instead of the password');
  assert.equal(payload.backupNote.includes(SECRET),false,'no password in backupNote');
  assert.equal(payload.fullDataJson.includes(SECRET),false,'no password in fullDataJson');
  const fullData=JSON.parse(payload.fullDataJson);
  assert.equal(fullData.password,undefined,'no password field in fullDataJson');
  assert.equal(fullData.login,undefined,'no login field in fullDataJson either');

  // 2) Marker is parsed safely, and legacy rows remain readable.
  const parsed=app.parseBackupNote(payload.backupNote);
  assert.equal(parsed.password,'','the marker is not treated as a password');
  assert.equal(parsed.passwordLocalOnly,true,'the app “sees” that the password is on the device');
  const legacy=app.parseBackupNote('Логін: u1\nПароль: openTextPass');
  assert.equal(legacy.password,'openTextPass','the old rows are parsed as before (read compatibility)');

  // 3) Cloud row with the marker: the local object does not receive a fake password.
  const local={...ticket};
  const cloudRow={id:payload.id,date:payload.date,time:payload.time,content:payload.content,sum:payload.sum,tags:payload.tags,backupNote:payload.backupNote,fullDataJson:payload.fullDataJson};
  const converted=restore.cloudTicketToLocal(cloudRow,{parseBackupNote:app.parseBackupNote,blankTicketObject:()=>({})});
  assert.equal(converted.invalid,false);
  assert.ok(!converted.ticket.password,'@local-only did not become the password');
  assert.notEqual(converted.ticket.password,'@local-only');
  assert.equal(converted.ticket.login,'abonent777','login from the cloud was restored');

  // 4) A real cloud row for the same local ticket does not create a false conflict.
  const plan=restore.buildTicketPlan([local],[cloudRow],deps);
  assert.equal(plan.stats.conflictCount,0,'the marker does not diverge in comparison: match');
  assert.equal(plan.stats.matchCount,1);

  // 5) "Accept the cloud" when there is a conflict in other fields does not wipe out the local secret.
  const otherRow={...cloudRow,content:'ЗІНОВЛЕНИЙ ТЕКСТ З ТАБЛИЦІ'};
  const applied=restore.applyTicketPlan([local],[otherRow],{777:'cloud'},deps);
  assert.equal(applied.length,1);
  assert.equal(applied[0].content,'ЗІНОВЛЕНИЙ ТЕКСТ З ТАБЛИЦІ','the cloud data won where intended');
  assert.equal(applied[0].password,SECRET,'the local password was kept, because the cloud no longer stores it');

  // 6) The old sheet may still have an open password — it no longer overrides the local secret.
  // Plan: both sides pass through the payload builder, so the marker and the
  // old text both become '' and do not create false conflicts; and local data remains intact.
  const legacyRow={...cloudRow,backupNote:'Логін: abonent777\nПароль: tablePass'};
  const legacyPlan=restore.buildTicketPlan([local],[legacyRow],deps);
  assert.equal(legacyPlan.stats.conflictCount,0,'legacy password in the sheet no longer conflicts');
  const appliedLegacy=restore.applyTicketPlan([local],[legacyRow],{777:'cloud'},deps);
  assert.equal(appliedLegacy[0].password,SECRET,'the local secret is not clobbered by the sheet legacy column');
  const editedLegacy={...legacyRow,content:'ІНШИЙ ТЕКСТ З ТАБЛИЦІ'};
  const appliedEdited=restore.applyTicketPlan([local],[editedLegacy],{777:'cloud'},deps);
  assert.equal(appliedEdited[0].content,'ІНШИЙ ТЕКСТ З ТАБЛИЦІ','content from the sheet was applied');
  assert.equal(appliedEdited[0].password,SECRET,'the sheet is not a source of password: the local secret is kept');
  // Проте чистий пристрій підхопить легасі-пароль з колонки — доступ не губиться.
  const fresh={...local}; delete fresh.password;
  const appliedFresh=restore.applyTicketPlan([fresh],[editedLegacy],{777:'cloud'},deps);
  assert.equal(appliedFresh[0].password,'tablePass','the first restore to a clean device still recovers the legacy password');
  console.log('PASS passwords no longer travel to Google Sheets; markers round-trip and local secrets survive cloud adoption');
})().catch(error=>{process.exitCode=1;console.error(error);});

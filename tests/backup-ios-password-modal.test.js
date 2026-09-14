'use strict';
/* Регресія аудиту (P1 iOS PWA): у standalone-режимі iOS prompt() повертає null
   без діалогу — створення/зміна пароля бекапу та розшифрування імпорту
   ставали неможливими. Тепер пароль запитується власним модальним вікном у всіх звичайних
   runtime-середовищах; native prompt лишається лише аварійним fallback до UI. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'js','backup-system.js'),'utf8');

function harness({ios}){
  const prompts=[],modalOpens=[],elements={
    backupPasswordStatus:{textContent:''},
    backupPasswordSaveBtn:{classList:{toggle(){}}},
    backupPasswordChangeBtn:{classList:{toggle(){}}},
    backupPasswordForgetBtn:{classList:{toggle(){}}},
    externalDailyBackupRoot:{innerHTML:''},
    mtBackupPw1:{value:'',focus(){}},
    mtBackupPw2:{value:'',focus(){}},
    mtBackupPwError:{textContent:''},
    mtBackupPwOk:{},
    mtBackupPwCancel:{}
  };
  const vault=new Map(),local=new Map();
  const context={
    console,crypto:webcrypto,TextEncoder,TextDecoder,Blob,
    btoa:v=>Buffer.from(v,'binary').toString('base64'),atob:v=>Buffer.from(v,'base64').toString('binary'),
    setTimeout:()=>1,clearTimeout:()=>{},
    URL:{createObjectURL:()=>'blob:test',revokeObjectURL:()=>{}},
    prompt:()=>{prompts.push(1);return null;},
    confirm:()=>true,openConfirmModal:async()=>true,showToast:()=>{},
    navigator:ios?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',platform:'iPhone',maxTouchPoints:5}:{userAgent:'Mozilla/5.0 (X11; Linux x86_64)',platform:'Linux x86_64',maxTouchPoints:0},
    matchMedia:q=>({matches:ios&&String(q).includes('standalone')}),
    openModal:(title,html,opts)=>{modalOpens.push({title,html});if(opts&&opts.onOpen)opts.onOpen(null);},
    closeModal:()=>{},
    document:{getElementById:id=>elements[id]||null,createElement:()=>({href:'',download:'',click(){}})},
    localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},
    backupDbGet:async k=>vault.get(k)||null,
    backupDbPut:async(k,v)=>{vault.set(k,v);return true;},
    backupDbDelete:async k=>vault.delete(k),
    localDateKey:()=>'2026-09-14',tickets:[],shifts:[],settings:{theme:'dark'},
    securitySanitizeSettingsForBackup:v=>({theme:v.theme}),blankTicketObject:()=>({signal:''}),securityRuntimeSanitizeTicket:v=>v,
    collectLocalPhotoData:async()=>({photoData:{},missingPhotos:0}),photoDbPut:async()=>true,migrateLegacyPhotosToIdb:async()=>{},
    saveTickets:async()=>{},saveShifts:async()=>{},saveSettings:()=>{},saveTicketsLocalOnly:async()=>true,saveShiftsLocalOnly:async()=>true,
    renderTicketsScreen:()=>{},renderShiftsScreen:()=>{},renderSettingsScreen:()=>{},
    securityMergeImportedSettings:(_i,c)=>c
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(source,context);
  return {context,elements,prompts,modalOpens,vault};
}

(async()=>{
  // iOS standalone: замість мертвого prompt() відкривається модалка
  {
    const h=harness({ios:true});
    const saving=h.context.saveBackupPasswordCredential();
    assert.equal(h.modalOpens.length,1,'на iOS відкрито модальний діалог пароля');
    assert.equal(h.modalOpens[0].html.includes('mtBackupPw2'),true,'для нового пароля — два поля');
    assert.equal(h.prompts.length,0,'prompt() на iOS не викликається');
    // слабкий пароль — не випускаємо
    h.elements.mtBackupPw1.value='short';h.elements.mtBackupPw2.value='short';
    h.elements.mtBackupPwOk.onclick();
    assert.match(h.elements.mtBackupPwError.textContent,/мінімум/,'короткий пароль відхилено в діалозі');
    // нещодавній ввід не резолвить проміс
    await Promise.resolve();
    // валідний — збігається
    h.elements.mtBackupPw1.value='ios backup password';h.elements.mtBackupPw2.value='ios backup password';
    h.elements.mtBackupPwOk.onclick();
    assert.equal(await saving,true,'пароль збеpeжено через модалку');
    assert.ok(h.vault.size>=1,'відряджено у зашифроване локальне сховище');
    assert.equal(JSON.stringify([...h.vault.values()]).includes('ios backup password'),false,'у сховищі немає plaintext-пароля');
    // скасування діалогу = null, без викиду
    const cancelling=h.context.saveBackupPasswordCredential();
    h.elements.mtBackupPwCancel.onclick();
    assert.equal(await cancelling,false,'скасування не зберігає пароль');
  }
  // desktop uses the same accessible application modal, not a native prompt
  {
    const h=harness({ios:false});
    const saving=h.context.saveBackupPasswordCredential();
    assert.equal(h.modalOpens.length,1,'на desktop також відкрито модальний діалог');
    assert.equal(h.prompts.length,0,'native prompt не використовується у звичайному runtime');
    h.elements.mtBackupPwCancel.onclick();
    assert.equal(await saving,false,'скасування модалки не зберігає пароль');
  }
  console.log('PASS backup password uses the application modal on iOS and desktop');
})().catch(e=>{console.error(e);process.exitCode=1;});

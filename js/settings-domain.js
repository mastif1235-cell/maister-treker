/* Canonical settings UI and catalog orchestration. */

function backfillAddressDictionariesFromTickets(){
  if(!settings.cities) settings.cities = [];
  if(!settings.streets) settings.streets = {};
  let addedCities = 0, addedStreets = 0;
  tickets.forEach(t=>{
    const city = (t.city||'').trim();
    const street = (t.street||'').trim();
    if(!city) return;
    if(!settings.cities.includes(city)){ settings.cities.push(city); addedCities++; }
    if(street){
      if(!settings.streets[city]) settings.streets[city] = [];
      if(!settings.streets[city].includes(street)){ settings.streets[city].push(street); addedStreets++; }
    }
  });
  saveSettings();
  renderCityMgmtList();
  showToast(addedCities || addedStreets ? `Додано міст: ${addedCities}, вулиць: ${addedStreets}` : 'Нічого нового не знайдено — довідники вже актуальні');
}
/* ---- Повний бекап у JSON (для перенесення на інший телефон або власне
   збереження на випадок втрати кешу/даних) ---- */

function showAppsScriptModal(){
  openModal('Код Apps Script', `
    <div class="report-text">${escapeHtml(APPS_SCRIPT_CODE)}</div>
    <button class="btn btn-accent btn-block" id="copyScriptBtn" style="margin-top:10px;">Копіювати код</button>
  `, {onOpen:()=>{
    document.getElementById('copyScriptBtn').onclick = async ()=>{
      try{ await navigator.clipboard.writeText(APPS_SCRIPT_CODE); showToast('Код скопійовано'); }
      catch(e){ showToast('Не вдалося скопіювати'); }
    };
  }});
}

function bindSettingsScreen(){
  bindSettingsLocalListsControls();
  document.getElementById('backfillAddrBtn').addEventListener('click', backfillAddressDictionariesFromTickets);
  bindSettingsCoworkerControls();

  document.getElementById('hourlyRateInput').addEventListener('input', e=>{
    settings.hourlyRate = Number(e.target.value)||0; saveSettings(); renderShiftStats();
  });
  document.getElementById('defaultConnectFeeInput').addEventListener('input', e=>{
    settings.defaultConnectFee = Number(e.target.value)||0; saveSettings();
  });
  document.getElementById('defaultTariffInput').addEventListener('input', e=>{
    settings.defaultTariff = Number(e.target.value)||0; saveSettings();
  });
  document.getElementById('defaultRepairCallFeeInput').addEventListener('input', e=>{
    settings.defaultRepairCallFee = Number(e.target.value)||0; saveSettings();
  });
  document.getElementById('freeRepairCallThresholdInput').addEventListener('input', e=>{
    settings.freeRepairCallThreshold = Number(e.target.value)||0; saveSettings();
  });
  document.getElementById('themeSwitch').addEventListener('change', e=>{
    settings.theme = e.target.checked ? 'dark' : 'light';
    saveSettings(); applyTheme();
  });
  // NEW: захист входу
  document.getElementById('appLockToggle').addEventListener('change', e=>{
    if(e.target.checked){
      e.target.checked = false; // вмикаємо лише після того, як пароль реально встановлено
      openSetPasswordModal(true);
    } else {
      if(!confirm('Вимкнути захист входу? Пароль і відбиток буде видалено.')){ e.target.checked = true; return; }
      settings.appLockEnabled = false;
      settings.appLockPasswordHash = '';
      settings.appLockPasswordKdf = '';
      settings.appLockPasswordSalt = '';
      settings.appLockPasswordIterations = 0;
      settings.appLockPasswordVerifier = '';
      settings.appLockBiometricEnabled = false;
      settings.appLockCredentialId = '';
      saveSettings();
      renderSettingsScreen();
    }
  });
  document.getElementById('appLockChangePwBtn').addEventListener('click', ()=> openSetPasswordModal(false));
  document.getElementById('appLockBiometricToggle').addEventListener('change', async e=>{
    if(e.target.checked){
      const ok = await registerBiometricCredential();
      if(ok){ settings.appLockBiometricEnabled = true; saveSettings(); showToast('✅ Відбиток налаштовано'); }
      else{ e.target.checked = false; }
    } else {
      settings.appLockBiometricEnabled = false;
      settings.appLockCredentialId = '';
      saveSettings();
    }
  });
  document.getElementById('scriptUrlInput').addEventListener('input', e=>{
    settings.scriptUrl = e.target.value.trim(); saveSettings();
  });
  document.getElementById('syncHmacSecretInput').addEventListener('input', e=>{
    settings.syncHmacSecret = e.target.value.trim(); saveSettings();
  });
  // NEW: налаштування Telegram-бота
  document.getElementById('tgBotTokenInput').addEventListener('input', e=>{
    settings.tgBotToken = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgBackupChatIdInput').addEventListener('input', e=>{
    settings.tgBackupChatId = e.target.value.trim(); saveSettings();
  });
  // NEW: два іменованих диспетчери — окремі поля імені й chat_id для кожного
  document.getElementById('tgDisp1NameInput').addEventListener('input', e=>{
    if(!settings.tgDispatchers) settings.tgDispatchers = [{name:'',chatId:''},{name:'',chatId:''}];
    settings.tgDispatchers[0].name = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgDisp1ChatIdInput').addEventListener('input', e=>{
    if(!settings.tgDispatchers) settings.tgDispatchers = [{name:'',chatId:''},{name:'',chatId:''}];
    settings.tgDispatchers[0].chatId = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgDisp2NameInput').addEventListener('input', e=>{
    if(!settings.tgDispatchers) settings.tgDispatchers = [{name:'',chatId:''},{name:'',chatId:''}];
    settings.tgDispatchers[1].name = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgDisp2ChatIdInput').addEventListener('input', e=>{
    if(!settings.tgDispatchers) settings.tgDispatchers = [{name:'',chatId:''},{name:'',chatId:''}];
    settings.tgDispatchers[1].chatId = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgMyChatIdInput').addEventListener('input', e=>{
    settings.tgMyChatId = e.target.value.trim(); saveSettings();
  });
  document.getElementById('tgTestBtn').addEventListener('click', ()=> sendTelegramTestMessage(settings.tgBackupChatId, 'група-архів'));
  document.getElementById('tgTestDisp1Btn').addEventListener('click', ()=>{
    const d = settings.tgDispatchers && settings.tgDispatchers[0];
    if(!d || !d.chatId){ showToast('Спочатку заповніть Chat ID диспетчера 1'); return; }
    sendTelegramTestMessage(d.chatId, d.name || 'диспетчер 1');
  });
  document.getElementById('tgTestDisp2Btn').addEventListener('click', ()=>{
    const d = settings.tgDispatchers && settings.tgDispatchers[1];
    if(!d || !d.chatId){ showToast('Спочатку заповніть Chat ID диспетчера 2'); return; }
    sendTelegramTestMessage(d.chatId, d.name || 'диспетчер 2');
  });
  document.getElementById('tgTestMonthlyBtn').addEventListener('click', sendMonthlyTelegramReportNow);
  document.getElementById('tgBulkExportBtn').addEventListener('click', bulkExportTicketsToTelegram);
  document.getElementById('tgResyncAllBtn').addEventListener('click', resyncAllTicketsToTelegram);
  document.getElementById('tgRestoreOneBtn').addEventListener('click', showRestoreFromTelegramModal);
  document.getElementById('shiftsScriptUrlInput').addEventListener('input', e=>{
    settings.shiftsScriptUrl = e.target.value.trim(); saveSettings();
  });
  document.getElementById('vizitkaUrlInput').addEventListener('input', e=>{
    settings.vizitkaUrl = e.target.value.trim(); saveSettings();
  });
  document.getElementById('dogovorUrlInput').addEventListener('input', e=>{
    settings.dogovorUrl = e.target.value.trim(); saveSettings();
  });

  document.getElementById('loadCloudBtn').addEventListener('click', loadFromCloud);
  document.getElementById('restoreCloudBtn').addEventListener('click', ()=>{
    if(!confirm('Відновити дані з хмари? Поточні локальні дані будуть замінені.')) return;
    loadFromCloud();
  });
  document.getElementById('sendAllBtn').addEventListener('click', sendAllToCloud);
  document.getElementById('loadShiftsCloudBtn').addEventListener('click', loadShiftsFromCloud);
  document.getElementById('restoreShiftsCloudBtn').addEventListener('click', ()=>{
    if(!confirm('Відновити зміни з хмари? Поточні локальні зміни будуть замінені.')) return;
    loadShiftsFromCloud();
  });
  document.getElementById('sendShiftsAllBtn').addEventListener('click', sendShiftsToCloud);
  document.getElementById('showScriptBtn').addEventListener('click', showAppsScriptModal);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJsonBackup);
  document.getElementById('downloadExternalBackupNowBtn').addEventListener('click', ()=> downloadExternalDailyBackup());
  document.getElementById('openOfflineMapSettingsBtn').addEventListener('click', openOfflineMapSettings);
  document.getElementById('backupPasswordSaveBtn').addEventListener('click', saveBackupPasswordCredential);
  document.getElementById('backupPasswordChangeBtn').addEventListener('click', saveBackupPasswordCredential);
  document.getElementById('backupPasswordForgetBtn').addEventListener('click', forgetBackupPasswordCredential);
  document.getElementById('importJsonBtn').addEventListener('click', ()=> document.getElementById('jsonImportInput').click());
  document.getElementById('jsonImportInput').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    handleJsonImportFile(file);
    e.target.value = ''; // щоб можна було обрати той самий файл повторно
  });
  document.getElementById('exportBtn').addEventListener('click', openExportModal);
  document.getElementById('importBtn').addEventListener('click', openImportModal);
  document.getElementById('repairTicketsBtn').addEventListener('click', repairCorruptedTickets);
  document.getElementById('dedupTicketsBtn').addEventListener('click', dedupTickets);
  document.getElementById('restoreBackupBtn').addEventListener('click', restoreFromBackup);
  // NEW: щоденні бекапи — завантажити як файл або відновити прямо з обраного дня
  document.getElementById('dailyBackupList').addEventListener('click', e=>{
    const dlBtn = e.target.closest('.daily-backup-download-btn');
    const restBtn = e.target.closest('.daily-backup-restore-btn');
    if(dlBtn) downloadDailyBackup(dlBtn.dataset.date);
    if(restBtn) restoreDailyBackup(restBtn.dataset.date);
  });
  document.getElementById('deletedTicketsList').addEventListener('click', e=>{
    const restoreBtn = e.target.closest('.restore-trash-btn');
    const purgeBtn = e.target.closest('.purge-trash-btn');
    if(restoreBtn) restoreDeletedTicket(restoreBtn.dataset.deletedAt);
    if(purgeBtn) purgeDeletedTicket(purgeBtn.dataset.deletedAt);
  });
  document.getElementById('clearAllBtn').addEventListener('click', ()=>{
    if(!confirm('Очистити ВСЮ базу даних (заявки і зміни)? Цю дію не можна скасувати.')) return;
    if(!confirm('Ви впевнені? Дані будуть видалені остаточно.')) return;
    backupLocalData();
    tickets = []; shifts = [];
    saveTickets(); saveShifts();
    clearAllPhotos();
    showToast('Видалення поставлено в безпечну пооб’єктну чергу; full sync не використовується');
    renderTicketsScreen(); renderShiftsScreen();
    showToast('Базу очищено');
  });

  bindSettingsCatalogControls();
}

/* ---------- Захист входу (пароль + опційно відбиток пальця) ----------
   Важливо чесно розуміти рівень захисту: це бар'єр від чужого погляду на
   екран (загублений/вкрадений телефон), а НЕ криптографічний захист від
   технічного втручання — будь-хто з доступом до консолі розробника в
   цьому ж браузері технічно може обійти екран блокування. Пароль
   зберігається як SHA-256 хеш, а не відкритим текстом, щоб він хоча б не
   був видний людині, яка просто відкриє налаштування чи експортований
   бекап. */
// NEW: встановлення чи зміна пароля захисту входу

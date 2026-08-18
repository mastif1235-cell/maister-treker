/* Майстер-Трекер — encrypted physical daily backup v65.0-security.17.3
   Повертає задуману поведінку: один фізичний зашифрований файл у Downloads
   при першому відкритті застосунку за день, без дублювання фото у кожній копії.

   Важливо:
   - локальний snapshot у IndexedDB лишається;
   - фізичний файл містить заявки/зміни/налаштування, але НЕ photoData;
   - пароль береться лише зі збереженого локального backup vault;
   - якщо vault ще не налаштований, автозавантаження просто пропускається;
   - повторно в той самий день файл не створюється.
*/

const DAILY_PHYSICAL_RELEASE_LABEL = 'v65.0-security.17.3 · 2026-08-18';
const DAILY_PHYSICAL_MARKER_KEY = 'dailyPhysicalEncryptedBackupDateV1';

async function securityDailyPhysicalDownload(dateKey, payload){
  const saved = typeof securityBackupVaultLoad === 'function'
    ? await securityBackupVaultLoad()
    : null;
  if(!saved?.password) return false;

  const clean = {
    app:'master-tracker',
    backupVersion:5,
    encryptedSource:true,
    physicalDaily:true,
    photosExcluded:true,
    exportedAt: payload?.exportedAt || new Date().toISOString(),
    tickets: Array.isArray(payload?.tickets) ? payload.tickets : [],
    shifts: Array.isArray(payload?.shifts) ? payload.shifts : [],
    settings: typeof securitySanitizeSettingsForBackup === 'function'
      ? securitySanitizeSettingsForBackup(payload?.settings || {})
      : (payload?.settings || {})
  };

  const envelope = await securityBackupEncryptObject(clean, saved.password);
  envelope.physicalDaily = true;
  envelope.photosExcluded = true;
  securityBackupDownloadEnvelope(
    envelope,
    `master-tracker-backup-${dateKey}-encrypted.json`
  );
  localStorage.setItem(DAILY_PHYSICAL_MARKER_KEY, dateKey);
  return true;
}

if(typeof maybeRunDailyBackup === 'function'){
  maybeRunDailyBackup = async function(){
    if(!backupDb) return;
    try{
      const todayKey = localDateKey(new Date());
      const index = loadDailyBackupIndex();
      let payload = await backupDbGet(todayKey);

      // Спочатку гарантуємо локальний snapshot за сьогодні.
      if(!payload){
        const safeSettings = typeof securitySanitizeSettingsForBackup === 'function'
          ? securitySanitizeSettingsForBackup(settings)
          : settings;
        payload = {
          tickets,
          shifts,
          settings:safeSettings,
          exportedAt:new Date().toISOString(),
          secretsExcluded:true,
          photosExcluded:true
        };
        const ok = await backupDbPut(todayKey, payload);
        if(!ok) return;

        const withoutToday = index.filter(x=>x && x.date!==todayKey);
        withoutToday.unshift({
          date:todayKey,
          ts:Date.now(),
          ticketsCount:tickets.length,
          shiftsCount:shifts.length
        });
        const overflow = withoutToday.splice(DAILY_BACKUP_MAX);
        for(const old of overflow) await backupDbDelete(old.date);
        saveDailyBackupIndex(withoutToday);
      }

      // Фізичний файл — рівно один раз на день. Фото тут навмисно відсутні:
      // при відновленні вони за потреби підтягнуться з Telegram, як і раніше.
      if((tickets.length || shifts.length) && localStorage.getItem(DAILY_PHYSICAL_MARKER_KEY)!==todayKey){
        const downloaded = await securityDailyPhysicalDownload(todayKey, payload);
        if(downloaded && typeof showToast === 'function'){
          showToast(`🔐 Щоденний бекап ${todayKey} збережено у Downloads без фото`);
        }
      }
    }catch(err){
      console.error('Encrypted physical daily backup failed:', err);
    }
  };
}

if(typeof renderSettingsScreen === 'function'){
  const dailyPhysicalPreviousRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = dailyPhysicalPreviousRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${DAILY_PHYSICAL_RELEASE_LABEL}`;
    return result;
  };
}

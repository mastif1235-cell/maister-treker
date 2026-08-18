/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — runtime security hardening (v65 security.9)
   - CSP for controlled navigations is also injected by sw.js;
   - blocks dangerous href schemes in UI;
   - rejects prototype-pollution keys in imported backups;
   - restores encrypted DAILY physical backup download when a vault password
     is already saved on this device (no password prompt during startup).
   ===================================================================== */

const SECURITY_RUNTIME_RELEASE_LABEL = 'v65.0-security.9 · 2026-08-18';
const SECURITY_RUNTIME_PHYSICAL_BACKUP_KEY = 'securityPhysicalBackupLastDate';

function securityRuntimeSafeHref(value){
  const raw=String(value||'').trim();
  if(!raw) return false;
  if(raw.startsWith('#')) return true;
  try{
    const u=new URL(raw,location.href);
    if(u.origin===location.origin && (u.protocol==='https:' || u.protocol==='http:')) return true;
    return ['https:','tel:','mailto:','blob:'].includes(u.protocol);
  }catch(e){ return false; }
}

// Last-line defense for links generated from imported/user data. This blocks
// javascript:, data:, file: and external plain-http links even if a renderer
// accidentally forgets to validate a URL before putting it into href.
document.addEventListener('click',(e)=>{
  const a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if(!a) return;
  const href=a.getAttribute('href')||'';
  if(securityRuntimeSafeHref(href)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if(typeof showToast==='function') showToast('🔒 Небезпечне посилання заблоковано');
},true);

// geoLink is the only ticket field currently rendered directly into href.
// Keep display data untouched, but remove an unsafe link from the render copy.
if(typeof renderTicketCard==='function'){
  const securityRuntimeOriginalRenderTicketCard=renderTicketCard;
  renderTicketCard=function(ticket,opts){
    if(ticket && ticket.geoLink && !securityRuntimeSafeHref(ticket.geoLink)){
      ticket=Object.assign({},ticket,{geoLink:''});
    }
    return securityRuntimeOriginalRenderTicketCard(ticket,opts);
  };
}

function securityRuntimeHasPrototypeKeys(value,depth=0,seen=new Set()){
  if(depth>24) return true;
  if(value===null || typeof value!=='object') return false;
  if(seen.has(value)) return false;
  seen.add(value);
  for(const key of Object.keys(value)){
    if(key==='__proto__' || key==='prototype' || key==='constructor') return true;
    if(securityRuntimeHasPrototypeKeys(value[key],depth+1,seen)) return true;
  }
  return false;
}

if(typeof securityValidateBackupEnvelope==='function'){
  const securityRuntimePreviousBackupValidator=securityValidateBackupEnvelope;
  securityValidateBackupEnvelope=function(data){
    if(!securityRuntimePreviousBackupValidator(data)) return false;
    if(securityRuntimeHasPrototypeKeys(data)) return false;
    return true;
  };
}

async function securityRuntimeBuildDailyEnvelope(dateKey,payload,saved){
  const clean={
    app:'master-tracker',
    backupVersion:5,
    encryptedSource:true,
    exportedAt:payload.exportedAt || new Date().toISOString(),
    tickets:Array.isArray(payload.tickets)?payload.tickets:[],
    shifts:Array.isArray(payload.shifts)?payload.shifts:[],
    settings:typeof securitySanitizeSettingsForBackup==='function'
      ? securitySanitizeSettingsForBackup(payload.settings||{})
      : (payload.settings||{})
  };
  const envelope=await securityBackupEncryptObject(clean,saved.password);
  securityBackupDownloadEnvelope(envelope,`master-tracker-backup-${dateKey}-encrypted.json`);
}

async function securityRuntimeTryPhysicalDailyBackup(dateKey,payload){
  if(localStorage.getItem(SECURITY_RUNTIME_PHYSICAL_BACKUP_KEY)===dateKey) return;
  if(!(tickets.length||shifts.length)) return;
  const saved=await securityBackupVaultLoad();
  if(!saved || !saved.password) return;
  try{
    await securityRuntimeBuildDailyEnvelope(dateKey,payload,saved);
    localStorage.setItem(SECURITY_RUNTIME_PHYSICAL_BACKUP_KEY,dateKey);
  }catch(downloadErr){
    console.warn('Automatic encrypted daily backup download was blocked/failed:',downloadErr);
  }
}

// security.7 intentionally disabled automatic downloads. The user relies on a
// physical file surviving browser/site-data cleanup, so security.9 restores it
// SAFELY: only when the backup password is already stored in the local vault.
// If today's IndexedDB snapshot already exists (for example this update was
// installed in the middle of the day), we still attempt the physical file once.
if(typeof maybeRunDailyBackup==='function' && typeof securityBackupVaultLoad==='function'){
  maybeRunDailyBackup=async function(){
    if(!backupDb) return;
    try{
      const todayKey=localDateKey(new Date());
      const index=loadDailyBackupIndex();
      if(index[0] && index[0].date===todayKey){
        const existing=await backupDbGet(todayKey);
        if(existing) await securityRuntimeTryPhysicalDailyBackup(todayKey,existing);
        return;
      }

      const safeSettings=typeof securitySanitizeSettingsForBackup==='function'
        ? securitySanitizeSettingsForBackup(settings)
        : settings;
      const payload={tickets,shifts,settings:safeSettings,exportedAt:new Date().toISOString(),secretsExcluded:true};
      const ok=await backupDbPut(todayKey,payload);
      if(!ok) return;
      index.unshift({date:todayKey,ts:Date.now(),ticketsCount:tickets.length,shiftsCount:shifts.length});
      const overflow=index.splice(DAILY_BACKUP_MAX);
      for(const old of overflow) await backupDbDelete(old.date);
      saveDailyBackupIndex(index);
      await securityRuntimeTryPhysicalDailyBackup(todayKey,payload);
    }catch(err){ console.error('Security.9 daily backup error:',err); }
  };
}

if(typeof renderSettingsScreen==='function'){
  const securityRuntimeOriginalRenderSettings=renderSettingsScreen;
  renderSettingsScreen=function(){
    const result=securityRuntimeOriginalRenderSettings.apply(this,arguments);
    const label=document.getElementById('appVersionLabel');
    if(label) label.textContent=`Версія застосунку: ${SECURITY_RUNTIME_RELEASE_LABEL}`;
    return result;
  };
}

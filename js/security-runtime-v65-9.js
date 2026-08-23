/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — runtime security hardening (v65 security.10)
   - CSP for controlled navigations is also injected by sw.js;
   - blocks dangerous href schemes in UI;
   - rejects prototype-pollution keys in imported backups;
   - normalizes imported ticket/settings fields before they reach HTML sinks;
   - restores encrypted DAILY physical backup download when a vault password
     is already saved on this device (no password prompt during startup).
   ===================================================================== */

const SECURITY_RUNTIME_RELEASE_LABEL = 'v65.0-security.10 · 2026-08-18';
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

function securityRuntimeSafeNumber(value,fallback=0,min=0,max=100000000){
  const n=Number(value);
  if(!Number.isFinite(n)) return fallback;
  return Math.min(max,Math.max(min,n));
}

function securityRuntimeString(value,max=20000){
  return String(value ?? '').slice(0,max);
}

function securityRuntimeSafeTicketId(value,index=0){
  const raw=String(value ?? '');
  if(/^\d{1,18}$/.test(raw)) return Number(raw);
  return Date.now()+Number(index||0);
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

// A ticket id is interpolated into several data-* / id attributes by the
// existing renderer. Normal ids are numeric. If damaged/imported data contains
// quotes or markup, encode it before the template is built. Browser decoding
// still gives event handlers the original value, while the HTML stays inert.
// geoLink is also stripped from the render copy if it is not a safe URL.
if(typeof renderTicketCard==='function'){
  const securityRuntimeOriginalRenderTicketCard=renderTicketCard;
  renderTicketCard=function(ticket,opts){
    if(ticket && typeof ticket==='object'){
      const patch={};
      if(ticket.geoLink && !securityRuntimeSafeHref(ticket.geoLink)) patch.geoLink='';
      const rawId=String(ticket.id ?? '');
      if(!/^\d{1,18}$/.test(rawId) && typeof escapeHtml==='function') patch.id=escapeHtml(rawId);
      if(Object.keys(patch).length) ticket=Object.assign({},ticket,patch);
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

if(false && typeof securityValidateBackupEnvelope==='function'){
  const securityRuntimePreviousBackupValidator=securityValidateBackupEnvelope;
  securityValidateBackupEnvelope=function(data){
    if(!securityRuntimePreviousBackupValidator(data)) return false;
    if(securityRuntimeHasPrototypeKeys(data)) return false;
    return true;
  };
}

function securityRuntimeSanitizeTicket(ticket,index=0){
  if(!ticket || typeof ticket!=='object' || Array.isArray(ticket)) return {};
  const t=Object.assign({},ticket);
  t.id=securityRuntimeSafeTicketId(t.id,index);
  if(t.geoLink && !securityRuntimeSafeHref(t.geoLink)) t.geoLink='';

  // Fields that later appear in text/attributes are bounded to keep malformed
  // imports from creating giant DOM nodes or pathological localStorage values.
  const short=['date','time','type','city','street','house','apartment','clientName','phone','payment','contractNumber','contractNumberDate','contractNumberMastersKey','login','macAddress'];
  short.forEach(k=>{ if(k in t) t[k]=securityRuntimeString(t[k],500); });
  const medium=['address','note','masterNote','otherNote','abonentNote'];
  medium.forEach(k=>{ if(k in t) t[k]=securityRuntimeString(t[k],5000); });
  if('content' in t) t.content=securityRuntimeString(t.content,30000);
  if('password' in t) t.password=securityRuntimeString(t.password,1000);

  ['sum','callFee','tariff','cashAmount','cardAmount'].forEach(k=>{
    if(k in t) t[k]=securityRuntimeSafeNumber(t[k],0,0,100000000);
  });

  ['tags','extraPhones','photos','tgPhotoFileIds','tgPhotoMsgIds','connectMasters','equipment','cables','presetWorks','additionalWork'].forEach(k=>{
    if(k in t && !Array.isArray(t[k])) t[k]=[];
    if(Array.isArray(t[k]) && t[k].length>500) t[k]=t[k].slice(0,500);
  });
  return t;
}

function securityRuntimeNormalizeCatalogSettings(s){
  if(!s || typeof s!=='object' || Array.isArray(s)) return s;
  const out=Object.assign({},s);
  ['hourlyRate','defaultConnectFee','defaultTariff','defaultRepairCallFee','freeRepairCallThreshold'].forEach(k=>{
    if(k in out) out[k]=securityRuntimeSafeNumber(out[k],0,0,100000000);
  });
  if(Array.isArray(out.materials)) out.materials=out.materials.slice(0,1000).map((m,i)=>({
    id:securityRuntimeString(m?.id || `material_${i}`,120),
    label:securityRuntimeString(m?.label,500),
    price:securityRuntimeSafeNumber(m?.price,0,0,100000000)
  }));
  if(Array.isArray(out.workTypes)) out.workTypes=out.workTypes.slice(0,1000).map((w,i)=>({
    id:securityRuntimeString(w?.id || `work_${i}`,120),
    label:securityRuntimeString(w?.label,500),
    price:securityRuntimeSafeNumber(w?.price,0,0,100000000)
  }));
  if(Array.isArray(out.cableTypes)) out.cableTypes=out.cableTypes.slice(0,1000).map((c,i)=>({
    id:securityRuntimeString(c?.id || `cable_${i}`,120),
    label:securityRuntimeString(c?.label,500),
    pricePerMeter:securityRuntimeSafeNumber(c?.pricePerMeter,0,0,1000000)
  }));
  if(Array.isArray(out.masters)) out.masters=out.masters.slice(0,500).map(m=>({
    name:securityRuntimeString(m?.name,300),
    letter:securityRuntimeString(m?.letter,10)
  }));
  if(Array.isArray(out.quickDialContacts)) out.quickDialContacts=out.quickDialContacts.slice(0,500).map(c=>({
    name:securityRuntimeString(c?.name,300),
    phone:securityRuntimeString(c?.phone,100)
  }));
  return out;
}

// Imported settings are whitelisted by security-hardening.js. Add type/range
// normalization so a crafted backup cannot inject quote-bearing values into
// numeric value="..." attributes or explode catalog sizes.
if(typeof securityMergeImportedSettings==='function'){
  const securityRuntimePreviousSettingsMerge=securityMergeImportedSettings;
  securityMergeImportedSettings=function(imported,current){
    return securityRuntimeNormalizeCatalogSettings(securityRuntimePreviousSettingsMerge(imported,current));
  };
}

// Encrypted restore path: sanitize the decrypted payload before the original
// restore function creates application objects from it.
if(false && typeof securityBackupRestorePayload==='function'){
  const securityRuntimePreviousEncryptedRestore=securityBackupRestorePayload;
  securityBackupRestorePayload=async function(data){
    const clean=Object.assign({},data||{});
    if(Array.isArray(clean.tickets)) clean.tickets=clean.tickets.map(securityRuntimeSanitizeTicket);
    if(clean.settings && typeof clean.settings==='object') clean.settings=securityRuntimeNormalizeCatalogSettings(clean.settings);
    return securityRuntimePreviousEncryptedRestore(clean);
  };
}

// Legacy/plain JSON import path: rebuild a sanitized Blob, then let the
// existing import handler perform its normal confirmations/photo migration.
if(false && typeof legacyHandleJsonImportFileDisabled==='function'){
  const securityRuntimePreviousJsonImport=legacyHandleJsonImportFileDisabled;
  legacyHandleJsonImportFileDisabled=async function(file){
    if(!file) return;
    try{
      const parsed=JSON.parse(await file.text());
      if(parsed?.format===SECURITY_BACKUP_ENVELOPE) return securityRuntimePreviousJsonImport(file);
      if(securityRuntimeHasPrototypeKeys(parsed)){
        if(typeof showToast==='function') showToast('🔒 Бекап містить небезпечну структуру й заблокований');
        return;
      }
      if(Array.isArray(parsed.tickets)) parsed.tickets=parsed.tickets.map(securityRuntimeSanitizeTicket);
      if(parsed.settings && typeof parsed.settings==='object') parsed.settings=securityRuntimeNormalizeCatalogSettings(parsed.settings);
      const cleanBlob=new Blob([JSON.stringify(parsed)],{type:'application/json'});
      return securityRuntimePreviousJsonImport(cleanBlob);
    }catch(e){
      return securityRuntimePreviousJsonImport(file);
    }
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
// physical file surviving browser/site-data cleanup, so security.9 restored it
// SAFELY: only when the backup password is already stored in the local vault.
// If today's IndexedDB snapshot already exists (for example this update was
// installed in the middle of the day), we still attempt the physical file once.
if(false && typeof legacyMaybeRunDailyBackupDisabled==='function' && typeof securityBackupVaultLoad==='function'){
  legacyMaybeRunDailyBackupDisabled=async function(){
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
    }catch(err){ console.error('Security.10 daily backup error:',err); }
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

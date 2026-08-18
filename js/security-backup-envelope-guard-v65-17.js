/* Майстер-Трекер — encrypted backup envelope guard v65.0-security.17
   Захищає імпорт зашифрованих бекапів від навмисно некоректних параметрів KDF/AES.
   Без цього envelope міг підставити абсурдне число PBKDF2-ітерацій або неправильні
   salt/iv і змусити слабкий телефон надовго зависнути ще до нормальної перевірки.
*/

const SECURITY_BACKUP_GUARD_RELEASE_LABEL = 'v65.0-security.17 · 2026-08-18';
const SECURITY_BACKUP_GUARD_MIN_ITER = 100000;
const SECURITY_BACKUP_GUARD_MAX_ITER = 1000000;
const SECURITY_BACKUP_GUARD_MAX_CIPHER_B64 = 220 * 1024 * 1024;

function securityBackupGuardBase64Size(value){
  const s = String(value || '').replace(/\s/g,'');
  if(!s || !/^[A-Za-z0-9+/=_-]+$/.test(s)) return -1;
  return s.length;
}

function securityBackupGuardEnvelope(envelope){
  if(!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return false;
  if(envelope.format !== 'master-tracker-encrypted-backup' || Number(envelope.version)!==1) return false;
  if(envelope.algorithm !== 'AES-GCM-256' || envelope.kdf !== 'PBKDF2-SHA256') return false;
  const it = Number(envelope.iterations);
  if(!Number.isInteger(it) || it < SECURITY_BACKUP_GUARD_MIN_ITER || it > SECURITY_BACKUP_GUARD_MAX_ITER) return false;
  const saltLen = securityBackupGuardBase64Size(envelope.salt);
  const ivLen = securityBackupGuardBase64Size(envelope.iv);
  const cipherLen = securityBackupGuardBase64Size(envelope.ciphertext);
  if(saltLen < 20 || saltLen > 64) return false;
  if(ivLen < 16 || ivLen > 32) return false;
  if(cipherLen < 24 || cipherLen > SECURITY_BACKUP_GUARD_MAX_CIPHER_B64) return false;
  return true;
}

function securityBackupGuardRecoveryWrap(wrap){
  if(!wrap || typeof wrap !== 'object' || Array.isArray(wrap)) return false;
  if(Number(wrap.version)!==1) return false;
  const it = Number(wrap.iterations);
  if(!Number.isInteger(it) || it < SECURITY_BACKUP_GUARD_MIN_ITER || it > SECURITY_BACKUP_GUARD_MAX_ITER) return false;
  const saltLen = securityBackupGuardBase64Size(wrap.salt);
  const ivLen = securityBackupGuardBase64Size(wrap.iv);
  const cipherLen = securityBackupGuardBase64Size(wrap.ciphertext);
  return saltLen>=20 && saltLen<=64 && ivLen>=16 && ivLen<=32 && cipherLen>=16 && cipherLen<=4096;
}

if(typeof securityBackupDecryptEnvelope === 'function'){
  const securityBackupGuardPreviousDecrypt = securityBackupDecryptEnvelope;
  securityBackupDecryptEnvelope = async function(envelope,password){
    if(!securityBackupGuardEnvelope(envelope)) throw new Error('BAD_ENVELOPE_PARAMS');
    return securityBackupGuardPreviousDecrypt(envelope,password);
  };
}

if(typeof securityBackupUnwrapPasswordWithRecovery === 'function'){
  const securityBackupGuardPreviousUnwrap = securityBackupUnwrapPasswordWithRecovery;
  securityBackupUnwrapPasswordWithRecovery = async function(wrap,recoveryKey){
    if(!securityBackupGuardRecoveryWrap(wrap)) throw new Error('BAD_RECOVERY_WRAP');
    const key = securityBackupRecoveryKeyNormalize(recoveryKey);
    if(key.length < 20 || key.length > 128) throw new Error('BAD_RECOVERY_KEY');
    return securityBackupGuardPreviousUnwrap(wrap,key);
  };
}

if(typeof renderSettingsScreen === 'function'){
  const securityBackupGuardPreviousRender = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = securityBackupGuardPreviousRender.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_BACKUP_GUARD_RELEASE_LABEL}`;
    return result;
  };
}

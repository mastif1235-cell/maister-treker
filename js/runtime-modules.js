/* Runtime composition manifest — architecture-cleanup.
 * One visible inventory for transitional runtime modules.
 * Sync is now owned by js/sync-v65.js instead of the 18.x wrapper chain.
 */
self.MAISTER_RUNTIME_MODULES = Object.freeze([
  'js/security-hardening.js',
  'js/security-lock.js',
  'js/security-qr.js',
  'js/security-telegram.js',
  'js/security-backup-encryption.js',
  'js/security-backup-vault-hub.js',
  'js/security-backup-vault.js',
  'js/security-runtime-v65-9.js',
  'js/share-fix-v65-11.js',
  'js/share-photo-picker-v65-12.js',
  'js/share-multi-fix-v65-17-2.js',
  'js/telegram-backup-reliability-v65-13.js',
  'js/photo-data-fetch-v65-14.js',
  'js/security-backup-envelope-guard-v65-17.js',
  'js/security-dom-final-v65-18.js',
  'js/daily-physical-backup-v65-17-3.js',
  'js/security-audit-fixes-v65-18-9.js',
  'js/sync-v65.js'
]);

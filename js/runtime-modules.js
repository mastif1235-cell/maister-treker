/* Runtime composition manifest.
 * This file is the single source of truth for optional/runtime modules.
 * index.html and sw.js migration should consume this list rather than grow
 * independent hidden lists. Keeping it data-only makes review straightforward.
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
  'js/security-sync-hmac-v65-18.js',
  'js/security-sync-verify-v65-18-1.js',
  'js/security-sync-race-v65-18-3.js',
  'js/security-sync-delete-repair-v65-18-4.js',
  'js/security-sync-latency-v65-18-5.js',
  'js/security-sync-verify-v65-18-6.js',
  'js/security-sync-locksplit-v65-18-7.js',
  'js/security-sync-fastverify-v65-18-8.js',
  'js/security-audit-fixes-v65-18-9.js'
]);

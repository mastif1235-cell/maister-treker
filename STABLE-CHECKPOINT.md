# v66 stable checkpoint

## Runtime owners

- Sync: `sync-engine-runtime.js`, with IndexedDB `maisterTrackerSync/journal/state-v1` as the only persisted journal owner and `sync-transport.js` as its signed transport.
- GAS test candidate: canonical `Code.gs`, one `doGet` and one `doPost`; production deployment is unknown and unchanged.
- Backup/restore: `backup-system.js`; encrypted exports use PBKDF2-SHA256 and AES-GCM. Daily IndexedDB snapshots are local recovery data and exports are always encrypted.
- App lock: `security-lock.js` backed by `app-lock-core.js`; legacy SHA-256 migrates to salted PBKDF2 after a valid unlock. This is not encryption-at-rest.
- QR: `securityQrBuildContractUrl` directly produces same-origin fragment-only v2 URLs; `d.js` is the canonical v2 viewer and `dogovor-secure.js` is the legacy v1 viewer.
- Security headers: `_headers` for a capable host, with CSP/referrer meta fallback for GitHub Pages. Service Worker is not a security-header owner.

## Regression result

All 12 test files pass: GAS contract/static vectors; sync core/runtime/transport and owner checks; secret boundaries; backup envelope; app lock and owner consolidation; DOM/QR/CSP; Service Worker upgrade simulation. All runtime JavaScript passes `node --check`, all bootstrap/SW asset references resolve, and `git diff --check` passes.

Legacy search confirms that remaining matches are not second sync owners: `retrySyncQueue` is a UI facade over the canonical engine; `synced`, `syncAction` and `pendingCloudDelete` are one-time migration fields; `deletedTickets` is trash/UI data; disabled `shiftsScriptUrl` is compatibility data; `no-cors` is a bounded canonical transport mode; Telegram/photo `window.fetch` interceptors do not own ticket/shift mutation transport. No `secret=` query transport remains.

## Known findings and gates

- Critical: 0 known. High: 0 known.
- Medium: direct client-held Telegram bot token; GitHub Pages cannot enforce checked-in response-only anti-framing headers.
- Low: escaped-template DOM maintenance complexity; inactive compatibility fields/code retained until later domain decomposition.
- Production gate: test CORS/no-cors only on an isolated test GAS deployment.
- Production gate: upgrade an installed old PWA/Service Worker to v66 without clearing user data; verify IndexedDB/localStorage preservation, pending journal recovery and deterministic cache update.

No production deploy, GAS/Sheets mutation, secret rotation or merge to `main` occurred.

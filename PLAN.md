# Security and stability implementation plan

Branch: `agent/security-stability-v66`. Baseline checkpoint: `9ae763a7a262a56d99efb4bfaaf1360b2d4c39b5`.

## Rules

- Read-only inventory is attempted once per relevant source. Unavailable production facts are recorded as `UNKNOWN`; isolated work continues.
- Production deploys, GAS/Sheets changes, real secret rotation, destructive migrations, and merge to `main` require explicit approval.
- Each stage ends with targeted tests, diff review, a logical commit, and this status update.
- No new patch/hotfix layers. One canonical owner replaces wrappers only after parity tests.
- **Production deployment gate:** before any production release, test upgrade from the old Service Worker/installed PWA to v66 without clearing user data; verify IndexedDB/localStorage preservation, pending sync recovery, cache replacement, and deterministic reload.
- The explicit runtime extensions are an intermediate split-brain fix, not the final architecture. Consolidate them domain-by-domain only after parity tests; do not remove them in bulk. Stage 4 removed only the eight sync-domain owners after their replacement passed parity tests.

## Stages

1. **Production inventory and branch/checkpoint — complete.** Proven facts are recorded in `AUDIT.md`; inaccessible production systems are explicitly `UNKNOWN`.
2. **Deterministic runtime bootstrap — complete.** The exact 25 extension scripts are explicitly ordered after `app.js`; SW no longer mutates HTML, injects scripts, or forces client navigation. Targeted checks: all JS syntax; 49 HTML script references exist; clean first-load loads all 49 with no console errors; server-offline reload restores all 49 and active UI from cache; SW injector/forced navigation search is empty.
3. **Canonical GAS contract in code/test environment — complete.** `Code.gs` is the sole GAS source with one `doGet`/`doPost`; HMAC v3 uses a Script Property, UTF-8 length-prefixed canonicalization, base64url, timestamp/nonce replay controls, generic errors, schema/size validation, ScriptLock and bounded idempotency records. Two vectors pass independently through browser-client and mocked GAS implementations; negative and lost-response cases pass. Production client transport and production GAS were not changed/deployed.
4. **Minimal sync state machine and unified tickets/shifts engine — complete.** IndexedDB database `maisterTrackerSync`, store `journal`, key `state-v1` is the only persisted journal owner. Tickets and shifts share one serialized recovery loop and HMAC v3 transport. Local saves durably record bounded `head`/`tail` transitions before network; startup and `online` recover them. Eight legacy sync wrapper/transport files were removed. Full sync remains closed with `ADMIN_RECOVERY_REQUIRED`; CORS capability remains `UNKNOWN` until an isolated GAS deployment test.
5. **Secrets and boundaries — complete.** Legacy query secret is discarded; HMAC material stays out of URL/body and GAS source; all credentials/routing identifiers are excluded from backups and direct secret logging. `SECRETS-THREAT-MODEL.md` documents the unavoidable Telegram direct-client token-path/XSS boundary and the cost/benefit of a future narrow relay; no proxy was added.
6. **Backup/restore and app-lock consolidation — complete.** `backup-system.js` is the sole export/import/daily owner and uses a validated PBKDF2-SHA256/AES-GCM envelope with bounded files, schema/prototype checks, secret exclusion and legacy plaintext/slot migration. Five backup patch owners were retired. `security-lock.js` is the sole lock owner, backed by testable PBKDF2/constant-time/throttling primitives; throttle state survives reload and legacy SHA-256 migrates after a valid unlock. The lock remains a UI access control, not encryption-at-rest.
7. **DOM/XSS, QR and host CSP/headers — pending.** Central sink/URL policy and deterministic host security configuration.
8. **Full regression/security pass and STABLE CHECKPOINT — pending.** Decomposition of `app.js` is forbidden before this checkpoint.

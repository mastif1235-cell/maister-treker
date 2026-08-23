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
7. **DOM/XSS, QR and host CSP/headers — complete.** Sources/sinks and residual risk are recorded in `SECURITY-REVIEW.md`. Scanner text uses DOM/text APIs; imported/rendered values are bounded, escaped and URL/photo schemes are allowlisted. Contract QR is generated directly as same-origin `d.html#2.<base64url>` with no sensitive query stage; viewers clear the fragment before bounded `textContent` rendering. CSP is enforced by checked-in Netlify headers and page meta fallback; GitHub Pages anti-framing remains a documented Medium host limitation.
8. **Full regression/security pass and STABLE CHECKPOINT — complete.** Twelve automated/static suites, full JavaScript syntax, bootstrap/SW asset resolution and legacy-owner searches pass. `STABLE-CHECKPOINT.md` records owners, residual severity and unexecuted production gates. No `app.js` decomposition was started.

## app.js decomposition after stable checkpoint

Baseline and dependency rules are fixed in `APP-DECOMPOSITION-MAP.md`. Planned order:

1. **Pure utils/format/validation — complete.** Pure Ukrainian date formatting and legacy backup-note parsing now load from `app-format-utils.js` before `app.js`; owner and behavior tests pass with no state/schema changes.
2. **QR/share — complete.** `qr-share-domain.js` owns vizitka/dogovor/PDF and `share-domain.js` owns clipboard/Web Share flows. Source owners were removed from `app.js`; fragment-only QR and security-adapter load order are unchanged and statically enforced.
3. **Reports/import-export UI — complete.** `reports-domain.js` owns report generation, NotebookLM export, bulk import, repair and dedup flows. Canonical encrypted backup APIs remain untouched; retired plaintext backup implementations were removed from `app.js`.
4. **Settings — complete.** `settings-core.js` owns defaults, migrations and persistence before app-state construction; `settings-domain.js` owns settings/catalog UI and binding. Secret/lock sanitization order is preserved, and retired base lock implementations were removed without touching the canonical lock owner.
5. **Photos/Telegram helpers — complete.** `photo-telegram-domain.js` owns local photo resolution/migration and direct Telegram delivery, backup/report queues. Token architecture, URLs, storage keys and later security fetch/photo adapters are unchanged; their load order is tested.
6. **Shifts — complete.** `shifts-domain.js` owns calendar/render/bind, mutations, monthly reporting and Telegram message maintenance. Shared date/selection state and `saveShifts` remain unchanged; unified sync journal calls are untouched.
7. **Tickets — complete.** `ticket-editor-core.js` constructs calculator state before `app.js`; `ticket-editor-domain.js`, `tickets-domain.js`, `tickets-bindings.js` and `ticket-address-domain.js` own form/draft/save, list/trash/calendar mutations, event wiring, naryad and address navigation. Source owners were removed immediately, load order is explicit, and journal-before-storage calls are unchanged.
8. **Storage orchestration — complete.** `storage-orchestration.js` owns shifts/naryad persistence plus daily-backup presentation/reminder facades. Ticket/photo/backup IndexedDB owners and every storage schema remain unchanged; settings and drafts already moved with their owning domains.
9. **UI orchestration/init.** Leave a small deterministic bootstrap with shared state construction, ordered initialization, listeners and SW registration.

Each numbered block ends with targeted tests, complete syntax checks, duplicate-owner/load-order search, diff review, a logical commit and status update. Final gate repeats all stable-checkpoint regressions and records the before/after size plus a production-candidate checkpoint. Sync/security/backup/lock are changed only if an explicit dependency requires it.

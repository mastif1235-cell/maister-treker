# Security and stability implementation plan

Branch: `agent/security-stability-v66`. Baseline checkpoint: `9ae763a7a262a56d99efb4bfaaf1360b2d4c39b5`.

## Rules

- Read-only inventory is attempted once per relevant source. Unavailable production facts are recorded as `UNKNOWN`; isolated work continues.
- Production deploys, GAS/Sheets changes, real secret rotation, destructive migrations, and merge to `main` require explicit approval.
- Each stage ends with targeted tests, diff review, a logical commit, and this status update.
- No new patch/hotfix layers. One canonical owner replaces wrappers only after parity tests.

## Stages

1. **Production inventory and branch/checkpoint — complete.** Proven facts are recorded in `AUDIT.md`; inaccessible production systems are explicitly `UNKNOWN`.
2. **Deterministic runtime bootstrap — in progress.** Move the currently required runtime scripts into explicit ordered loading; remove SW HTML/script injection; keep SW limited to cache/offline/update. Preserve functionality and run first-load/controlled/offline/update tests.
3. **Canonical GAS contract in code/test environment — pending.** One `doGet`, one `doPost`, PropertiesService HMAC key, canonical request format, timestamp, nonce/replay protection, validation/limits, LockService, idempotency, deterministic test vectors. No production GAS deploy.
4. **Minimal sync state machine and unified tickets/shifts engine — pending.** First specify transitions for create/edit/delete/retry/offline/restart/lost response/tombstone. Required invariants: per-entity serialization; update follows create; delete wins/no resurrection; idempotent retry; pending survives restart; startup recovers queue; lost response cannot duplicate. Prefer adapting existing persisted ticket/tombstone state; introduce an operation log only if impossibility is demonstrated. Full sync is never incremental repair.
5. **Secrets and boundaries — pending.** Remove URL secrets. Document Telegram client-token threat model and cost/benefit before proposing any proxy.
6. **Backup/restore and app-lock consolidation — pending.** One owner and validated encrypted pipeline; remove old wrappers only after parity tests.
7. **DOM/XSS, QR and host CSP/headers — pending.** Central sink/URL policy and deterministic host security configuration.
8. **Full regression/security pass and STABLE CHECKPOINT — pending.** Decomposition of `app.js` is forbidden before this checkpoint.

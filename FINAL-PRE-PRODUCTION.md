# Final pre-production checkpoint

Scope: production gates after accepted candidate `025fa0e4a68483cc4b784aa5649ee549cd722491`. Production GitHub Pages, GAS, Sheets, secrets and `main` were not changed.

## Gate disposition

- **Gate 1 — PASS.** Isolated TEST GAS/Sheet passed 20/20 live contract checks. Readable simple `text/plain;charset=utf-8` CORS POST is canonical; forced JSON preflight fails; runtime `no-cors` was removed. Four readable mutations took 2925–4971 ms. Deliberately lost response was verified in 3376 ms. See `GATE-1-RESULTS.md`.
- **Gate 2 — BLOCKED only at installed-shell boundary.** The real v62-to-v66 same-origin browser runtime path passed without clearing data, including an open stale v62 tab, cache replacement, offline reopen, IndexedDB/localStorage and journal recovery. The available browser cannot launch the operating-system installed-PWA window/icon, so that last manual confirmation is not called PASS. See `GATE-2-RESULTS.md`.
- **Gate 3 — PASS as a read-only assessment.** Production is GitHub Pages `main@9ae763a`; live responses lack CSP/anti-framing/privacy headers. No accessible Netlify linkage exists. Long-term recommendation is Netlify/equivalent, but v66 must first upgrade on the existing GitHub Pages origin to preserve browser storage. See `GATE-3-RESULTS.md`.

## Final regression

- 75 JavaScript files: syntax PASS.
- All 15 automated/static suites PASS: pure utilities, backup/AES-GCM/PBKDF2/schema/limits, app lock/throttling/migration, owner/load order, share, DOM/QR/CSP, HMAC client/server vectors, GAS static parity, secrets, Service Worker upgrade, sync core/runtime/transport.
- Real TEST GAS result remains 20/20 PASS; TEST deployment was not mutated again.
- Runtime asset references and v66 cache manifest PASS.
- `git diff --check` PASS and worktree clean before this report.

Targeted legacy search conclusions:

- no runtime `secret=`/`?secret=`, `no-cors`, `syncShiftPostGet`, `security-sync*`, `eval` or `new Function`;
- exactly one `.gs` entrypoint owner (`Code.gs`: one `doGet`, one `doPost`); the generated browser reference matches it;
- `syncHmacSecret` is client settings/HMAC input only and is never placed in URL/body; `syncSecret` is discard-only migration data;
- `shiftsScriptUrl` is disabled compatibility/admin-recovery data, not a mutation transport owner;
- three ordered `window.fetch` adapters remain only for Telegram/photo sanitization, retry and `data:` conversion; none owns ticket/shift sync;
- remaining `innerHTML`/single `outerHTML` locations are the accepted escaped/template render boundary covered by DOM tests; dynamic-code sinks are absent;
- historical checkpoint documents mentioning canonical opaque transport are superseded by `GATE-1-RESULTS.md` and are not runtime code.

Telegram token remains only in password-type local settings and the required Telegram API `/bot<token>/...` requests. It is excluded from backup, QR, GAS and logs. This remains a client-held-secret Medium risk, not a newly found leak.

## Residual risk

- Critical: **0 known**.
- High: **0 known**.
- Medium: **2** — client-held Telegram bot token; GitHub Pages cannot emit the checked-in response-only headers.
- Low: **3** — escaped-template DOM maintenance surface; inactive compatibility fields/ordered Telegram adapter chain; sync badge may remain visually pending until the next render although the journal is already acknowledged.
- Operational blocker: one installed-PWA shell reopen test remains manual.

## Changes after `025fa0e`

1. `5501c96a84ad6c462dce690d2348da5e5436ee31` — isolated GAS transport gate, real partial-apply fix, one readable transport.
2. `bff424d4e27b9cf8c5f7f30336d0b9db05cdefaf` — crash-safe one-time legacy shift adoption discovered by the v62 upgrade test.
3. `dd84a5ff951b2c43cff0be75574b77132803d207` — production host/header evidence and recommendation.
4. Final checkpoint is the commit containing this report.

## Required manual action before production

Using desktop Chrome/Edge, serve v62 and candidate v66 successively from the **same local HTTPS/localhost origin**. Install v62 as a PWA, seed representative data, then switch that origin to v66 without clearing storage. Launch from the existing installed icon, close/reopen once, then confirm tickets, shifts, settings, backups, pending recovery and offline launch. This closes the only BLOCKED boundary without touching production.

## Safe future deployment order

The first v66 release must preserve the current GitHub Pages origin. Do not combine it with Netlify migration.

1. Record `main`, Pages build and current production GAS deployment versions; make a protected production Sheet backup/export.
2. Validate the canonical GAS once more against a duplicate of the production Sheet layout.
3. With explicit approval, set a newly generated `MT_SYNC_HMAC_SECRET` in production Script Properties; do not expose it in a URL/log.
4. With explicit approval, deploy canonical `Code.gs` as a new production GAS version attached to the intended production Sheet. Keep the prior version available.
5. Perform an approved controlled signed canary and verify the visible row plus `_SyncState` revision/tombstone/idempotency state.
6. Only after GAS readiness, merge/deploy the v66 client to the existing GitHub Pages origin. Existing devices without the HMAC value remain locally functional but cannot sync until securely configured.
7. Let the existing installed PWA update on that same origin; verify version, storage, journal recovery and offline reopen before broad use.
8. Later, under separate approval, create a Netlify preview, verify real `_headers` and caching, then migrate each device with encrypted export/restore before changing its installed PWA origin.

## Rollback

- Before any v66 user starts: revert Pages to recorded `main`, restore the previous GAS deployment, and leave the Sheet backup untouched.
- After a v66 client has migrated or synced: **do not downgrade it to v62** and do not overwrite the Sheet. The old client does not own the v3 journal/revision semantics. Stop further rollout, keep local journals/data, retain the v3 GAS if safe, and roll forward with a v66 fix. Any Sheet restore/reconciliation is a separately approved destructive operation.
- During a later Netlify migration: keep GitHub Pages live. If validation fails before new-origin writes, reopen the old installed PWA. If writes occurred on the new origin, export/reconcile them before fallback; browser storage cannot be copied between origins automatically.

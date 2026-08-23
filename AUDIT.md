# Майстер-Трекер: implementation audit

Audit baseline: GitHub `mastif1235-cell/maister-treker`, `main`, `9ae763a7a262a56d99efb4bfaaf1360b2d4c39b5`.

## Production inventory

| Component | Proven state |
|---|---|
| GitHub source | `mastif1235-cell/maister-treker`, default `main`, baseline `9ae763a` |
| Public deployment | GitHub Pages reports successful deployment of `9ae763a` at `https://mastif1235-cell.github.io/maister-treker/` |
| Netlify main PWA | No accessible linkage: no `.netlify` state, CLI/account token, config, GitHub hook or Netlify deployment. Account-wide site inventory remains `UNKNOWN` without Netlify authorization. |
| Netlify auxiliary app | `https://on-b6a966.netlify.app` is a default `vizitkaUrl`, but its live root returns Netlify 404; ownership/branch/deploy SHA remain `UNKNOWN` and it is not evidence of a usable project host. |
| GAS endpoint | `UNKNOWN`: repository default endpoint is empty and runtime URLs are device-local settings |
| Deployed GAS source/version | `UNKNOWN`: no read-only Apps Script project access available |
| Google Sheet | `UNKNOWN`: repository uses `SpreadsheetApp.getActiveSpreadsheet()` and contains no Sheet ID |
| Production secrets | `UNKNOWN`: values are device-local settings/Script Properties; they were not read or changed |

Unknown infrastructure does not block isolated development. No production deploy, GAS/Sheet mutation, secret rotation, or `main` merge is authorized.

## Confirmed critical architecture

`index.html` loads the baseline scripts and `app.js`. `sw.js` then rewrites navigation HTML and injects 24 versioned security/hotfix scripts. Those scripts replace global owners including `fetch`, `postToUrl`, `retrySyncQueue`, delete/verify, backup and lock functions. Runtime therefore depends on Service Worker control/cache state and injection order.

Baseline `Code.gs` is legacy secret auth. HMAC/replay behavior lives in separate patch `.gs` files and cannot be assumed deployed. Shifts still use GET query secrets. Settings, including client-held tokens/secrets, are persisted in localStorage.

## Severity summary

- CRITICAL: 4 — runtime split-brain; unverified HMAC/GAS contract; shift URL secret; client-held privileged secrets.
- HIGH: 6 — multiple owners/wrappers; legacy GAS auth; competing backup and lock owners; host headers not proven; fragmented sync state.
- MEDIUM: 5 — forced SW navigation; cache atomicity; distributed DOM sinks; destructive cloud flows; QR threat boundary.
- LOW: 3 — versioned patch accumulation; missing deployment manifest; oversized multi-owner `app.js`.

The detailed pre-implementation audit is retained in the session deliverable. This file records the implementation baseline and will be updated only when new evidence changes a finding.

## Stage 3 evidence

The branch now has one canonical test-candidate server, `Code.gs`; this does not describe the unknown production GAS deployment. Four append-only `.gs` patches were removed because they redefined entrypoints/auth helpers. The v3 server contract and future client signing helper pass independent deterministic vectors and negative tests. A protocol cutover remains intentionally deferred to the sync stage and requires an isolated GAS/Sheet deployment before any production proposal.

## Stage 4 design finding

The former `synced`/`syncAction`/`pendingCloudDelete` model could not preserve two immutable logical operations for one entity when an attempted create and a later edit/delete coexisted. It has been replaced by the bounded journal documented in `SYNC-STATE-MACHINE.md`. IndexedDB is the only persisted client owner; GAS `_SyncState` is the durable server owner. Legacy scalar fields are read once for migration and removed from stored ticket/trash objects. The obsolete sync wrapper files are deleted and no longer appear in `index.html` or the Service Worker asset list.

Targeted automated tests cover ticket/shift parity, serial head/tail execution, offline/startup recovery, lost responses, timeouts, duplicate retry, revisions, conflicts and permanent tombstones. Gate 1 subsequently proved against an isolated Apps Script/Sheet that readable `text/plain` CORS responses work, while forced JSON preflight fails. The candidate now has one readable mutation transport; signed `getEntityState` remains only bounded lost-response verification. See `GATE-1-RESULTS.md`.

## Stage 5 secrets/boundaries finding

GAS HMAC material is sourced only from Script Properties and the browser never places `syncHmacSecret` in URL/body. Legacy `syncSecret` is discarded. Backup sanitization now excludes HMAC, Telegram token, chat/message identifiers and lock material. Direct Telegram remains a documented client-held-secret exception: Telegram requires `/bot<token>/...`, so removing the token from request URLs requires a separately approved relay. No proxy was introduced. See `SECRETS-THREAT-MODEL.md`.

## Stable checkpoint reassessment

Stages 6–8 consolidate backup and app-lock owners, remove five obsolete backup extensions, enforce validated PBKDF2/AES-GCM exports and persistent lock throttling, and replace query-based contract QR construction with a direct same-origin fragment flow. All twelve automated/static suites and all JavaScript syntax checks pass at the checkpoint.

Current known severity is: **Critical 0, High 0, Medium 2, Low 2**. Medium findings are the deliberately client-held Telegram bot token boundary and unavailable response-header anti-framing on the proven GitHub Pages host. Low findings are remaining escaped-template DOM maintenance complexity and inactive legacy compatibility fields/code pending later domain decomposition. The app lock remains UI access control rather than encryption-at-rest.

Gate 1 passed against an isolated TEST GAS/Sheet. Gate 2 fully passed the same-origin v62-to-v66 path, including installation as a desktop PWA, stale-window continuation, close/reopen through the existing installed entry, preserved user data and offline launch after the local server stopped. Gate 3 proved production is GitHub Pages and recommends an explicitly approved later Netlify migration because Pages does not emit the checked-in CSP/anti-framing/privacy headers. Production GAS, Sheets, host deployment and `main` were not changed.

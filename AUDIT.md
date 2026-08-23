# Майстер-Трекер: implementation audit

Audit baseline: GitHub `mastif1235-cell/maister-treker`, `main`, `9ae763a7a262a56d99efb4bfaaf1360b2d4c39b5`.

## Production inventory

| Component | Proven state |
|---|---|
| GitHub source | `mastif1235-cell/maister-treker`, default `main`, baseline `9ae763a` |
| Public deployment | GitHub Pages reports successful deployment of `9ae763a` at `https://mastif1235-cell.github.io/maister-treker/` |
| Netlify main PWA | `UNKNOWN`: no `.netlify` linkage, `netlify.toml`, GitHub deployment, or accessible account metadata found |
| Netlify auxiliary app | `https://on-b6a966.netlify.app` is a default `vizitkaUrl`; repository ownership/branch/deploy SHA are `UNKNOWN` |
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

Targeted automated tests cover ticket/shift parity, serial head/tail execution, offline/startup recovery, lost responses, timeouts, duplicate retry, revisions, conflicts and permanent tombstones. Runtime CORS behavior is still `UNKNOWN` because production was not touched and no isolated Apps Script deployment endpoint is available. The client supports explicit readable and opaque modes; opaque mode uses bounded signed `getEntityState` verification.

## Stage 5 secrets/boundaries finding

GAS HMAC material is sourced only from Script Properties and the browser never places `syncHmacSecret` in URL/body. Legacy `syncSecret` is discarded. Backup sanitization now excludes HMAC, Telegram token, chat/message identifiers and lock material. Direct Telegram remains a documented client-held-secret exception: Telegram requires `/bot<token>/...`, so removing the token from request URLs requires a separately approved relay. No proxy was introduced. See `SECRETS-THREAT-MODEL.md`.

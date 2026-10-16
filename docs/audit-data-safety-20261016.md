# Local data-safety candidate — 2026-10-16

Branch: `codex/audit-data-safety-20261016`.
Base: reviewed A02 `0f755efe6db3e34bfd950d2f767ed2e2844b55e5`, on production/main `97842f230b76008ac26058a303048053f63fc27e`.
All implementation and execution stayed on the local Windows PC, with synthetic records and in-memory GAS/Sheets or disposable Chromium profiles. Nothing was published.

## Results

| Finding | Status | Change / evidence | Local verification |
|---|---|---|---|
| A01 | FIXED | Coalesced head/tail revision also updates body.revision. | Offline create/edit, restart, mock GAS round-trip; ticket and shift core parity. |
| A02 | ALREADY FIXED | Exact revision + semantic fingerprint required; inherited unchanged verification condition. | 55 delivery-proof tests, lost-ACK/replay and conflict tests. |
| A12 | FIXED | Missing engine cannot advance the diff baseline or claim synced. Failed journaling persists changed IDs locally; markers survive restart and clear only after successful journaling of that ID's diff. Local data still persists; marker persistence failure returns false. | Missing/rejected journal, restart, badge, baseline and ticket durability tests. |
| A06 | FIXED | Re-find ID after awaiting trash persistence; stop if target disappeared or its object was replaced. | Concurrent removal/reordering and photo-trash tests. |
| A10 | FIXED | Telegram restore requires explicit true from local save; failure returns false and keeps additions retryable without removing unrelated edits. | Failed save and retry; existing T1–T25 restore suite. |
| A11 | FIXED | Preview/restore respect local trash, durable tombstones and pending deletes, in addition to snapshot deletions. Active local records are not automatically deleted. | Three deletion-evidence cases and existing snapshot suite. |
| A03 | FIXED | Validate journal structure, core invariants and mutation/body identity before any restore write. Do not swallow journal storage failures or write it twice through two paths. | Corrupt journals rejected with unchanged pending state; failed journal save is surfaced; restore/rollback suites. |
| A04 | FIXED | Local main-GAS candidate supports signed ticket-only list reads without opening shifts. Restore requests the selected scope and rejects partial ticket-only data as a full restore. | Shift configuration unavailable; tickets readable; full read fails honestly; partial restore cannot clear shifts. |
| A07 | FIXED | Local main-GAS candidate escapes formula-like text and original leading apostrophes at cell writes; numeric values remain numeric. | Literal-write emulation; GAS contract/router checks. Real isolated Sheets literal round-trip remains a release prerequisite. |
| A08 | FIXED | Direct diagnostics use observed server responses bound to current endpoint/key; configuration alone is not connection/authorization evidence. Offline and failed sends report unverified. | Configured/offline/unverified/success/failure cases and direct transport tests. |
| H-1 | NOT REPRODUCED | Existing local timeout, lost-ACK and parallelism tests remain green. Actual Google LockService latency and the reported production banner were not measured. Timeout/concurrency values were not guessed or changed. | Delivery-proof, runtime, lost-ACK and concurrency tests. |
| H-2 | FIXED | Per-item BUSY/RATE_LIMITED remain retryable. Exhausted throttled operations wait 120 seconds before a new bounded attempt cycle. IDs/versions remain fixed; permanent errors stay parked and AUTO OFF stays respected. | Per-item throttling, exhaustion cooldown, permanent STALE stop, durable queue and lost-ACK tests. |
| H-3 | FIXED | Client and local main-GAS candidate cap fullDataJson at 50,000 UTF-16 code units; oversized data is not truncated or sent. Local ticket remains parked as INVALID_INPUT. | 50,001-unit rejection, local preservation, boundary signature and GAS validation. |
| H-4 | BLOCKED | Code confirms Worker read signing and GAS writes use the same signing authority. No real keys/configuration were inspected or changed. Role-separated credential migration requires its own approval. | Static comparison of mcp/src/config.js, mcp/src/gas/client.js and Code.gs authentication. |
| A05 | BLOCKED | Real GAS under fault injection writes the ticket before _SyncState; another request at the same revision can then overwrite that partial write. No speculative server transaction rewrite was applied. | scripts/diagnose-gas-partial-commit.cjs reproduces the risk entirely in memory. |
| A09 | FIXED | Portable local test runner discovers both .test.js and .test.cjs. Workflows unchanged. | CJS discovery regression and actual 91-file local run. |

12 newly fixed findings, 1 inherited fix, 1 not reproduced locally, 2 blocked.

## Verification and limitations

- Related Node selection: 91 test files. Initial run: 90 pass, 1 fail because the generated browser copy of Code.gs was stale. Regenerated it with the existing generator; gas-static.test.js then passed. Final selection: all 91 files pass. This is a file count, not a count of individual assertions.
- Existing Playwright tests: 7/7 pass, locally: boot, real IndexedDB persistence, offline restart, local ONU statistics, and three pricing scenarios.
- Syntax compilation: 11 changed runtime/server sources pass.
- A02's 55 checks remain green after all transport/core changes.
- Release proof check deliberately remains FAIL: RELEASE_IDENTITY_CHANGED under v92.23/runtime-170. No local release version, cache identity or manifest hashes were substituted to bypass the gate. Preparing a new release identity is a separate release step.
- Whitespace check passes with Windows CR-at-EOL accepted. No semantic formatting rewrite was performed.
- No dependencies installed. Existing Playwright installation was reused through command-local NODE_PATH.
- No GitHub Actions, cloud E2E, push, PR, merge, deployment, real Sheets/GAS writes, syncAll or historical correction execution.

The main `Code.gs` changes are a separate **local primary-sync GAS candidate**, not the current production GAS export and not the dispatcher GAS project. Do not paste or deploy this candidate into the dispatcher project.

## Preserved production and existing work

- No changes under gas/dispatcher-report, .github/workflows, sw.js, runtime-proof.json or scripts/release-identity.json.
- The 133 applied ONU overlays were neither executed nor recalculated. No requests were made to their live journal.
- Saved current dispatcher GAS export remains byte-identical: audit-results/2026-10-16/gas-head-new.json SHA-256 `2d9804e7099554b6b4dafc3f72d5fa3b137eea0c50cbef6249baa2128bf90c77`.
- PR #99/#100 branches and the original worktree's unfinished changes were not modified.
- Changes do not intentionally change canonical ticket fields, payments, tariff/pricing rules, ONU policies or receipts. Tests exercise preservation with synthetic data.

## Remaining safe decisions

### Unjournaled ticket recovery (A12)

The persistent ID marker is evidence of **unconfirmed delivery**, not a substitute receipt. After journal failure/restart, a marked record may need a deliberate fresh server/baseline comparison before enqueueing. No automatic bulk replay or revision guessing was added. If localStorage also fails, the existing draft/save failure warning remains necessary; the app cannot promise persistence when all stores refuse writes.

### A05 server commit protocol

Before modifying production primary GAS, design and test a durable PREPARED/COMMITTED mutation journal. Persist and verify intent (request ID, fingerprint, expected revision, desired data) before any row write. An unresolved intent must block competing mutations for that entity. Retry of the same intent must recover forward and return the original identity-bound result. Verification reads must not report APPLIED from a partial state. Keep intent storage bounded; Script Properties alone cannot hold arbitrary 50,000-character payloads. Test failures at each write boundary, response loss, restart, duplicate requests, competing devices and money preservation. Only then decide the migration and deployment plan. This protocol is not implemented here.

### H-4 credential roles

Prepare a separate read credential accepted only for GET allowlisted read actions; retain the existing write authority for authorized mutation clients. Bind role/method/action in the signed protocol, reject every write signed with the read key, migrate Worker reads privately, and only then retire legacy read acceptance. Back up configuration and keep a deployment/configuration recovery plan. Never put credential values in source, reports or chat. No rotation or protocol migration was performed.

### Before Android rollout

Independent review of these commits; decide frontend vs primary-GAS release scope; prepare a unique release runtime/cache with matching proof; test on an isolated real GAS/Sheets sandbox for literal text and ticket-only read compatibility. Then separately authorize a controlled rollout and check Android offline edits, restart, pending/conflict visibility, lost response recovery and old data preservation. Existing errors already committed by an older version are not automatically repaired.

Client fixes are ready for a separate release review. The combined package is **not ready for deployment**: release identity and the server decisions above remain outstanding. No claim of production effectiveness is made.

## Changed files (relative to A02 base)

Code/runtime:

- Code.gs
- app.js
- js/apps-script-reference.js (generated only)
- js/backup-system.js
- js/dispatcher-report-client.js
- js/restore-from-sheets.js
- js/sync-engine-core.js
- js/sync-transport.js
- js/telegram-full-snapshot.js
- js/ticket-state-storage.js
- js/tickets-domain.js
- package.json

Tools/evidence:

- scripts/run-local-tests.cjs
- scripts/diagnose-gas-partial-commit.cjs
- docs/audit-data-safety-20261016.md

Regressions:

- tests/backup-journal-invariants.test.js
- tests/dispatcher-throttle-recovery.test.js
- tests/dispatcher-verified-diagnostics.test.js
- tests/gas-literal-text.test.js
- tests/local-test-discovery.test.cjs
- tests/sync-cell-size.test.js
- tests/sync-offline-revision.test.js
- tests/sync-tickets-only-read.test.js
- tests/sync-unavailable-save.test.js
- tests/telegram-restore-deletions.test.js
- tests/telegram-restore-durability.test.js
- tests/ticket-delete-concurrency.test.js

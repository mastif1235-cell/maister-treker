# Backup restore / local release gate — 2026-10-16

Branch: `codex/audit-data-safety-20261016`. Starting HEAD: `a526b3d6bc6ded505f6189602104eca381f946e2`. Earlier A01/A02/A03/A06/A08/A10/A11/A12/H-2/H-3 changes are retained. This report supersedes the backup blocker described in `final-release-review-20261016.md`; it does not approve production publication.

Candidate: **v92.26 / runtime-173 / maister-treker-v103-runtime-173**. These identifiers avoid the unpublished PR #99 candidate v92.25/runtime-172. Existing release-identity records are retained; the new identity is appended, not substituted for an old cache's assets.

## Cause and fix

`Engine.persistTransition()` previously committed the journal to IndexedDB and then called a UI callback which could throw. Backup restore interpreted that notification exception as a failed write and rolled back tickets, but not the journal. The original pending record disappeared while the returned ticket could display a synced badge.

- Notification errors no longer invalidate a completed journal commit. Real storage failures still reject.
- Restore pauses primary sync and blocks editing/dispatcher sends while replacing local state. An active primary flush refuses restore before replacement.
- Live pending head/tail/delete mutations and unjournaled-ticket markers **block replacement before writes**, rather than being discarded or guessed into a merged journal. The owner must resolve/review those changes separately; restoring a backup is not a queue-clearing operation.
- A backup's own pending mutations can be restored onto an idle device and remain pending after reopening storage. Confirmed local tombstones are retained, and their records are not resurrected by an older backup.
- Before mutation, the existing pre-restore snapshot and a dedicated recovery checkpoint are durably written. The checkpoint includes the previous journal and affected local collections; settings secrets are excluded from its settings copy.
- Tickets and journal use different IndexedDB databases; shifts/settings use localStorage. A single native transaction cannot cover these existing stores without a storage migration. Instead, a durable fence prevents sends and false synced badges until the complete new state, or the complete rollback, passes storage read-back.
- On interrupted restore, startup automatically retries recovery from the checkpoint before loading tickets or starting sync. If recovery/read-back fails, the fence and snapshot remain, sync and ordinary saves stay blocked, and the user receives an error. No success badge is issued.
- Rollback includes the previous sync journal. Local-only fallback success is not accepted as proof of an IndexedDB replacement: actual ticket/journal read-back must agree.
- A refused restore restores any previously scheduled retry. No automatic restored-history send or bulk replay was added.
- Existing photo data is not overwritten by a conflicting backup photo under the same key. Transaction aborts in backup writes/deletes now resolve as explicit failures rather than hanging.

## Seven previous failures: exact disposition

| Existing test file | Cause | Resolution |
| --- | --- | --- |
| init-degradation.test.js | Outdated A12 expectation: an unavailable journal was expected to advance the synced baseline; static regex also assumed migration was the first statement. | Require the old baseline to remain and the durable unsent marker to exist; retain guarded initialization checks. |
| repair-ticket-id-regression.test.js | Invokes the preceding initialization test; inherited its failure. | Its existing checks pass after correcting that expectation. |
| ticket-db-read-error.test.js | Outdated A12 expectation: newly saved but unjournaled data was expected inside the committed baseline. | Assert preserved recovered records and a durable unsent marker for the new record. |
| network-tools-monitor.test.js | Test-environment timing: Windows scheduling inflated scripted RTT (observed average 47 ms vs expected 38–46). | Use the monitor's existing injected measurement clock for scripted samples; keep real cancellation/concurrency tests and all statistical assertions. Production ping code unchanged. |
| sw-android-runtime.test.js | New bytes under the old proof/cache identity. | New consistent candidate identity and regenerated proof. This is a Node test, not physical Android certification. |
| sw-named-cache-guard.test.js | Same stale proof. | Existing byte/hash and named-cache isolation checks retained. |
| sw-release-identity.test.js | Same stale proof/identity. | New identity appended; the rejection of changed assets under an old identity remains tested. |

The post-commit rollback defect was a separate newly reproduced critical gap, not one of those seven existing-suite failures. It now has dedicated regressions.

## Local evidence

- Full existing Node suite: 268 files (the original 266 plus `backup-recovery-journal.test.js` and `sync-legacy-protocol-compatibility.test.js`). Final result recorded below.
- New Node backup suite: 11 scenarios, including pre-write refusal, partial write, journal refusal before/after commit, notification error, pending head/tail/delete across reopening, imported pending work, tombstone preservation and conflicting photo preservation.
- A02: 55/55 checks pass. The combined related safety selection passes 36/36 files.
- Full MCP suite: **716/716 PASS**, using the already installed aws4fetch dependency via a process-local resolver. No new dependency installation.
- Browser selection includes 11 new backup scenarios plus boot, IndexedDB persistence, offline restart, atomic Service Worker install/update, runtime proof, three pricing cases and local ONU statistics: 22 scenarios. Final result recorded below.
- Syntax: 11 changed runtime sources PASS. Runtime proof build/check PASS. Whitespace checks PASS with Windows CR-at-EOL recognized.
- Mobile environment: local headless Chromium at a 412×915 viewport. Real browser IndexedDB is used, not a storage mock. Android SDK adb exists, but its device list is empty; no physical Android result is claimed.

## Server compatibility and preserved work

Read-only remote refs remain: main `97842f230b76008ac26058a303048053f63fc27e`, PR #99 `114cfdcbbf64d86b0075c1ca6f869b2588e9cc95`, PR #100 `2246b59eefbe580f6eaa639bf8c864efaf4493b6`. They were not modified.

The new client passes synthetic add/edit/list/delete against the known main primary-GAS snapshot. This does **not** prove what the active private primary deployment runs. The saved dispatcher GAS export is a different project and cannot establish that fact. A04's independent ticket-only read still requires the prepared primary-GAS server change; the old server fails explicitly when its shifts configuration is unavailable. A07 remains a local server candidate. Neither was deployed or declared active.

No changes to the actual dispatcher GAS, primary GAS, Google Sheets, real money, phone storage, receipts, outbox data or the 133 applied ONU corrections. The original worktree's two dirty ONU files and PR preservation branch remain untouched. Saved dispatcher export SHA-256 remains `2d9804e7099554b6b4dafc3f72d5fa3b137eea0c50cbef6249baa2128bf90c77`.

## Publication gate

**Local candidate only; NOT READY FOR AUTOMATIC PRODUCTION PUBLICATION.**

Remaining mandatory gates: a real Android update/offline/restart check, current primary-GAS implementation/compatibility confirmation and explicit frontend/server release separation, and an authorized publication route. Existing main push/PR workflows automatically trigger prohibited GitHub Actions; no workaround or disabling was attempted. A05 partial primary-server commits and H-4 shared signing authority remain previously documented server risks, not fixed by backup restore. H-1 production latency remains unmeasured.

No push, merge, GitHub Actions, deployment, secret changes, real-table writes or historical correction reruns. No further user action is needed merely to preserve this local candidate.

Final frozen-candidate results: **268/268 Node test files PASS; 716/716 MCP tests PASS; 22/22 selected Playwright scenarios PASS; syntax 11/11 PASS; runtime proof PASS**. No runtime source was changed after these final runs. The extra two top-level test files explain the increase from 266 to 268. The complete Playwright repository suite was not rerun; the 22-case selection covers this package's relevant storage, update, backup, pricing and ONU behavior.

# Conditional publication review — STOP / NOT READY

Reviewed implementation: `3a9df0c8c296d80a1318ff3ec5910d625362740d`, branch `codex/audit-data-safety-20261016`; initially clean. No implementation was changed during this review. This report supersedes the earlier claim that the client package is ready for release review without further safety work.

## Confirmed release blocker: backup rollback loses the pending journal

`Engine.persistTransition()` saves the new journal and assigns `this.state` before invoking `onChange`. If that callback throws during `mtBackupRestore`, its catch rolls back tickets/settings/shifts/tools, but never the journal. A synthetic pending ticket is restored while its journal record has disappeared and its badge reports synced. The previous queue is not restored automatically, although a pre-restore snapshot may remain available for manual recovery.

Reproduction: `scripts/diagnose-backup-postcommit-rollback.cjs` executes the real backup and engine code against an in-memory GAS harness. Expected safe result: the original pending journal survives. Observed: 1 record before, 0 after, ticket restored, synced=true. Diagnostic deliberately exits 1.

Minimum correction to design and test before release: separate durable-commit success from notification failure; make backup replacement/rollback explicitly preserve the previous journal and prevent concurrent flush during replacement. Do not silently swallow real storage errors. Test failures before and after the durable journal write and during rollback. No implementation fix was attempted after the stop condition was established.

## Fresh local verification

- Full existing Node runner: **266 files, 259 PASS, 7 FAIL**. This replaces the earlier limited 91-file result, not an assertion that all tests pass.
- Failures include initialization/degraded-mode expectations affected by A12, the dependent repair-ticket-ID regression, ticket database baseline expectations, and stale runtime/cache proof. Static expectations must be reviewed rather than blindly weakened.
- Related MCP selection: **66/66 PASS**, including sync contract, physical consumption, report parity and security. Reused the existing aws4fetch 1.0.20 installation through a command-local resolver; nothing installed. Initial attempts failed on dependency resolution; final corrected local run passed.
- Fresh Playwright selection: **6/7 PASS**: boot, IndexedDB persistence, offline restart, two atomic Service Worker installation cases, and cache upgrade with retained ticket. Runtime-proof case **FAIL**, because modified app/client bytes retain the old runtime proof. Disposable local profiles only.
- Explicit release-identity check: **FAIL / RELEASE_IDENTITY_CHANGED** for `maister-treker-v100-runtime-170`.
- Post-commit backup diagnostic: **FAIL**, the data-safety blocker above. Not counted as an existing-suite test.
- No adb executable found on PATH; no physical Android test performed. Mobile-viewport Chromium is not Android.

## Scope and compatibility

Client candidates: A01/A02, A06, A08, A10/A11/A12, H-2, client H-3 and backup validation. They remain candidates, not a release endorsement; the rollback defect blocks this package.

Primary-sync GAS changes: A04 scoped ticket-only list, A07 literal-cell writes and server H-3 validation. The A04 client requests `list` with ID `tickets`; the old local server ignores this scope and still reads shifts. Its intended independence from shift configuration therefore requires the updated primary GAS. Literal-text round-trip was only emulated, not verified against an isolated real Sheet. The saved dispatcher GAS export is a DIFFERENT project and cannot establish the current primary-sync server implementation. Active primary server code/compatibility is not confirmed from a fresh authorized export; no protocol change was published.

A12 persists affected IDs in localStorage and tickets through the existing persistence path, not merely RAM. It does not persist a full recoverable mutation/baseline for automatic replay after restart. An ID marker is an honest unresolved-delivery warning, not proof of delivery or automatic recovery.

A05 partial server commit and H-4 shared signing authority remain unresolved; H-1 production latency remains unmeasured. No secrets/protocol migration attempted.

## Remote state and publication restrictions

Fresh read-only GitHub checks:

- main: `97842f230b76008ac26058a303048053f63fc27e`.
- PR #99: open Draft, HEAD `114cfdcbbf64d86b0075c1ca6f869b2588e9cc95`.
- PR #100: open Draft, HEAD `2246b59eefbe580f6eaa639bf8c864efaf4493b6`, base PR #99's branch, not main. Its remote HEAD differs from the older local preservation commit; it was not overwritten or integrated. Full integration compatibility remains unapproved.
- Live public runtime proof: `maister-treker-v100-runtime-170`; published identity remains v92.23/runtime-170. No new version prepared.
- Actual main Tests workflow runs on pushes to main and PRs targeting main. The existing publication route would trigger prohibited Actions. No bypass, workflow disabling, push, merge or deployment performed.

## Preservation

No changes to dispatcher GAS/ONU policy, historical overlays, receipts, money, real tickets, Sheets or phone storage. All 133 APPLY remain outside this review's execution scope; their live state was not reread or modified.

Saved dispatcher export SHA-256 expected: `2d9804e7099554b6b4dafc3f72d5fa3b137eea0c50cbef6249baa2128bf90c77`. No replacement of that export. PR #99/#100 and previous dirty worktrees were left untouched.

Runtime/cache were deliberately NOT bumped: mandatory safety and compatibility gates failed. No releasable build or tested rollback package is claimed. The local implementation and this reproducible evidence are retained for the next narrowly scoped repair. No user action on Android or Google is requested at this blocked stage.

# Remaining ONU history — finite owner job

Status: locally tested; NOT installed, deployed or applied to live Google by this agent.
The user's real read-only verification proves September 20+8 / 46115 and October 7+5 / 20186.
Prepared CSV plan: 102 remaining connections, February–August. Source: primary Заявки ONLY.
CSV totals are provisional, never a claim about live cells. 59 UNKNOWN_TYPE and one
UNKNOWN_ONU_CONSUMPTION remain untouched. Existing original 31 targets are excluded.
The approved customer ONU 1783937356209 stays zero. Test/closed-period missing IDs
are excluded; no row creation, deletion or restoration is implemented.

## Package and one owner start

1. Keep a local export of the current GAS HEAD and note the current existing deployment version.
2. Replace ONLY Код.gs with the generated DispatcherReport.bundle.gs. Keep the existing
   ONU_Correction_Helper.gs, ONU_Preview_Helper.gs, Без назви.gs and all their contents.
3. In the EXISTING appsscript.json oauthScopes array add ONE scope:
   https://www.googleapis.com/auth/script.scriptapp
   Keep every other scope, timezone, webapp access and execution setting unchanged.
   This allows one owner-created continuation timer. Do NOT replace the manifest with
   the generic builder template. Authorization is granted only through Google's UI.
4. Update the EXISTING deployment to a new version, preserving deployment ID/URL,
   access and execute-as-owner settings. The new target registry must be deployed
   BEFORE the first correction so normal subsequent renders understand the overlays.
5. Select ONU_History_Start and run it ONCE as owner; accept Google's scope consent.
   No key, token or password is copied. It checks fresh primary rows and report rows
   before mutation, saves snapshots and installs its own one-minute continuation timer.
   Leave phone ticket editing/sending idle while this finite job runs: any raw-row or
   receipt change between portions stops the job rather than silently rebasing it.
6. The helper processes at most eight entries / 90 seconds before one report render.
   Continuations execute as owner, even without an open editor. It removes only its
   own timer on completion or explicit failure. It never touches other triggers.
7. Execution logs: ONU_HISTORY_RESULT. DONE means all prepared entries are applied,
   not that unresolved source tickets have been guessed. Then run
   ONU_History_VerifyReadOnly once: applied=102, pending=false, actual cells verified,
   actual monthly totals and unresolved list. Report those live results, not CSV totals.

No per-ticket clicking; no syncAll/retryAll/setup/rebuild or frontend release.
If permissions or fresh source hashes differ, it stops BEFORE correction writes.
Do not remove the primary-source or report-evidence checks to force the CSV plan.

## Durable progress, snapshot and scope

Source digest covers the exact primary ID/date/time/content/sum/tags/canonical JSON
that produced each decision. Fresh live digest must match. Missing/deleted/duplicate
report rows stop. The existing physical-evidence guard must match as well.
Each correction overlays ONLY work_type, work_category, onu_used. The raw row,
source version/hash, onu_replacement, amounts, payments, materials, receipts and
queues remain untouched. All raw rows + receipts are hashed before/after each write.
Original non-target journal entries and complete September/October statistics are
guarded. Each request is durably saved before append; replay uses the same request.
Snapshots are owner-only Script Properties (capacity checked BEFORE mutation) plus
the existing append-only _DispatcherOnuCorrections before/after journal.

The owner executor uses the existing correction validator, CAS, journal, read-back
and rollback. A per-execution owner capability defers render; normal signed requests
cannot provide it and keep their existing behavior. No public API/batch auth bypass.

## Failure and rollback

On an explicit error the helper stops its timer and retains progress/snapshots. A
hard GAS timeout retains the exact pending request; the next timer invocation retries
under the same guards. An interrupted render can be completed by ONU_History_Resume
after inspecting the error. No automatic continuation after an explicit conflict.

ONU_History_Rollback starts a finite reverse job for ONLY this job's active overlays.
It uses existing journal tombstones, never restores old full DTOs or overwrites later
money. It renders once per portion and checks real cells. It does not remove the
original 11 or September 20. If the source changed, rollback does not require the
old primary JSON, but missing/deleted report rows still stop safely.

Never switch to an older GAS deployment that lacks these target IDs while any new
history overlays remain active. First finish and verify rollback, then restore the
prior deployment version without changing its URL. Keep snapshots and source package.

## Local verification

- tests/dispatcher-history-onu-plan.test.cjs: 12 policy/exclusion fixtures.
- tests/dispatcher-history-onu-owner.test.cjs: 12 batch, auth, timeout, readback,
  timer, read-only failure, rollback and unchanged-finance scenarios; real mocked cells.
- tests/dispatcher-onu-correction-gas.test.js: existing 11 correction scenarios.
- tests/dispatcher-september-onu-owner.test.cjs: existing 11 September scenarios.
- tests/dispatcher-report-gas.test.js: existing 42 security/CRUD checks.
- tests/dispatcher-onu-stats-presentation.test.js: two rows day/week/month, no duplicates.

No live application occurred during preparation. No credentials or raw CSV in Git/ZIP.

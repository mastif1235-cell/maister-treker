# Historical ONU correction — v92.20 / runtime-167

Candidate only. Production remains v92.14/runtime-159. No production write,
merge, deployment, rebuild, sync, queue action or manual Actions invocation is
part of this task. The full real-data dry-run is still required; fixture totals
and the preliminary 185 value are not release evidence.

## Final policy and implementation

All 13 previously UNKNOWN_TYPE IDs are user-approved REPAIR. Physical OUR_ONU
is one for 1774458317612 (February), 1774458317619 (March), and 1783937356212
(June). The other ten have explicit NO_ONU decisions. These decisions override
legacy unchecked equipment and do not apply a connection default to repairs.
The earlier two NO_ONU corrections, five confirmed legacy ONU, one manual OUR,
and two held UNKNOWN decisions remain supported. Held UNKNOWN rows/cards/hashes
are unchanged; only the confirmed repair statistic excludes them.

Resolved historical connections use explicit customer ownership first, then
our selected equipment, then default OUR_ONU=1. The user-confirmed customer ID
1783937356209 is explicitly pinned to zero. "Роутер свой" does not match ONU
ownership. Checked:false and empty/missing equipment are not customer evidence.

`reconcileHistoricalTickets` handles same-ID current precedence first, then
the 11 approved physical aliases (including archive 1782744999128 -> current
1783937356212). Other different-ID matches require equal normalized date/time
and full content, plus compatible resolved type and all shared address,
contract and monetary evidence. Similar text alone never merges jobs. Missing
preferred canonical records block correction rather than inventing an ID.

Day/week/month stats have exactly two ONU lines. Other aggregated materials and
ticket-card material/price details remain visible. Physical ONU is not the sum
of onu_used + onu_replacement + material ONU. Those are overlapping evidence.

## One offline data-transfer procedure

Sources authorized by the user:

- Main workbook: https://docs.google.com/spreadsheets/d/1fc_yXm7XihQn7medg8H25a9cxBn_HIqMhXx-rZyVD5M
- Report workbook: https://docs.google.com/spreadsheets/d/1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA

In Google Sheets, select each tab and use File -> Download -> CSV. Save locally
inside the ignored `audit-input` folder in this checkout:

1. `Заявки` -> `current.csv`
2. `Заявки старые` -> `archive.csv`
3. `_DispatcherData` -> `report.csv`

Do not edit the CSVs or upload the raw files; canonical JSON can contain private
data. From the repository directory run this one offline command:

```powershell
rtk node scripts/historical-onu-audit.cjs --current audit-input/current.csv --archive audit-input/archive.csv --report audit-input/report.csv --output historical-onu-dry-run.json
```

Share only `historical-onu-dry-run.json`. The reader performs no HTTP requests,
does not use browser storage, and only creates a new local report. Existing
output files are never overwritten. The raw CSVs remain a local pre-change
snapshot. The safe output contains their SHA-256 fingerprints, monthly counts,
IDs, safe ownership phrases, report version/hash preconditions, proposed changed
field names, and safe monetary/counter BEFORE -> AFTER values. It omits names,
phones, addresses, notes, passwords, HMAC keys and full canonical/DTO dumps.
All active report rows are schema/hash validated before simulation. Incomplete
canonical source data blocks a proposed missing-row insert.

The planning result can be locally consistent (`ready:true`) but always has
`ready_for_production:false` until the full data diff is reviewed by the user.
No fixture input is used by the CLI in place of supplied files.

## Read-only correction plan

`dryRunHistoricalCorrection` works only on cloned rows. It issues no POST and
does not enqueue anything. It prepares normal projector DTO hashes and fresh
versions/request IDs, simulates normal core upserts, and lists changes by ID.
Financial diffs, hash failures, tombstones, unresolved types, unconfirmed repair
consumption, missing preferred source records and incomplete missing-row sources
block execution readiness. IDs 1786990035908 and 1786951228806 are always excluded
from insertion/restoration. The two held UNKNOWN rows are left unchanged.

If an already-active duplicate exists in the report, the planner separately
proposes a soft delete only after its preferred row exists in the simulation.
This is not deletion of a table or rewriting its financial columns. The proposal
requires explicit approval in the reviewed per-ID diff before any future write.

## Rollout gates — future, require separate user approval

1. Obtain all three current CSV snapshots. Review complete February–October
   monthly totals, customer list, duplicate/alias list and exact per-ID diff.
   Do not target 185. October must be derived from actual tickets, with the
   supplied 6+4=10 case used only as a consistency check.
2. Review the exact candidate commit and automatic PR CI. No manual workflow
   dispatch/rerun is part of the plan. Any failed required check blocks release.
3. After separate approval, publish the matching bundled Dispatcher GAS as a
   new immutable version on the same deployment URL and ownership/access model.
   Preserve properties, HMAC secret, origins and spreadsheet privacy. First run
   signed read-only status and authentication rejection smoke; compare identity
   sets/counts. Then merge the approved exact HEAD and verify Pages/runtime-167,
   cache v97, runtime-proof 8/8 and absence of mixed runtime. No history write
   or automatic test ticket occurs during frontend/GAS rollout.
4. Request a separate approval for the concrete historical plan, including any
   addressed duplicate soft-delete proposals. There is no historical write
   full-history executor in this candidate; the approved execution must use the existing
   authenticated dispatcher protocol with strict ACK handling, never syncAll,
   mass retry or raw Sheet edits. The earlier, separately confirmed two-ID
   `correctHistoricalOnu` UI action remains in the branch; it is not an executor
   for this full-history plan and must not be invoked during review/rollout.

## Controlled historical execution contract — future

- Re-read every target's exact ID/version/hash/deleted/SYNCED precondition.
  Recheck both active/deleted absence immediately before each approved insert.
  Drift aborts the plan; do not force or bypass STALE_VERSION.
- Apply approved normal projected DTOs one ID at a time, with the plan's fresh
  version/hash and a new bound request_id. Preserve canonical sums and every
  existing monetary field. Create/update preferred rows before any approved
  duplicate soft deletion. Leave excluded and held IDs untouched.
- Await exact per-item ACK, then read back ID/version/hash/counters/money and
  verify a single stored row. On ambiguous ACK, resolve the same request proof;
  do not issue a second mutation under a different request ID blindly.
- After each operation verify non-target row identities/hashes against the
  snapshot, allowing only separately identified legitimate concurrent activity.
  Abort subsequent operations on any mismatch. Existing ACK/receipts are never
  rewritten. Re-running a completed plan must be UNCHANGED, not new rows.
- Verify monthly day/week/month output, all money invariants, duplicate=0,
  exclusions, UNKNOWN preservation, and the reviewed actual physical total.
  Rendering is secondary under existing durable-ACK semantics; do not use a
  whole-history rebuild/sync as a substitute for addressed correction.

Rollback uses the private snapshot and the same authenticated endpoint: restore
approved prior fields under strictly newer versions and newly computed hashes,
or soft-delete only approved newly inserted rows. Restore an approved duplicate
tombstone only if rollback approval explicitly includes it. Never reset version
numbers, overwrite old receipts, delete the table or replay historical queues.
Re-read and verify each rollback ACK/data result and monthly snapshot totals.

## Current status

The 13 decisions and both display/counting defects are implemented in candidate
code. Local synthetic tests are evidence of implementation behavior only. Full
real-data dry-run is unavailable until the above CSV transfer is completed.
Production release and controlled historical recalculation remain NOT READY.

### Final local review blocker

The full local E2E run found a real compatibility failure at
`e2e/dispatcher-works-connection-onu.spec.js:18`: unchecking ONU in a newly
created connection still projects `onu_used=1`, expected 0. Existing canonical
tickets have no reliable modern-selection marker, so the historical default
currently also reaches new unchecked selections. Do not weaken this test or
infer a schema boundary from a date. A deliberate modern-selection contract
is required before release. No production or historical writes are permitted.

Full E2E: 83/86 initially passed; two failures were obsolete runtime/cache test
pins and were updated to this release. The ONU-checkbox assertion was left
unchanged. Full unit: 250/251, with the lone monitor timing failure independently
reproduced on unchanged main. MCP 716/716; dispatcher 33/33; runtime proof 8/8.

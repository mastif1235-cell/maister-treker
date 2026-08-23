# v66 pre-production canonical migration rehearsal

Date: 2026-08-23  
Branch: `agent/security-stability-v66`  
Production status: unchanged; no production Sheet, GAS, Script Property, endpoint, GitHub branch or Pages deployment was modified.

## Isolated resources

- Canonical target copy: `PREPROD-v66-migration-2026-08-23 — tickets canonical target`, spreadsheet ID `1SWLWyN6hsE5GF9pwDKjJ54uT5Ft8Pk_3qqigQRkUD18`.
- Legacy shifts reference copy: `PREPROD-v66-migration-2026-08-23 — legacy shifts source`, spreadsheet ID `1dHlxrxSxLRXwffHdVZbMxq8pkONVknAVx81-a_7B7Bg`.
- Isolated bound GAS project: `PREPROD v66 canonical migration test`, script ID `1qGtU_jWp1CNeaHNFxXj8_wAwC0jchPRgS39lOK4i0kl2ewOQSiqvHymq`.
- Isolated web app: deployment version 3. Its test-only HMAC Script Property was rotated after terminal echo; no secret value is stored in this report or source control.

## Legacy shifts schema

The legacy `Зміни` sheet is a report-shaped document, not a flat database table. Its used rows contain:

1. month headings: `📅 МІСЯЦЬ: YYYY-MM`;
2. repeated headings: `Дата | День | Години | Напарник`;
3. raw shift rows: `date | weekday | hours | coworker | id`;
4. monthly totals: `📊 РАЗОМ ЗА МІСЯЦЬ:` plus calculated hours/count;
5. blank separator rows.

Inventory of the copied source:

- 142 raw shifts;
- 7 month headings, 7 repeated column headings, 7 monthly totals and 6 blank separators;
- no unknown rows;
- no duplicate shift IDs;
- 1,191.5 total hours.

The seven displayed monthly totals exactly match recomputation from raw shifts:

| Month | Shifts | Hours |
| --- | ---: | ---: |
| 2026-02 | 21 | 175.0 |
| 2026-03 | 19 | 157.5 |
| 2026-04 | 20 | 164.0 |
| 2026-05 | 22 | 176.5 |
| 2026-06 | 22 | 194.0 |
| 2026-07 | 22 | 188.5 |
| 2026-08 | 16 | 136.0 |

## Canonical schema and mapping

The canonical `Зміни` tab is a flat table with one header and one row per business record:

`id | date | hours | coworker`

| Legacy source | Canonical target | Treatment |
| --- | --- | --- |
| column E `id` | column A `id` | copied exactly |
| column A `date` | column B `date` | copied as `DD.MM.YYYY` |
| column C `hours` | column C `hours` | normalized to a number |
| column D `coworker` | column D `coworker` | copied exactly |
| column B `weekday` | none | derived presentation data |
| month headings | none | presentation only |
| repeated headings | none | presentation only |
| monthly totals | none | derived report data |
| blank separators | none | presentation only |

Canonical rows are ordered by date for compatibility with the current server writer. Monthly views and totals remain derivable; they are not duplicated as business records.

## Migration parity

Initial migration and post-canary cleanup both produced the same result:

- source raw records: 142;
- canonical records: 142;
- source unique IDs: 142;
- canonical unique IDs: 142;
- source hours: 1,191.5;
- canonical hours: 1,191.5;
- exact `id/date/hours/coworker` differences: 0;
- duplicate canonical IDs: 0;
- lost records: 0;
- presentation rows migrated as business data: 0.

## Live canonical GAS results

The deployed isolated `Code.gs` has one `doGet` and one `doPost`. Tests used the v66 client-side HMAC contract and transport from localhost against only the isolated deployment.

Signed lifecycle matrix: 16/16 PASS.

- ticket: create, exact duplicate retry, update, stale revision, same revision/same fingerprint, same revision/different fingerprint, delete, delayed update after tombstone;
- shift: the same eight cases;
- readable `text/plain` CORS succeeded from localhost;
- request-id idempotency prevented duplicate application;
- revisions and fingerprints produced the expected `APPLIED`, `STALE`, `IDEMPOTENT_SUCCESS` and `CONFLICT` outcomes;
- tombstones rejected delayed resurrection;
- the normal v66 UI also completed ticket create/update/delete and shift create/delete through its durable journal;
- all canary business rows were deleted after the test;
- four expected canary tombstones remain only in the isolated hidden `_SyncState` tab.

The independent Stage-3/Gate-1 suites remain the source of coverage for malformed signatures, wrong key, expired timestamp, reused nonce, modified body, oversized payload, lost response and timeout vectors. Full sync remains deliberately closed with `ADMIN_RECOVERY_REQUIRED` and was not used for repair.

## One-time settings migration

`settings-core.js` owns the durable `syncV66Migration` marker.

- The old ticket endpoint and old shifts endpoint are retained in the marker as sanitized rollback evidence.
- URL query secrets are removed; the obsolete secret value is never retained.
- `shiftsScriptUrl` remains data-compatibility evidence but is not a runtime transport owner.
- Runtime uses only `scriptUrl` plus `syncHmacSecret`.
- Migration becomes `complete` only when `scriptUrl` is a query-free HTTPS Apps Script URL and the HMAC is at least 32 characters.
- A completed marker remains completed after restart, so the cutover is detectable and not repeated automatically.

## Fate of legacy production systems

- The separate production shifts Sheet remains untouched as a rollback/reference archive during the soak period.
- The old shifts GAS deployment remains untouched and callable during the soak period, but v66 does not use it after cutover.
- The current production tickets Sheet remains the intended canonical workbook; it receives a new `Зміни` tab only during an explicitly approved production migration.
- The old ticket GAS deployment remains pinned and untouched as a rollback reference.
- Neither old endpoint is destroyed, overwritten or automatically disabled. Later decommissioning is a separate destructive decision.

## Exact production migration plan

Every phase has a stop condition. Do not continue after a mismatch.

### 0. Reconfirm inventory and freeze writes

1. Record the exact endpoint currently saved in the installed production PWA for tickets and shifts.
2. Resolve the known ticket-endpoint inventory discrepancy between the user-supplied URL and the earlier deployment listing.
3. Record both production spreadsheet IDs, bound GAS script IDs, active deployment IDs and pinned versions; never print secret values.
4. Choose a short maintenance window and stop creating/editing tickets or shifts until the data copy and canary finish.

Stop if any ID or active endpoint differs from the approved inventory.

### 1. Create recoverable backups

1. Create timestamped Drive copies of both production spreadsheets.
2. Export or copy the current source of both GAS projects and record their deployed versions.
3. Record Script Property names and presence only; do not export secret values into documentation.
4. Verify that both spreadsheet copies open and that their row counts match their originals.

Stop if either copy or count verification fails.

### 2. Migrate production shifts into the canonical workbook

1. Re-read the live legacy shifts sheet after the write freeze; do not assume it still contains 142 records.
2. Run the tested parser and fail on unknown rows, missing IDs, duplicate IDs, invalid dates/hours or monthly-total mismatch.
3. Create the canonical `Зміни` tab in the production ticket workbook only after validation succeeds.
4. Write the raw canonical rows once.
5. Compare source/target record count, unique IDs, dates, hours, coworkers, total hours and monthly recomputation.

Stop and restore the backed-up ticket workbook if parity is not exact. Do not delete or edit the legacy shifts Sheet.

### 3. Prepare the canonical production GAS

1. Back up the current ticket-bound GAS source.
2. Save canonical `Code.gs` in the ticket-bound project and run static/vector checks again.
3. Generate a new production HMAC secret and save it only as `MT_SYNC_HMAC_SECRET` in Script Properties.
4. Create a new pinned Apps Script version and a new web-app deployment URL. Do not replace the old deployment.
5. Confirm execution identity/access settings and record the new deployment ID.

Stop if the deployment cannot be distinguished from both legacy deployments.

### 4. Server canary before client cutover

1. Run signed ticket and shift fixtures with unmistakable canary IDs.
2. Verify create, update, duplicate retry, `getEntityState`, revisions and deletion/tombstones directly in the canonical workbook.
3. Confirm readable `text/plain` CORS from the actual production origin.
4. Delete canary business rows and confirm only their `_SyncState` tombstones remain.
5. Re-run migration parity for all pre-existing shifts.

Stop if any canary or parity check fails. The installed client still uses the legacy endpoints at this point.

### 5. Cut over one installed client

1. Enter the new canonical endpoint and new HMAC into v66 settings.
2. Verify that `syncV66Migration.status` becomes `complete` and both sanitized legacy endpoints are retained.
3. Create/edit/delete one ticket and create/delete one shift.
4. Confirm journal pending count returns to zero and the canonical rows/tombstones match.
5. Restart the installed PWA and repeat a read plus one small mutation.

Stop if the journal remains pending or any operation reaches a legacy endpoint.

### 6. Release v66 web assets

1. Reconfirm the production-candidate commit and clean worktree.
2. Merge/push only after separate explicit approval.
3. Wait for GitHub Pages build completion and verify the deployed commit.
4. Repeat the already-passed installed-PWA upgrade check without clearing user data.
5. Observe sync and Sheets for a defined soak period; keep both legacy GAS deployments and the legacy shifts Sheet unchanged.

## Rollback and roll-forward

- Before client cutover: abandon the new deployment/tab or restore the ticket workbook from its copy; legacy clients and both legacy endpoints remain unchanged.
- After client cutover but before new writes: restore the saved client settings and, if necessary, the previous web commit. The old secret is intentionally not preserved by v66 and must be re-entered manually.
- After new canonical writes: do not blindly restore an old Sheet copy, because that would lose post-cutover records. Freeze sync and reconcile by entity ID/revision; prefer a server roll-forward while the IndexedDB journal retains pending operations.
- If the canonical endpoint is temporarily unsafe, clear/disable its client configuration rather than sending pending operations elsewhere. Local business data and the durable journal remain the recovery source.
- Destruction of the old Sheet, old GAS projects, old deployments or old endpoint settings is never part of rollback and requires separate approval after the soak period.

## Remaining risks / gates

- The actual currently configured production ticket endpoint must be resolved before cutover; two different URLs were observed during inventory.
- Production CORS must be repeated from the actual production origin, even though localhost PREPROD passed.
- The HMAC is client-held and therefore protects request integrity/replay, not a compromised browser/device or successful XSS.
- The legacy monthly Sheet layout is not carried into the canonical raw tab. If a Sheet-native report is operationally required, add a separate derived report tab later; never mix it with canonical records.
- Downgrading an already-upgraded Service Worker is not the primary rollback strategy and has not been qualified. Prefer endpoint pause plus roll-forward.
- Production migration, production secret creation, GAS deployment, `main` merge and Pages deployment all still require fresh explicit authorization.

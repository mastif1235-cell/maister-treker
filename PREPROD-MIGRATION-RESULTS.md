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

### Production phase 0-1 checkpoint — PASS (2026-08-23 17:24 EEST)

No production Sheet cells, GAS source, Script Properties, deployments, PWA settings,
GitHub Pages assets or `main` were changed during this checkpoint.

Installed production PWA endpoints were confirmed by the user and match the active
deployment inventory:

- tickets: `https://script.google.com/macros/s/AKfycbzlWV_bNluAcrZwG6Xv8IFpcY0OofAUxKPJwrlBd5WJ4LewNAWkUwY8ANyZuD94XE3mkQ/exec`;
- shifts: `https://script.google.com/macros/s/AKfycbxpwMgHe2YB8apDSIY4zv14sAiaIYQO8AvyZo4RjWyF-wf0oVqmDh90VBxbI4qNMlyY/exec`.

The earlier user-supplied ticket and shifts URLs are therefore legacy/non-runtime
inventory, not the endpoints currently owned by the installed PWA.

Recorded production inventory:

- tickets Sheet `1fc_yXm7XihQn7medg8H25a9cxBn_HIqMhXx-rZyVD5M`;
- tickets bound GAS `1w5yrdY1uKQyJJ9Eg5jWRLKU4cs0DV_D0FSWQ6S3AIMASIFAc0eIt0FfS`;
- tickets active deployment `AKfycbzlWV_bNluAcrZwG6Xv8IFpcY0OofAUxKPJwrlBd5WJ4LewNAWkUwY8ANyZuD94XE3mkQ`, pinned version 55;
- shifts Sheet `1ItNSvv91klhfhfR44PBa6Xx41gDCb0dABEV2IZ37m_I`;
- shifts bound GAS `174sBA1lGvaiUBpGEY1-H_j3bPsxNLlI-Gnufrdm80BHrCY4xgQCpCCEc`;
- shifts runtime deployment `AKfycbxpwMgHe2YB8apDSIY4zv14sAiaIYQO8AvyZo4RjWyF-wf0oVqmDh90VBxbI4qNMlyY`, pinned version 6;
- shifts also has an unexpected second active deployment
  `AKfycbxoNFIkKWJ28IUIATnu2_gaFoJvcF7BA0oQk3XP-OJ_9SEewEn8arVSsMD0hEw1mCr5`,
  description `111`, pinned version 1. It is not the endpoint saved in the installed PWA.

Timestamped Drive backups were created in the same Drive location as the sources.
Copying the container-bound spreadsheets preserves their bound GAS source; the
immutable deployed versions above provide the deployed-source reference:

- tickets backup `1oiiL6-dNKlazb62UOk7HcVPvwub1IxAiRsi4GUWQZ2k` —
  `https://docs.google.com/spreadsheets/d/1oiiL6-dNKlazb62UOk7HcVPvwub1IxAiRsi4GUWQZ2k/edit`;
- shifts backup `1SdUOKx8l8Zb_RWT5YcNDlXm_32d4iwxotx5RtSgDme4` —
  `https://docs.google.com/spreadsheets/d/1SdUOKx8l8Zb_RWT5YcNDlXm_32d4iwxotx5RtSgDme4/edit`.

Both copies opened successfully. Parity checks:

- tickets `Заявки`: 339 non-empty rows in production and backup;
- tickets `Заявки старые`: 246 non-empty rows in production and backup;
- shifts `Зміни`: 163 non-empty rows in production and backup, with the last
  non-empty row at 169 in both; sheet/grid metadata also matches.

The selected production write-freeze is a 20-minute activation-based window. It
begins only after explicit phase-2 authorization and an operator confirmation that
the window has started. No ticket or shift create/edit/delete is allowed until the
phase-2 parity check and canary stop condition complete. The window was selected
but was not started by this checkpoint.

### 2. Migrate production shifts into the canonical workbook

1. Re-read the live legacy shifts sheet after the write freeze; do not assume it still contains 142 records.
2. Run the tested parser and fail on unknown rows, missing IDs, duplicate IDs, invalid dates/hours or monthly-total mismatch.
3. Create the canonical `Зміни` tab in the production ticket workbook only after validation succeeds.
4. Write the raw canonical rows once.
5. Compare source/target record count, unique IDs, dates, hours, coworkers, total hours and monthly recomputation.

Stop and restore the backed-up ticket workbook if parity is not exact. Do not delete or edit the legacy shifts Sheet.

### Production phase 2 checkpoint — PASS (2026-08-23 17:44 EEST)

The activation-based write-freeze was active for the migration and closed after
the final parity read. No ticket or shift writes were intentionally made through
the PWA during the window.

The live legacy `Зміни` source was re-read from spreadsheet
`1ItNSvv91klhfhfR44PBa6Xx41gDCb0dABEV2IZ37m_I`. The tested parser accepted all
rows with these results:

- 142 raw shift records and 142 unique IDs;
- zero unknown rows, missing IDs, duplicate IDs, invalid dates, invalid hours or
  date/month-header mismatches;
- seven monthly stored totals matched recomputation;
- total hours: 1,191.5.

Immediately before the atomic write, the source was unchanged and the production
ticket workbook had no sheet named `Зміни`. One `addSheet + updateCells` batch then
created only the canonical target and its raw records:

- workbook `база данных`, spreadsheet ID
  `1fc_yXm7XihQn7medg8H25a9cxBn_HIqMhXx-rZyVD5M`;
- canonical sheet `Зміни`, sheet ID `660823002`;
- schema `id | date | hours | coworker`;
- one header row plus 142 business rows.

Post-write parity was exact:

- source/target records: 142/142;
- source/target unique IDs: 142/142;
- source/target hours: 1,191.5/1,191.5;
- missing IDs, extra IDs and duplicate target IDs: 0;
- exact `id/date/hours/coworker` differences: 0;
- monthly count/hour parity: exact for 2026-02 through 2026-08;
- the legacy shifts Sheet was re-read after the write and remained unchanged.

No GAS source, deployment, Script Property, endpoint, PWA setting, `main`, GitHub
Pages asset or legacy shifts Sheet was changed. Canary and phase 3 were not run.

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

- The endpoint discrepancy is resolved: the installed PWA uses the version-55 tickets deployment recorded in the phase 0-1 checkpoint. The earlier supplied URL is legacy inventory.
- The shifts GAS project has two active deployments. The installed PWA uses version 6; the unexplained version-1 deployment must remain untouched in the current authorization scope and be explicitly accounted for before later decommissioning.
- Production CORS must be repeated from the actual production origin, even though localhost PREPROD passed.
- The HMAC is client-held and therefore protects request integrity/replay, not a compromised browser/device or successful XSS.
- The legacy monthly Sheet layout is not carried into the canonical raw tab. If a Sheet-native report is operationally required, add a separate derived report tab later; never mix it with canonical records.
- Downgrading an already-upgraded Service Worker is not the primary rollback strategy and has not been qualified. Prefer endpoint pause plus roll-forward.
- Production migration, production secret creation, GAS deployment, `main` merge and Pages deployment all still require fresh explicit authorization.

# Separate dispatcher report-layer — verified local release candidate

Branch: `codex/dispatcher-report-layer`.
Baseline: `bcde8c4698c8eaf54c819ffae55795eab2a943ca`.
Production is not published or changed by this work.

Current local candidate: **v91.88 · 2026-10-06 / runtime-133**.
Live synthetic CRUD, queue recovery, idempotency, rendering and statistics PASS.
The earlier blocked checkpoints below are historical, not current blockers.
No commit, push, merge or production frontend/Worker rollout has been performed.

## Ownership and isolation

Only the new Apps Script project `Проект без назви`, ID
`1JORochxK2MLdLIQIdJnNgmLGL9ieTZO_t6brmTpanYq69XYQEIEuvvMy`,
and the separate report spreadsheet, ID
`1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA`, are deployment targets.
Legacy root `Code.gs`, all existing GAS actions, old sync transports/contracts,
ticket ID and ticket/fullDataJson schema, backup/import/export, AI, Worker,
QueryState and maps are unchanged.
The server refuses a workbook containing `Заявки` or `Зміни`.

The new settings fields are `dispatcherReportEndpoint` and
`dispatcherReportEnabled` (default false). The old script/shift URLs and secrets
are never read by this transport. `mtDispatcherReportOutboxV1` contains ONLY
operation ID, type, version, retry counters/timestamps and safe error codes;
no DTO, ticket/note/MAC/credential payload is persisted in the report queue.
It is an independent device-local outbox, not a ticket/storage migration.
Bulk import and backup restore remain untouched; explicit full sync reconciles
the current live local tickets. Missing remote IDs are NOT inferred as deleted.
The ordinary trash-restore path queues its already durably restored new ID.

## Data and view

`_DispatcherData` is hidden. Its exact schema is the 27 fields in
`MTDispatcherReportCore.FIELDS`, followed by `deleted_at` and `sync_status`.
One row per stable ticket ID, source hash/version, locks, bounded rate and
whole-batch validation. Deletes retain tombstones to reject delayed resurrection.
Same hash + active record is a no-op. Request IDs bind to a request digest.
`report_sync_all` means batched upsert of current local tickets, not replacement
of the entire spreadsheet. Explicit deletes may accompany those batches.
Action names: `report_upsert`, `report_sync_all`, `report_delete`,
`report_rebuild`, `report_status`.

`Отчет` owns only A:E; A is an 8px gutter, B is 380px wrapped content,
and C/D/E are 250px daily/weekly/monthly panels.
Newest ISO work day/time first, stable ID tie-break, daily display number starts
at 1 and never changes ticket ID. Pastel day/daily/week/month blocks.
Daily, ISO Monday–Sunday weekly and calendar-month statistics share ONE pure
aggregator. A cross-month week is computed once over the full available week,
independently of each calendar month; each summary appears after its oldest
represented day. Only active records participate. Working days are unique days
with active tickets, not seven assumed working days.
Rebuild regenerates only the visible report, preserving source rows/tombstones.
Setup is idempotent; it preserves existing data and can rename a sole EMPTY
default tab rather than delete it. It never clears a populated default tab.

## Privacy and counters

Strict client + server whitelist. Geo, signal/dBm/map links, private notes,
credentials, private URLs/photos, phone fields, unknown DTO fields and formula
injection are not accepted. Public work text is sanitized without mutating its
original note/comment. MAC is explicitly authorized as `mac_onu` only.
Counters reuse the unchanged existing pure physical-consumption engine locally,
after projection to its public inputs; no AI/provider/Worker request is made.
Structured > explicit > business-derived, replacement provenance and dedup are
unchanged. No new ONU heuristic or repair count inference is introduced.
Cash/card use saved canonical ticket amounts. Free amount is the saved amount,
not a guessed equipment valuation. A missing historic MAC or malformed historic
date/payment is a visible rejected item, never an invented repair of source data.

## Transport / consent

Deployment must be Google-authenticated, `USER_ACCESSING`, access `MYSELF`.
Server checks active owner identity and a fixed report workbook ID. No shared
HMAC/API key/client secret is introduced. Google Sheets/email scopes require
the user's own Google consent. Private session credentials are managed by Google.
Arbitrary HTTP POST is disabled to avoid a session-cookie-only CSRF write path.
The PWA uses an authenticated HtmlService bridge / `google.script.run`, with
an exact allowed parent origin and a random transient channel pinned to a Google
frame/window. This is not an anonymous writable JSON endpoint.
Browser consent/cookie restrictions fail closed with a safe connection status.
No ticket is lost when report authorization or delivery fails. Retries are
bounded to three attempts and persist across reload; privacy/schema failures
do not auto-retry. Manual retry/full-sync are explicit controls.

The final flow uses a first-party Google popup, not an embedded Google iframe.
The temporary report frame-src additions were removed; application CSP is
unchanged from the baseline. The scoped native opener accepts only the saved
HTTPS script.google.com Web App endpoint, no credentials/non-default port,
the application's current origin and exactly one 32-hex nonce. All other
window.open calls retain global noopener/noreferrer. BOOT is pinned to the
actual popup's child, HTTPS Google origin and nonce; READY/RESPONSE require
the established peer source, exact origin, channel and pending request ID.

## Build and validation

`scripts/build-dispatcher-report.cjs` bundles the shared pure core, separate GAS
backend and HTML bridge into one editor-ready `.gs` file in an external artifact
directory. It never rewrites legacy `Code.gs` or the project configuration.
Artifact directory: sibling `dispatcher-report-build`.
Backup baseline: sibling `dispatcher-report-baseline-bcde8c4` (tracked relevant
runtime files only, no secret stores copied).

Checkpoint tests:
- Dispatcher contract/privacy/projection/outbox: 42/42 PASS (including sandbox pin).
- GAS mocked security/CRUD/idempotency: 19/19 PASS.
- MCP full: 716/716 PASS; includes legacy/semantic parity and security.
- Full root: 215/216; only unchanged Ping timing test, 48 ms vs 38–46 ms.
- Full E2E initial run: 58/59; new settings test could not see the parked
  settings card. After routing it through the existing Sync settings category,
  targeted dispatcher E2E: 3/3 PASS (real browser settings/reload, DTO privacy and
  unchanged source data, offline module boot). No timeout/assertion was weakened.
- Final complete E2E rerun: 59/59 PASS (6.5 minutes), including all three new
  report scenarios and existing AI, map, persistence, directory and SW tests.
- Frontend/report JavaScript syntax: 133 files PASS; GAS bundle parses.
- MCP `scripts/check.sh` PASS using the existing Git Bash.
- CSP parity and diff-check PASS.

## Historical external checkpoints — superseded by final verification below

Browser control was restored on 2026-10-06. The validated standalone bundle is
now saved in the separate project's `Код.gs`; copying the full editor back
confirmed an exact normalized match (25,609 characters). Bundle SHA-256:
`3d7441947d7ddef407a6355da6b0686a3d27635b3eea064ad9af8478c3b73f79`.
The prepared manifest is saved with Sheets/email scopes, USER_ACCESSING/MYSELF;
Google normalizes the timezone alias Europe/Kiev to Europe/Kyiv.
The user completed Google consent. `reportSetup` successfully ran on 2026-10-06
17:49:58–17:50:01 (Kyiv), with no error in the visible execution log.
Initial sync has NOT run. After the user attached the spreadsheet, browser UI
readback confirmed the separate spreadsheet title, private sharing, visible
`Отчет` (gid=0), hidden `_DispatcherData` in the all-sheets menu, and B1 text
`Нарядів поки немає`. No source records were sent or edited during that read.
Detailed hidden schema and populated rendering readback remain pending.
Deployment management revealed an existing version 1 from 2026-10-05 21:27,
executing as USER_DEPLOYING with access ANYONE_ANONYMOUS. This old deployment
must not be treated as the validated report endpoint. The user deployed version
2 on 2026-10-06 17:52 with USER_ACCESSING, but actual access readback was
ANYONE (all Google-account users), not MYSELF. The current edit is staged to
narrow access to MYSELF while retaining version 2 and USER_ACCESSING. The user
submitted that update; deployment readback now confirms version 2,
USER_ACCESSING and MYSELF. The agent has NOT submitted deployment.
Observed existing deployment ID:
`AKfycbwwQGwcOR0IzPAfDZu4p6JeJ08hjpoPzbYTtEeUpVgBiMQl09atKNodVKJFdWC4avbImA`.
No commit/push/merge or Worker/frontend production deploy has occurred.

Resume with the saved project; do not restart the audit or replace its code.
Continue verification of the closed deployment and the
target sheet before setup, actual Google identity, sandbox origin and transport.
Then perform controlled synthetic CRUD/privacy/idempotency/rebuild checks,
100/500/1000 server-render capacity and mobile visual readback before live data.
Remove synthetic entries by soft-delete only; do not delete source tickets.
Full real sync uses only the approved whitelist and report target.

Local live-client checkpoint: existing E2E static-server helper is running on
`http://127.0.0.1:50076` (exec session 84724). Browser tab 274251213 now shows the
empty local application; the extra test tab was closed to avoid the normal
single-writer conflict. Reload removed the writer warning. The user attached
the local-app tab to this chat and explicitly authorized the temporary local
origin. Live Script Properties readback confirms REPORT_ALLOWED_ORIGINS equals
`https://mastif1235-cell.github.io,http://127.0.0.1:50076`.
Remove the local origin after live testing; this cleanup is still pending.
The endpoint was successfully filled into the separate local settings textbox,
but automated Save and Check Connection commands failed before browser command
dispatch (both click and keyboard alternatives). The user subsequently clicked
Save; live UI readback confirms the exact endpoint and successful independent
settings-save message. Check Connection still fails before browser dispatch;
do not claim RPC/initial sync succeeded. Automatic sending remains disabled.
Do NOT publish frontend to work around this browser-control blocker.

Live Check Connection was subsequently clicked by the user and returned
GOOGLE_AUTHORIZATION_REQUIRED. This code is the client's 20-second handshake
timeout, not proof of missing Google permissions. Opening the bare endpoint
shows the expected instruction to connect from application settings. Opening
the observed origin/channel URL returns the report HtmlService/sandbox page,
without an authorization prompt; nested sandbox inspection remains blocked.
An independent actual-HTML/client VM regression reproduced an RPC envelope
mismatch: Bridge.html sends `result`, while the client formerly read `response`.
The unpublished client now reads `result`; the bridge test and 42 report plus
19 GAS tests pass. The server bundle is unchanged. This fixes lost RPC results
but does NOT establish the root cause of the live handshake timeout.
The final 59/59 full E2E result above predates this one-field client fix.
Post-fix targeted dispatcher E2E rerun: 3/3 PASS. User reload + Check Connection
still produced GOOGLE_AUTHORIZATION_REQUIRED. Direct visible navigation to the
current origin/channel URL visually shows the bridge's initial protected-
connection text, not a consent/login page. Captured parent console warnings/
errors are empty; this does not rule out a frame/network/cookie restriction.
No confirmed cause for the embedded handshake timeout yet. Do not request
repeated authorization or make the endpoint anonymous as a workaround.

A frontend cache/version bump is REQUIRED before future frontend publication;
current production version/runtime was deliberately not changed in this
unpublished checkpoint. Worker deploy is NOT required.

## Rollback

### Live continuation 2026-10-06

The separate report Web App was updated to version 3 (20:03 Kyiv), retaining
the same deployment ID, USER_ACCESSING and MYSELF. The source bundle SHA256 is
`5cb2434ccda379d956221977cb58fab63e668632e7a5ca5d04bb71902325e215`.
The embedded Google authorization frame visibly showed a blocked-content error.
The popup implementation then exposed the existing global window.open hardening:
it forcibly adds noopener/noreferrer, so the popup opens but the client receives
no WindowProxy. A narrowly validated dispatcher opener now captures the native
opener inside security-hardening.js, with no generic native-open API. Only the
saved Google /macros/s/.../exec endpoint, current origin and a 32-hex channel are
accepted; ordinary windows retain the original protection. Actual HTML/client
handshake regression plus actual hardening-wrapper checks PASS.

Live report_status after this fix passed twice: active_count=0, deleted_count=0.
A single local synthetic repair ticket was saved: TEST REPORT, Тестова 1,
2026-10-06, cash 300. Its public note contains synthetic geo/signal markers and
its private note contains PRIVATE_TEST_DO_NOT_FORWARD. The legacy sync URL in
this local profile is empty. No legacy sync action was executed.

Historical blocker (now resolved): the report outbox shows pending=1, failed=0, INVALID_ENDPOINT after
save, despite the same endpoint passing report_status. The visible report sheet
still says no orders after reload. Do not claim an upsert succeeded or proceed
with update/delete/stats checks. The broad enqueue catch may mask a non-endpoint
exception; exact underlying cause is not yet established. The test ticket and
pending metadata must be retained for diagnosis; no real tickets were touched.
Automatic report sending was disabled and saved in the local UI after capturing
the blocker. The queue still contains the one synthetic operation. Evidence of
the safe paused state: report-outbox-paused.png.
The local diagnostic cache is currently runtime-132-report-diagnostic-3, NOT an
approved production release. Cleanup/version alignment remains pending.
Evidence: report-deployment-v3.png, report-status-connected.png and
report-outbox-new-blocker.png in the sibling dispatcher-report-build directory.

Disable only `dispatcherReportEnabled`; keep the old sync settings untouched.
This stops new automatic report work without deleting tickets or report rows.
Return the frontend release as a coordinated cache-bumped rollback if eventually
published. The separate GAS/report spreadsheet may remain inert; no destructive
cleanup, legacy table recovery or Worker rollback is needed.

## Final live verification — 2026-10-06

Exact INVALID_ENDPOINT cause: native browser setTimeout/clearTimeout were passed
as unbound outbox dependencies, then called with the dependency object as their
receiver. Chromium threw TypeError: Illegal invocation. The broad enqueue catch
misclassified it as an invalid URL AFTER persisting the operation. An actual
Chromium regression failed before the fix (false return, pending=1) and passed
after explicit Window-receiver wrappers. Queue failures now use REPORT_QUEUE_ERROR
unless endpoint validation really fails; malformed URLs are normalized to the
safe INVALID_ENDPOINT code. No source note/DTO is written to the retry queue.

Verified through authenticated private version-3 Web App and ordinary local UI:

- report_status and nonce-pinned popup handshake PASS.
- Existing pending synthetic operation recovered; pending=0/errors=0.
- Actual upsert appeared in hidden _DispatcherData and visible Отчет.
- Same local ticket update via normal form: 300 -> 450, same ID/row; no duplicate.
- Same ticket delete via normal trash flow: tombstone retained, removed from
  visible report and all statistics. No real ticket was used or deleted.
- UI report_rebuild returned the successful rebuilt status.
- Four additional prefix-bound synthetic DTOs were batched via report_sync_all.
  Identical request/request_id replay returned the same ACK and exactly four rows.
- October 7 precedes October 6. October 7 has numbers 1/2/3; October 6 resets to 1.
- Before update, daily 600 + 700 = weekly/monthly 1300 (5 records, 2 working days).
  After update, 600 + 850 = 1450. After first delete, 600 + 400 = 1000.
- Explicit numeric counters consistently total ONU=2/replacements=1/router=2.
  The unchanged physical-consumption projection is covered by contract tests;
  the live batch's counters were not inferred from its text.
- Synthetic geoLat/geoLng, coordinate values, optical before/after and private
  note canaries were absent from BOTH hidden DTO cells and visible report.
  Working public text, address, type and amounts survived. Original local private
  note/public sensitive fragments were observed still present in the edit form.

Read-only XLSX exports were inspected without changing/unhiding workbook tabs.
Screenshot evidence in sibling dispatcher-report-build: report-live-multiday.png
and report-live-cleanup.png. Temporary editor-only test helper was NEVER deployed,
then removed; clipboard readback equals the exact original version-3 bundle.

Cleanup PASS: all five synthetic rows are soft-deleted, active_count=0, visible
report says no orders. Tombstones deliberately retained, no destructive purge.
Local automatic sending OFF, queue=0/errors=0. Temporary localhost was removed
from REPORT_ALLOWED_ORIGINS; final value is https://mastif1235-cell.github.io.
USER_ACCESSING/MYSELF and owner/workbook IDs remain unchanged. Legacy sync URL
in the isolated local profile was empty; no legacy network action was executed.
No diff in root Code.gs, legacy sync, backup/import/export, AI/Worker or maps.

Final validation:
- Contract/projection/privacy/outbox: 44 PASS.
- Separate GAS mocked security/CRUD: 19 PASS.
- Actual Bridge HTML/client/hardening handshake/RPC, forged origin/source/nonce
  rejection, invalid opener rejection and background popup prohibition: PASS.
- MCP full: 716/716 PASS.
- Root: 216/217 PASS; only unchanged network-tools-monitor Ping timing 48 ms
  vs 38–46 ms. No threshold/assertion change.
- Syntax: 374 JS/MJS files + exact GAS bundle PASS; check.sh/diff-check PASS.
- Final full E2E: 60/60 PASS, 386.236 seconds, including native Chromium timer
  regression, settings/reload, public DTO/source retention and offline report boot.

## B:E visual layout verification

The presentation renderer now owns only A:E of Отчет: A is an empty 8px
gutter, B is 380px day headers/ticket cards, C/D/E are readable 250px
daily/ISO-week/month panels. Newest dates remain first; numbering restarts
inside each day. Pastel yellow/blue/green/lavender distinguish the four roles.
Outer thick navy borders, solid thin ticket separators, Arial 11pt, top alignment,
wrapping and bounded row heights keep the mobile ticket column readable;
statistics are horizontally scrollable rather than reduced to tiny text.

One empty top row precedes centered 16pt lavender month bands merged across B:E. Statistics
have separate bold 12pt headers with stronger blue/green/lavender fills, followed
by top-aligned bodies. C covers the entire corresponding day, D its entire ISO
week, E all the month's days below the title. A cross-month week is visually split
at the full-width B:E month cut: its summary occurs ONCE, with a labelled
continuation in the older month. No merged range crosses the month cut and no
statistics are duplicated. Day/panel frames and header rules use SOLID_THICK.
Cards use emoji and three light dashed section separators; the router symbol is
the broadly supported 📶, because 🛜 was missing in the live Google font.
Equipment counts remain the validated DTO numbers, not inferred materials text.
Rebuild unmerges the old owned footprint before clearing A:E,
including empty bottom cells of old merges. A merge crossing into F+ fails
closed before any clearing. Source rows, DTO, counters and actions are unchanged.

Final polish live checks: seven tickets/five days/three weeks/two months with
cash/cashless/free payments; create/idempotent replay/rebuild PASS; update
retained seven IDs and changed total 1900 -> 1950. All additive fields reconciled
exactly daily -> weekly -> monthly. ONU=2, replacements=1, routers=2; cashless=700,
free amount=900, free count=2. Native bold headers and blank top row verified;
month cuts at rows 2 and 11; merges B2:C2, C4:C6, B11:C11, D4:D8, E3:E10,
E12:E15. All seven new prefix IDs were subsequently SOFT-deleted, active=0,
deleted=19, rejected=0, pending_retry=0. No source row physically removed.
Screenshots report-polish-month-boundary.png and report-polish-week-continuation.png
show the populated native Google view, with a full-width month cut.

Private Web App version 5 was published on the SAME existing deployment URL,
with USER_ACCESSING/MYSELF unchanged. Exact saved bundle SHA256:
032306e043adf95462974a72bf1858541d7c5457ec9e9b19a2c1f9a303f68ba3.
After updating: real local popup handshake PASS, UI report_status PASS (active=0,
deleted=19), UI report_rebuild PASS. Automatic sending stayed OFF; pending=0,
errors=0. No new scopes, endpoint or production app deployment were introduced.
Final cleanup restored REPORT_ALLOWED_ORIGINS to exactly the production origin;
the connection-test helper was removed, saved editor code matched the exact
published bundle, and the temporary test popup was closed.

Current local verification: 47 contract/projection/outbox PASS; 22 GAS
security/CRUD/layout PASS; Bridge/hardening PASS; root 216/217 (only unchanged
Ping 47–48ms timing flake); MCP 716/716 PASS; E2E 60/60 PASS, final report E2E 4/4 PASS; 374-file syntax and
GAS bundle PASS; check.sh and diff-check PASS. No frontend/Worker production publication.

## Release and rollback plan

1. Review/commit the isolated candidate; run GitHub Tests/MCP/E2E on that exact
   SHA before any frontend publication. Explicitly record the unchanged local
   Ping timing flake, not a green result. No Worker release is needed.
2. Separate report GAS is already private version 5. Keep MYSELF/USER_ACCESSING,
   the fixed report workbook and only the production origin; never connect old
   Заявки/Зміни workbook or copy legacy credentials into this flow.
3. Publish only the approved frontend tree with v91.88/runtime-133 together,
   then verify PWA update/reload. Report sending defaults OFF; configure the
   private Web App URL and authorize its Google popup before explicit full sync.
4. Full sync only upserts approved projections; does not infer absent IDs as
   remote deletions. Verify a small real batch before enabling automatic sending.
5. First rollback step: turn off only dispatcherReportEnabled and save, closing
   its connection. Retain pending metadata and report rows/tombstones; never
   clear local tickets, old sync settings, old tables or backups. Allow any
   already-started report-only request to settle before evaluating counts.
6. If frontend rollback is required, publish the baseline tree with a NEWER
   cache revision and consistent version expectations (do not reuse runtime-132
   or downgrade to runtime-133). Verify installed PWA activation/reload. The
   private report GAS and report workbook may remain inert; no Worker rollback,
   legacy restoration or destructive report cleanup is needed.
7. For a presentation-only GAS rollback, select PRIVATE version 5 on the same
   deployment, retaining MYSELF/USER_ACCESSING and production-only origin, then
   rebuild the report. Never select archived anonymous version 1. No source-row
   cleanup or legacy restoration is necessary.

## Reference-image final verification — 2026-10-07

The photo-guided formatter is presentation-only. Month title bands are now
merged B:E, centered, lavender, bold 16pt, and framed in thick navy. C/D/E
headers align with the first day beneath each title. Whole month sections have
full-width outer frames. Ticket first lines combine number/time/type; solid
native thin lines separate tickets, while three dashed text rules separate
sections inside each card. No numeric cable/metre aggregate is invented from
materials text: that numeric field is absent from the existing DTO.

Live seven-record reference dataset: three tickets in one day, five days,
three weeks, two months, ONU/replacement/router and all payment types.
Create/replay/rebuild/privacy/native centered title checks PASS. Update changed
1900 -> 1950 and retained seven IDs; all additive daily/weekly/monthly fields
agree. Prefix-only soft delete removed seven synthetic active records, leaving
active=0, tombstones=26, rejected=0, pending_retry=0, last_error empty.
The real Google Sheet PDF export was visually reviewed after screenshot capture
became unavailable; PDF export omits emoji glyphs, so it is not an emoji check.
Temporary test helpers were removed before publishing.

Private Web App version 6 published 2026-10-07 08:52 Kyiv on the SAME URL,
USER_ACCESSING/MYSELF unchanged. Bundle SHA256:
767a80cef0104eef773e20c5d7521907f5322c7b209dd4aa13c9961d987af403.
Rollback target before frontend release: main
bcde8c4698c8eaf54c819ffae55795eab2a943ca, v91.87/runtime-132;
separate private report GAS version 5. No Worker deploy is required.

Final local validation: 47 contract/projection/outbox PASS; 22 GAS PASS;
actual HTML bridge/security PASS; MCP 716/716 PASS; full E2E 60/60 PASS;
targeted report E2E 4/4 PASS; 374-file syntax + GAS bundle PASS; check.sh and
diff-check PASS. Root 216/217: only the unchanged Ping timing test returned
48ms instead of 38–46ms; no threshold/assertion change. GitHub CI on the exact
release SHA is mandatory before merge.

## v91.90 / runtime-135 candidate — release gate

The physical-PWA failure reported after v91.89 is NOT considered resolved by
a desktop handshake. The actual v91.89 code marked the channel ready at
`MT_REPORT_READY`, before a successful `report_status` response; this is the
proven false-readiness defect, not proof of the phone's underlying suspension
or WindowProxy behavior.

This candidate gates queue release and the connected label on a status RPC,
revalidates on foreground/focus/pageshow/online, coalesces concurrent probes,
and keeps transient RPC receipts in the Google bridge until a pinned client
ACK. HELLO can replay a receipt missed during suspension. Receipt buffers are
bounded and memory-only; persisted outbox remains ID/version metadata only.
Reload destroys window references: a fresh explicit private connection is
required, with no automatic background popup or frontend credential.

Compact cards have no delivery badges. Other is a note-only presentation;
normal materials use individual non-zero rows. Stored ticket/content,
financial calculations, legacy GAS, Telegram, Worker and physical engines
are unchanged. Report numeric aggregate counters keep the existing required
27-field contract (including zero aggregates); zero material *positions* are
omitted from materials_display, which is newline-separated.

Do NOT merge unless exact-head Tests/MCP/E2E and real report CRUD/reconnect,
privacy and legacy regression gates PASS. Remove any temporary loopback
origin before merge. Physical Android transport remains unproven until a
real-device check; desktop success alone must not be labelled Android PASS.
Rollback frontend to dda0cad9845dd32ba1c075d336e7f8f9d1bc9689 (v91.89/runtime-134)
and the prior report deployment version as a coordinated pair if necessary;
retain outbox/receipts/tombstones, never clear application storage.

## PWA connection and delivery-status correction — v91.89

The previous bridge displayed "connected" before the opener acknowledged
READY, and the client used `popup.closed` as an authentication/liveness gate.
Android app/browser handoff can invalidate that proxy hint without invalidating
the nonce/source/origin-pinned peer. The bridge now requires an opener ACK before
displaying success, repeats only handshake metadata until ACK, and resumes the
same pinned channel on focus/pageshow/visible. It never resets on pagehide.
No origin, identity, private deployment access, or global popup protection is
relaxed. A real Android device has not been inspected by the automated tests.

Manual sync is independent of the automatic-send checkbox and authenticates
before enqueueing all tickets. Connection failures pause the channel without
consuming each operation's bounded retry budget. The old 430-error display was
430 queued ticket operations exhausted by one shared connection failure, not
430 independent Google failures. V1 queue recovery preserves operation IDs and
versions, resets connection-only failures, and keeps pending deletes.

Per-ticket dispatcher ACK receipts contain only ID/version in the existing
`mtDispatcherReportOutboxV1` metadata store. No DTO/private text or ticket schema
field is added. New edits invalidate receipts; stale ACKs cannot confirm newer
queued edits. Endpoint changes invalidate endpoint-specific receipts. Full and
compact cards show independent canonical legacy delivery and dispatcher states.
The legacy retry change is UI settlement only (catch/finally/banner refresh).

Release identity: v91.89 · 2026-10-07 / runtime-134. Before merge, require green
Tests/MCP Tests/E2E on the exact release HEAD. Publish the saved separate GAS
bridge as a new private version on the existing URL (USER_ACCESSING/MYSELF),
then frontend-only Pages release; no Worker deploy. Run live status, synthetic
CRUD/rebuild/retry checks before claiming production PASS. Rollback together to
frontend v91.88/runtime-133 at f0f44da135896a12e04e733f5802300c29bc5221 and
private report GAS version 6; preserve outbox pending metadata. Never reset
legacy storage, clear real tickets, or widen the report endpoint's access.

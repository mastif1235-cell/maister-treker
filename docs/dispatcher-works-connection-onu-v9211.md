# Selected works and connection ONU — v92.11 / runtime-156

Code-only candidate; no merge, deployment, migration, historical sync or queue action.
Base: merged PR94 `799b3a160d806adc1a49e762391207d789ead9ba`.

## Root causes

Selected catalog works are saved in `ticket.presetWorks`; save omits unchecked
rows and the `checked` property of selected rows. Dispatcher projection passed
them to physical analysis but never displayed them. Optional `works_display`
now carries sanitized, deduplicated selected labels. An absent checked flag is
selected in saved data; explicit false is omitted. The optional column is
appended after contacts and undefined values do not change prior hashes.
The block precedes service/tariff/payment/total; dispatcher comment remains last.
Other/Інше cards retain note-only semantics.

The form catalog started entirely unchecked. Equipment costs were always added
and calendar counts grouped all ONU together. New connections now select the
existing ONU checkbox by default. Stable catalog id `onu`, or an exact legacy
ONU/ONT/ОНУ label without id, identifies the unit (not notes or prices).
For structured connections an explicit selected ONU means exactly one unit;
empty/unchecked equipment means zero, regardless of free-text inference.

## Money and inventory

Connection ONU contributes zero to calculator, mixed-payment items, material
presentation and structured material price. The catalog's stored price is not
mutated, so repair pricing remains available. Dispatcher total remains saved
`ticket.sum`; no recalculation of historical totals. Raw-import historical rows
without structured equipment keep the existing interpretation and stored hashes.

Dispatcher `onu_used` keeps its existing total-counter meaning for compatibility.
Statistics derive `onu_connection` by work category, `onu_regular` by subtraction,
and `onu_total` as their sum. Monthly local reports show the same three labels.
No extra counters are guessed from display text. Connection duplicate ONU rows
project to one; existing ID/version/hash upsert rules remain unchanged. Editing
replaces the same row, so checked/off/on yields 1/0/1 rather than accumulation.

## Boundaries

No changes to transport, ACK/reconciliation, HMAC/auth/bridge, legacy sync,
Telegram transport, IndexedDB schema, backup, Worker, AI, maps or production data.
Matching frontend and GAS will eventually be required for the appended optional
works field; this branch does not deploy either side.

## Regression

`dispatcher-works-connection-onu.test.js`: selected works 0/1/many/dedup,
privacy/hash binding, connection default/off/+0, repair prices and replacement,
7 repairs + 13 connections = 20, edit 1/0/1, replay without duplicates and source
immutability. Existing schema-prefix tests verify append-only old-row hash safety.
`dispatcher-works-connection-onu.spec.js`: actual isolated browser checkbox,
unchanged total, works display, fresh repair/connection type switches.

## Exact functional owners

- `js/finance-utils.js`: `isTicketOnuEquipment`, `ticketEquipmentPrice`,
  `calculateTicketTotal`, `buildMixedPaymentItemsFromTicket`,
  `buildWorkSummaryLines`, `buildTicketContent`.
- `js/ticket-editor-core.js`: `blankCalcState`.
- `js/ticket-editor-domain.js`: `resetCalcForm`, `applyDefaultTypeTag`.
- `js/calculator-render.js`: `renderEquipmentList`, `updateEquipmentSummary`.
- `js/calendar-stats-render.js`: `buildMonthlyEquipmentLines`.
- `js/dispatcher-report-projection.mjs`: `projectTicket`.
- `js/dispatcher-report-core.js`: optional fields/validation,
  `isOnuEquipment`, `stats`, `statsBody`, `card`.
- `gas/dispatcher-report/DispatcherReport.gs`: `REPORT_HEADERS` only.

All other application changes are release identity literals/proof, accompanied
by matching test expectations and the regressions listed above.

## Local verification

Dispatcher: 26/26 files PASS. MCP: 716/716 PASS. Full E2E: 85/85 PASS,
plus final targeted checkbox/type-switch regression PASS. Unit: 243/244 files;
only unchanged `network-tools-monitor.test.js` timing assertion fails, also
reproduced against unchanged main. Its thresholds were not modified.
Runtime-proof: 8/8 PASS. Syntax, MCP check.sh and diff-check: PASS.
No GitHub CI run or physical Android production test is claimed.

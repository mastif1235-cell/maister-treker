# Dispatcher presentation restoration — v92.01 / runtime-146

Candidate only. Do not merge, deploy GAS, publish Pages, retry queues or rebuild
the live report as part of this change. Production remains v92.00/runtime-145,
dispatcher GAS v13.

## Root causes and minimal presentation fixes

- The GAS renderer wrote ticket cards to B and merged daily/weekly/monthly
  statistics into C/D/E. It stretched every day to at least 370 pixels so a
  side panel could fit. A short Інше record therefore looked like empty space.
- Core now emits one shared vertical sequence: month heading, day heading,
  tickets, daily statistics, then weekly/monthly statistics at their existing
  period boundaries. Dates remain newest-first; daily numbers remain assigned
  by chronological time, independently of display order.
- GAS writes this sequence to B, wraps it, bolds the first line, uses modest
  background colors and solid thin bottom borders. Row heights follow content.
  Old owned A:E merges are removed; cross-boundary merges still fail closed.
  There are no side-panel merges, thick frames or minimum day-panel heights.
- Card order is header, city/address, optional partner, optional materials,
  optional permitted MAC, optional payment, amount, total, optional dispatcher
  comment. Missing sections and literal text rules are omitted. Інше shows
  its note before its amount, without normal-ticket fields.
- Expanded app cards remove material lines only from a local display copy,
  show structured nonzero materials before the existing payment/total/note
  tail, and never add another total. Material prices are informational only.
  Stored content and financial calculations are unchanged.
- Empty diagnostic history returns an empty string, without heading,
  placeholder or spacing. Existing history is still rendered. Existing
  credential, signal, linked-point, note and tag blocks remain conditional;
  no diagnostic/material data is deleted.

## Safety boundary

Presentation logic changes only in:

- `js/dispatcher-report-core.js`: card/render, not DTO/projection/hash/stats/CRUD.
- `gas/dispatcher-report/DispatcherReport.gs`: `reportRender_` only.
- `js/tickets-render.js`: display formatting, omission and ordering only.

The client has **only three release-literal line changes**, necessary for the
existing mixed-runtime guard: its revision and its two cache/revision proof
pins. After normalizing runtime-146/v76 to runtime-145/v75, it is byte-identical
to production base `dfd1b8c19c84185433642bc9146c8b69af24b5ef`.

The GAS source outside `reportRender_` and core outside card/render are also
byte-identical to that base. HMAC/nonce/request binding, durable receipts/ACK,
outbox, auto-send, retry, reconcile, bridge security, DTO schema, hashes and
versions of ticket data are unchanged. Projection, bridge, manifest, legacy
Code.gs, finance utilities, styles, shifts, Telegram, Worker/AI, maps, backup
and storage schema are unchanged. No real ticket or queue operation is run.

## Release identity

- App: `v92.01 · 2026-10-11`
- Runtime: `runtime-146`
- Cache: `maister-treker-v76-runtime-146`
- Runtime proof: eight real asset hashes; previous ledger entries preserved.
- Compact-view and runtime-guard changes are release pins only, not behavior.
- Production/GAS rollback points stay unchanged because nothing is deployed.

## Verification and visual fixture

- `tests/dispatcher-presentation.test.js`: section order, optional fields,
  Інше, nonzero priced materials, no duplicated totals, empty/existing history,
  unchanged input objects, same daily/weekly/monthly aggregator.
- `tests/dispatcher-report.test.js`: vertical flow, period boundaries, daily
  numbering, cross-month week, deterministic rendering and existing privacy.
- `tests/dispatcher-report-gas.test.js`: owned footprint cleanup, no side
  merges, wrap, bold titles, thin separators, content-sized rows and safe
  empty rebuild; existing security/CRUD tests retained.
- `tests/diagnostic-ticket-history.test.js`: removes only the obsolete empty
  placeholder expectation; storage/sync/privacy assertions retained.
- `e2e/dispatcher-vertical-presentation.spec.js`: expanded card ordering and
  a mobile visual fixture derived from the exact core formatter. It generates
  `vertical-report-mobile.png` plus an HTML attachment in Playwright artifacts.
  This is a generated fixture, **not evidence of a live Sheet update**.
- Existing privacy, durable commit ACK, lost-ACK, orphan-safety, legacy and
  runtime tests run without transport changes.
- Local MCP: 716/716. Local unit: 237 passed; the unchanged
  `network-tools-monitor.test.js:81` timing assertion failed (47–48 vs <=46).
  Five interleaved candidate/base runs each failed 5/5 at that assertion with
  matching timing. The test and all its local dependencies were compared
  byte-for-byte against base; base test source was executed in memory.
  This is a local baseline timing issue; no threshold or failure was masked.
- Full local E2E and GitHub Tests/MCP/E2E results belong to the exact final
  review HEAD. Do not infer CI success from the local timing classification.

## Review / later deployment

Review the mobile fixture before approving rollout. Any later rollout needs
both this frontend identity and the matching renderer bundle in the existing
dispatcher GAS project; it must not alter transport settings or user storage.
Live report restoration/rebuild is a separate authorized step, not performed
by this PR's tests.

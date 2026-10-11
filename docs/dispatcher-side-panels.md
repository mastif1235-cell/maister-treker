# Dispatcher side-panel restoration — v92.01 / runtime-146

DRAFT PR #89 only. No merge, deployment, live rebuild, sync or queue operation.
Production remains v92.00/runtime-145, dispatcher GAS v13.

## Restored layout, not a redesign

The B:E renderer is restored from base
`dfd1b8c19c84185433642bc9146c8b69af24b5ef`:

- A: 8 px spacer. B: 380 px tickets. C/D/E: readable 250 px panels.
- B: yellow day headers and beige tickets; first ticket line is bold.
- C: blue daily statistics aligned with the day's frame.
- D: green weekly statistics spanning that week's segment.
- E: purple monthly statistics spanning that month's days.
- Purple month headers merge B:E. A cross-month week has one summary and
  a continuation panel; no merge crosses a month separator.
- Adjacent ticket cells in B have an actual dark-blue SOLID_THICK top border.
  No decorative text rules remain in cards or statistics.

Final border-only pass closes every statistics header and reapplies continuous
SOLID_THICK dark-blue B|C, C|D and D|E edges over each month's body, including
headers and padding. The merged B:E month title is never divided. Month,
day and statistics frames stay closed to their last row; shared physical cell
edges are replaced, not doubled. Existing ticket separators remain unchanged.
GAS tests resolve all successive border writes to final horizontal/vertical
edges and verify full perimeters, not just the presence of styling calls.
The visual fixture uses collapsed borders and checks all four edges of panels,
day endings and continuous column boundaries. Layout/text/aggregator, row
heights, widths, colors, frontend assets and runtime proof are unchanged by
this final border-only correction.

Ticket heights follow their actual text, with a 58 px minimum rather than the
previous 100 px minimum / 370 px minimum day stretched into the last ticket.
For a very short day only, one separate beige padding row reserves exactly
the height deficit needed by its side panels. It is layout-only, has no ticket
data, and never changes the ticket row height. Daily frame and statistics
include this minimal padding so panel contents cannot spill into another day.

## Retained content and app-card fixes

- Normal ticket: header, location, optional partner, nonzero materials,
  optional permitted MAC, optional payment, amount, total, optional comment.
- Materials remain one item per line, quantity/unit and nonzero informational
  cost. No financial recalculation or duplicated material/total lines.
- Інше: compact header, comment if present, amount. No normal-ticket fields.
- Empty optional fields and literal separator lines are omitted.
- App-card materials precede existing payment/total; empty diagnostic history
  renders nothing. Existing history and stored ticket data are unchanged.

## Frozen boundaries

GAS changes only `reportRender_`; core changes only card/render relative to
production base. DTO, privacy, projection, source_hash/source_version, numeric
aggregation and CRUD are unchanged. App-card fixes from the previous PR89 HEAD
are retained, not reverted.

The dispatcher client's three changed lines versus base are release literals
only. Normalizing runtime-146/v76 to runtime-145/v75 makes it byte-identical.
Outbox, HMAC, nonce, request binding, direct transport, durable ACK/receipts,
AUTO, retry, reconcile and GAS security are untouched. Legacy Sheets, shifts,
Telegram transport, AI, maps, backup/import/export and storage schema remain
unchanged. No real records or queue operations are exercised.

## Identity and checks

Candidate stays v92.01 / runtime-146 / maister-treker-v76-runtime-146.
Only the unpublished v76 proof fingerprint is regenerated for the corrected
candidate. All prior release ledger entries are preserved.

Targeted tests cover B/C/D/E coordinates, B:E month merge, aligned day frames,
cross-month safe spans, bold titles, actual thick ticket borders, compact
ticket heights, omission/order/material costs, unchanged diagnostics and
financial/privacy behavior. Existing delivery/security regressions also run.

The isolated E2E fixture in `e2e/dispatcher-side-panels.spec.js` uses the actual
core layout spans to generate `dispatcher-side-panels.png` and an HTML
attachment. This is a visual review fixture, NOT evidence of a live Sheet
update. It includes multiple tickets and daily/weekly/monthly side panels.

The unchanged Windows ping timing assertion at
`network-tools-monitor.test.js:81` was previously reproduced 5/5 on both
candidate and base at comparable 47–48 ms (threshold <=46). Its thresholds and
dependencies are not changed or masked. Final local and GitHub check results
must be reported against the final exact review HEAD.

Review the new side-panel fixture before any later authorized deployment.

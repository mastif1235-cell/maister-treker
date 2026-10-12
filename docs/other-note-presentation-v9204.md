# Note-ticket presentation patch

Candidate: v92.04 / runtime-149 / maister-treker-v79-runtime-149.
Base: ab56d3666332fea2d04cb941c8ccc296ea43b1ac (v92.03).

## Scope

- Remove the early-return `Інше` card template. Reuse the normal card skeleton,
  `ticketDeliveryBadges`, Telegram badge conditions, photo keys, toggle, and viewer.
- Note cards show a note preview and omit monetary headers. Their expanded
  details show the complete escaped note, independent delivery statuses, and
  the existing photo action. First expansion from compact mode opens these
  details directly; ordinary repair/connection expansion is unchanged.
- Keep address, equipment, credentials, diagnostic history, and private master
  notes out of the note-only presentation. Stored ticket fields are untouched.
- Dispatcher report note blocks contain only the existing title and dispatcher
  comment. Normal work tickets retain exactly one existing `💰 Разом` line.
- No statistic, B:E layout, DTO, hash, transport, outbox, AUTO, ACK, HMAC,
  retry/reconcile, storage schema, photo-loader, or viewer changes.

The GAS source consumes the shared report core through the existing bundle
builder. A future coordinated release must update that bundle as well as the
frontend. This PR does not deploy GAS/frontend or change production records.

## Regression evidence

- `tests/other-ticket-presentation.test.js`: note-only output, shared delivery
  helper, independent pending/error states, modern/legacy photo references,
  compact omission, first expansion, unchanged inputs, normal card structure.
- `e2e/other-note-card.spec.js`: isolated browser fixture; compact -> expanded
  note -> shared photo toggle -> existing fullscreen modal, without Edit mode.
- `tests/dispatcher-report-gas.test.js`: real renderer/mocked Sheets API verifies
  note block omission of all generated financial lines.
- Existing delivery, photo, material, presentation, layout, and runtime suites
  remain in the verification package. Old note-money expectations are updated
  explicitly to the new requirement; material calculations are unchanged.

No real queue operations, retries, full sync, rebuilds, or credential changes
are part of this patch or its tests. Merge and deploy require separate approval.

# Dispatcher work price breakdown — v92.12 / runtime-157

Narrow follow-up to `52efe3b4fb17c213ab14f4ea4c6ad0bb1aa6c4c1`.
No deployment, merge, sync or production-data action.

## Source and root cause

Catalog selections are stored in `ticket.presetWorks`: `id`, `label`, `price`,
`qty`; unchecked rows are removed at save, so saved selections can omit checked.
Manual work is stored in `ticket.additionalWork`: `desc`, `sum` (a line total).
The previous projection selected only catalog labels, deduplicated by label,
discarded price/quantity and did not project manual rows.

## Exact functional changes

Only `js/dispatcher-report-projection.mjs` changes application behavior:

- `projectWorks` produces a presentation model with source, id, sanitized label,
  quantity, unit_price and line_total. Catalog prices are multiplied by saved
  quantity. An explicit saved sum is authoritative, including zero; manual
  amounts are not multiplied again. Missing/zero amounts omit the price suffix.
- `projectTicket` formats those rows into existing optional `works_display`.
  Each row occupies one line in the existing works block. No renderer, schema,
  ONU, finance, transport, ACK, HMAC or reconciliation behavior changes.

An identical explicit id + label + quantity + line amount is deduplicated,
including a mirrored catalog/manual row. Distinct ids or amounts stay distinct.
Anonymous duplicate catalog rows retain the former exact-content dedup behavior;
anonymous manual rows are independent by source/index because there is no proof
they represent the same physical work. Equal labels alone never merge amounts.

Privacy sanitization uses only real work labels/descriptions; notes/private
notes are not used as a work source. Existing works_display validation remains.
The optional field schema is unchanged; absent works keep old content hashes.

## Example

Catalog: welding 300, connector 100, router setup 200; manual duct work 450.
The works block contains those four prices once. With the preceding connection
example of 6000, the calculator saves 7050. Projection and report statistics
display the saved 7050, not 8100. Connection ONU stays +0 money / +1 inventory.

## Regression

`tests/dispatcher-work-prices.test.js` and
`e2e/dispatcher-work-prices.spec.js`: all named/generic catalog rows, manual
rows, zero/missing prices, quantity and explicit line totals, mirror dedup,
distinct equal-label rows, privacy, immutable input, saved total and ONU.
Existing ONU and old-hash/append-only tests are also rerun.

Other changed application modules contain release literals only. Release proof
is bumped rather than reusing the previous asset fingerprint.

Local results: dispatcher 27/27 files PASS, MCP 716/716 PASS, E2E 86/86 PASS,
runtime-proof 8/8 PASS, syntax/check.sh/diff-check PASS. Unit 244/245 files:
only unchanged network-tools-monitor timing assertion fails on both candidate
and unchanged base (same AVG assertion); thresholds were not changed.

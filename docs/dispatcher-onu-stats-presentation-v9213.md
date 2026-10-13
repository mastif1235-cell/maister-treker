# Dispatcher ONU statistics presentation — v92.13 / runtime-158

Presentation only. No historical backfill, network actions or deployment.

## Functional changes

- `js/dispatcher-report-core.js`: `materialLines` omits canonical ONU/ONT/ОНУ equipment from summary material lines only; other materials and prices are unchanged. `statsBody` displays only `ONU на підключеннях` and `ONU на ремонтах`, using the existing `onu_connection` and `onu_regular` values. It no longer displays generic ONU, combined ONU or replacement counts.
- `tests/dispatcher-material-stats.test.js`: update the summary presentation assertions; preserve all accounting/storage/hash tests.
- `tests/dispatcher-onu-stats-presentation.test.js`: day/week/month, two counters, ONU price variants and aliases, other materials, no empty materials heading, zero counters, ticket cards, unchanged input/stats/hash regressions.

`stats`, `card`, projection, DTO/schema, material aggregation, amounts, HMAC, ACK, outbox, retry and reconciliation logic are unchanged. Canonical material recognition is reused, not inferred from MAC or notes. No real tickets or historical records are edited.

## Release-only files

The shared core is a frontend runtime-proof asset and is bundled into GAS. A future release requires a matching GAS bundle and frontend; neither is deployed here.

- `app.js`
- `sw.js`
- `js/dispatcher-report-client.js`
- `js/runtime-guard.js`
- `js/tickets-compact-view.js`
- `js/tickets-render.js`
- `runtime-proof.json`
- `scripts/release-identity.json`
- `e2e/sw-runtime-proof.spec.js`
- `e2e/tickets-compact-view.spec.js`
- `tests/network-tools-ui.test.js`
- `tests/runtime-guard.test.js`
- `tests/sw-release-identity.test.js` (future unrecorded identity fixture advances to v89/runtime-159)
- `tests/sw-upgrade-static.test.js`
- `tests/tickets-compact-view.test.js`
- `tests/tools-v82-field-package.test.js`
- `tests/tools-v84-field-update.test.js`
- `tests/tools-v85-narrow-field-fixes.test.js`

These changes are release literals, fingerprints and their assertions only. Previous release ledger entries remain immutable.

## Verification

- Dispatcher regression: 28 files passed, including GAS renderer/security tests.
- MCP: 716 tests passed.
- Targeted E2E: 3 tests passed (runtime proof and compact/full card behavior), isolated local profiles only.
- Runtime proof: 8/8, syntax and diff whitespace checks passed.
- Network monitor timing assertion at line 81 reproduces on unchanged origin/main. Candidate and baseline monitor/test bytes are identical; no threshold changes.
- No GitHub push, merge, GAS publication, frontend publication, rebuild, full sync, queue clearing or historical updates performed.

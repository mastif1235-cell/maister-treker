# QueryState Phase 2A — period-only runtime bridge

Exact base: `0911bb508e84f36e134b35ad99237d71a7ead159`.
Production remains v91.84 · 2026-10-04 / runtime-128. No bump, merge or deploy.

## Parser / transition / execution

1. `parseTemporalWorkPeriod` in work-intent.js is the existing v91.84 closed
   grammar and resolveDateRanges logic, extracted without changing the accepted
   syntax, inherited year or date semantics. Returns only `{from,to}`.
2. `resolvePeriodFollowUp` in period-query-state.js converts the existing
   validated queryContext/resolved_filters with `fromExisting`.
3. FollowUpPatch contains ONLY `periods: REPLACE([period])`. The foundation
   reducer applies/validates it atomically; `toExisting` compiles one plan.
4. The existing temporal list limit is 8, kept as execution metadata. No new
   state or pagination persistence/schema is introduced.
5. Orchestrator uses that plan in its existing semantic fast path. Existing
   query_tickets, workAnswer, response/queryContext projection and failure
   handling execute unchanged. One tool call/scan, no second analytics query.

There is one period parser. Eligible calls do NOT build a second legacy argument
set alongside the reducer. `temporalWorkIntent` remains the legacy compiler and
test comparator: parser + old spread-based args. On adapter/reducer/compiler
error the bridge invokes it with the already parsed range (no duplicate parsing).

## Eligibility and fallback

Eligible: existing validated semantic queryContext, count/list mode, exactly one
unambiguous supported month phrase (RU/UA, optionally explicit year), with all
original filters representable by the foundation adapter. Mode, semantic entity/
action/profile/category/context, coworker, type, items and other filters stay.

Not eligible: missing semantic context; group/stats/exists; comparisons;
navigation; drill-down; workType/entity changes; coworker replacement/remove/
exclude; extra words/constraints such as “А в августе с Петей?”. These return
null intent and continue the unchanged legacy routing. No partial application.

Adapter validation/unsupported filter: exact legacy temporal fallback. No new
state written, no error-driven narrowing/widening. Foundation still rejects
unreconstructable redacted phone/MAC/contract flags; runtime currently projects
them out of inheritable queryContext as before. No architecture change to them.

The bridge returns internal path labels query_state_period/fallback/legacy_temporal
for tests; orchestrator uses only intent. No labels in user responses, new
observability fields, telemetry, logs or private content.

## Reload, navigation and failures

Existing serialized queryContext is sufficient: state is reconstructed for each
eligible follow-up. No storage of a second AnalyticsQueryState. Browser reload
between September/Женя/ONU and August produces the same filters/count as no
reload. Existing pre-v91.84 missing-mode recovery is untouched and regression-
tested in the old temporal suite.

selectedTicketId/resultSet are never supplied to the bridge. Existing navigation
still runs independently; this phase does not repair analytics/navigation
lifecycle. Network failure returns the existing error; no new queryContext/state
is returned. Network UI and request generation are not changed.

## Verification and boundaries

- Targeted tests compare old/new arguments and complete query envelopes, not
  just answer text, including all supported filters, profile/type and list limit.
- 216-case mode/profile/type/phrase matrix: 96 eligible envelope comparisons.
- Independently loaded **unchanged work-intent.js from exact base SHA** passed
  the same 216-case comparison with zero differences before completion.
- Foundation property/reference model and golden tests stay enabled.
- Synthetic golden: September all 28=20+8; September Женя 20=13+7;
  August Женя 27=15+12. Physical rules and engine modules are untouched.
- Browser E2E at 320px uses synthetic tickets/token and local orchestrator,
  literal reload, Q1=20/Q2=27 and exactly two requests/two queries.
- Engine legacy parity 9/9; semantic/event parity 36/36 vs exact base.

Existing runtime edits are limited to work-intent.js (parser extraction) and
orchestrator.js (import and fast-path intent planning). No changes to workAnswer,
comparison/navigation/selection, network UI, physical rules/reconciliation,
smart-query, sync/Sheets/ticket.id/schema, privacy/masterNote, storage/restore,
READ-ONLY, map/R2/Speedtest, service worker, auth or Wrangler files.

This changes the internal period-only planning path, not its intended behavior.
Production was not updated. After any future approved merge, Worker release will
be required for the mcp/src runtime changes; no infrastructure changes needed.
WorkType/entity/coworker reducers, exclusions, comparisons, drill-down and
request-generation guards remain outside Phase 2A.

## Local test summary

- Phase 2A unit: 23/23 PASS; foundation/golden: 29/29 PASS.
- MCP full: 638/638 PASS; frontend AI subset: 29/29 PASS.
- Targeted literal-reload browser E2E: 1/1 PASS; full E2E: 47/47 PASS.
- Frozen-base temporal parity: 216/216 cases, 96/96 eligible full envelopes PASS.
- Legacy nonsemantic 9/9; semantic/event 36/36; restore/privacy/security PASS.
- Syntax/check.sh/diff-check PASS.
- Root full twice: 207/208; only existing network-tools-monitor.test.js:81,
  47 ms then 48 ms vs 38–46 ms. Separate targeted Ping repeat PASS.
  Ping implementation/assertions/thresholds are unchanged. No unrelated fixes.

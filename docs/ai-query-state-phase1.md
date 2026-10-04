# Analytics query state — Phase 1 foundation

Frozen baseline: merge `4904ef33ce213777b95af32128e9695d5393a4e9`,
v91.84 · 2026-10-04 / runtime-128. No version bump or deployment in this PR.

## Integration boundary

`mcp/src/ask/analytics-query-state.js` is a pure, disconnected module.
Nothing in the runtime imports it. There is **no shadow integration**, extra
tool call, database scan, log, persistence, LLM call or change to queryContext.
Existing orchestrator, mergeInheritedFilters, temporal paths, workAnswer,
physical consumption, READ-ONLY tools, navigation and frontend remain untouched.

## Schema (version 1)

| Field | Representation |
| --- | --- |
| version | 1 |
| periods | ordered array, 0–8 `{from?, to?}` inclusive DD.MM.YYYY calendar ranges; empty means unrestricted |
| entity | optional existing normalized work entity |
| measure | `tickets` for legacy/work_v2 contract; `quantity` for onu_physical/physical_consumption; contract discriminator, not a new units engine |
| action | optional existing semantic action |
| category | existing definite/ambiguous/excluded/all, default definite when semantic fields exist |
| profile | optional work_v2/onu_physical/physical_consumption |
| signalContext | subscriber/input/any, default subscriber when semantic fields exist |
| coworker | `{kind:'any'}` or `{kind:'include'|'exclude', name}` |
| workType | optional existing type string (no new type taxonomy) |
| aggregation | exists/count/list/group/stats; default list |
| groupBy | optional existing group_by; required for group |
| filters | only city/street/city_id/street_id/house/apartment/tags/payment/sum_min/sum_max/signal_worse_than/signal_worse_or_equal/signal_better_than/has_signal/items |

Item filters preserve text/kind/unit_price/quantity/total. UUID normalization and
semantic normalization reuse current definitions. Unknown fields, invalid dates,
lossy truncation/projection, and unsupported combinations fail explicitly. The
state contains no rows, notes/masterNote, credentials, MAC values, network errors,
LLM answers, selection or UI values. Permitted filter strings are query inputs,
not an anonymization guarantee; never log them indiscriminately.

## FollowUpPatch and reducer

Patch is `{changes?: {field: {op:'KEEP'|'REMOVE'|'REPLACE', value?}}, clarification?: string}`.
REPLACE requires value; KEEP/REMOVE reject value. Replacements are whole-field,
not recursive merges. Missing fields KEEP. Explicit null is invalid, not REMOVE.

`reduceAnalyticsState(previous, patch)` returns either `{ok:true,state:normalizedNext}`
or `{ok:false,code:'INVALID_PATCH'|'CLARIFICATION',state:previous}`. Failure keeps
the original object unchanged, atomically. Neither inputs nor nested values mutate.

REMOVE periods => unrestricted; coworker => Any; filters => empty; aggregation =>
list. Other optional constraints disappear. Semantic defaults are normalized by
the existing validator; removing measure re-infers the contract's measure.
Removing a required/dependent field can fail validation (e.g. groupBy in group).
Entity changes **do not guess dependent profiles away**: ONU-only profile + router
is rejected; caller must explicitly replace the profile with a compatible one.

Explicit patch examples (not a new natural-language phrase router):

- August: replace periods only.
- Only repairs: replace workType with Ремонт.
- With everybody: remove coworker restriction.
- With Петя: replace coworker with Include(Петя).
- Routers: replace entity and explicitly resolve incompatible profile if needed.
- Without Женя: Exclude(Женя), distinct from Remove; ambiguous meaning needs clarification.
- All together: clarification unless target dimension is known.

## Adapter and known limits

`fromExisting(resolved_filters, {mode, group_by})` accepts supported exact filters,
never an entire response/context. `toExisting(state)` compiles an ordered **array
of query_tickets argument plans**, without execution. One period gives one plan;
multiple periods give separate plans. No plan overwrites another.

Round-trip equivalence is semantic, including current semantic defaults and UUID
case normalization. Supported golden filters also have exact full engine envelope
parity. Presence-only `phone_digits`, `contract`, `mac` cannot reconstruct the
original restriction and are rejected, not dropped. Pagination is deliberately
not analytics state. Arbitrary unknown envelope fields are rejected.

Exclude is modelled but compilation rejects it: current tools do not support an
exclusion predicate. No LLM workaround or new WRITE tool is introduced. Multi-
period planning is not a comparison execution/formatting architecture. There is
no money/metres/pieces aggregation redesign; stats and physical profiles retain
their current engine semantics. No sentence parser is included in this phase.

## Independent ownership for future phases

- AnalyticsQueryState: normalized restrictions and aggregation intent only.
- NavigationContext (existing lifecycle, unchanged): resultSet, selectedTicketId,
  TTL/selection metadata. Not included in analytics state.
- Network/UI state (existing lifecycle, unchanged): request generation/id,
  status, error, cooldown. No chat flow or generation guard changes here.

## Safety harness

Synthetic golden fixture: September all 28=20+8; September Женя 20=13+7;
August Женя 27=15+12, with direct and exact legacy tag evidence and a free
warranty explicit replacement. No real customer data copied.

12 physical safety cases freeze derived connection, old-fault wording,
explicit reuse/transfer/used/customer-owned exclusions, structured quantities,
dedup, warranty, planned, negated and signal-only behavior. Existing v91.84
tests retain multi-period, morphology, navigation selection/reload, READ-ONLY,
privacy, network hotfix and backward compatibility coverage.

New invariants cover independent field retention, KEEP/REMOVE idempotence,
commutation, serialization, deterministic compilation, atomic rejection,
clarification, strict privacy/ownership boundaries and unsupported adapter cases.
Independent reference reducer validates 1,024 seeded chains of length 1–8
(4,608 transitions) over period/coworker/workType/entity/aggregation.
Metamorphic tests cover independent August equivalence, September→August→September
and ONU→router→ONU without changing period/coworker.

## Phase 2 deliberately deferred

Natural-language patch extraction/clarification policy; general follow-up routing;
execution support for Exclude; comparison lifecycle; integration/shadow metrics;
analytics/navigation separation in the orchestrator; per-turn state authority;
drill-down; request generation guard. None is enabled by this foundation.

## Local verification

- New foundation/golden tests: 29/29 PASS; 4,608 reference transitions.
- MCP full: 615/615 PASS.
- Root: 208/208 PASS; frontend AI subset: 29/29 PASS.
- Full E2E: 46/46 PASS.
- Legacy exact parity vs frozen production: 9/9 PASS.
- Semantic/event exact parity vs frozen production: 36/36 PASS.
- Restore compatibility and privacy/security: PASS (full suites plus boundary checks).
- Syntax: 451 JS files PASS; check.sh and diff-check PASS.

Known timing-sensitive Ping test passed this run. No Ping thresholds/assertions
or implementation were modified. Initial sandboxed Node test runner hit spawn
EPERM; permission-approved normal full suites completed successfully. New golden
test assertions initially used an incorrect breakdown field name; corrected to
the actual `new_connections` field without modifying production engine code.

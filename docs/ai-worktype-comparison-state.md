# Narrow deterministic work-type and comparison transitions

This PR is based on main, not cache PR #72 or coworker PR #73. It does not
change Foundation, physical-consumption semantics, provider, prompt, tools,
navigation, storage schema, config, resources or production.

## Closed grammar and typed patches

For valid bounded semantic count context only:

- D2: `changes.workType = {op: 'REPLACE', value: 'Ремонт'}`; all unspecified
  fields KEEP. Eight explicit RU/UA phrases are accepted. Conflicting/new
  constraints fall back atomically to the unchanged legacy path.
- D4: `changes.periods = {op: 'REPLACE', value: [first, second]}`; all other
  fields KEEP. Four RU/UA comparison forms preserve user ordering. Both
  months use the existing month parser and previous-period year anchor.

Single D2 executes one query, D4 exactly two count queries; neither calls the
provider. All plans validate before execution. A failure in either comparison
query publishes no partial result/context. No reports/statistics/shifts tools.

## Additive context, not a new storage schema

`queryContext.comparison = {periods: [{from,to}, {from,to}]}` carries only two
ordered calendar-valid periods. `resolved_filters` contains common safe filters
and no dates. No last-envelope overwrite, rows, selection, raw state or secrets.
Both authoritative totals/breakdowns are returned under `comparison.results`;
the answer formats both periods. There is deliberately no combined scalar total.
Client whitelist preserves both periods through the existing chat reload path.

Q1 -> D2 -> August keeps repair/coworker/entity/profile. Q1 -> D4 -> D2 applies
repair to BOTH periods using the existing reducer/compiler. Unsupported follow-ups
from comparison request clarification and retain context: they do not silently
execute all-time filters or choose one of the periods. Broader comparison drill-down
and multi-period navigation are not implemented here.

## Release limits

Frontend remains v91.84/runtime-128: no publication is authorized. Before future
frontend rollout, assign an agreed cache bump for the changed client sanitizer.
Worker release is needed after a future authorized merge because `mcp/src` changes.
No claim is made that this proves CPU/memory causation or eliminates Cloudflare 1102.

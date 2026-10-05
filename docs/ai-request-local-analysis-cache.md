# Request-local work analysis memoization

Performance-only change against `7b5e764a152ab5145af5a0c63a25b7e12bf8cff8`.
Frontend remains v91.84 / runtime-128. No deployment or infrastructure change.

## Boundary and ownership

`createAskOrchestrator().handle()` creates one internal execution object.
The deterministic semantic path, authoritative list follow-up and model-driven
`query_tickets` calls pass that same object as a private second handler argument.
It is not part of tool definitions/arguments or serialized conversation state.
Raw `/mcp` calls without that object retain their previous behavior.

`createReadTools().query_tickets()` pins the first successful `loadRedacted()`
promise for this request. This is necessary because the existing KV provider
parses its JSON afresh for every read, creating new row/search-index objects.
Concurrent reads share the pending promise; rejected or `ok:false` reads are
removed and preserve their existing error result. Non-query tools are unchanged.
The pinned projection includes the existing redacted tickets, shifts, public
search index, directory and freshness metadata; no raw GAS rows are introduced.

The cached unit is the completed `workEvents(ticket, legacyText, options)`
analysis, including reconciliation and physical consumption, before filtering.
Dependencies audited in the existing functions:

- ticket identity/content: id/date, connectMasters, public note/abonentNote/
  otherNote, presetWorks label/qty/checked, additionalWork desc, equipment
  label/qty/consumption_qty/checked, cables label/meters, signal, type, MAC validation;
- the public search-index text supplied for that ticket;
- `options.profile`, the **only options field read by workEvents**.

Identity is `WeakMap<ticketObject, WeakMap<searchIndexObject, Map<profile, analysis>>>`.
An immutable search-index identity determines its text within this request.
Missing profile is distinct from work_v2; ONU/physical profiles remain distinct.
Never key by ticket.id, raw note, MAC, phone, contract or secret values.
Duplicate/malformed IDs do not alias new cache entries; existing ID-based
query aggregation behavior is preserved rather than redesigned.

Entity/action/category/signal_context, date/coworker/mode and all other query
filters are outside this boundary. Each query still scans, filters, orders and
aggregates independently. No final envelope/totals/list-result cache exists.
If a future workEvents change reads another option, update this identity/tests.

Both inputs and completed analyses are read-only in query processing. Regression
tests deeply freeze fixtures and computed analyses. Mutations during extraction
are confined to newly allocated analysis objects before insertion. Exceptions
from computation are not inserted or replaced with empty analyses.

`handle()` disposes both WeakMaps in `finally`, including early returns and
provider errors. Even a test-retained execution object cannot hit old entries.
Each handle has separate closure state, including simultaneous handles using
the same orchestrator. There is no module-global or persistent analysis cache.
Methods are non-enumerable and the execution object serializes as `{}`;
no snapshot/cache is attached to response, queryContext, history or resultSet.
masterNote is never an analysis input and no cache logging/telemetry is added.

## Read-only live measurements

426 tickets, 171 shifts, 426 search-index rows; snapshot fetched with GET only,
held in RAM, never saved/logged. Compare exact-main bundle with local candidate.
Actual read-tool/orchestrator path is used with scripted provider calls and fresh
JSON identities per provider read, matching the KV behavior. Filtered calls
alternate September/August with the same coworker/profile; broad calls repeat
the full dataset. Full envelopes and orchestrator responses are deep-equal.

Six samples per version, balanced ABBA order after warmup; CPU is mean Node
process CPU and wall is median. Counts are collected in separate instrumented
bundles. These are **not Cloudflare CPU or memory telemetry**.

| Calls | Analyses main → cache | Rows scanned both | Reads main → cache | CPU ms main → cache | Wall ms main → cache |
| --- | ---: | ---: | ---: | ---: | ---: |
| filtered 1 | 51 → 51 | 426 | 1 → 1 | 49.50 → 51.83 | 41.36 → 43.73 |
| filtered 2 | 113 → 113 | 852 | 2 → 1 | 91.17 → 88.50 | 86.96 → 76.12 |
| filtered 4 | 226 → 113 | 1704 | 4 → 1 | 176.83 → 88.50 | 169.02 → 80.40 |
| filtered 8 | 452 → 113 | 3408 | 8 → 1 | 367.33 → 91.17 | 333.94 → 90.38 |
| broad 1 | 426 → 426 | 426 | 1 → 1 | 296.83 → 304.83 | 285.98 → 286.51 |
| broad 2 | 852 → 426 | 852 | 2 → 1 | 705.50 → 328.17 | 588.32 → 299.41 |
| broad 4 | 1704 → 426 | 1704 | 4 → 1 | 1192.67 → 354.17 | 1143.83 → 326.94 |
| broad 8 | 3408 → 426 | 3408 | 8 → 1 | 2268.33 → 380.17 | 2187.28 → 359.66 |

Each analysis count applies to both workEvents and physicalConsumption. Unique
compatible analyses are 113 across the two filtered periods and 426 broad.
Disjoint periods in two calls already have no overlapping analysis work; their
improvement is mostly snapshot parsing. One call need not become faster.

| Calls | Sampled heap increase MiB main → cache: filtered | Broad |
| --- | ---: | ---: |
| 1 | 33.4 → 40.2 | 64.1 → 74.5 |
| 2 | 32.3 → 40.4 | 65.9 → 74.7 |
| 4 | 64.3 → 42.2 | 69.2 → 74.5 |
| 8 | 64.2 → 49.1 | 76.2 → 74.6 |

Heap sampling is affected by GC/JIT/instrumentation. The cache deliberately
retains the snapshot and computed analyses until request completion; memory
does not necessarily decrease. Post-GC measurement deltas were approximately
-0.1–1.0 MiB main and 2.9–4.0 MiB candidate; this includes retained benchmark
outputs and runtime warmup and does not prove a leak or Worker memory footprint.
Lifetime tests prove disposal, not Cloudflare resource-limit behavior.

Expected benefit: materially less repeated CPU in multi-call asks. The exact
root cause of live Cloudflare 1102 remains **unproven**. A later controlled
preview/rollout and resource verification are still required; no limits raised.

# v91.80 reconciliation: audit and candidate implementation

Base: main `a5b52da49aba7cae16164a14cba9c9970ae864a0`, production v91.79 /
runtime-123. Branch: `codex/ai-semantic-reconciliation-v91-80`.
Candidate: v91.80 · 2026-10-02 / runtime-124. No deployment, merge, data
migration or backfill was performed. Audit statements below describe the
v91.79 baseline; the implementation section records the authorized fix.

## Coworker root cause and data path

1. `js/calculator-render.js` renders selections from calcState.connectMasters.
   `js/tickets-bindings.js` stores selected name/letter objects and maintains
   corresponding tags. Thus a tag is not necessarily an arbitrary label,
   but neither does every matching tag prove a historical direct selection.
2. `saveTicketFromForm` in `js/ticket-editor-domain.js` deep-copies calcState
   into the local ticket, then calls saveTickets. Direct names survive this
   local path for new and edited tickets.
3. **app.js ticketToSyncPayload omits connectMasters from fullDataJson.**
   The sync runtime sends this serializer's output. Existing persisted fields
   such as MAC/type/public notes are included; selected masters are not.
4. Code.gs validates/stores the provided fullDataJson string in the existing
   Sheets column; it cannot restore a field the serializer omitted.
5. ticketFromGasRow parses the fullDataJson column (or legacy backupNote JSON
   only when that column is empty). redactTicket already projects direct
   connectMasters names if present, otherwise []. KV snapshot v4 stores that
   projection without recovering masters. No mapper field/schema addition is
   necessary to preserve correctly serialized names.
6. Semantic coworker matching only accepts direct projected names. This is
   correct for definite evidence, but cannot recover names absent upstream.
   Legacy non-semantic calls can use same-day shifts, explaining the misleading
   discrepancy with the phone UI. They must retain behavior during this stage.

Synthetic reproduction with the actual serializer and mapper: a direct ticket
matches Petya (1); after normal serialization/redaction it matches 0, because
fullDataJson has no connectMasters and the MCP projection has an empty array.
A manually supplied fullDataJson containing connectMasters does preserve it.

## Historical UI recovery

editTicket begins with JSON deep-copy of the ticket (not mutation of the stored
record). It can recover old masterName/masterLetter, or, for an empty masters
array, exact tags matching settings.masters. Recovery modifies calcState only.
Opening/filling the form does not call saveTickets or enqueue a ticket mutation;
the restored masters enter the local ticket only on explicit Update. Even that
Update still loses them at the current sync serializer. Draft auto-save is not
a historical-ticket backfill.

The Worker receives neither settings.masters nor provenance of tag creation.
Matching a name from shifts proves that it is a known person, **not** that an
arbitrary tag is a direct-master tag. Definitive legacy attribution must not be
invented from same-day shift coincidence or a name alone.

Proposed conservative rules:

- direct connectMasters: definite, reason direct_ticket;
- matching historical master tag: separate computed legacy candidate category
  unless a trusted roster/provenance rule can be established; report candidates
  explicitly rather than silently replying zero;
- same-day shift only: contextual, never a definite event/coworker;
- do not rewrite historical tickets, and never let legacy narration say
  "only in shift" when ticket-level direct/legacy-tag evidence exists.

## ONU root cause and proposed business rules

Current workEvents consumes action/object text and selected work labels.
It does not derive completed connection or ONU installation from type/MAC.
Selected equipment remains mention-only. Current install questions filter the
install action, so replacements are also outside that count. These are semantic
rule gaps, not missing MAC in the mapper: macAddress already exists in v4.

Synthetic O1 and O10 (connection + MAC, with/without signal) produce no ONU
event. O5 gives one explicit install but unknown quantity; O6 one explicit
replace; O7 only an ONU power-supply replace. O2/O3/O4 produce mere mentions,
not owned/reuse context. O8 produces one explicit install and an ambiguous old
ONU mention; O9 correctly does not infer an installation without MAC.

Proposed computed taxonomy, without persisted fields:

- explicit event, structured-field/derived-job event, and context exclusion;
- definite / ambiguous / excluded remain the categories;
- ordinary completed connection type + usable ONU MAC => derived ONU install,
  quantity 1, safe evidence contains presence flags, never the MAC;
- type is business evidence for connection completion; signal is never install
  evidence and no router rule is derived without an approved business rule;
- extensible RU/UA ownership and transfer/reuse dictionaries provide reasons
  customer_owned_onu / reused_onu_transfer;
- explicit new replacement/install can supersede old-equipment context,
  but must be linked to the actual ONU clause rather than apply globally;
- connection + explicit ONU install => one physical event, not two;
- connection + explicit replacement => one new physical ONU for that ticket,
  with replacement provenance, not a derived install plus replace;
- explicit quantity conflicts or several independently proven ONU operations
  require conservative handling, not unconditional one-per-ticket collapsing;
- physical-placement questions need an additive, whitelisted semantic profile
  preserving install / replacement / derived-connection breakdown. Do not
  silently redefine every existing action=install tool call to mean replace.

Rules must be tested at the event, aggregation, intent, HTTP and persisted
follow-up boundaries. A derived quantity must be labelled business-derived,
not "explicitly entered" in the answer. Existing explicit quantity semantics
and non-semantic envelopes must be compared against v91.79.

## Privacy-safe production aggregates

Read source: existing production MCP list_tickets/get_shifts/query_tickets,
September 2026, data_as_of `2026-10-02T18:20:33.995Z`.
No customer records, IDs, dates of individual tickets, MACs, notes, addresses,
credentials or person-by-person lists were logged or persisted.

| Aggregate | Count |
|---|---:|
| September tickets | 62 |
| Structured connection tickets | 20 |
| Connections with direct connectMasters | 0 |
| Connections with tags but no direct names | 20 |
| Connections with known-person-name tag candidates | 20 |
| Connections with MAC present | 20 |
| Customer-owned markers in public structured notes | 0 |
| Transfer/reuse markers in public structured notes | 0 |
| Would-be derived candidates using those notes only | 20 |
| Current definite explicit ONU install events, full internal query path | 0 |
| Current definite explicit ONU replacement events, full internal query path | 3 |
| Explicit/derived pairs in public structured notes | 0 |

**Limits:** the public list does not expose internal searchIndex/legacy content.
Context-marker and dedup figures above are candidates from structured public
notes, not complete final classifications or an asserted physical total of 23.
Known-person candidates use available direct names plus September shift names,
not settings.masters, and do not establish provenance. An attempted direct KV
read returned 401; no auth was changed, and the audit used existing MCP reads.

## Authorization and additive boundary

The robust new-ticket fix requires adding the already-existing ticket field
connectMasters to the existing fullDataJson sync payload. This is additive and
needs no new Sheets column, GAS deployment, DB schema, snapshot version, ID
change or historical rewrite. The owner separately authorized this exact
serialization addition and the computed ONU business rules. No other sync
runtime, mapper, persistence, infrastructure or authorization change is needed.

Historical migration is **not recommended**. Computed legacy candidates can
avoid destructive backfill, but exact definite legacy-tag attribution still
needs an agreed trusted provenance/roster strategy. No PR should suggest the
coworker loss is fixed while the serializer still drops names.

## Audit baseline verification

Audit reproductions cover C1/C2/C3 and O1–O10 with synthetic data using actual
v91.79 serializer, mapper and query modules. These are baseline reproductions,
not implementation results. Fresh passing regression tests are listed below.
No assertions, Ping code, network-tools-monitor.test.js, auth, R2, storage,
sync runtime, mapper, snapshot or tool contract were edited.
Runtime suite results are recorded in the handoff; a new implementation will
require all requested regression/privacy/follow-up/E2E suites anew.

Fresh audit baseline: MCP 467/467 PASS (including privacy/security and existing
semantic regressions); root 200/201, only network-tools-monitor.test.js:81,
average 48ms. Root includes existing frontend AI tests. Audit helper syntax and
diff-check PASS. E2E was not rerun at this permission gate: no runtime code was
changed (the published v91.79 release previously passed 42/42).

## Implemented candidate

- app.js adds existing connectMasters to existing fullDataJson only. Undefined
  legacy fields remain omitted; explicit [] clears names on normal update.
  An unchanged historical ticket or pending mutation is not reserialized at
  startup. No new Sheets column, DB migration, ID change or mass backfill.
- Computed profiles are opt-in: work_v2 and onu_physical. Calls without profile
  preserve v91.79 explicit semantics; all non-semantic envelopes are unchanged.
- Direct connectMasters is definite direct_ticket evidence with highest
  provenance. After the owner's specific-query business clarification, an exact
  normalized ticket tag matching the requested coworker is definite
  legacy_master_tag evidence, even with absent/conflicting shifts or another
  direct coworker. Safe query cases Петей/Женей resolve to Петя/Женя; stored
  tags use full normalized equality, never fuzzy/substring matching. No roster
  is built or transmitted. Same-day shift is never definite. General coworker
  grouping remains direct-only, not inferred from arbitrary historical tags.
- Connection type + MAC present derives ONU install quantity=1 with reason
  derived_from_connection, quantity_source=business_derived. Explicit install
  on the same connection is deduplicated; explicit replace retains replacement
  provenance. Ownership/reuse exclusions yield safe presence-only evidence.
  Explicitly new ONU overrides those contexts for the corresponding action,
  not for a separate reused action. No analogous router inference.
- onu_physical combines definite installs/replacements and exposes full-set
  breakdown before pagination: connection installs, standalone installs,
  replacements, total physical-placement events and owned/reused exclusions.
  Known unit quantity and unknown-quantity events stay separate: unknown
  explicit replacement quantity is never guessed to be one.
- Evidence follow-ups/reload retain exact semantic profile, dates and coworker.
  Reasons include direct_ticket, legacy_master_tag, derived_from_connection,
  explicit_install, explicit_replace, customer_owned_onu, reused_onu_transfer.
  Evidence never contains a MAC value. No ticket/event/snapshot write is made
  by analytics, and the existing READ-only toolset remains unchanged.

## Candidate verification

- C1–C3 / L1–L6 / O1–O10 and additional profile, dedup, quantity-conflict, RU/UA,
  exclusion, item/date scope, roster and follow-up privacy tests: PASS.
- Actual serializer -> durable offline journal -> signed transport -> real
  Code.gs in-memory Sheets -> mapper -> redacted ticket -> coworker semantic
  query: PASS. Direct coworker survives; no columns/IDs/backfill changed.
- Nine full non-semantic result envelopes and one pre-existing explicit
  semantic call compared exactly against main a5b52da: PASS. CI uses hashes of
  those synthetic baseline results, not Git-history or RTK dependencies.
- Raw Worker entry-point tools/list/tools/call contract, GET-only GAS reads,
  invalid-profile rejection and response privacy: PASS.
- MCP full: 496/496 PASS (includes privacy/security and READ-only guards).
- Frontend AI: 25/25 PASS, including sync boundary and fail-closed profiles.
- E2E full: 42/42 PASS, including count -> evidence -> reload at 320px.
- Root full: final 201/202; only pre-existing timing-sensitive
  network-tools-monitor.test.js:81 at 48ms (expected 38–46ms). Before the
  specific-query refinement an earlier full repeat was 202/202 PASS; the
  immediately previous final run hit the same test at 47ms.
  Ping code, timers and assertions were not modified or weakened.
- Syntax: 104/104 JS files PASS; mcp/scripts/check.sh PASS; diff-check PASS.

## Known limitations and release boundary

The Worker has no settings.masters roster. Under the owner's approved narrow
business rule, a specific requested coworker's exact historical tag is definite
ticket-level evidence, not direct selection provenance. General historical
coworker grouping is not expanded without a trusted roster. Historical names
are not repaired automatically. Existing pending
requests retain their original payload; only a later normal user edit/new ticket
includes the added field. KV snapshot version stays 4.

Free-text ownership/reuse/new-hardware detection is a conservative RU/UA
dictionary, not universal language understanding. Arbitrarily complex multiple
operations and unsupported quantity wording can remain ambiguous/unknown.
Explicit quantity conflicting with the one-connection rule is not overridden.
Physical-event counts are not represented as proven unit counts. Existing
selected hardware alone remains mention-only; signal does not prove installation.

Candidate changes require a later authorized frontend + Worker release to take
effect in production. This stage permits only a DRAFT PR. No merge, deploy,
production switch, secrets/auth/R2 change or data migration was performed.
The owner authorized DRAFT PR #65 despite the existing Ping timing failure;
subsequent refinement remains on that PR with v91.80 / runtime-124 unchanged.

## Changed files (23)

- Runtime: app.js, sw.js, js/ai/ai-client.js.
- Computed analytics: mcp/src/ask/orchestrator.js, smart-query.js, work-events.js,
  work-intent.js, work-reconciliation.js; mcp/src/tools/definitions.js.
- MCP regressions: mcp/test/unit/work-reconciliation.test.js,
  mcp/test/unit/work-backward-compatibility.test.js,
  mcp/test/integration/work-reconciliation.test.js.
- Frontend/sync regressions: tests/ai-sync-masters-roundtrip.test.js,
  tests/ai-work-analytics.test.js; e2e/ai-work-analytics.spec.js.
- Release pins only: e2e/tickets-compact-view.spec.js,
  tests/network-tools-ui.test.js, tests/sw-upgrade-static.test.js,
  tests/tickets-compact-view.test.js, tests/tools-v82-field-package.test.js,
  tests/tools-v84-field-update.test.js, tests/tools-v85-narrow-field-fixes.test.js.
- Audit/handoff: docs/ai-semantic-reconciliation-audit-v91-80.md.

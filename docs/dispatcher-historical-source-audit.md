# Historical source reconciliation and ONU dry-run

Code-only candidate v92.19 / runtime-166. No network, storage, mutation POST,
canonical-ticket changes, migration, rebuild, sync, or production writes occur
in these helpers. The normal delivery projector does not call the historical
type resolver. Historical classification is used only by the dry-run pipeline.

## Source reconciliation

`reconcileHistoricalTickets(current, archive, core)` first resolves identical
ticket IDs in favor of current. Duplicate IDs within one source fail closed.
It then suppresses different-ID physical duplicates only when normalized date,
normalized HH:MM, and full content match exactly. Content normalization only
converts CRLF/CR to LF; it does not trim, case-fold, remove private fields, or
fuzzily match text. Missing content/time cannot prove a duplicate. Current wins;
within a source the smallest lexicographic ID provides a deterministic winner.
Suppression is an in-memory view; nothing is deleted. Diagnostics expose only
IDs, source labels, and reason codes, never full content or sums.

## Work type

`resolveHistoricalWorkType(ticket)` returns CONNECTION, REPAIR, OTHER, or
UNKNOWN_TYPE. It uses approved historical overrides first, then canonical type,
an exact saved heading, recognized tags, saved connection fee/tariff semantics,
and repair/replacement/restore/loss/splice evidence. Canonical connection type
alone is insufficient. A repair heading plus repair tags/evidence resolves to
REPAIR despite an old connection JSON type. ONU replacement with canonical
repair remains REPAIR despite a connection heading. Power-supply replacement
is not strong ONU-replacement evidence. Routine optical splicing is compatible
with three independently agreeing connection type sources. Other genuine
conflicts remain UNKNOWN_TYPE and enter neither connection nor repair counts.

Approved repair overrides supplied by the user:

- 1784113153627
- 1784048596976
- 1783937356216
- 1777287852811
- 1775815433108

The original ticket, type, tags, and sum remain unchanged. No inferred decision
is persisted and no DTO/version/hash is issued by this pipeline.

## ONU counts

Only resolved CONNECTION receives the existing approved legacy ONU policy:
explicit customer ownership gives zero; otherwise default our ONU gives one.
Historical unchecked/empty equipment does not imply customer ownership.
Resolved repairs use the existing `confirmedRepairOnuCount` evidence helper
once, with historical ONU overrides, structured equipment, or exact saved
material evidence. It does not add onu_used, onu_replacement, and materials
together. Repair pricing and saved sums are untouched.

`dryRunHistoricalOnu({current, archive}, core)` reports source counts, physical
jobs, exact/same-ID suppression, type conflicts, UNKNOWN_TYPE records, safe
customer-ONU phrases, and monthly totals. Array input is explicitly labeled
CURRENT_ONLY; it must not be presented as complete current/archive coverage.

## Supplied-evidence regression fixture, not a complete live audit

The full current/archive canonical exports were unavailable in this session.
The fixture reconstructs only user-supplied relationships/evidence. Dates and
content not explicitly supplied by the user are synthetic. Its counts must
not be presented as actual complete historical monthly results.

Exact pairs (current preferred, archive suppressed):

| Current | Archive |
| --- | --- |
| 1783937356200 | 1783435135970 |
| 1783937356201 | 1783420836005 |
| 1783937356203 | 1783343460359 |
| 1783937356205 | 1783075798413 |
| 1783937356209 | 1782994943831 |
| 1783937356210 | 1782905435476 |
| 1783937356211 | 1782829354711 |
| 1783937356224 | 1782381630879 |
| 1783937356225 | 1782308060945 |
| 1783937356226 | 1782297313220 |

The fixture produces 10 physical jobs from 20 source rows, 9 our ONU and one
customer ONU. The customer pair is the user-confirmed 02.07.2026 15:17 example
with the safe phrase `своя ONU`.

The separate type-conflict fixture contains the supplied 18 conflicts. Five
resolve to approved repair; these 13 remain held as UNKNOWN_TYPE:

- 1783937356212
- 1783336285098
- 1781882915421
- 1781880526066
- 1781871158184
- 1781716436224
- 1781179383203
- 1781104713848
- 1780498750666
- 1780498841441
- 1779469363834
- 1774458317619
- 1774458317612

October control fixture: six independent connection jobs, zero explicit
customer ONU, and four structured repair ONU produce 6 + 4 = 10 physical ONU.
These numbers are fixture inputs, not hardcoded projector values.

Regression: all 32 dispatcher test files PASS. Full historical rebuild remains
NOT READY pending complete canonical source dry-run and review of unresolved
types. No GitHub Actions, merge, deploy, full sync, or rebuild was performed.

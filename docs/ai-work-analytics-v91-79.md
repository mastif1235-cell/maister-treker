# v91.79: computed READ-only work analytics

Pipeline: redacted ticket/search projection → optional validated
`query_tickets.semantic` → computed WorkEvents → existing filters + exact
direct coworker → full-set deterministic aggregates → pagination/evidence.
No migration, new stored fields, snapshot version, permissions or WRITE tools.

Supported entity IDs: `onu`, `onu_power_supply`, `router`,
`router_power_supply`, `power_supply`, `fiber`, `cable`, `splice`, `splitter`,
`patchcord`, `connector`, `box`, `connection`. Compound spans mask their
components. RU/UA vocabulary is an explicit extensible dictionary.

Actions: `install`, `replace`, `remove`, `check`, `configure`, `repair`,
`restore`, `lay`, `weld`, `move`, `connect`, `measure`, plus `complete`,
`mention`, `fault`, `measurement`. Connection + explicit connect is complete.
Equipment selection alone is NOT installation. Unknown semantic IDs/keys
fail closed. Entity without action asks for clarification, preserving period.

Default category is definite. Bare object mentions and conflicting quantities
are ambiguous; negated/planned/conditional work is excluded. Events are distinct
entity/action/category combinations per ticket, not an inferred number of
physical units. Repeated sources are deduplicated. Only explicit text/preset
quantity contributes to quantity_sum; missing quantity stays null. Money uses
the existing ticket sum once per ticket, not an attributed equipment price.

Coworker filtering in semantic mode accepts only connectMasters. A same-day
shift is not proof. Legacy non-semantic calls retain their existing behavior.
The synthetic A–H fixture gives ONU install 3, ONU replace 1, ONU PSU replace 1,
router install 2, completed connection with Petya 1, ONU install with Petya in
September 1. No customer data is used in fixtures.

Periods: today/yesterday, current/previous Monday–Sunday week, current/previous
calendar month, named RU/UA month with optional year, explicit day interval,
inclusive last N days, calendar year, all time. Invalid calendar intervals
are rejected by the resolver. Calendar input is the orchestrator's supplied
Date, retaining the existing clock contract.

Signals: labelled subscriber/ONU and input values are separate; unlabelled dBm
is ambiguous. Negative money is not signal. Strict worse-than excludes the
boundary. Multiple contradictory subscriber readings are ambiguous; structured
signal wins unless legacy text proves that the same value is input-only
(the old redacted projection does not preserve signal provenance). A unique
subscriber metric is attached only to ONU/connection events, never router/PSU.

Counts, events, explicit quantity, money, groups and signal min/max/average
are computed over the entire matched set before pagination. Entity/action/
coworker/date/month groups expose separate ticket and event counts and known/
unknown quantity counts. Multi-coworker groups are intentionally non-additive.

Common acceptance questions bypass the LLM entirely. Unknown constraints or
complex wording use the existing schema-bound LLM intent parser; the model
chooses filters and formats tool facts, not arithmetic. Rules are conservative,
not general NLP: unsupported paraphrases need dictionary expansion and tests.

“Show tickets” / “Why counted” repeat a fresh READ with the original safe
semantic/date/coworker/item filters, not a wider keyword query. Existing
result-set/ordinal mechanisms receive those exact rows. Evidence includes
matched vocabulary and reason only, not surrounding customer notes. No computed
events are persisted to tickets, Sheets, snapshot, or browser storage; the
existing chat keeps only its usual whitelisted query context.

Frontend adds four quick prompts and two small evidence actions in the existing
AI UI. The 12-tool READ-only contract is unchanged in size; semantic is optional.
Provider token-budget assertions and security/privacy regressions are retained.
Worker code requires a later separately authorized release; this branch does
not deploy Worker or publish Pages.

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
are ambiguous; negated/planned/conditional work is excluded. Future/infinitive
free text is also excluded, while a performed preset-work row may use an
infinitive catalogue label. Events are distinct
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
subscriber metric is attached only when one definite ONU/connection event can
receive it, never router/PSU or several different actions. Ticket signal stats
remain available even when event association is ambiguous.

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

## Local verification and handoff

- MCP: 461/461 PASS, including 19 new semantic/period/signal/follow-up tests.
- E2E: 42/42 PASS on the final implementation; AI mock uses real Worker
  modules, a 320px viewport and a reload with the same semantic filter.
- Root: 200/201 PASS. All 24 frontend AI files PASS. The sole remaining FAIL
  is the existing timing-sensitive `network-tools-monitor.test.js:81`:
  observed average 47–48ms instead of approximately 40ms. Neither Ping code nor
  that test was modified or weakened. The failure also reproduces without
  parallel E2E load. Checked with system Node v24.21.0, bundled v24.19.0 and
  an ephemeral official v22.23.3 runtime (matching the CI's Node 22 major,
  SHA-256 checked against nodejs.org SHASUMS256). A single bundled targeted
  retry passed, but the full suites still reproduced the failure; it is not
  reported as a clean full PASS or as a proven Node-version-specific bug.
- Syntax: 93 JS files PASS (changed frontend files and all MCP src/test/scripts,
  equivalent to check.sh; Bash is unavailable). `git diff --check`: PASS.
- Version: `v91.79 · 2026-10-02`; cache: `maister-treker-v67-runtime-123`.
- No push/DRAFT PR or GitHub CI: the authorization requires all checks PASS.
  The remaining local FAIL prevents satisfying that prerequisite; no assertion
  was weakened and no new workflow/infrastructure was added to bypass the gate.
- No merge, deployment, secrets/config/bindings or production traffic changes.

## Changed files

Implementation:

- `mcp/src/ask/work-events.js`
- `mcp/src/ask/work-intent.js`
- `mcp/src/ask/smart-query.js`
- `mcp/src/ask/date-resolver.js`
- `mcp/src/ask/query-context.js`
- `mcp/src/ask/orchestrator.js`
- `mcp/src/tools/definitions.js`
- `js/ai/ai-client.js`
- `js/ai/ai-config.js`
- `js/ai/ai-ui.js`

Tests, release pins and documentation:

- `mcp/test/unit/work-events.test.js`
- `tests/ai-work-analytics.test.js`
- `tests/ai-chat-ux.test.js`
- `tests/ai-mobile-ux.test.js`
- `e2e/ai-work-analytics.spec.js`
- `e2e/tickets-compact-view.spec.js` (version pin only)
- `tests/network-tools-ui.test.js` (version/cache pins only)
- `tests/sw-upgrade-static.test.js` (pins only)
- `tests/tickets-compact-view.test.js` (pins only)
- `tests/tools-v82-field-package.test.js` (pins only)
- `tests/tools-v84-field-update.test.js` (pin only)
- `tests/tools-v85-narrow-field-fixes.test.js` (pin only)
- `app.js` (APP_VERSION only)
- `sw.js` (CACHE_NAME only)
- `docs/ai-work-analytics-v91-79.md`

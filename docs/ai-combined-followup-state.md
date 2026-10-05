# Narrow atomic combined follow-up

Based on main, independently of PRs #72–#74. No frontend version/cache bump,
storage/schema change, deployment, provider/prompt change or new write capability.

## Contract

The closed grammar accepts one existing month clause followed by one exact,
unambiguous trusted-roster coworker clause. It produces one FollowUpPatch with
REPLACE periods and REPLACE coworker/include, applies the existing reducer once,
and compiles one count query. Unspecified fields KEEP: entity, action, category,
profile, signal context, work type and other representable filters.

Unknown/ambiguous names, multiple months/names, extra constraints, unsupported
state, list/group contexts and comparisons use the entire legacy path. Neither
clause is applied partially. Input context is not mutated; failed execution does
not publish a replacement context. No fuzzy/substring lookup or roster inference.

RU/UA endings reuse coworkerForms/resolveRosterCoworker. «з Петром» is eligible
only for a uniquely resolving trusted name such as «Петр», not an inferred alias
for «Петя». The period/year uses parseTemporalWorkPeriod, not a second date parser.

## Compatibility with open PRs

Standalone period, coworker EXCLUDE/ANY and repair/comparison grammars are not
expanded by this PR. #73 still owns standalone «А со всеми?»/«А без Жени?»;
#74 still owns repair/comparison. Combined include follows their existing state
representation and must be placed before standalone period planning on eventual
integration. Integration verification must assert D1 → ANY and all prior cases.

## D3 audit: AMBIGUOUS

«А роутеры в августе?» can replace entity+period in a patch, but cannot safely
KEEP ONU-only profile=onu_physical: validateSemantic rejects that router profile.
Choosing physical_consumption versus work_v2 changes what is counted (physical
quantity versus explicit work events). A new action/profile interpretation must
be separately agreed. D3 remains legacy/fallback; no guessed profile conversion.

The live D1 failure (lost coworker + group mode + total 29) is addressed by
deterministic planning. This is not proof of the CPU/memory cause of Cloudflare
1102; its root cause remains UNKNOWN.

## Verification

- Targeted combined/period/foundation/golden: 68/68 PASS, including 100 D1 repeats.
- Full MCP: 654/654 PASS; frontend AI: 29/29 PASS; full E2E: 48/48 PASS.
- Root: 207/208; only the unchanged network-tools-monitor.test.js:81 timing
  check failed at 47 ms (expected 38–46 ms). Ping code/assertions were not changed.
- Syntax: 457/457 PASS; check.sh and diff-check PASS.
- Local replay using the real DeepSeek adapter and the existing frozen redacted
  426/171/426 Preview dataset: D1 20/20 total=1, provider calls/rounds=0, one query
  and snapshot read, no mode/filter loss, serialized reload + next September PASS.
  No Worker load series or provider payload upload was performed.
- Golden 28/20/27; legacy parity 9/9; semantic parity 18/18; event parity 426/426.
- RAM-only pending integration compatibility: D1→ANY=29, EXCLUDE=8,
  comparison=20/27, comparison→repair=7/12. No PR/source/deployment edits to #72–#74.
- Initial local E2E setup failed before the app ran because a dependency junction
  could not be copied into a temporary workspace. Ordinary locked dependencies
  resolved the setup issue; the complete rerun passed without test weakening.

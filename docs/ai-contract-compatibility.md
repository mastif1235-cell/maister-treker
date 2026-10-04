# AI contract boundary (version 1)

`ai_contract_version: 1` is a top-level /ask request and successful response discriminator, not an analytics filter. Equality is strict (integer only). The /ai/config descriptor exposes the same marker; its existing descriptor version is independent.

After ordinary authentication, request size/rate checks and JSON/question validation, but before context processing, tools, snapshot reads or provider calls, unsupported clients receive HTTP 409 with `AI_CLIENT_UPDATE_REQUIRED`. A compatible marker whose context projection would discard `coworker_exclude`, `comparison`, or `group_by` receives `AI_CONTEXT_RESET_REQUIRED`. Both errors contain only a fixed public message and server contract marker.

The client discards incompatible successful responses and controlled compatibility errors. It clears only `mtAiChatHistoryV1` and in-memory AI history/session, query context, selection and result set. There is no automatic retry. Unsupported/unversioned saved history is removed, and the first attempted continuation is stopped with the update/restart message. A compatible stored session survives reload. Tickets, shifts, settings, tokens, map and IndexedDB are untouched.

## Release / rollback requirements

The client also checks its request/response context projection before accepting critical EXCLUDE/comparison/grouping state. A guard-only older client cannot silently lose these fields even when both sides advertise version 1. Invalid critical state is stopped before network execution. Private extra fields remain subject to the existing whitelist; comparison period equality does not require preserving private/unrecognized object properties.

This PR is a guard-only artifact on main, not the #72–#75 integration. On guard-only backend code, supported version 1 does not authorize silently dropping EXCLUDE/comparison context: the boundary rejects those contexts if its existing projection cannot preserve them. When the integration projection preserves them, the same boundary passes them unchanged. It does not implement their semantics.

Before a coordinated release, prepare and verify both a new integrated Worker and a guard-preserving rollback Worker. Do not use the original unguarded production version as the only rollback target. A rollback to old analytics must preserve this boundary and refuse unsupported context. Unsupported PWA clients are denied AI only; the rest of the application remains usable. The new client receiving an old/unmarked successful response drops it and resets the AI session; it cannot retroactively prevent the old backend from computing that first response.

The release still needs a separately authorized frontend version/cache bump and coordinated deployment. This PR changes neither APP_VERSION nor service worker cache, deployment config, resources, limits, provider/model, nor production. Contract changes that alter representable context require a new integer on both endpoints, not guessed migration.

## Verification against #72–#75

Local detached verification starts from `309ca16ca27be4ebcab8c7fee972d011bc7077b1` and overlays only this guard. Existing compatible HTTP/session fixtures are given the required marker. #73/#74/#75-added fixtures will need the same mechanical update when those PRs are integrated with the guard; invalid comparison/contradictory coworker context is now refused before transport rather than silently removed from a sent request. No reducer/planner/count/cache code is changed.

Frozen redacted projection remains 426 tickets / 171 shifts / 426 search-index rows, content SHA-256 `10e2af084b0567618b90308cdaa092c7c74b5c873cf15033fd6a1b5078c7e53b`. RAM replay preserves golden 28 / 20 / 27, 140 deterministic replays, six chains, legacy parity 9/9, semantic parity 18/18 and event parity 426/426. Complete local Worker + real client boundaries additionally preserve Q1=20, Q2=27, D1=1, D2=7, D4=20/27, D5=8, D6=28, EXCLUDE reload→August=2 and missing-client-version refusal without snapshot reads. Provider/GAS egress is zero. No new Preview or Cloudflare load series is required.

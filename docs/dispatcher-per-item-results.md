# Dispatcher per-item ACK correction

Root cause: an item-level `STALE_VERSION` escaped the GAS batch loop before
`reportWrite_`. The client then assigned the one request error to every sent
operation. Equal version with different hash remains a genuine conflict.

The signed dispatcher mutation engine now returns `items`, bound to
`ticket_id`, `action`, and `source_version`. Status is `synced`, `unchanged`,
`stale_version`, `invalid_dto`, or `error`; codes use the existing safe-code
allowlist. Invalid/privacy-rejected items are never written. Valid siblings
are persisted, and the complete response is cached under the existing
request-id/payload binding. Authentication, bridge mutation denial, nonce
checks, the script lock, and the core stale/duplicate protection are unchanged.

The client validates the full set of item identities before settling anything.
Only successful exact versions receive receipts and count as acknowledged.
Rejected operations remain individually recoverable errors. Late/cached partial
ACKs use the same settlement path. Missing/duplicate/foreign item identities
leave operations unacknowledged. Legacy aggregate ACKs remain supported.

`MTDispatcherReport.retry(ticketId)` resets only that operation; it does not
change ticket ID or source version. Historical `INVALID_DTO` is not reset by
targeted or general retry. There is no automatic migration of old STALE errors:
the real conflict must not accidentally become an overwrite. A normal corrected
local edit obtains a newer operation version through the existing enqueue path.

Error diagnostics are limited to ID, date, attempts, safe error/response code,
and dispatcher channel, inside expanded card details. No DTO, note, address,
phone, token, secret or raw server body is persisted in these diagnostics.
Compact presentation is unchanged apart from its required runtime revision pin.

Candidate identity: v91.98 / runtime-143,
`maister-treker-v73-runtime-143`. A future coordinated release needs the new
dispatcher GAS source before the frontend, then runtime-proof verification.
This patch does not perform deployment, retry, rebuild, or any data mutation.
Legacy GAS/sync, shifts, Telegram transport, AI, maps, backups and storage schema
are not changed.

AUTO/MANUAL follow-up: automatic callbacks and timers use `reason:'auto'` and
check `dispatcherReportEnabled === true` before sending, including after async
projection. OFF preserves pending operations without generating errors. The
existing explicit `flush()` API is manual and snapshots its selected IDs;
`await retry(ticketId)` sends only that ID, never enabling global auto-send.
Queue retry selects failed operations (excluding historical INVALID_DTO), not
unrelated pending items. Manual continuations retain the same ID scope.
Expanded cards retain pending/error/sent state with auto-send OFF; compact
markup is unchanged. No production retry is performed by this patch.

## Lifecycle audit and corrections (v91.98)

The review follows enqueue, durable outbox, AUTO/MANUAL scheduling, lifecycle
events, signing, direct POST, server authentication and item processing, ACK,
receipts, reconciliation, restart and expanded-card diagnostics. No live
production operation or Android retry is part of this audit.

| Severity | Finding / affected function | Correction |
| --- | --- | --- |
| HIGH | AUTO could cross OFF/config/superseded-operation changes during signing (`flushBatch`, `createDirectSend`, bridge `send`) | One revocable send capability checked after every async preparation boundary and immediately before POST/RPC; generation invalidates older continuations. |
| MEDIUM | Concurrent targeted flush intent could be swallowed (`flush`) | Serialize manual scopes; retain a waiting AUTO wake-up without widening manual selection. |
| MEDIUM | Unrelated pending entries could suppress targeted report rendering (`flushBatch`) | Final-page decision uses the explicit selected scope. |
| HIGH | Bare `ok:true` could clear operations (`flushBatch`, `reconcile`) | Require complete identity-bound per-item ACK or exact nonnegative legacy counters. |
| MEDIUM | Partial ACK persisted success before sibling failure (`applyItemResults`, `completeSent`) | Settle success and errors in one outbox persistence operation. |
| HIGH | Unchanged newer content did not advance the CAS fence (`core.upsert`) | Reject lower versions first; advance version on higher-version unchanged content. Equal-version different-hash remains STALE. |
| HIGH | Runtime verification allowed sending before SW proof or after timeout (`checkServiceWorker`) | Fail closed until identity ACK; verify replacement controller; recover on focus and notify dispatcher readiness. |
| MEDIUM | Failed outbox persistence did not suppress transmission (`persist`, `flushBatch`) | Require durable metadata before sending; avoid zero-delay quota failure loop. |
| MEDIUM | Manual full-sync could spin on a no-progress flush (`syncAll`) | Stop on unchanged progress and report incomplete, never infer success. |
| MEDIUM | New row at server capacity could reject valid siblings (`reportExecute_.applyItem`) | Reject only capacity-exceeding items before modifying the store. |

Regression coverage includes real direct-signing cancellation, rapid OFF/ON,
endpoint/key changes without logging credentials, superseded edits, concurrent
manual retries and AUTO arrivals, missing ACK counters, quota failure, monotonic
version fence, mixed invalid/stale/upsert/delete items, server capacity, SW
timeout/controller replacement, and the exact redacted six-operation Android
fixture. Existing authentication/replay, privacy, missing lookup, 434-ticket,
lost ACK, lifecycle, compact UI and legacy tests remain active.

The Android fixture confirms targeted retry of the two absent-server IDs
preserves their IDs/versions and creates one row each. The real STALE operation
and all three historical INVALID_DTO operations remain metadata-equivalent.
This is a deterministic regression, not a claim of a physical Android test.

Operational limits: OFF prevents requests that have not yet been dispatched;
it cannot retract an already dispatched authenticated POST. At server capacity
or local quota exhaustion, affected data remains explicitly unresolved; no
silent-success fallback is used. A later coordinated rollout must deploy the
updated dispatcher GAS before the new frontend. Production is unchanged here.

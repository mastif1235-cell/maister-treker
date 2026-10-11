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

Candidate identity: v91.97 / runtime-142,
`maister-treker-v72-runtime-142`. A future coordinated release needs the new
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

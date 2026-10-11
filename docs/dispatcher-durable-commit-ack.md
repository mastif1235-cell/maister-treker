# Dispatcher durable commit ACK — v91.99 / runtime-144

Candidate only. No production deployment, queue retry, rebuild or real-ticket
reconciliation has been performed as part of this patch.

## Root cause and write boundary

The previous mutation engine wrote `_DispatcherData`, then rendered `Отчет`,
updated properties and finally cached its ACK. A render/property exception could
therefore report failure for a committed ticket, leaving no local receipt.
CacheService alone cannot be a durable receipt store.

The new separate hidden `_DispatcherReceipts` sheet stores only request ID/hash,
exact redacted per-item results, ID/version/hash/status/deletion evidence, state
and timestamp. It contains no ticket content, notes, address, MAC or secret.
It does not change `_DispatcherData` or frontend storage schemas.

Under the existing script lock:

1. Validate/authenticate request; replay an identity-bound durable receipt.
2. Compute independent item outcomes with existing validation/stale fences.
3. Write and flush PREPARED receipt/evidence before changing stored tickets.
4. Write and flush `_DispatcherData`. A failed write/flush gives NO success ACK.
5. Mark receipt COMMITTED; cache is only an optional acceleration.
6. Property updates, safe error logging and visible rendering are best-effort.
   A render error logs `REPORT_RENDER_FAILED`, not payload or exception text,
   and does not change successful item statuses. A later render/rebuild repairs
   presentation. Explicit rebuild still reports a rendering failure honestly.

Sheets does not provide a transaction across the two SpreadsheetApp writes.
The PREPARED record closes that recovery gap: after interruption, exact persisted
evidence can confirm the original ACK without another ticket write. If the data
write did not persist, the same bound request can resume only originally successful
items, using unchanged stale fences. A newer/conflicting state fails closed with
`REPORT_COMMIT_UNRESOLVED`; it never receives an invented ACK or overwrite.
Originally rejected siblings retain their exact original results.

Journal creation/prepare failures occur before ticket writes. Durable receipts
have no cache TTL and are never silently evicted. At 100,000 requests the journal
fails closed with `REPORT_RECEIPT_CAPACITY`; maintenance/retention is a separate
future operation, not automatic deletion. A COMMITTED receipt stays authoritative
even if a later legitimate request changes its ticket.

HMAC verification, request-body binding, replay nonce, bridge mutation denial,
same-version/different-hash rejection and per-item identity checks remain active.
Existing pre-upgrade CacheService receipts still have their original short TTL;
only new candidate requests gain durable journal receipts.

## Existing physical orphan: proposed explicit recovery, NOT executed

Ticket `ab60a3df-c5c4-4927-8ee8-7bea835fbd2c`, version `1791703794130`:

- A deliberate operator call to `outbox.reconcileStored(ticketId)` is allowed
  only for an upsert currently marked `REPORT_INTERNAL_ERROR`.
- Project the actual local ticket using the exact queued version. Never invent
  its hash from the supplied incident description.
- Send signed **read-only** `report_receipt` with exact ticket_id/source_version/
  source_hash. This is an HTTP POST read query, NOT a mutation POST.
- GAS reads and validates the store. It confirms only an active row with exact
  ID, version, content hash and `sync_status === SYNCED`; otherwise mismatch.
- Client checks every response field and re-projects after the asynchronous
  query. Endpoint/generation, ticket content and exact queue operation must still
  match. Only then persist its local receipt and remove that exact operation.
- Storage failure leaves the operation recoverable. No new version, enqueue,
  mutation, global retry or AUTO setting change occurs. The method is not wired
  into startup/lifecycle/retry; operator approval/use is a later separate step.

ID/version alone is NEVER sufficient. A changed projection/hash needs review,
not overwrite or optimistic completion. The real STALE_VERSION, both earlier
false-positive items and historical INVALID_DTO operations are untouched.

## Release / rollback

Review/CI first. A later separately authorized coordinated rollout must publish
the dispatcher GAS candidate before using `report_receipt` from the new client.
Keep existing Web App URL, properties/secret and private spreadsheet permissions.
Frontend candidate: v91.99 / runtime-144 / maister-treker-v74-runtime-144,
runtime-proof eight assets. No Worker/AI/legacy/Telegram/maps/backup changes.

Rollback points: frontend main before this patch; current dispatcher GAS v12.
Do not delete the new receipt journal or any outbox/user data on rollback.
Old GAS cannot provide the new durable/reconcile guarantees: pause dispatcher
sending before such a rollback, and never replay historical errors blindly.

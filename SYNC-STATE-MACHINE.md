# Sync v3 state machine proposal

Status: design only. Implementation is paused because the Stage 3 application contract needs the minimal extension described below. The HMAC v3 canonical envelope and existing vectors do not change.

## Why a single pending flag is insufficient

The current persisted model has `ticket.synced`, optional `ticket.syncAction`, and `deletedTickets[].pendingCloudDelete`. Shifts have no persisted sync state. It has no stable request ID, revision, immutable attempted payload, or shift tombstone.

One entity can require two distinct immutable operations at once: an attempted create whose response is unknown, followed by an edit or delete made while that create is in flight. Replacing the single pending payload would reuse a request ID with a different body; dropping the first operation would allow update to overtake create. Therefore the required invariants cannot be implemented reliably with only extra scalar fields.

The minimal sufficient model is a **bounded per-entity journal**, not an unbounded global event log. Each entity keeps at most:

- one immutable attempted/in-flight head operation;
- one unattempted tail operation, coalesced to the newest state;
- a durable tombstone when deleted.

## Persisted entity state

```text
entityType: ticket | shift
entityId: stable ID
revision: monotonic positive integer
ackedRevision: highest server-confirmed revision
tombstone: boolean
head: immutable attempted operation or null
tail: coalesced unattempted operation or null
```

An operation contains `requestId`, `action`, `revision`, exact signed body, state (`pending|syncing|retryable`), attempts, createdAt and lastAttemptAt. `requestId` and body become immutable at the first attempt. A retry preserves requestId/body and creates a fresh timestamp, nonce and signature.

## Client transitions

| Event | Transition |
|---|---|
| create | revision 1; create operation becomes head/tail |
| edit before first attempt | coalesce into the unattempted operation; no network history exists yet |
| edit after head attempted | increment revision; create/replace unattempted update tail |
| rapid edits | increment revision; coalesce only the unattempted tail to latest snapshot |
| delete before any attempt | remove unsent create/update and retain a local tombstone; no server mutation is needed |
| delete after any attempt | increment revision; discard unattempted update tail; enqueue delete behind immutable head |
| send | per-entity scheduler moves one operation to syncing; no second mutation for that ID starts |
| readable success | compare returned entity/revision/deleted state, ack exact operation, then advance tail |
| opaque/lost response | bounded signed state verification; otherwise mark retryable without blocking UI |
| retry | same requestId/body/revision, new timestamp/nonce/signature |
| restart | load journal after storage/UI init; start one recovery loop if online, otherwise wait for online |

`synced` is derived: no head/tail, no unacknowledged tombstone, and server-confirmed revision equals local revision.

## Delete-wins rules

- A local tombstone prevents creation of any later update operation for the same ID.
- Delete removes/coalesces every unattempted update.
- If create/update is already attempted, delete waits behind it; the server revision gate then applies delete last.
- The server permanently records the highest revision and deleted state for that entity ID. Once deleted, add/update for that ID is rejected; recreation requires a new ID.

## Minimal required Stage 3 server extension

The cryptographic envelope remains byte-for-byte unchanged. The application contract needs:

1. Require positive integer `revision` for every ticket/shift mutation.
2. Add `updateShift` (or explicitly rename create/update to one documented upsert action; separate `updateShift` is clearer).
3. Add signed GET `getEntityState` for both tickets and shifts, returning `{entity,id,revision,deleted}` and optionally the current payload needed for verify.
4. Store durable server state per entity: latest revision, deleted flag and last mutation fingerprint. A hidden `_SyncState` sheet is the scalable option; Script Properties are not suitable for an unbounded entity/tombstone registry.
5. Under the existing ScriptLock, reject stale revisions, make same-revision/same-fingerprint replay a no-op success, reject same-revision/different-fingerprint, and make tombstone reject all later add/update.
6. Define explicit full-sync semantics for rebuilding entity state; full sync remains admin-only and never repairs a single operation.

These additions make exact replay and retry safe even after nonce cache and request-id idempotency records expire. HMAC canonicalization, UTF-8 encoding, base64url and the Stage 3 vectors remain unchanged.

## Bounded verification policy proposal

- Initial settle delay: 250 ms.
- Up to three signed `getEntityState` reads with short backoff (250/500/1000 ms).
- Per-read timeout: 2500 ms; total foreground budget: at most 5 seconds.
- If state is not proven, leave operation retryable and continue in the single background recovery loop.

Final timings must be validated against an isolated Apps Script Web App. CORS/readable POST versus opaque `no-cors` remains `UNKNOWN` until that test deployment exists.

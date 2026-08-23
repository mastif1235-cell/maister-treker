# Production Gate 1: isolated GAS + TEST Sheet

Status: **PASS** on TEST deployment version 2. Production GAS, Sheets, endpoint and secrets were not accessed or changed.

## Isolated environment

- TEST Apps Script project: `19YiV-UTVeK_gYAGtW8X9-1TFAoCba-myXbHXoRZvEEFAiyB5pAP-jUBq`
- TEST Sheet: `1xUYqJ7_yiKRiYpDU8A0bG4WbxVpJoOD3S3SCuDoSACw`
- TEST deployment ID: `AKfycbwSWffEybJ27YMJ3jJJNbhyCbXWMwgvQerHlx6uldtQ441Cqhi3DH-mMEokOssBdRdb`
- Secret exists only in TEST Script Properties as `MT_SYNC_HMAC_SECRET`; its value is not stored in the repository, URLs, test output or this report.

## Correctness defect found and fixed

Deployment version 1 exposed a real ticket-only failure. `addTicket` wrote the visible row, then called nonexistent Sheet API `setRowHeightsAuto`, returned generic `SERVER_ERROR`, and never wrote the entity revision to `_SyncState`. Shift mutations were unaffected. This is a dangerous partial-apply state because retries keep seeing revision zero.

The minimal fix replaces it with supported `sheet.autoResizeRows(rowIndex, 1)`. A static regression guard rejects the old method and requires the supported call. The canonical browser copy was regenerated from `Code.gs`. TEST deployment version 2 contains the fix. The first run's orphan TEST row remains as an explicit test artifact; no destructive cleanup was performed.

## Real GAS contract matrix

Version 2 passed 20/20 sequential live checks:

- unsigned request rejected;
- malformed signature, expired timestamp, modified body and wrong key rejected;
- reused nonce rejected;
- oversized payload rejected;
- ticket create/update/delete and tombstone;
- lost-response retry with stable requestId;
- same revision/same fingerprint;
- same revision/different fingerprint conflict;
- requestId collision;
- delayed stale create;
- signed entity-state read;
- shift create/update/delete parity;
- full sync remains closed with `ADMIN_RECOVERY_REQUIRED`.

## Browser CORS and transport decision

- Simple POST using `Content-Type: text/plain;charset=utf-8` is readable cross-origin. Four browser mutations passed with `response.type === "cors"` in 2925–4971 ms.
- The response exposes `Access-Control-Allow-Origin: *`.
- A forced preflight using `application/json` failed in 220–243 ms. Direct OPTIONS returned HTTP 500 without CORS headers. Production must keep the request simple and must not add JSON content type or custom headers.
- Opaque `no-cors` mutation plus signed verification worked, but took 4691–7698 ms and provided no mutation response. It is unnecessary and has been removed from the runtime.
- A readable POST was deliberately aborted after 1014 ms. Signed `getEntityState` recovered the applied revision in 3376 ms, and retrying the same requestId returned the stored success.

Production transport decision: one readable CORS POST path. Signed `getEntityState` is retained only for timeout/lost-response recovery. Evidence-based bounds are 8000 ms for POST, 4000 ms per state read, and two reads after 300/900 ms delays.

## Targeted regression

- JavaScript syntax: PASS.
- GAS static/source parity: PASS.
- HMAC client/server vectors and negative/idempotency/revision tests: PASS.
- Sync transport: PASS.
- Sync state machine/journal/runtime recovery: PASS.
- Runtime single-owner/no URL secret/no opaque path gate: PASS.
- `git diff --check`: PASS.


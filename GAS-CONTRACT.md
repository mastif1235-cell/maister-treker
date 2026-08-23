# Canonical Google Apps Script contract (test candidate)

This document describes `Code.gs` in branch `agent/security-stability-v66`. It is not a production deployment instruction. Production GAS must not be changed until the isolated contract and later client cutover pass their gates.

## Server ownership

`Code.gs` is the only canonical GAS implementation and contains exactly one `doGet` and one `doPost`. The old append-only security.18 patch files were removed because they redefined entrypoints/auth helpers and required hardcoded secrets.

Required Script Property:

- `MT_SYNC_HMAC_SECRET`: at least 32 UTF-8 bytes, generated randomly and never committed.

The server stores each successful mutation in a small `MT_SYNC_IDEM_<request hash>` Script Property. Records are bounded to 256 entries and seven days, avoiding the per-property size limit. Nonces are stored only in Script Cache for ten minutes.

## Envelope

Version: `3`. HMAC: SHA-256. Text encoding: UTF-8. Signature encoding: unpadded base64url.

Every signed request has:

- `v`, `method`, `action`, `entity`, `id`, `ts`, `nonce`, `requestId`, `body`, `sig`;
- `method` is uppercase `GET` or `POST`;
- mutation `requestId` is stable across retries; GET uses an empty request ID;
- POST `body` is the exact JSON string that is parsed after signature verification;
- outer action/entity/id must match the signed body.

Canonical form is the fixed prefix `MT-SYNC-HMAC-V3` followed by nine newline-separated fields. Every field is encoded as `<UTF-8 byte length>:<exact value>` in this order:

```text
version
method
action
entity
id
timestamp
nonce
requestId
body
```

This length-prefixing removes separator ambiguity and makes Unicode byte handling explicit. Deterministic examples and expected signatures are in `tests/fixtures/sync-contract-v3-vectors.json`.

## Security and correctness

- Timestamp window: ±5 minutes.
- Nonce: 16–128 base64url-compatible characters; replay check is atomic under ScriptLock and stored in CacheService.
- Mutations run under ScriptLock after authentication and schema validation.
- Constant-time signature comparison includes differing lengths.
- Request limit: 2 MiB; signed body limit: 1.5 MiB; batch limit: 5000 entities.
- Errors expose only stable generic codes.
- A repeated mutation with the same request ID and same semantic payload returns its previous result without executing again, including an exact replay after a lost response. Reusing a request ID with different action/entity/id/body is rejected.
- Ticket add/update/delete and shift add/delete are idempotent by stable entity ID. `addShift` updates an existing matching ID instead of duplicating it.
- `syncAll*` remains an explicit bulk/admin action. It is not an incremental repair mechanism.

## Tests

Run:

```text
node tests/gas-contract.test.js
node tests/gas-static.test.js
```

The first suite independently calculates every vector through the future browser client implementation and the GAS implementation executed with Apps Script mocks. It also covers malformed signatures, expired timestamps, replayed nonces, modified bodies, wrong keys, oversized bodies, exact lost-response retry, retry with a fresh nonce, and request-ID collision.

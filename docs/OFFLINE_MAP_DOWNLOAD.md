# One-region offline map (v91.76): PRIVATE R2

BACKEND SIGNER REQUIRED: YES. AUTH REQUIRED: YES. PRODUCTION CONNECTION: BLOCKED
until the owner approves a signer and a server-side map entitlement mechanism.
This PR implements only the client interface and isolated test mocks. No R2
resources, backend, production Worker or Apps Script have been created/deployed.
`js/offline-map-catalog.js` intentionally keeps `manifestUrl` empty and no URL
provider configured. Download stays disabled. Installed/manual maps remain usable
without a manifest, signer or network. Release remains v91.76 / runtime-120.

## Access model and provider contract

A secret-free manifest may be public. It contains map id/title/version,
`downloadId` (opaque immutable object identity), size, SHA-256, native/display
zooms, source/license/attribution, build and timestamp. It contains **no PMTiles
URL**, signature or credentials. `file`, `url` and `downloadUrl` are rejected.
The derived local filename is only a display label, not an object URL.

PWA → authenticated, entitled signer → temporary signed GET URL → PRIVATE R2
object → dedicated browser Worker → inactive OPFS slot.

The separately approved integration supplies
`getOfflineMapDownloadUrl(mapId, version, {downloadId, sha256, size, signal})`.
It must obtain a fresh grant on every Start/Resume/expiry retry. The promise
returns `url`, `expiresAt` (ISO UTC), optional strong quoted `etag`, and mandatory
echoed identity: `mapId`, `version`, `downloadId`, `sha256`, `size`.
All identity fields must match the manifest. The provider must honor cancellation,
use `credentials:'omit'`, no-store and no redirects, and reject authorization
errors. Provider errors are mapped to a fixed code, never shown with secret URLs.
This is an injectable interface, **not an anonymous deployed signer endpoint**.

Permanent manifest URLs remain strict HTTPS without query, username/password or
fragment. Signed download URLs allow query parameters but still reject non-HTTPS,
username/password and fragments. HTTP loopback is allowed only for local fixtures;
`r2.dev` is rejected. Actual approved origins must be explicitly allowed by CSP.
The client accepts grants with 5 seconds to 30 minutes remaining; the signer
should issue short 10–30 minute GET grants. R2 presigned URLs use the **S3 API
endpoint**, not a public custom-domain URL.

## Resume and persistence

- Journal identity is `mapId/version/downloadId/sha256/totalSize`, with ETag or
  Last-Modified HTTP validators. Exact temporary URL/query is never identity.
- URL/expiry and authentication exist only in memory. The URL is passed separately
  to the browser Worker, not included in manifest/page state/journal/active meta.
  Journal writes allowlist metadata fields; URL/token/credential fields are dropped.
  No presigned URL is written to localStorage, IndexedDB, backups or SW caches.
- Resume re-fetches the manifest and obtains a **new** signed URL. Changed signatures
  do not invalidate flushed partial bytes. Changed object/version/hash/size is
  refused before appending. ETag checks remain in the provider/HTTP path.
- Pre-private PR journals are read without exposing their old URL, then rewritten
  with `downloadId` only after an exact map/version/hash/size match. Final SHA-256
  remains mandatory. No OPFS format or slot change is needed.
- Expired grant or GET HTTP 403 triggers **one** fresh-grant retry per user action.
  R2 403 may also mean access denied/signature invalid; repeated denial pauses
  safely and preserves the checkpoint, never marks the archive broken and never
  loops forever. Signer denial does not retry. A later Resume can try after login.
  Expiry normally affects a subsequent request, not bytes already streaming.
- Fetch remains `credentials:'omit'`, no-store, redirect:error; object GET also
  uses no-referrer. Do not log signed URLs or include them in diagnostics/analytics.
  They are bearer capabilities: anyone holding one can use it until expiry.
  Private R2 + signer does not prevent an entitled downloader from copying the
  offline archive or sharing a still-live grant; this is access control, not DRM.

## Existing downloader safety (unchanged)

- Bounded manifest: 32 KiB. Streaming fetch body → browser Worker → inactive
  `map-a.pmtiles` / `map-b.pmtiles` SyncAccessHandle, no whole-file page buffer.
- Durable flush/checkpoints every 200 ms; Stop/offline abort and release writer.
  Reload resumes only flushed bytes, truncating an unjournalled crash tail.
- Range/206 exact Content-Range and preserved ETag/Last-Modified; wrong responses
  never append. Existing cross-tab exclusive Web Lock covers transfer/import/delete.
- Quota gate max(size × 1.25 + 250 decimal MB, 300 MB): 392,759,075 bytes for
  this archive. persist() remains best effort; Android may suspend background work.
- Unchanged streaming SHA-256 second pass, exact size, v3/MVT sections/zoom/bounds,
  bounded metadata/directories, roads/buildings/places and sample-tile checks.
- Atomic active metadata publication after verification; failed update keeps old
  slot. Confirmed deletion/manual import/MapLibre remain unchanged. Native Z0–15
  display overzoom Z18; overzoom cannot add missing source OSM building coverage.
- No tickets/DB/sync/backup/Ping/Speedtest/Apps Script/mcp changes. PMTiles archive
  and A/B storage format are untouched; clearing browser data can still evict maps.

## Signer choices — design only, separate owner approval required

A. Existing project Cloudflare Worker: possible only after explicit permission
to add a route and a distinct map entitlement policy; no change in this PR.
B. Separate minimal Worker: isolates map authorization/rate limiting and R2 signing;
new resource/deployment requires separate permission, not performed here.
C. Another secure HTTPS endpoint: same authentication/entitlement and GET contract.

Existing MCP/ask bearer authentication has a read scope for its current APIs,
**not a map entitlement**. The app's local lock is also not server authentication.
No existing token, sync HMAC or Telegram secret is silently repurposed. Minimal
safe option: owner-provisioned, revocable per-user/device map credential or a
server-verified login issuing a short-lived map-scoped access token. The signer
must verify that principal's entitlement to the requested allowlisted map/version.
No R2/admin secrets or shared hardcoded credential may ship in frontend config.
Choosing/provisioning this auth is a production blocker, not bypassed with CORS.

## Owner setup and acceptance checklist (after separate approval)

```text
1. Keep the map R2 bucket PRIVATE: r2.dev and public custom domains disabled.
   Do not expose the PMTiles object permanently. The manifest may be hosted
   separately on a public HTTPS origin; it contains only non-secret metadata.

2. Agree and provision server-side authentication + map entitlement first.
   Signer must reject unauthenticated/unentitled clients (401/403), rate-limit,
   and accept only an allowlisted mapId/version/downloadId mapping. Never let
   the client choose arbitrary bucket/key/method/expiry. Sign GET only, with
   10–30 minute lifetime and read-only scoped R2 credentials stored server-side.
   Return matching identity, optional exact quoted ETag, ISO expiresAt and URL.
   Return no-store. Do not log the signed URL; never expose R2/admin credentials.
   Implementation/deployment is a SEPARATE task; this PR does not create it.

3. Upload the already prepared archive privately, without rebuilding:
   C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\offline-map-research-20260930\dnipro-oblast-z0-15.pmtiles
   Private key: dnipro/2026-09-30/dnipro-oblast-z0-15.pmtiles
   downloadId: dnipro-oblast-2026-09-30 (server allowlist maps it to this key)
   Size: 114207260 bytes
   SHA-256: 4ebb26c99a51407dab3a1d45cdfaef9f2d176003a1bdb19579caa1d9001877da
   Content-Type: application/octet-stream; Cache-Control: private, no-store
   No outer Content-Encoding/compression/redirect/challenge.
   ETag must remain stable; it is not the SHA-256 hash.

4. Private bucket CORS (this is browser access control, NOT authorization):
   AllowedOrigins: https://mastif1235-cell.github.io (exact origin, no path)
   AllowedMethods: GET, HEAD
   AllowedHeaders: Range, If-Match, If-Unmodified-Since
   ExposeHeaders: ETag, Content-Range, Content-Length, Last-Modified,
                  Accept-Ranges, Content-Encoding
   The signer has its own exact-origin CORS policy for its auth header.
   Never enable public bucket access as a workaround for CORS.

5. Publish docs/offline-maps/dnipro-oblast/manifest.json on the approved public
   HTTPS host with application/json and no-store. No PMTiles URL or secret.
   New version: upload NEW immutable private object first; verify hash/size,
   update server allowlist, then publish new manifest last. Do not overwrite
   immutable objects. Do not add etag unless it is the actual quoted HTTP ETag.

6. Implement the separately authorized client provider with runtime map-scoped
   authentication, not R2 credentials. Set manifestUrl. Allow exactly the
   manifest, signer and account R2 S3 HTTPS origins in connect-src in BOTH
   index.html and _headers. No wildcard. Coordinate a later release/cache bump
   for this setup: installed shell assets do not reliably update without it.
   No production endpoint is configured or fabricated in this PR.

7. From actual PWA origin check: unauthorized signer denied, authorized signer
   issues short-lived GET, permanent unsigned object URL denied. GET 200 has
   correct size/ETag; Range with If-Match yields 206/exact Content-Range. Stale
   ETag rejects changed object. Fresh signature resumes same checkpoint. Expired
   GET 403 renews once; repeated denial pauses without broken. Journal/meta/cache
   contain no signed URL/token. CORS exposes necessary response headers.

8. PHYSICAL ANDROID (not tested by Codex): real 114 MB download, responsive UI,
   Stop/reload/Resume, background/foreground, close/reopen, fresh grant after
   expiry, integrity/Ready. Airplane-mode reopen/MapLibre pan/zoom Z16–18:
   Дніпро, Кам’янське, Павлоград, Кривий Ріг, Нікополь, Таромське, Царичанка,
   Васильківка; attribution and local markers. Failed/interrupted update keeps
   old map; successful update switches slots. Discard/delete/manual import work;
   tickets/photos/settings are untouched. No deploy or merge without approval.
```

Official references: [R2 presigned URLs, bearer capabilities and S3-only endpoint](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).
Tests use local authenticated mocks, not live R2 or a deployed production signer.

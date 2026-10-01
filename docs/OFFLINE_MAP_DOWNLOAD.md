# One-region offline map (v91.76): PRIVATE R2

BACKEND SIGNER IMPLEMENTED: YES. AUTH REQUIRED: YES. PRODUCTION SETUP: NOT DEPLOYED.
The existing Worker now has an isolated map-only route and the PWA has an
authenticated provider. No Worker deploy, R2 creation, secrets provisioning or
Apps Script changes have been performed. `manifestUrl` remains empty until the
owner completes private R2/CSP setup. Download stays disabled meanwhile.
Installed/manual maps remain usable without a manifest, signer or network.
Release remains v91.76 / runtime-120; PR #61 MUST NOT MERGE without owner approval.

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
The implementation is POST /offline-map/grant on the existing Worker, not an
anonymous endpoint. MAP_BEARER_TOKENS is mandatory and has no MCP/ASK fallback.

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
- A CORS-masked network error can also renew ONCE, only when online, partial
  bytes exist and the current grant is within 30 seconds of expiry. Otherwise
  pause. A second failure pauses without marking integrity broken.
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
- No tickets/DB/sync/backup-schema/Ping/Speedtest/Apps Script changes. PMTiles archive
  and A/B storage format are untouched; clearing browser data can still evict maps.

## Implemented signer and owner access

The existing Worker uses the existing bearer verifier with a SEPARATE
MAP_BEARER_TOKENS pool. It rejects overlapping MCP/ASK credentials in map config.
Only the code-owned dnipro-oblast/2026-09-30 catalog entry can be signed; all five
client identity fields must match, and unknown input keys are rejected. Small
JSON input is streamed with a 2048-byte cap. SigV4 GET uses pinned aws4fetch,
TTL 900 seconds and host-only signed headers, not fixed Range. There is no R2
download proxy or GAS/AI dependency. Missing map configuration/binding fails
closed only for the map route. Native limiter: 6/60 seconds per client/map,
per-location best effort, 429 + Retry-After: 60. No D1/new Worker/new DB.

Each phone has a separately revocable owner-provisioned map token. UI never
echoes it after entry. It is kept outside settings in a separate AES-GCM record
using the existing IndexedDB vault key; unavailable vault means session memory
only, never plaintext fallback. No token is imported/exported/backed up/synced.
The app's local lock and CORS do not authorize downloads. Theft/XSS can expose
a usable client credential; revocation blocks future grants, not installed
OPFS bytes or already-issued URLs before expiry. This is not DRM/device binding.

## Owner setup and acceptance checklist (after separate approval)

```text
1. Keep the map R2 bucket PRIVATE: r2.dev and public custom domains disabled.
   Do not expose the PMTiles object permanently. The manifest may be hosted
   separately on a public HTTPS origin; it contains only non-secret metadata.

2. Provision the separately approved map-only authentication.
   Signer must reject unauthenticated/unentitled clients (401/403), rate-limit,
   and accept only an allowlisted mapId/version/downloadId mapping. Never let
   the client choose arbitrary bucket/key/method/expiry. Sign GET only, with
   10–30 minute lifetime and read-only scoped R2 credentials stored server-side.
   Return matching identity, optional exact quoted ETag, ISO expiresAt and URL.
   Return no-store. Do not log the signed URL; never expose R2/admin credentials.
   Code is implemented in this PR; provisioning/deployment remains manual and
   requires separate permission. Native rate-limit binding is required.

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

6. The provider is already implemented with runtime map-scoped authentication,
   not R2 credentials. Set manifestUrl. Allow exactly the
   manifest, signer and account R2 S3 HTTPS origins in connect-src in BOTH
   index.html and _headers. No wildcard. Coordinate a later release/cache bump
   only if this PR has already shipped. Before its merge, keep v91.76/runtime-120.
   Provider uses the existing production Worker origin; no new Worker.

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

9. Exact manual setup (OWNER ONLY, AFTER separate provisioning/deploy approval).
   This is not an instruction to Codex to execute any of these operations now.
   Open Cloudflare Dashboard -> R2 -> Create bucket, name maister-offline-maps,
   Standard storage. Keep public r2.dev and public custom domains DISABLED.
   R2 -> Manage API tokens -> Create Account API token -> Object Read Only,
   restrict ONLY to maister-offline-maps. Save Access Key ID/Secret Access Key
   privately. These credentials sign/download; they CANNOT upload the archive.
   Upload uses the owner's Cloudflare login permissions instead.

   In the EXISTING mcp/wrangler.toml, preserve ALL current Worker/KV/GAS/AI
   settings. Under its EXISTING [vars] add:
     R2_ACCOUNT_ID = "<actual non-secret 32-hex account ID>"
     R2_BUCKET = "maister-offline-maps"
     MAP_SIGN_TTL_SECONDS = "900"
     MAP_ALLOWED_ORIGIN = "https://mastif1235-cell.github.io"
   Add a top-level binding (not inside [vars]); namespace 1061 must be unused
   by other rate limit bindings in this account, otherwise choose another:
     [[ratelimits]]
     name = "MAP_GRANT_RATE_LIMIT"
     namespace_id = "1061"
     simple = { limit = 6, period = 60 }
   Wrangler >=4.36 is required. Missing binding disables map signing.
   No R2 bucket binding is necessary: signing does not fetch/proxy the file.

   Generate TWO independent high-entropy credentials privately (at least
   32 random bytes each, base64url without padding). Never reuse MCP/ASK.
   MAP_BEARER_TOKENS secret format (placeholders, NOT literal credentials):
     phone-a:<phone A token>:read;phone-b:<phone B token>:read
   Each phone's UI receives only its bare token, not the entire pool.
   Revoke a lost phone by removing its entry from this Worker secret.
   Never store these values in files/config/manifest/screenshots/logs.

   PowerShell commands below are for the owner AFTER approval, from this repo:
   rtk proxy npx wrangler@4 secret put MAP_BEARER_TOKENS --config "C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\audit-main-v91-48\mcp\wrangler.toml"
   rtk proxy npx wrangler@4 secret put R2_ACCESS_KEY_ID --config "C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\audit-main-v91-48\mcp\wrangler.toml"
   rtk proxy npx wrangler@4 secret put R2_SECRET_ACCESS_KEY --config "C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\audit-main-v91-48\mcp\wrangler.toml"
   rtk proxy npx wrangler@4 r2 object put "maister-offline-maps/dnipro/2026-09-30/dnipro-oblast-z0-15.pmtiles" --remote --file "C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\offline-map-research-20260930\dnipro-oblast-z0-15.pmtiles" --content-type "application/octet-stream" --cache-control "private, no-store" --config "C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\audit-main-v91-48\mcp\wrangler.toml"
   rtk proxy npx wrangler@4 r2 bucket cors set maister-offline-maps --file "C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\audit-main-v91-48\mcp\offline-map-r2-cors.json" --config "C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\audit-main-v91-48\mcp\wrangler.toml"
   rtk proxy npx wrangler@4 r2 bucket cors list maister-offline-maps --config "C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\audit-main-v91-48\mcp\wrangler.toml"
   rtk proxy npm ci --prefix "C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\audit-main-v91-48\mcp" --ignore-scripts
   rtk proxy npx wrangler@4 deploy --config "C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\audit-main-v91-48\mcp\wrangler.toml"

   Enter secret values only at Wrangler's private interactive prompt.
   Verify uploaded object's size/hash/key and stable ETag. Do not overwrite
   versioned objects. Do not set Content-Encoding for the PMTiles archive.

10. Public manifest publication uses the EXISTING GitHub Pages deployment,
    not R2 public access: docs/offline-maps/dnipro-oblast/manifest.json is already
    in this PR. After separately approved merge/Pages deployment it is served at
    https://mastif1235-cell.github.io/maister-treker/docs/offline-maps/dnipro-oblast/manifest.json
    Before enabling downloads, set this exact URL as manifestUrl. Both CSP
    connect-src lists already allow the owner-approved exact S3 origin:
    https://a1e94c2f68447a4f7874830c42a513e8.r2.cloudflarestorage.com
    Never invent an account ID or use *.cloudflarestorage.com. This exact-origin
    setup is mandatory; a valid signature alone cannot bypass browser CSP.

11. Live checks MUST run after setup: missing/wrong MCP/ASK token denied;
    each authorized phone can grant only the catalog map. Browser GET/Range/
    If-Match/CORS, actual expired URL and airplane-mode Android acceptance.
    Current status: REAL R2 NOT TESTED; PHYSICAL ANDROID NOT TESTED.
```

Official references: [R2 presigned URLs, bearer capabilities and S3-only endpoint](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).
Tests use local authenticated mocks, not live R2 or a deployed production signer.

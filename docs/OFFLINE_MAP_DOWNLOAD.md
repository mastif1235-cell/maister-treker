# One-region offline map (v91.76)

R2 SETUP REQUIRED: YES. No bucket/domain/backend has been created. Production
`js/offline-map-catalog.js` deliberately has an empty `manifestUrl`. Download is
disabled with an honest message until the owner configures public hosting.
An already installed/manual map keeps working without a manifest or network.

## Implementation / safety

- Public manifest (at most 32 KiB, no-store, no credentials/redirects) specifies
  identity/version, size, relative file on the same origin, native/display zoom,
  attribution and mandatory SHA-256. No r2.dev or third-party bulk tile sources.
- fetch body → dedicated **browser** Worker → SyncAccessHandle on the inactive
  existing OPFS slot (`map-a.pmtiles` / `map-b.pmtiles`). No whole-file blob,
  staging file, second installed copy or file bytes on the main thread.
- Worker flushes and reports durable checkpoints at most every 200 ms (plus
  initial/final checkpoints); page stores only the small journal. Progress
  updates the card's text/progress nodes, never remounts the map.
- Stop/offline abort the current fetch, flush and close. Reload restores paused
  state. Background/browser termination may lose the uncheckpointed tail only;
  resume truncates that tail and re-downloads from the last flushed checkpoint.
- Resume re-fetches manifest; version/hash/URL/size must match. Range response
  must be 206 with exact Content-Range start/end/total and preserved ETag (or
  Last-Modified when available). HTTP 200, wrong range or changed object never
  appends. User can delete the incomplete download and restart explicitly.
- Quota gate: max(size × 1.25 + 250 decimal MB, 300 MB). For this file:
  **392,759,075 bytes**, about 393 MB (aim for at least 400 MB free). This reserve
  covers browser housekeeping, not a temporary second full archive. Browser
  estimates are approximate, not a guarantee of actual free disk. persist()
  denial/error is non-fatal; OS/browser can suspend a background task.
- Integrity: exact size, streaming SHA-256 second pass in 256 KiB chunks in the
  worker (also safe after resume), v3/MVT header and zoom/bounds, ordered section
  offsets/extents, readable bounded metadata and all directories, compatible
  roads/buildings/places schema, up to six actual tile reads. Compressed reads
  and decompressed sections have 8 MiB caps to avoid malformed-file RAM spikes.
- Publication is one synchronous active-metadata write with completed=true.
  Only afterwards is the old slot removed. Failed update keeps old active slot;
  broken inactive file is not published/resumed until explicitly discarded.
- Exclusive Web Lock covers transfer/publication, manual import and deletion
  across tabs. Automatic download needs Worker + OPFS sync access + Web Locks.
  Unsupported browsers can still use the existing manual import in Settings.
- Delete (confirmed) removes both map slots and journal/meta only. No IndexedDB,
  tickets, photos, AddressBook, settings or backup schema changes.
- Existing MapLibre PMTiles protocol reads the local OPFS File. Native Z0–15
  overzooms to Z18 without remote native Z16–18 requests. The regional extraction
  includes whole intersecting tiles (not a geometrically clipped raster).
  OSM details/house footprints depend on source coverage; overzoom adds none.
- Browser data clearing, origin change or storage eviction can remove the map.
  There is no promise of permanent retention without browser support.

## Owner setup (copy this complete checklist; placeholders are NOT production URLs)

```text
1. In Cloudflare Dashboard create a dedicated R2 bucket, storage class Standard.
   Put ONLY public map artifacts in it. Do not expose private backups or secrets.
   Do not create a Worker, D1 or change the project's production Worker/config.

2. Bucket → Settings → Custom Domains → connect a hostname YOU own in an active
   Cloudflare zone. Wait for Active/HTTPS. Leave r2.dev disabled for production.
   Below, <MAP_HOST> means your real hostname, not a value to paste literally.

3. Bucket CORS policy (PWA's origin has NO path/trailing slash):
   [
     {
       "AllowedOrigins": ["https://mastif1235-cell.github.io"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["Range", "If-Match", "If-Unmodified-Since"],
       "ExposeHeaders": ["ETag", "Content-Range", "Content-Length", "Last-Modified", "Accept-Ranges", "Content-Encoding"],
       "MaxAgeSeconds": 3600
     }
   ]
   Add another exact origin only if the installed PWA actually uses it.
   CORS is NOT authorization; these artifacts are intentionally public/read-only.

4. Upload the existing local archive (no rebuilding required):
   C:\Users\Артем\OneDrive\Документы\ChatGPT\мастер трекер\offline-map-research-20260930\dnipro-oblast-z0-15.pmtiles
   Object key: dnipro/2026-09-30/dnipro-oblast-z0-15.pmtiles
   Content-Type: application/octet-stream
   Cache-Control: public, max-age=31536000, immutable, no-transform
   NO Content-Encoding / automatic compression / redirect / login/challenge.
   Keep the HTTP ETag returned by R2 unchanged; it is NOT a SHA-256 checksum.
   Expected size: 114207260 bytes
   Expected SHA-256: 4ebb26c99a51407dab3a1d45cdfaef9f2d176003a1bdb19579caa1d9001877da

5. Upload docs/offline-maps/dnipro-oblast/manifest.json from this repository:
   Object key: dnipro/manifest.json
   Content-Type: application/json; charset=utf-8
   Cache-Control: no-store
   Disable CDN cache for this manifest (rule must not override no-store).
   Do not add etag to the manifest unless it is the exact quoted HTTP ETag.
   For later updates: publish a NEW immutable versioned file FIRST, verify it,
   then replace manifest last with new version/file/size/hash/build/updatedAt.
   Do not overwrite bytes at an existing immutable versioned URL.

6. In js/offline-map-catalog.js set the sole manifestUrl to:
   https://<MAP_HOST>/dnipro/manifest.json
   Add exactly https://<MAP_HOST> to connect-src in BOTH index.html and _headers.
   Do not add wildcards or credentials. Ship these config changes with the next
   coordinated APP_VERSION/cache bump: current SW shell is immutable.
   Merely editing a file on GitHub without publishing a new cache won't update
   an already installed PWA reliably. No production URL is configured in this PR.

7. Check from the actual PWA origin (CORS headers require an Origin request):
   - manifest HTTP 200, current JSON, Content-Type JSON, no-store;
   - file HTTP 200, Content-Length 114207260, stable quoted ETag;
   - Range: bytes=1048576- plus If-Match: <the actual quoted ETag>
     yields HTTP 206 and Content-Range: bytes 1048576-114207259/114207260;
   - Access-Control-Allow-Origin matches PWA origin;
   - ETag/Content-Range/Content-Length/Last-Modified readable from browser JS;
   - stale If-Match refuses the changed object, never returns mixed bytes.
   If enabling/changing CORS after CDN caching, purge that bucket domain cache.
   Never share tokens, presigned admin URLs or R2 credentials in frontend code.

8. PHYSICAL ANDROID CHECKLIST (NOT TESTED by Codex):
   - Install/update the PWA from its normal production origin.
   - Start the real 114 MB download; check progress/UI responsiveness.
   - Background/foreground the PWA. If Android suspends it, resume explicitly.
   - Stop halfway, reload, Resume; ensure bytes continue rather than duplicate.
   - Close the browser/PWA during download, reopen, Resume from checkpoint.
   - Complete download and wait for integrity verification / Ready.
   - Enable airplane mode, close/reopen PWA; open Offline map.
   - Pan/zoom through Дніпро, Кам’янське, Павлоград, Кривий Ріг, Нікополь,
     Таромське, Царичанка, Васильківка; check streets/buildings, Z16–18,
     visible OSM attribution, ticket markers and existing local network points.
   - Check Update unchanged version → already current.
   - With a newly published version, update; old map works until success.
   - Interrupt update; old map stays active. Resume and finish.
   - Delete incomplete update only → old map remains.
   - Delete map → both slots/journal cleared; tickets/photos/settings remain.
   - Check old manual PMTiles import from Settings still installs/opens offline.
```

Official references: [public bucket/custom domain](https://developers.cloudflare.com/r2/buckets/public-buckets/),
[CORS and exposed headers/cache purge](https://developers.cloudflare.com/r2/buckets/cors/).
Bucket setup and real R2/Android acceptance remain owner steps, not an automated
test claim. Chromium mocks never fetch the 114 MB production archive in CI.

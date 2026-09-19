/* KV-backed snapshot cache for the REDACTED READ projection.
   Google Sheets (reached via the signed GAS contract) remains the source of
   truth; this layer only smooths latency:

   - fresh (age <= ttlMs)          → answer from cache, no GAS call;
   - stale (ttlMs < age <= staleMs)→ answer stale immediately + refresh in
                                     background (stale-while-revalidate);
   - cold miss                     → fetch from GAS (our own 20 s budget),
                                     cache the projection on success;
   - GAS failure + copy present    → serve the last known good copy;
   - KV absent/broken              → transparent passthrough (never an error,
                                     never a leak: only failures are logged
                                     by name, no values).

   Only the REDACTED projection (exactly the objects the MCP tools return to
   clients) plus the internal address search index built from PUBLIC address
   text is ever written to KV — raw rows, fullDataJson and secrets never
   enter the cache. Since v91.48 the search index excludes the app's private
   marker lines and masterNote (mappers.searchableTextFromGasRow). SNAPSHOT_VERSION invalidates old shapes on schema or
   redaction changes.

   v2 (v91.44): the REDACTED schema changed — equipment rows now carry
   qty/total/qty_derived, and tickets gained connectMasters and has_geo.
   Old v1 envelopes must never feed the new code: they are simply ignored
   (the old KV key is left untouched, never deleted manually).

   v3 (v91.45): the projection CONTENT semantics changed — legacy rows whose
   structured fields live in the backupNote «ПовніДаніJSON:» payload now
   carry city/street/house. Cached v2 projections built by the old mapper
   would keep hiding those addresses until they expire, so they are ignored
   exactly like v1 (old KV key left untouched, never deleted manually). */

export const SNAPSHOT_VERSION = 3;

export function snapshotKey(){
  return 'mt:snapshot:v' + SNAPSHOT_VERSION;
}

export function createSnapshotProvider(options){
  const fetchFn = options.fetchFn;
  const kv = options.kv || null;
  const now = options.now || Date.now;
  const ttlMs = Math.max(0, Number(options.ttlMs) || 300000);
  const staleMs = Math.max(ttlMs, Number(options.staleMs) || 86400000);
  const log = options.log || function(){};
  const waitUntil = options.waitUntil || function(promise){
    if(promise && typeof promise.catch === 'function') promise.catch(function(){});
  };

  function parseEnvelope(raw){
    if(!raw) return null;
    let parsed = null;
    try{ parsed = JSON.parse(raw); }
    catch(_err){ return null; }
    if(!parsed || parsed.v !== SNAPSHOT_VERSION || typeof parsed.savedAt !== 'number' ||
       !parsed.data || !Array.isArray(parsed.data.tickets) || !Array.isArray(parsed.data.shifts)){
      return null;
    }
    return parsed;
  }

  async function kvGet(){
    if(!kv) return null;
    try{ return parseEnvelope(await kv.get(snapshotKey())); }
    catch(_err){ log('snapshot_cache_read_failed'); return null; }
  }

  async function kvPut(data){
    if(!kv) return false;
    try{
      await kv.put(snapshotKey(), JSON.stringify({v:SNAPSHOT_VERSION, savedAt:now(), data}));
      return true;
    }catch(_err){ log('snapshot_cache_write_failed'); return false; }
  }

  /* Fetch through to GAS; on success schedule a cache write (never awaited on
     the critical path, never allowed to break the answer). */
  async function fetchProjection(){
    const result = await fetchFn();
    if(result.ok) waitUntil(kvPut(result.data));
    return result;
  }

  async function getList(){
    const cached = await kvGet();
    if(cached){
      const age = now() - cached.savedAt;
      if(age <= ttlMs) return {ok:true, data:cached.data, cache:'fresh', savedAt:cached.savedAt};
      if(age <= staleMs){
        waitUntil(refresh());
        return {ok:true, data:cached.data, cache:'stale', savedAt:cached.savedAt};
      }
    }
    const result = await fetchProjection();
    if(result.ok) return result;
    if(cached){
      log('snapshot_gas_failed_serving_last_known_good');
      return {ok:true, data:cached.data, cache:'stale', savedAt:cached.savedAt};
    }
    return result;
  }

  /* Foreground refresh used by the Cron Trigger: fetch + await the write. */
  async function refresh(){
    const result = await fetchFn();
    if(result.ok) await kvPut(result.data);
    return result.ok;
  }

  return {getList, refresh};
}

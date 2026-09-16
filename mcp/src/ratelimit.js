/* Best-effort in-isolate sliding-window rate limiter, keyed by client name.
   Isolate-local by design (stateless spec): it protects the GAS/Sheets
   backend from runaway loops of a misbehaving client on a healthy isolate;
   it is not a global quota. Default 120 requests/min per client. */

export function createRateLimiter(options){
  const limit = Math.max(1, Number(options && options.limitPerMin) || 120);
  const now = (options && options.now) || Date.now;
  const hits = new Map(); // key -> array of timestamps

  function check(key){
    const ts = now();
    let array = hits.get(key);
    if(!array){ array = []; hits.set(key, array); }
    const windowStart = ts - 60000;
    while(array.length && array[0] <= windowStart) array.shift();
    if(array.length >= limit){
      const retryAfterSec = Math.max(1, Math.ceil((array[0] + 60000 - ts) / 1000));
      return {allowed:false, retryAfterSec};
    }
    array.push(ts);
    return {allowed:true, retryAfterSec:0};
  }

  return {check};
}

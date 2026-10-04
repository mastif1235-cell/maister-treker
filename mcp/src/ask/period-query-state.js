/* Phase 2A only. Input is the existing validated queryContext, not navigation
 * state or raw rows. Pure planning: no calls, scans, persistence or logging. */
import {parseTemporalWorkPeriod,temporalWorkIntent} from './work-intent.js';
import {fromExisting,reduceAnalyticsState,toExisting} from './analytics-query-state.js';

export function resolvePeriodFollowUp(question,now,queryContext){
  // Same closed month grammar/year anchor as v91.84. Comparisons, navigation,
  // drill-down and additional constraints are not eligible; group/stats aren't
  // supported by this temporal contract. No second month parser.
  const period=parseTemporalWorkPeriod(question,now,queryContext);
  if(!period) return {path:'legacy_temporal',intent:null};
  try{
    const previous=fromExisting(queryContext.resolved_filters,{mode:queryContext.mode});
    const patch={changes:{periods:{op:'REPLACE',value:[period]}}};
    const reduced=reduceAnalyticsState(previous,patch);
    if(!reduced.ok) throw new TypeError('Unsupported period transition');
    const plans=toExisting(reduced.state);
    if(plans.length!==1) throw new TypeError('Expected a single period');
    // Pagination is execution metadata, not analytics state. Keep the existing
    // temporal list contract (8), never import an arbitrary persisted limit.
    const intent={...plans[0],...(queryContext.mode==='list'?{limit:8}:{})};
    return {path:'query_state_period',intent};
  }catch(_error){
    // Atomic fallback, no state mutation. Reuse the already parsed period.
    return {path:'fallback',intent:temporalWorkIntent(question,now,queryContext,period)};
  }
}

/* Narrow period / coworker bridge. Input is validated queryContext, not navigation
 * state or raw rows. Pure planning: no calls, scans, persistence or logging. */
import {parseTemporalWorkPeriod,temporalWorkIntent} from './work-intent.js';
import {fromExisting,normalizeAnalyticsState,reduceAnalyticsState,toExisting} from './analytics-query-state.js';
import {resolveRosterCoworker} from './coworker-names.js';

// Keep the existing single Foundation owner. Its adapters and golden contract
// stay unchanged; typed EXCLUDE is compiled only by this execution bridge.
function fromExecutionContext(context){
  const {coworker_exclude,...filters}=context.resolved_filters;
  if(coworker_exclude!==undefined && filters.coworker!==undefined)throw new TypeError('Conflicting coworkers');
  const state=fromExisting(filters,{mode:context.mode,group_by:context.group_by});
  return coworker_exclude===undefined?state:normalizeAnalyticsState({...state,coworker:{kind:'exclude',name:coworker_exclude}});
}
function toExecutionPlans(state){
  const s=normalizeAnalyticsState(state);
  if(s.coworker.kind!=='exclude')return toExisting(s);
  // Compile all other fields using Foundation. Restore exclusion on EVERY
  // plan: it must never execute as an unrestricted ANY plan.
  return toExisting({...s,coworker:{kind:'any'}}).map(p=>({...p,coworker_exclude:s.coworker.name}));
}
export function resolveCoworkerFollowUp(question,context,roster){
  const fallback={path:'legacy_coworker',intent:null};
  const q=String(question||'').normalize('NFKC').trim().replace(/[.!?…]+$/u,'').trim();
  const exclude=/^(?:а\s+)?без\s+([\p{L}ʼ'-]+)$/iu.exec(q);
  const any=/^(?:а\s+)?(?:со\s+всеми(?:\s+мастерами)?|з\s+усіма(?:\s+майстрами)?)$/iu.test(q);
  if(!exclude&&!any)return fallback;
  try{
    const previous=fromExecutionContext(context);
    if(!previous.entity||!previous.action||previous.periods.length!==1||
      !previous.periods[0].from||!previous.periods[0].to)return fallback;
    const name=exclude&&resolveRosterCoworker(exclude[1],roster);
    if(exclude&&!name)return fallback;
    const reduced=reduceAnalyticsState(previous,{changes:{coworker:{op:'REPLACE',
      value:exclude?{kind:'exclude',name}:{kind:'any'}}}});
    if(!reduced.ok)return fallback;
    const plans=toExecutionPlans(reduced.state);
    if(plans.length!==1)return fallback;
    return {path:'query_state_coworker',intent:{...plans[0],...(previous.aggregation==='list'?{limit:8}:{})}};
  }catch(_error){return fallback;}
}

export function resolvePeriodFollowUp(question,now,queryContext){
  // Same closed month grammar/year anchor as v91.84. Comparisons, navigation,
  // drill-down and additional constraints are not eligible; group/stats aren't
  // supported by this temporal contract. No second month parser.
  const period=parseTemporalWorkPeriod(question,now,queryContext);
  if(!period) return {path:'legacy_temporal',intent:null};
  try{
    const previous=fromExecutionContext(queryContext);
    const patch={changes:{periods:{op:'REPLACE',value:[period]}}};
    const reduced=reduceAnalyticsState(previous,patch);
    if(!reduced.ok) throw new TypeError('Unsupported period transition');
    const plans=toExecutionPlans(reduced.state);
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

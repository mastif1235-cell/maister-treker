/* Narrow combined follow-ups: parse every clause before one atomic reduction.
 * No I/O, roster inference, fuzzy names, partial period update or LLM. */
import {parseTemporalWorkPeriod} from './work-intent.js';
import {resolveRosterCoworker} from './coworker-names.js';
import {fromExisting,reduceAnalyticsState,toExisting} from './analytics-query-state.js';

export function resolveCombinedFollowUp(question,now,queryContext,roster){
  const fallback={path:'legacy_combined',intent:null};
  if(queryContext?.mode!=='count'||queryContext.comparison) return fallback;
  const text=String(question||'').normalize('NFKC').trim().replace(/[.!?…]+$/u,'').trim();
  // Entire input must be one existing month clause + one exact roster name.
  // Additional months, constraints, names or trailing words reject BOTH fields.
  const clauses=/^(.+?)\s+(?:с|со|з|із|зі)\s+(.+)$/iu.exec(text);
  if(!clauses) return fallback;
  const period=parseTemporalWorkPeriod(clauses[1],now,queryContext);
  const coworker=resolveRosterCoworker(clauses[2],roster);
  if(!period||!coworker) return fallback;
  try{
    const previous=fromExisting(queryContext.resolved_filters,{mode:queryContext.mode});
    if(!previous.entity||!previous.action||!previous.profile) return fallback;
    const patch={changes:{
      periods:{op:'REPLACE',value:[period]},
      coworker:{op:'REPLACE',value:{kind:'include',name:coworker}}
    }};
    const reduced=reduceAnalyticsState(previous,patch);
    if(!reduced.ok) return fallback;
    const plans=toExisting(reduced.state);
    if(plans.length!==1) return fallback;
    return {path:'query_state_combined',patch,state:reduced.state,intent:plans[0]};
  }catch(_error){return fallback;}
}

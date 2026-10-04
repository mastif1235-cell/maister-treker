/* Closed D2/D4 grammar -> typed state patch. No execution, I/O or LLM. */
import {fromExisting,normalizeAnalyticsState,reduceAnalyticsState,toExisting} from './analytics-query-state.js';
import {parseTemporalWorkPeriod} from './work-intent.js';
import {projectComparisonContext} from './query-context.js';

export function resolveAnalyticsFollowUp(question,now,context){
 const q=String(question||'').normalize('NFKC').trim().replace(/[.!?…]+$/u,'').trim();
 const repair=/^(?:(?:а\s+)?(?:только\s+ремонты|только\s+ремонтные\s+заявки|тільки\s+ремонти|тільки\s+ремонтні\s+заявки)|а\s+(?:ремонты|ремонти))$/iu.test(q);
 const compare=/^(?:сравни|порівняй)\s+([^\s]+)\s+(?:и|і)\s+([^\s]+)$/iu.exec(q);
 if(!repair&&!compare)return null;
 try{
  let state=fromExisting(context.resolved_filters,{mode:context.mode});
  if(context.comparison){
   const c=projectComparisonContext(context);if(!c)return null;
   state=normalizeAnalyticsState({...state,periods:c.comparison.periods});
  }
  if(state.aggregation!=='count'||!state.entity||!state.action||!state.profile||!state.periods.length||state.periods.some(p=>!p.from||!p.to))return null;
  let patch;
  if(repair)patch={changes:{workType:{op:'REPLACE',value:'Ремонт'}}};
  else{
   // Reuse the existing closed month parser AND its existing year anchor.
   const years=new Set(state.periods.flatMap(p=>[p.from.slice(-4),p.to.slice(-4)]));if(years.size!==1)return null;
   const anchor={mode:'count',resolved_filters:{...context.resolved_filters,date_from:state.periods[0].from,date_to:state.periods[0].to}};
   const periods=[compare[1],compare[2]].map(m=>parseTemporalWorkPeriod(m,now,anchor));
   if(periods.some(p=>!p)||periods[0].from===periods[1].from)return null;
   patch={changes:{periods:{op:'REPLACE',value:periods}}};
  }
  const reduced=reduceAnalyticsState(state,patch);if(!reduced.ok)return null;
  const plans=toExisting(reduced.state);if(plans.length>2)return null;
  return {state:reduced.state,patch,plans};
 }catch(_error){return null;}
}

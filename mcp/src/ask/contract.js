/* Request/response boundary only; independent of analytics/planner semantics. */
export const AI_CONTRACT_VERSION = 1;
export const AI_COMPATIBILITY_MESSAGE = 'AI-модуль оновився. Оновіть застосунок і повторіть початкове питання.';

export function acceptsAIContract(value){
  return value === AI_CONTRACT_VERSION;
}

/* A guard-preserving rollback must refuse state its older projection drops.
   No migration, guessed filters or fallback analytics execution. */
export function preservesAIContext(raw, projected){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
  for(const key of ['coworker_exclude']){
    if(Object.hasOwn(raw.resolved_filters || {},key) &&
      raw.resolved_filters[key] !== projected?.resolved_filters?.[key]) return false;
  }
  if(Object.hasOwn(raw,'comparison') && (!projected?.comparison || JSON.stringify(raw.comparison?.periods) !== JSON.stringify(projected.comparison.periods))) return false;
  for(const key of ['group_by']){
    if(Object.hasOwn(raw,key) && JSON.stringify(raw[key]) !== JSON.stringify(projected?.[key])) return false;
  }
  return true;
}

/* Request-scoped names only: no roster inference from arbitrary ticket tags,
   no substring/fuzzy matching, no persistence or snapshot fields. */
export function normalizeCoworkerName(value){
  return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
}
export function coworkerForms(name){
  const base=normalizeCoworkerName(name),forms=new Set([base]);
  // Controlled case endings of a single roster name, not arbitrary stemming.
  if(/^[а-яіїєґ]+$/u.test(base)){
    const stem=base.slice(0,-1);
    if(base.endsWith('я'))for(const ending of ['ей','е','ю','і',/[аеєиіїоуюя]я$/u.test(base)?'єю':'ею'])forms.add(stem+ending);
    else if(base.endsWith('а'))for(const ending of ['ей','ой','ою','е','у','і',/[жчшщ]а$/u.test(base)?'ею':'ою'])forms.add(stem+ending);
    else if(base.endsWith('ь'))for(const ending of ['я','ю','ем','я'])forms.add(stem+ending);
    else if(/[бвгґджзклмнпрстфхцчшщ]$/u.test(base))for(const ending of ['а','у','ом','ем','е'])forms.add(base+ending);
  }
  return forms;
}
export function sanitizeCoworkerRoster(value){
  if(!Array.isArray(value))return [];
  const names=value.slice(0,50).map(item=>typeof item==='string'?item:item?.name).filter(name=>typeof name==='string'&&name.length<=60&&/^[\p{L}ʼ' -]+$/u.test(name)).map(name=>name.trim()).filter(Boolean);
  return [...new Map(names.map(name=>[normalizeCoworkerName(name),name])).values()];
}
export function resolveRosterCoworker(query, roster){
  const target=normalizeCoworkerName(query);
  const candidates=sanitizeCoworkerRoster(roster).filter(name=>{
    const forms=coworkerForms(name),base=normalizeCoworkerName(name);
    // Genitive for «без Жени/Пети/Паши» belongs ONLY to trusted roster
    // query resolution. Do not broaden stored-name/event matching.
    if(/^[а-яіїєґ]+[ая]$/u.test(base))forms.add(base.slice(0,-1)+'и');
    return forms.has(target);
  });
  return candidates.length===1?candidates[0]:null;
}
export function exactDirectCoworker(stored,query){
  return !!normalizeCoworkerName(stored)&&coworkerForms(stored).has(normalizeCoworkerName(query));
}

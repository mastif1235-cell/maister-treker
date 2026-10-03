/* Computed inventory consumption. No ticket mutation/persistence, no prices,
   no private notes. Equipment is the saved selected-items list (one item/pcs
   when the UI has no native qty); cables are measured in meters. */
const PLACEMENT=new Set(['install','replace','lay']);
const USED_ABBREVIATION=/(?<![\p{L}\p{N}])б\s*(?:[./-]\s*)?у(?![\p{L}\p{N}])/giu;
const ONU_NOUN='(?:onu|ону|ont|онушк[\\p{L}]*)';
// Adjacent condition or bounded «ONU ... это б/у» predicate. Never cross a
// different hardware noun or a speculative modifier to attribute its state.
const USED_DESCRIPTOR='\\s*[:(-]?\\s*(?:(?:(?!(?:onu|ону|ont|онуш|роутер|router|бп|psu|блок|кабел|utp|думаю|кажется|похоже|возможно|мабуть|наверное|может))[\\p{L}]+\\s+){0,2}это\\s+)?б\\s*/\\s*у';
const USED_ONU=new RegExp('(?<![\\p{L}\\p{N}])(?:'+ONU_NOUN+USED_DESCRIPTOR+'|б\\s*/\\s*у\\s+'+ONU_NOUN+')(?![\\p{L}\\p{N}])','iu');
const USED_ONU_COMPONENT=new RegExp('(?:(?:бп|psu|блок\\s+(?:питания|живлення))\\s+'+ONU_NOUN+'|(?:onu|ont)\\s+psu)'+USED_DESCRIPTOR,'giu');
function positive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}
export function workType(ticket){return /^п[іо]дключен(?:ня|ие)$/iu.test(String(ticket.type||''))?'connection':/^ремонт$/iu.test(String(ticket.type||''))?'repair':'other';}
function exclusions(entity,text,patternFor){
  const pattern={onu:'(?:onu|ону|ont|онушк[\\p{L}]*)',router:'(?:роутер[\\p{L}]*|маршрутизатор[\\p{L}]*|router)'}[entity]||patternFor?.(entity),noun=pattern?'(?:'+pattern+')':null;
  if(!noun)return null;
  const own='(?:абонент[\\p{L}]*|клиент[\\p{L}]*|клієнт[\\p{L}]*)';
  const adjectives='(?:сво[яєійю]|власн[\\p{L}]*|клиентск[\\p{L}]*|клієнтськ[\\p{L}]*|абонентск[\\p{L}]*|абонентськ[\\p{L}]*)';
  const old='(?:стар[\\p{L}]*|існуюч[\\p{L}]*|существующ[\\p{L}]*|existing|reused)';
  const move='(?:перенос[\\p{L}]*|перенес[\\p{L}]*|перен[іе]с[\\p{L}]*|reuse|reused|повторно\\s+(?:использ[\\p{L}]*|використ[\\p{L}]*))';
  const owned=new RegExp(noun+'\\s+'+own+'|'+adjectives+'\\s+'+noun,'iu');
  // An old-unit fault is not proof that the old unit was retained/reused.
  const reused=new RegExp(move+'\\s+(?:(?:эту\\s+же|цю\\s+ж|ту\\s+же|той\\s+самий)\\s+)?(?:'+old+'\\s+)?'+noun+'|(?:оставил[\\p{L}]*|оставили|залиш[\\p{L}]*|использовал[\\p{L}]*|использовали|використав[\\p{L}]*|використали)\\s+'+old+'\\s+'+noun+'|reused\\s+'+noun+'|'+noun+'\\s+(?:reuse|reused|повторно\\s+(?:использ[\\p{L}]*|використ[\\p{L}]*))','iu');
  // Component ownership cannot mask a separate physical ONU/router.
  let safe=['onu','router'].includes(entity)?text.replace(/(?:(?:бп|psu|блок\s+(?:питания|живлення))\s+(?:onu|ону|ont|роутер[\p{L}]*|router)|(?:onu|ont|router)\s+psu)\s+(?:абонент[\p{L}]*|клиент[\p{L}]*|клієнт[\p{L}]*)/giu,' '):text;
  if(entity==='onu')safe=safe.replace(USED_ABBREVIATION,'б/у').replace(USED_ONU_COMPONENT,' ');
  const legacyMove='(?:перенос[\\p{L}]*|перенес[\\p{L}]*|перен[іе]с[\\p{L}]*|reuse|reused)';
  const legacyReuse=new RegExp('(?:'+old+'|'+legacyMove+')\\s+(?:'+old+'\\s+)?'+noun+'|'+noun+'\\s+(?:'+old+'|'+legacyMove+')','iu');
  const explicitReuse=entity==='onu'?safe.split(/[\n;,.!?]+/).some(c=>!/(?:^|\s)(?:не|ні|надо|нужно|треба|будем|будемо|завтра)\s/iu.test(c)&&(reused.test(c)||USED_ONU.test(c))):legacyReuse.test(safe);
  return owned.test(safe)?'customer_owned_'+entity:explicitReuse?'reused_'+entity+'_transfer':null;
}
function newAction(entity,text,patternFor){
  const pattern=entity==='onu'?'(?:onu|ону|ont)':entity==='router'?'(?:router|роутер[\\p{L}]*|маршрутизатор[\\p{L}]*)':patternFor?.(entity),noun=pattern?'(?:'+pattern+')':null;
  const actions=new Set();if(!noun)return actions;
  for(const c of text.split(/[\n;,.!?]+/)){
    if(/(?:^|\s)(?:не|ні|надо|нужно|треба|будем|будемо|завтра)\s/iu.test(c))continue;
    const m=new RegExp('(?:постав[\\p{L}]*|установ[\\p{L}]*|встанов[\\p{L}]*|замен[\\p{L}]*|зам[іи]н[\\p{L}]*)\\s+(?:на\\s+)?(?:\\d+\\s+)?нов[\\p{L}]*\\s+'+noun+'|(?:постав[\\p{L}]*|установ[\\p{L}]*|встанов[\\p{L}]*|замен[\\p{L}]*|зам[іи]н[\\p{L}]*)\\s+'+noun+'\\s+(?:на\\s+)?нов[\\p{L}]*','iu').exec(c);
    if(m)actions.add(/^зам/iu.test(m[0])?'replace':'install');
  }
  return actions;
}
export function physicalConsumption(ticket,explicit,reconciled,texts,identify,materialOnly,patternFor){
  const text=texts.join('\n'),type=workType(ticket),structured=new Map(),events=[],contexts=[];
  const key=(entity,unit)=>JSON.stringify([entity,unit]);
  const row=(entity,quantity,unit,source,action,reason)=>({ticket_id:String(ticket.id),date:String(ticket.date||''),entity,action,category:'definite',quantity,unit,physical_consumption:true,work_type:type,source,reason,quantity_source:source==='structured'?'structured':source==='business_derived'?'business_derived':'explicit',coworkers:reconciled.events.find(e=>e.coworkers)?.coworkers||[],evidence:source+'; quantity='+quantity+' '+unit,install_origin:type==='connection'?'connection':'other'});
  for(const item of ticket.equipment||[]){
    if(item.checked===false)continue;
    const entity=identify(String(item.label||''))||('material:'+String(item.label||'').normalize('NFKC').trim().toLowerCase());
    if(entity==='material:'||entity==='connection')continue;
    const quantity=Object.hasOwn(item,'consumption_qty')?positive(item.consumption_qty):Object.hasOwn(item,'qty')?positive(item.qty):1;
    if(!quantity)continue;
    const k=key(entity,'pcs');structured.set(k,(structured.get(k)||0)+quantity);
  }
  for(const item of ticket.cables||[]){
    const quantity=positive(item.meters);if(!quantity)continue;
    const entity=identify(String(item.label||''))||'cable',k=key(entity,'m');structured.set(k,(structured.get(k)||0)+quantity);
  }
  // Some existing work-catalog entries are material-only nouns (e.g. the
  // default "Блок живлення оптичного термінала"). Count their actual qty,
  // never setup/crimp/welding services; equipment wins when pools mirror it.
  const preset=new Map();
  for(const item of ticket.presetWorks||[]){
    if(item.checked===false)continue;
    const entity=materialOnly?.(item.label),quantity=positive(item.qty);
    if(!entity||entity==='connection'||['cable','fiber'].includes(entity)||!quantity)continue;
    const k=key(entity,'pcs');preset.set(k,(preset.get(k)||0)+quantity);
  }
  for(const [k,quantity] of preset)if(!structured.has(k))structured.set(k,quantity);
  // Completed public use/lay phrases with a proven numeric meter quantity.
  // Never promote a bare cable mention, measurements, future or negation.
  // Work-row qty counts services, NOT meters. A free numeric cable phrase
  // without an explicit meter unit is also insufficient length evidence.
  explicit=explicit.map(e=>['cable','fiber'].includes(e.entity)?{...e,quantity:null}:e);
  const extra=[];
  for(const clause of texts.join('\n').split(/[\n;!?]+|,(?!\d)/)){
    if(/(?:^|\s)(?:не|ні|нужно|надо|треба|будем|будемо|завтра)\s/iu.test(clause))continue;
    if(!/(?:использовал[\p{L}]*|використав[\p{L}]*|використали|протян[\p{L}]*|протяг[\p{L}]*|пролож[\p{L}]*|прокла[\p{L}]*|поставил[\p{L}]*|встановив[\p{L}]*|установил[\p{L}]*|заменил[\p{L}]*)/iu.test(clause))continue;
    const entity=identify(clause);if(!entity||entity==='connection')continue;
    const measured=['cable','fiber'].includes(entity);
    const match=measured?/(?<![-\d.,])(\d+(?:[.,]\d+)?)\s*(?:м(?![\p{L}])|метр[\p{L}]*)/iu.exec(clause):/(?<![-\d.,])(\d+(?:[.,]\d+)?)\s+(?:нов[\p{L}]*\s+)?(?:onu|ону|ont|router|роутер[\p{L}]*|маршрутизатор[\p{L}]*)/iu.exec(clause);
    const quantity=match?positive(match[1].replace(',','.')):null;
    if(match&&!quantity)continue;
    if(measured&&!quantity)continue;
    // Only use verbs need an extra event; ordinary placement stays in the
    // existing parser, with a narrowly proven missing quantity filled in.
    const existing=explicit.find(e=>e.entity===entity&&PLACEMENT.has(e.action)&&e.category==='definite');
    if(existing&&quantity&&existing.quantity==null)existing.quantity=quantity;
    else if(existing&&quantity&&existing.quantity!==quantity){existing.category='ambiguous';existing.reason='conflicting_quantity';}
    else if(!existing&&(quantity||/(?:использовал[\p{L}]*|використав[\p{L}]*|використали)/iu.test(clause)))extra.push({entity,action:/заменил/iu.test(clause)?'replace':measured?'lay':'install',category:'definite',quantity});
  }
  explicit=explicit.concat(extra);
  const entities=new Set([...structured.keys()].map(k=>JSON.parse(k)[0]).concat(explicit.map(e=>e.entity),reconciled.events.map(e=>e.entity)).filter(e=>e!=='connection'));
  for(const entity of entities){
    const reason=exclusions(entity,text,patternFor),newActions=newAction(entity,text,patternFor),newExplicit=newActions.size>0;
    if(reason&&!newExplicit){contexts.push({entity,reason,category:'excluded',evidence:reason+'=yes'});continue;}
    const measured=['cable','fiber'].includes(entity);
    const unit=measured?'m':'pcs',k=key(entity,unit),selected=structured.get(k);
    const candidates=explicit.filter(e=>e.entity===entity&&PLACEMENT.has(e.action)&&e.category==='definite'&&(!reason||newActions.has(e.action)));
    const replacement=candidates.some(e=>e.action==='replace'),action=replacement?'replace':candidates.length?candidates[0].action:type==='repair'?'replace':measured?'lay':'install';
    if(selected){events.push(row(entity,selected,unit,'structured',action,'structured_consumption'));continue;}
    if(explicit.some(e=>e.entity===entity&&PLACEMENT.has(e.action)&&e.category==='ambiguous'&&e.reason==='conflicting_quantity')){
      events.push({...row(entity,null,unit,'explicit',action,'conflicting_quantity'),category:'ambiguous',quantity:null});continue;
    }
    // Explicit action is fallback, not an extra unit alongside selected stock.
    const quantities=candidates.map(e=>positive(e.quantity)).filter(Boolean);
    if(candidates.length){
      const unique=new Set(quantities);
      if(unique.size>1){events.push({...row(entity,null,unit,'explicit',action,'conflicting_quantity'),category:'ambiguous',quantity:null});continue;}
      const unknownPlural=!quantities.length&&/(?:несколько|кілька|декілька|пару|два|две|дві|три|четыре|чотири|пять|пʼять|десять)\s+(?:нов[\p{L}]*\s+)?(?:onu|ону|ont|router|роутер[\p{L}]*)/iu.test(text);
      const quantity=quantities[0]||(!measured&&!unknownPlural?1:null);
      if(quantity){const event=row(entity,quantity,unit,'explicit',action,action==='replace'?'explicit_replace':'explicit_install');event.evidence=candidates[0].evidence||event.evidence;if(!quantities.length)event.quantity_source=reconciled.events.some(e=>e.entity===entity&&e.provenance?.includes('derived_from_connection'))?'business_derived':'action_default';events.push(event);}
      else events.push({...row(entity,null,unit,'explicit',action,'unknown_quantity'),category:'ambiguous',quantity:null});
      continue;
    }
    const derived=reconciled.events.find(e=>e.entity===entity&&e.reason==='derived_from_connection'&&e.category==='definite');
    if(derived)events.push(row(entity,1,'pcs','business_derived','install','derived_from_connection'));
  }
  return {events,contexts};
}

/* Reuse the exact existing, pure physical engine. Never call /ask, alter the
   Worker, or duplicate its business heuristics. The local ticket is projected
   before analysis and only three normalized counters cross the report boundary. */
import {workEvents} from '../mcp/src/ask/work-events.js';
import {publicBackupText} from '../mcp/src/gas/mappers.js';
// Historical raw imports can have only the app's own labelled content lines.
// Extract presentation fields, never mutate the ticket or feed these inferred
// materials into the physical accounting engine. Structured values win,
// including an explicit zero/empty array on an ordinary structured ticket.
export function reportPresentation(ticket,core){
  const lines=publicBackupText(ticket.content,ticket.masterNote).split(/\r?\n/);
  const raw=ticket.cloudImported===true;
  const equipment=Array.isArray(ticket.equipment)?ticket.equipment:[];
  const cables=Array.isArray(ticket.cables)?ticket.cables:[];
  // Materials display (v91.95): quantity + informational line price from the
  // real ticket/calculator data. The price is a decoding aid only — it never
  // adds to `total`, never feeds physical accounting, and is omitted when
  // missing or zero. Zero-quantity materials are not shown.
  const priceSuffix=n=>Number(n)>0?' — '+(Math.round(Number(n)*100)/100)+' грн':'';
  let materials=[...equipment.filter(e=>e.checked!==false&&Number(e.consumption_qty??e.qty??1)>0).map(e=>core.sanitize(e.label)+' — '+(e.consumption_qty??e.qty??1)+' шт.'+priceSuffix(e.price)),...cables.filter(c=>Number(c.meters)>0).map(c=>core.sanitize(c.label)+' — '+Number(c.meters)+' м'+priceSuffix(Number(c.meters)*Number(c.pricePerMeter||0)))];
  if((raw&&!equipment.length&&!cables.length)||(!Array.isArray(ticket.equipment)&&!Array.isArray(ticket.cables))){
    materials=lines.flatMap(line=>{
      // Exact markers emitted by buildTicketContent; no fuzzy note guessing.
      // Optional price tail: «х N грн» and/or «= T грн» (explicit total wins).
      const match=/^\s*(?:🛠️?|🔌)\s*([^:\n]+):\s*(\d+(?:[.,]\d+)?)\s*(шт\.?|м)(?=\s|$|[хx×])(?:\s*[хx×]\s*(\d+(?:[.,]\d+)?)\s*грн)?(?:\s*=\s*(\d+(?:[.,]\d+)?)\s*грн)?/u.exec(line);
      if(!match||Number(match[2].replace(',','.'))<=0)return [];
      const label=core.sanitize(match[1]);
      const qty=Number(match[2].replace(',','.')),unit=match[3].startsWith('шт')?'шт.':'м';
      const explicit=match[5]!==undefined?Number(match[5].replace(',','.')):match[4]!==undefined?qty*Number(match[4].replace(',','.')):0;
      return label?[label+' — '+qty+' '+unit+priceSuffix(explicit)]:[];
    });
  }
  const note=ticket.note||ticket.otherNote||((raw||ticket.note===undefined)?lines.filter(line=>/^\s*📝\s*/u.test(line)).map(line=>line.replace(/^\s*📝\s*/u,'')).join('\n'):'');
  const field=pattern=>core.sanitize(lines.map(line=>pattern.exec(line)?.[1]||'').find(Boolean)||'');
  const header=raw?field(/^\s*📋\s*ЗАЯВКА:\s*(ПІДКЛЮЧЕННЯ|РЕМОНТ)\s*$/u):'';
  const type=header==='РЕМОНТ'?'Ремонт':header==='ПІДКЛЮЧЕННЯ'?'Підключення':String(ticket.type||'');
  const payment=String(ticket.payment||'')||(raw?field(/^\s*💳\s*Оплата:\s*(Готівка|Безготівка|Безкоштовно|Змішана)\s*$/u):'');
  // Preserve only the existing exact app-labelled raw-import tariff fallback,
  // now in its dedicated field rather than contaminating the public note.
  const tariff=Number(ticket.tariff)>0?Number(ticket.tariff):raw?Number(field(/^\s*💎\s*Тариф:\s*(\d+(?:[.,]\d+)?)\s*грн\s*$/u).replace(',','.')):0;
  return {materials:materials.filter(line=>!line.startsWith(' —')).join('\n'),note:core.sanitizeComment(publicBackupText(note,ticket.masterNote)),type,payment,tariff,
    city:core.sanitize(ticket.city)|| (raw?field(/^\s*🏙️?\s*Місто:\s*(.+)$/u):''),address:core.sanitize(ticket.address)|| (raw?field(/^\s*📍\s*Адреса:\s*(.+)$/u):'')};
}
// Presentation-only work breakdown. Never add these amounts to ticket.sum.
export function projectWorks(ticket,core){
  const rows=[],seen=new Set();
  const number=(value,fallback)=>{
    if(value===undefined||value===null||value==='')return fallback;
    const n=Number(value);if(!Number.isFinite(n)||n<0)throw new Error('INVALID_NUMBER');return n;
  };
  for(const [source,items] of [['catalog',ticket.presetWorks||[]],['manual',ticket.additionalWork||[]]]){
    items.forEach((w,index)=>{
      if(w.checked===false)return;
      const label=core.sanitizeComment(publicBackupText(source==='catalog'?w.label:w.desc,ticket.masterNote)).trim();
      if(!label)return;
      const quantity=number(w.qty,1)||1,unit_price=number(w.price,0);
      const line_total=Math.round(number(w.sum,quantity*unit_price)*100)/100;
      const id=w.id===undefined||w.id===null||w.id===''?null:String(w.id);
      // Shared explicit id + identical data can be a mirrored record. Different
      // ids or different amounts remain distinct, even with the same label.
      // Anonymous manual rows are independent; do not guess their identity.
      const key=JSON.stringify([id===null?(source==='manual'?source+':'+index:source):'id:'+id,label,quantity,line_total]);
      if(seen.has(key))return;seen.add(key);
      rows.push({source,id,label,quantity,unit_price,line_total});
    });
  }
  return rows;
}
export const HISTORICAL_ONU_OVERRIDES=Object.freeze({
  '1778579833958':'NO_ONU',
  '1776093623146':'NO_ONU',
  '1787044186198':'OUR_ONU',
  '1782135770715':'OUR_ONU',
  '1775815433108':'OUR_ONU',
  '1774458317644':'OUR_ONU',
  '1774458317627':'OUR_ONU',
  '1774458317606':'OUR_ONU',
  '1774458317612':'OUR_ONU',
  '1774458317619':'OUR_ONU',
  '1783937356212':'OUR_ONU',
  '1783336285098':'NO_ONU',
  '1781882915421':'NO_ONU',
  '1781880526066':'NO_ONU',
  '1781871158184':'NO_ONU',
  '1781716436224':'NO_ONU',
  '1781179383203':'NO_ONU',
  '1781104713848':'NO_ONU',
  '1780498750666':'NO_ONU',
  '1780498841441':'NO_ONU',
  '1779469363834':'NO_ONU',
  'cca10ba0-41a2-4571-ac3c-02b57e2a19bc':'UNKNOWN',
  '1774458317609':'UNKNOWN'
});
export const HISTORICAL_ONU_OVERRIDE_STATES=Object.freeze(['OUR_ONU','NO_ONU','UNKNOWN']);
export const HISTORICAL_ONU_CORRECTION_IDS=Object.freeze(['1778579833958','1776093623146']);

function overrideFor(ticketId,overrides){
  const value=overrides instanceof Map?overrides.get(String(ticketId)):overrides?.[String(ticketId)];
  if(value===undefined||value===null||value==='')return undefined;
  if(!HISTORICAL_ONU_OVERRIDE_STATES.includes(value))throw new Error('INVALID_HISTORICAL_ONU_OVERRIDE');
  return value;
}

const ONU_WORD='(?:onu|ont|онт|ону)';
const CUSTOMER_OWNER_WORD='(?:сво(?:я|й|ю|е|и|его|ей)|его|её|ее|її|його|собственн(?:ая|ый|ую|ое|ой|ого)|власн(?:а|ий|у|е|ої|ого)|клиентск(?:ая|ий|ую|ое)|абонентск(?:ая|ий|ую|ое)|клиент|абонент|користувач)';
const CUSTOMER_ONU_PATTERNS=Object.freeze([
  new RegExp(`(?<![\\p{L}\\p{N}_])${CUSTOMER_OWNER_WORD}\\s+${ONU_WORD}(?![\\p{L}\\p{N}_])`,'iu'),
  new RegExp(`(?<![\\p{L}\\p{N}_])${ONU_WORD}\\s+(?:клиента|клиенту|абонента|абоненту|пользователя|користувача|користувачу)(?![\\p{L}\\p{N}_])`,'iu'),
  new RegExp(`(?<![\\p{L}\\p{N}_])(?:сам(?:остоятельно)?|сама|самостійно)\\s+(?:купил|купила|купили|покупал|покупала|приобрел|приобрела|придбав|придбала|купив)\\s+(?:(?:себе|собі)\\s+)?${ONU_WORD}(?![\\p{L}\\p{N}_])`,'iu'),
  new RegExp(`(?<![\\p{L}\\p{N}_])${ONU_WORD}\\s+(?:сам|сама)\\s+(?:купил|купила|купили|покупал|покупала|приобрел|приобрела|придбав|придбала|купив)(?![\\p{L}\\p{N}_])`,'iu')
]);
export const HISTORICAL_CONNECTION_ONU_OVERRIDES=Object.freeze({'1783937356209':'CUSTOMER_ONU'});

function customerOnuEvidence(ticket){
  const source=[ticket?.content,ticket?.note,ticket?.otherNote,...(Array.isArray(ticket?.equipment)?ticket.equipment.map(item=>item?.label):[])]
    .filter(value=>typeof value==='string'&&value.trim())
    .join('\n')
    .normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/ё/gu,'е').replace(/[’‘`]/gu,"'");
  for(const sentence of source.split(/[\n.!?;]+/u)){
    for(const pattern of CUSTOMER_ONU_PATTERNS){
      const match=pattern.exec(sentence);
      if(!match)continue;
      // Negated ownership is not evidence that the customer's ONU was used.
      if(/(?:^|[^\p{L}\p{N}_])не\s*$/u.test(sentence.slice(0,match.index)))continue;
      return match[0];
    }
  }
  return '';
}

// Explicit persisted schema contract only. Dates, cloudImported and equipment
// shape never upgrade legacy records. Modern sparse equipment [] means OFF;
// legacy unchecked/absent equipment remains subject to the approved default.
export function classifyConnectionOnu(ticket,core){
  if(HISTORICAL_CONNECTION_ONU_OVERRIDES[String(ticket?.id)]==='CUSTOMER_ONU')return Object.freeze({classification:'CUSTOMER_ONU_EXPLICIT',onu_connection:0,reason:'approved_customer_ownership',evidence:'своя onu'});
  if(ticket?.onuAccountingVersion!==undefined){
    if(ticket.onuAccountingVersion!==1||!Array.isArray(ticket.equipment)||ticket.equipment.some(item=>!item||typeof item!=='object'||Array.isArray(item)||('checked' in item&&typeof item.checked!=='boolean')))
      return Object.freeze({classification:'REVIEW_REQUIRED',onu_connection:null,reason:'INVALID_OR_UNSUPPORTED_ONU_ACCOUNTING_CONTRACT',evidence:'ONU accounting contract requires review'});
    const selected=ticket.equipment.some(item=>core.isOnuEquipment(item)&&item.checked!==false);
    return Object.freeze({classification:selected?'OUR_ONU_EXPLICIT':'CUSTOMER_ONU_EXPLICIT',onu_connection:selected?1:0,reason:selected?'modern_onu_selected':'modern_onu_unchecked',evidence:selected?'schema 1 ONU selected':'schema 1 ONU unchecked'});
  }
  const equipment=Array.isArray(ticket?.equipment)?ticket.equipment:[];
  const onuItems=equipment.filter(item=>core.isOnuEquipment(item));
  const customerEvidence=customerOnuEvidence(ticket);
  const customerLabel=onuItems.find(item=>customerOnuEvidence({equipment:[item]}));
  if(customerLabel){
    const evidence=customerOnuEvidence({equipment:[customerLabel]});
    return Object.freeze({classification:'CUSTOMER_ONU_EXPLICIT',onu_connection:0,reason:'customer_ownership_in_canonical_equipment',evidence});
  }
  if(customerEvidence)return Object.freeze({classification:'CUSTOMER_ONU_EXPLICIT',onu_connection:0,reason:'explicit_customer_ownership_text',evidence:customerEvidence});
  const selected=onuItems.find(item=>item.checked!==false);
  if(selected)return Object.freeze({classification:'OUR_ONU_EXPLICIT',onu_connection:1,reason:'canonical_onu_selected',evidence:'canonical ONU selected'});
  return Object.freeze({classification:'LEGACY_DEFAULT_OUR_ONU',onu_connection:1,reason:'approved_legacy_connection_default',evidence:'legacy connection default'});
}

export function projectTicket(ticket,core,now=Date.now(),overrides=HISTORICAL_ONU_OVERRIDES,workTypeOverride){
  const resolvedWorkType=workTypeOverride??HISTORICAL_WORK_TYPE_OVERRIDES[String(ticket.id)];
  if(resolvedWorkType!==undefined&&!['CONNECTION','REPAIR','OTHER'].includes(resolvedWorkType))throw new Error('UNRESOLVED_HISTORICAL_WORK_TYPE');
  const effectiveType=resolvedWorkType===undefined?ticket.type:{CONNECTION:'Підключення',REPAIR:'Ремонт',OTHER:'Інше'}[resolvedWorkType];
  const text=v=>core.sanitize(v);
  const connection=/^п[іо]дключен(?:ня|ие)$/iu.test(String(effectiveType||''));
  let seenOnu=false;
  const equipment=connection&&Array.isArray(ticket.equipment)?ticket.equipment.flatMap(e=>{
    if(!core.isOnuEquipment(e))return [e];
    if(e.checked===false||seenOnu)return [];seenOnu=true;return [{...e,qty:1,consumption_qty:1,price:0}];
  }):ticket.equipment;
  const projected=connection&&Array.isArray(ticket.equipment)?{...ticket,equipment}:ticket;
  const safePublic={id:ticket.id,date:ticket.date,type:effectiveType,macAddress:ticket.macAddress,
    equipment:(ticket.equipment||[]).map(e=>({label:publicBackupText(e.label),checked:e.checked,qty:e.qty,consumption_qty:e.consumption_qty})).map(e=>Object.fromEntries(Object.entries(e).filter(([,v])=>v!==undefined))),
    cables:(ticket.cables||[]).map(c=>({label:publicBackupText(c.label),meters:c.meters})),
    presetWorks:(ticket.presetWorks||[]).map(w=>({label:publicBackupText(w.label),qty:w.qty,checked:w.checked})),
    additionalWork:(ticket.additionalWork||[]).map(w=>({desc:publicBackupText(w.desc)})),
    note:publicBackupText(ticket.note),otherNote:publicBackupText(ticket.otherNote)};
  const analysis=workEvents(safePublic,publicBackupText(ticket.content,ticket.masterNote),{profile:'physical_consumption'});
  const quantity=(entity,action)=>analysis.events.filter(e=>e.category==='definite'&&e.entity===entity&&(!action||e.action===action)).reduce((s,e)=>s+(e.quantity||0),0);
  const presentation=reportPresentation(projected,core);
  if(resolvedWorkType!==undefined)presentation.type=effectiveType;
  const total=Number(ticket.sum??0),payment=presentation.payment,free=payment==='Безкоштовно';
  const cash=free?0:payment==='Готівка'?total:payment==='Змішана'?Number(ticket.cashAmount||0):0;
  const card=free?0:payment==='Безготівка'?total:payment==='Змішана'?Number(ticket.cardAmount||0):0;
  const materials=presentation.materials;
  const type=presentation.type,category=/^п[іо]дключен(?:ня|ие)$/iu.test(type)?'connection':/^ремонт$/iu.test(type)?'repair':'other';
  const dto={ticket_id:String(ticket.id),work_date:core.dateKey(ticket.date),work_time:core.timeKey(ticket.time||'00:00'),work_type:text(type),work_category:category,
    city:presentation.city,street:text(ticket.street),house:text(ticket.house),apartment:text(ticket.apartment),
    address_display:text([presentation.city,presentation.address||[ticket.street,ticket.house,ticket.apartment&&'кв. '+ticket.apartment].filter(Boolean).join(' ')].filter(Boolean).join(', ')),
    materials_display:materials,mac_onu:String(ticket.macAddress||'').trim(),partner_display:text((ticket.connectMasters||[]).map(n=>typeof n==='string'?n:n?.name||'').filter(Boolean).join(', ')),
    payment_type:text(payment),amount:free?0:total,total:free?0:total,dispatcher_comment:presentation.note,
    onu_used:quantity('onu'),onu_replacement:quantity('onu','replace'),router_used:quantity('router'),payment_cash:cash,payment_cashless:card,
    // Free amount is the saved monetary amount, not a guessed inventory price.
    payment_free_amount:free?total:0,payment_free_count:free?1:0,updated_at:new Date(now).toISOString(),source_version:now,source_hash:''};
  if(category==='connection'||category==='repair'){
    const money=n=>Number(n).toLocaleString('uk-UA',{maximumFractionDigits:2})+' грн';
    const works=projectWorks(ticket,core).map(w=>w.label+(w.quantity!==1?' — '+w.quantity+' шт.'+(w.unit_price>0?' · '+money(w.unit_price)+'/шт.':''):'')+(w.line_total>0?' — '+money(w.line_total):''));
    if(works.length)dto.works_display=works.join('\n');
    if(category==='connection'){
      const onu=classifyConnectionOnu(ticket,core);
      if(onu.classification==='REVIEW_REQUIRED')throw new Error('ONU_SELECTION_REVIEW_REQUIRED');
      dto.onu_used=onu.onu_connection;dto.onu_replacement=0;
    }
    const contract=String(ticket.contractNumber??'').trim();
    // Keep structured identity intact; validate rather than sanitizing private
    // fragments into a different contract number. No extraction from notes.
    if(contract)dto.contract_number=contract;
    // Explicitly allowed contacts ONLY from saved structured fields. Never
    // extract contacts from raw imports, notes or dispatcher_comment.
    const clientName=String(ticket.clientName??'').trim(),clientPhone=String(ticket.phone??'').trim();
    if(clientName)dto.client_name=clientName;
    if(clientPhone)dto.client_phone=clientPhone;
    // saveTicket persists the effective fee in callFee. baseCallFee is only
    // the calculator input and must never revive a waived/missing saved fee.
    for(const [field,value] of [['service_fee',ticket.callFee],['tariff_amount',ticket.tariff]]){
      if(field==='service_fee'&&free)continue;
      if(value!==undefined&&value!==null&&value!==''){
        const amount=Number(value);
        if(!Number.isFinite(amount)||amount<0)throw new Error('INVALID_NUMBER');
        if(amount>0)dto[field]=amount;
      }
    }
    if(dto.tariff_amount===undefined&&presentation.tariff>0)dto.tariff_amount=presentation.tariff;
  }
  // Optional hash-bound material usage, independent of display/price strings.
  // Historical raw imports retain the existing physical-counter fallback.
  if(Array.isArray(ticket.equipment)||Array.isArray(ticket.cables)){
    const equipment=projected.equipment||[],cables=ticket.cables||[];
    if(!ticket.cloudImported||equipment.length||cables.length){
      const entries=[...equipment.filter(e=>e.checked!==false&&Number(e.consumption_qty??e.qty??1)>0).map(e=>({label:text(e.label),quantity:Number(e.consumption_qty??e.qty??1),unit:'шт.',...(e.price!==undefined?{unit_price:Number(e.price)}:{})})),
        ...cables.filter(c=>Number(c.meters)>0).map(c=>({label:text(c.label),quantity:Number(c.meters),unit:'м',...(c.pricePerMeter!==undefined?{unit_price:Number(c.pricePerMeter)}:{})}))].filter(e=>e.label);
      dto.materials_json=core.materialJSON(entries);
    }
  }
  if(type==='Інше'){
    for(const key of ['city','street','house','apartment','address_display','materials_display','mac_onu','partner_display'])dto[key]='';
    dto.dispatcher_comment=core.sanitizeComment(publicBackupText(ticket.otherNote||ticket.note||''));
    dto.onu_used=0;dto.onu_replacement=0;dto.router_used=0;
    if(dto.materials_json!==undefined)dto.materials_json='[]';
  }
  // Explicit historical decisions affect only repair ONU physical counters.
  // UNKNOWN intentionally behaves like no override for projection; it only
  // excludes that ticket from the separate evidence-confirmed statistic.
  if(category==='repair'){
    const historicalOverride=overrideFor(ticket.id,overrides);
    if(historicalOverride==='NO_ONU'){dto.onu_used=0;dto.onu_replacement=0;}
    else if(historicalOverride==='OUR_ONU'){dto.onu_used=1;dto.onu_replacement=0;}
  }
  return dto;
}
export async function buildDTO(ticket,core,now=Date.now(),overrides=HISTORICAL_ONU_OVERRIDES,workTypeOverride){
  const dto=projectTicket(ticket,core,now,overrides,workTypeOverride),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(core.content(dto)));
  dto.source_hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');return core.validate(dto);
}

// Read-only preview for the two manually approved NO_ONU corrections. The
// baseline intentionally omits historical overrides so it shows what the old
// parser would currently project; the after projection uses the production map.
export async function previewHistoricalOnuCorrection(tickets,core,now=Date.now()){
  const expected={
    // BEFORE values are the user's confirmed read-only server snapshot.
    '1778579833958':{date:'2026-05-12',time:'12:57',before_used:1,before_replacement:1,total:1600},
    '1776093623146':{date:'2026-04-13',time:'18:20',before_used:1,before_replacement:0,total:300}
  };
  if(!Array.isArray(tickets))throw new Error('HISTORICAL_SOURCE_UNAVAILABLE');
  return Promise.all(HISTORICAL_ONU_CORRECTION_IDS.map(async id=>{
    const matches=tickets.filter(ticket=>String(ticket?.id??'')===id);
    if(matches.length!==1)throw new Error(matches.length?'HISTORICAL_DUPLICATE_LOCAL_TICKET':'HISTORICAL_TICKET_NOT_FOUND');
    const ticket=matches[0],baseline=await buildDTO(ticket,core,now,{}),after=await buildDTO(ticket,core,now),snapshot=await buildDTO(ticket,core,1);
    const rule=expected[id];
    if(baseline.work_category!=='repair'||baseline.work_date!==rule.date||baseline.work_time!==rule.time||baseline.total!==rule.total||Number(ticket.sum??0)!==rule.total)throw new Error('HISTORICAL_BEFORE_MISMATCH');
    if(after.ticket_id!==id||after.onu_used!==0||after.onu_replacement!==0||after.total!==rule.total)throw new Error('HISTORICAL_AFTER_MISMATCH');
    return Object.freeze({ticket_id:id,date:baseline.work_date,time:baseline.work_time,snapshot_hash:snapshot.source_hash,before:{onu_used:rule.before_used,onu_replacement:rule.before_replacement,total:rule.total},after:{onu_used:after.onu_used,onu_replacement:after.onu_replacement,total:after.total}});
  }));
}

// Count only physical ONU evidence: explicit user decisions, structured
// equipment/materials, or a precise legacy material line. Notes, MAC and the
// text-parser counter are deliberately not evidence for this confirmed total.
export function confirmedRepairOnuCount(records,core,overrides=HISTORICAL_ONU_OVERRIDES){
  const seen=new Set();let total=0;
  const quantityOf=(items)=>items.filter(item=>core.isOnuEquipment(item)&&item.checked!==false)
    .reduce((sum,item)=>sum+Number(item.consumption_qty??item.qty??1),0);
  for(const record of records||[]){
    const id=String(record?.ticket_id??record?.id??'');
    if(!id||seen.has(id))continue;seen.add(id);
    if(record.work_category!=='repair'&&!/^ремонт$/iu.test(String(record.work_type??record.type??'')))continue;
    const decision=overrideFor(id,overrides);
    if(decision==='NO_ONU'||decision==='UNKNOWN')continue;
    if(decision==='OUR_ONU'){total++;continue;}
    if(Array.isArray(record.equipment)&&(!record.cloudImported||record.equipment.length)){
      total+=quantityOf(record.equipment);continue;
    }
    if(record.materials_json!==undefined){
      total+=core.readMaterials(record.materials_json).filter(item=>core.isOnuEquipment(item)).reduce((sum,item)=>sum+item.quantity,0);
      continue;
    }
    const lines=String(record.materials_display??'').split(/\r?\n/u);
    for(const line of lines){
      const match=/^\s*ONU\s*[—-]\s*(\d+(?:[.,]\d+)?)\s*шт\.(?:\s*[—×x].*)?\s*$/iu.exec(line);
      if(match)total+=Number(match[1].replace(',','.'));
    }
  }
  return total;
}

// User-approved work-type decisions from the historical source audit. No
// inferred decision is persisted back to a ticket, DTO, receipt or server row.
export const HISTORICAL_WORK_TYPE_OVERRIDES=Object.freeze({
  '1784113153627':'REPAIR',
  '1784048596976':'REPAIR',
  '1783937356216':'REPAIR',
  '1777287852811':'REPAIR',
  '1775815433108':'REPAIR',
  '1783937356212':'REPAIR',
  '1783336285098':'REPAIR',
  '1781882915421':'REPAIR',
  '1781880526066':'REPAIR',
  '1781871158184':'REPAIR',
  '1781716436224':'REPAIR',
  '1781179383203':'REPAIR',
  '1781104713848':'REPAIR',
  '1780498750666':'REPAIR',
  '1780498841441':'REPAIR',
  '1779469363834':'REPAIR',
  '1774458317619':'REPAIR',
  '1774458317612':'REPAIR'
});
export const HISTORICAL_REBUILD_EXCLUDED_IDS=Object.freeze(['1786990035908','1786951228806']);
export const HISTORICAL_PHYSICAL_ALIASES=Object.freeze({
  '1783435135970':'1783937356200','1783420836005':'1783937356201',
  '1783343460359':'1783937356203','1783075798413':'1783937356205',
  '1782994943831':'1783937356209','1782905435476':'1783937356210',
  '1782829354711':'1783937356211','1782381630879':'1783937356224',
  '1782308060945':'1783937356225','1782297313220':'1783937356226',
  '1782744999128':'1783937356212'
});
const HISTORICAL_WORK_TYPES=Object.freeze(['CONNECTION','REPAIR','OTHER','UNKNOWN_TYPE']);
const normalizeHistoricalText=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/ё/gu,'е').trim();
function historicalType(value){
  const text=normalizeHistoricalText(value).replace(/[\s_-]+/gu,'');
  if(['connection','connect','підключення','подключение'].includes(text))return 'CONNECTION';
  if(['repair','ремонт'].includes(text))return 'REPAIR';
  if(['other','інше','другое'].includes(text))return 'OTHER';
  return null;
}
const historicalHeading=line=>/^\s*(?:📋\s*)?(?:(?:заявка|наряд)\s*[:—-]\s*)?(підключення|подключение|ремонт|інше|другое)\s*[.!:]?\s*$/iu.exec(line)?.[1];

export function historicalWorkTypeEvidence(ticket){
  const canonical=[...new Set([historicalType(ticket?.type),historicalType(ticket?.work_category)].filter(Boolean))];
  const content=publicBackupText(ticket?.content,ticket?.masterNote).replace(/\r\n?/gu,'\n');
  const lines=content.split('\n');
  const headings=[...new Set(lines.map(historicalHeading).map(historicalType).filter(Boolean))];
  const tags=[],repairEvidence=[];
  for(const raw of Array.isArray(ticket?.tags)?ticket.tags:[]){
    const value=typeof raw==='string'?raw:raw?.label??raw?.name??raw?.id;
    const type=historicalType(value);if(type&&!tags.includes(type))tags.push(type);
    if(/^(?:замена|заміна)(?:onu|ону|ont)$/iu.test(normalizeHistoricalText(value).replace(/[\s_-]+/gu,''))){
      if(!tags.includes('REPAIR'))tags.push('REPAIR');repairEvidence.push('ONU_REPLACEMENT_TAG');
    }
  }
  const body=normalizeHistoricalText([...lines.filter(line=>!historicalHeading(line)),publicBackupText(ticket?.note,ticket?.masterNote),publicBackupText(ticket?.otherNote,ticket?.masterNote)].join('\n'));
  if(/(?:замен[\p{L}]*|замін[\p{L}]*|поменя[\p{L}]*|міня[\p{L}]*)\s+(?:(?:стар[\p{L}]*|нов[\p{L}]*)\s+)?(?:onu|ont|ону)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:onu|ont|ону)\s+(?:замен[\p{L}]*|замін[\p{L}]*)/iu.test(body))repairEvidence.push('ONU_REPLACEMENT_TEXT');
  if(/(?<![\p{L}\p{N}_])ремонт[\p{L}]*/iu.test(body))repairEvidence.push('REPAIR_TEXT');
  if(/(?<![\p{L}\p{N}_])(?:red\s*loss?|los)(?![\p{L}\p{N}_])|(?:красн|червон)[\p{L}]*\s+(?:los|ламп|індикатор)/iu.test(body))repairEvidence.push('RED_LOSS_TEXT');
  if(/(?:пайка|сварка|зварювання|спая[\p{L}]*)\s+оптик[\p{L}]*/iu.test(body))repairEvidence.push('OPTICAL_SPLICE_TEXT');
  if(/(?<![\p{L}\p{N}_])(?:восстанов[\p{L}]*|віднов[\p{L}]*)/iu.test(body))repairEvidence.push('RESTORE_TEXT');
  const positive=value=>Number.isFinite(Number(value))&&Number(value)>0;
  const connectionFinancials=(positive(ticket?.callFee)&&positive(ticket?.tariff))||lines.some(line=>/^\s*(?:🛠️?\s*)?(?:підключення|подключение)\s*[:—-]\s*[1-9]\d*(?:[.,]\d+)?\s*грн\s*$/iu.test(line));
  const signals=[...canonical,...headings,...tags];
  return Object.freeze({canonical:Object.freeze(canonical),headings:Object.freeze(headings),tags:Object.freeze(tags),repairEvidence:Object.freeze([...new Set(repairEvidence)]),connectionFinancials,type_conflict:new Set(signals).size>1});
}

export function resolveHistoricalWorkType(ticket,overrides=HISTORICAL_WORK_TYPE_OVERRIDES){
  const id=String(ticket?.id??'');
  const override=overrides instanceof Map?overrides.get(id):overrides?.[id];
  if(override!==undefined){if(!HISTORICAL_WORK_TYPES.includes(override))throw new Error('INVALID_HISTORICAL_WORK_TYPE_OVERRIDE');return override;}
  const e=historicalWorkTypeEvidence(ticket),signals=[...e.canonical,...e.headings,...e.tags];
  if(e.canonical.length>1||e.headings.length>1||e.tags.length>1)return 'UNKNOWN_TYPE';
  const repair=e.repairEvidence.length>0,strongReplacement=e.repairEvidence.some(code=>code.startsWith('ONU_REPLACEMENT_'));
  if(e.headings.includes('REPAIR')&&(e.tags.includes('REPAIR')||repair))return 'REPAIR';
  if(strongReplacement&&e.canonical.includes('REPAIR'))return 'REPAIR';
  const kinds=new Set(signals),families=[e.canonical,e.headings,e.tags].filter(values=>values.length).length;
  if(kinds.size===1){
    const type=signals[0];
    if(type==='OTHER'&&families>=2&&!repair)return 'OTHER';
    if(type==='REPAIR'&&(families>=2||repair))return 'REPAIR';
    // Splicing can be a normal connection work item; three agreeing type
    // sources establish a connection without relying on old JSON alone.
    if(type==='CONNECTION'&&families>=2&&(!repair||(families===3&&e.repairEvidence.every(code=>code==='OPTICAL_SPLICE_TEXT'))))return 'CONNECTION';
  }
  if(e.headings.includes('CONNECTION')&&e.connectionFinancials&&!repair&&!e.tags.includes('REPAIR')&&!e.tags.includes('OTHER')&&!e.canonical.includes('REPAIR')&&!e.canonical.includes('OTHER'))return 'CONNECTION';
  return 'UNKNOWN_TYPE';
}

// Exact full-content comparison only; no fuzzy matching, MAC/address heuristic
// or material-text comparison. Missing content/time cannot prove duplication.
export function reconcileHistoricalTickets(current,archive,core){
  if(!Array.isArray(current)||!Array.isArray(archive))throw new Error('HISTORICAL_SOURCE_UNAVAILABLE');
  const byId=new Map(),byPhysicalJob=new Map(),duplicates=[],records=[],unresolvedAliases=[];
  const normalizeTime=value=>core.timeKey(String(value).trim().replace(/^(\d):/u,'0$1:'));
  for(const [source,tickets] of [['current',current],['archive',archive]]){
    for(const ticket of [...tickets].sort((a,b)=>String(a?.id??'').localeCompare(String(b?.id??'')))){
      if(!ticket||typeof ticket!=='object'||Array.isArray(ticket)||ticket.id===undefined||ticket.id===null||String(ticket.id)==='')throw new Error('HISTORICAL_SOURCE_INVALID');
      const id=String(ticket.id),existing=byId.get(id);
      if(existing){
        if(existing.source===source)throw new Error('HISTORICAL_DUPLICATE_SOURCE_ID');
        duplicates.push(Object.freeze({reason:'SAME_TICKET_ID',kept_id:id,suppressed_id:id,kept_source:existing.source,suppressed_source:source}));continue;
      }
      byId.set(id,{ticket,source});
    }
  }
  for(const record of byId.values()){
    const ticket=record.ticket,id=String(ticket.id);
    const preferred=HISTORICAL_PHYSICAL_ALIASES[id],preferredRecord=preferred&&byId.get(preferred);
    if(preferred){
      if(preferredRecord?.source==='current'){
        duplicates.push(Object.freeze({reason:'APPROVED_PHYSICAL_ALIAS',kept_id:preferred,suppressed_id:id,kept_source:preferredRecord.source,suppressed_source:record.source}));continue;
      }
      unresolvedAliases.push(Object.freeze({ticket_id:id,preferred_id:preferred,reason:'PREFERRED_CANONICAL_RECORD_UNAVAILABLE'}));
    }
    const key=typeof ticket.content==='string'&&ticket.content.trim()&&ticket.time?JSON.stringify([core.dateKey(ticket.date),normalizeTime(ticket.time),ticket.content.replace(/\r\n?/gu,'\n')]):null;
    const compatible=(a,b)=>{
      const aType=resolveHistoricalWorkType(a),bType=resolveHistoricalWorkType(b);
      if(aType!=='UNKNOWN_TYPE'&&bType!=='UNKNOWN_TYPE'&&aType!==bType)return false;
      return ['city','street','house','apartment','address','address_display','contractNumber','sum','payment','cashAmount','cardAmount','callFee','tariff'].every(field=>{
        const av=a[field],bv=b[field];
        return av===undefined||av===null||av===''||bv===undefined||bv===null||bv===''||String(av).normalize('NFKC').trim()===String(bv).normalize('NFKC').trim();
      });
    };
    const existing=key&&(byPhysicalJob.get(key)||[]).find(candidate=>compatible(candidate.ticket,ticket));
    if(existing){duplicates.push(Object.freeze({reason:'EXACT_PHYSICAL_JOB',kept_id:String(existing.ticket.id),suppressed_id:id,kept_source:existing.source,suppressed_source:record.source}));continue;}
    if(key){if(!byPhysicalJob.has(key))byPhysicalJob.set(key,[]);byPhysicalJob.get(key).push(record);}records.push(Object.freeze(record));
  }
  return Object.freeze({records:Object.freeze(records),duplicates:Object.freeze(duplicates),unresolvedAliases:Object.freeze(unresolvedAliases)});
}

// Pure full-history pipeline. Array input remains a current-only preview;
// full reconciliation requires {current:[canonical tickets],archive:[tickets]}.
// UNKNOWN_TYPE jobs never enter connection or repair ONU counts.
export function dryRunHistoricalOnu(source,core){
  const reconciled=Array.isArray(source)?reconcileHistoricalTickets(source,[],core):reconcileHistoricalTickets(source?.current,source?.archive,core);
  const monthly=new Map(),repairRows=new Map(),customerOnuTickets=[],connectionReviews=[],unknownTypes=[],typeConflicts=[],excluded=[];
  for(const {ticket,source:origin} of reconciled.records){
    if(HISTORICAL_REBUILD_EXCLUDED_IDS.includes(String(ticket.id))){excluded.push(Object.freeze({ticket_id:String(ticket.id),reason:'CLOSED_PERIOD_NOT_RESTORING'}));continue;}
    const date=core.dateKey(ticket.date),time=core.timeKey(ticket.time||'00:00'),month=date.slice(0,7),type=resolveHistoricalWorkType(ticket),e=historicalWorkTypeEvidence(ticket);
    const reference={ticket_id:String(ticket.id),date,time,source:origin};
    if(e.type_conflict)typeConflicts.push(Object.freeze({...reference,resolved_type:type,evidence:e}));
    if(!monthly.has(month))monthly.set(month,{month,connections_total:0,connections_physical:0,connection_our_onu:0,connection_customer_onu:0,connection_unknown:0,unknown_type:0,repair_onu:0,total_physical_onu:0});
    const summary=monthly.get(month);
    if(type==='UNKNOWN_TYPE'){
      summary.unknown_type++;unknownTypes.push(Object.freeze({...reference,reason:'CONFLICTING_OR_INSUFFICIENT_TYPE_EVIDENCE',evidence:e}));continue;
    }
    if(type==='CONNECTION'){
      summary.connections_total++;summary.connections_physical++;
      const result=classifyConnectionOnu(ticket,core);
      if(result.classification==='REVIEW_REQUIRED'){
        summary.connection_unknown++;connectionReviews.push(Object.freeze({...reference,reason:result.reason}));continue;
      }
      if(result.onu_connection===1)summary.connection_our_onu++;
      else{
        summary.connection_customer_onu++;customerOnuTickets.push(Object.freeze({...reference,reason:result.reason,evidence:result.evidence}));
      }
    }else if(type==='REPAIR'){
      if(!repairRows.has(month))repairRows.set(month,[]);
      repairRows.get(month).push({...ticket,work_category:'repair',type:'Ремонт',materials_display:reportPresentation(ticket,core).materials});
    }
  }
  for(const [month,rows] of repairRows)monthly.get(month).repair_onu=confirmedRepairOnuCount(rows,core);
  const sort=(a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.ticket_id.localeCompare(b.ticket_id);
  const months=[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(summary=>Object.freeze({...summary,total_physical_onu:summary.connection_our_onu+summary.repair_onu}));
  return Object.freeze({source_mode:Array.isArray(source)?'CURRENT_ONLY':'CURRENT_AND_ARCHIVE',current_count:Array.isArray(source)?source.length:source.current.length,archive_count:Array.isArray(source)?0:source.archive.length,physical_jobs:reconciled.records.length,months:Object.freeze(months),customerOnuTickets:Object.freeze(customerOnuTickets.sort(sort)),connectionReviews:Object.freeze(connectionReviews.sort(sort)),duplicate_count:reconciled.duplicates.filter(d=>d.reason!=='SAME_TICKET_ID').length,same_id_count:reconciled.duplicates.filter(d=>d.reason==='SAME_TICKET_ID').length,duplicates:reconciled.duplicates,unresolvedAliases:reconciled.unresolvedAliases,excluded:Object.freeze(excluded),type_conflict_count:typeConflicts.length,typeConflicts:Object.freeze(typeConflicts.sort(sort)),unknownTypes:Object.freeze(unknownTypes.sort(sort))});
}

// Read-only local-report decisions from the completed source audit. Kept out
// of projectTicket/buildDTO: opening a report must not change sync hashes,
// receipts, canonical records or dispatcher operations.
const LOCAL_ONU_REVIEW_TYPES=Object.freeze({
  '1774458317620':'CONNECTION','1774458317633':'CONNECTION','1775552919257':'CONNECTION',
  '1774458317624':'OTHER','1774458317625':'OTHER','1774458317626':'OTHER',
  '1774628690218':'OTHER','1775480134445':'OTHER','1775660244884':'OTHER',
  '1776438212349':'OTHER','1776797323194':'OTHER','1776853930120':'OTHER',
  '1779774198131':'OTHER','1781370027980':'OTHER','1781716479670':'OTHER',
  '1785702374503':'OTHER','cb55b7b0-cf9e-4c9d-a6f3-1653b5f78f0a':'OTHER','ceaf6cf1-0a1a-4625-8a64-c19320d37c66':'OTHER',
  '1774458317638':'REPAIR','1774458317655':'REPAIR','1776503311178':'REPAIR',
  '1777038786488':'REPAIR','1778059754581':'REPAIR','1778163811083':'REPAIR',
  '1778163907065':'REPAIR','1778667601083':'REPAIR','1779774046364':'REPAIR',
  '1780976433188':'REPAIR','1781007346592':'REPAIR','1781088809796':'REPAIR',
  '1781179247584':'REPAIR','1781716414678':'REPAIR','1781716532814':'REPAIR',
  '1781716587669':'REPAIR','1781788780325':'REPAIR','1782128548219':'REPAIR','1783937356208':'REPAIR',
  '1783937356227':'REPAIR','1783937356219':'REPAIR',
  '1774458317639':'UNKNOWN_TYPE','1774534269278':'UNKNOWN_TYPE','1774628565896':'UNKNOWN_TYPE',
  '1775480931283':'UNKNOWN_TYPE','1776938600051':'UNKNOWN_TYPE','1779202193077':'UNKNOWN_TYPE',
  '1779460556673':'UNKNOWN_TYPE','1780922851831':'UNKNOWN_TYPE','1781007458879':'UNKNOWN_TYPE','1781716452178':'UNKNOWN_TYPE'
});
const LOCAL_ONU_OVERRIDES=Object.freeze({...HISTORICAL_ONU_OVERRIDES,'1783937356227':'OUR_ONU','1783937356219':'OUR_ONU'});
export const LOCAL_REPORT_TEST_IDS=Object.freeze(['1778319337856']);

// One pure adapter over the existing classifier/repair counter. Its input is
// ONLY the currently selected local tickets; never Sheets/archive/report rows.
export function localOnuStatistics(tickets,core){
  if(!Array.isArray(tickets))throw new Error('LOCAL_TICKETS_REQUIRED');
  const unique=new Map(),conflicts=new Set(),unknown=[],excluded=[];
  const reference=t=>({ticket_id:String(t.id),date:String(t.date||''),time:String(t.time||'')});
  for(const ticket of tickets){
    if(!ticket||ticket.id===undefined||ticket.id===null||String(ticket.id)==='')throw new Error('LOCAL_TICKET_ID_REQUIRED');
    const id=String(ticket.id);
    if(LOCAL_REPORT_TEST_IDS.includes(id)||HISTORICAL_REBUILD_EXCLUDED_IDS.includes(id)){excluded.push(id);continue;}
    if(unique.has(id)&&JSON.stringify(unique.get(id))!==JSON.stringify(ticket))conflicts.add(id);
    else if(!unique.has(id))unique.set(id,ticket);
  }
  for(const id of conflicts){unknown.push({...reference(unique.get(id)),reason:'DUPLICATE_ID_CONFLICT'});unique.delete(id);}
  const reconciled=reconcileHistoricalTickets([...unique.values()],[],core);
  let connection=0,repair=0;
  for(const {ticket} of reconciled.records){
    const id=String(ticket.id),ref=reference(ticket);
    // The explicit modern contract wins historical template defaults.
    const modernType=ticket.onuAccountingVersion===1?historicalType(ticket.type):null;
    const type=LOCAL_ONU_REVIEW_TYPES[id]??HISTORICAL_WORK_TYPE_OVERRIDES[id]??modernType??resolveHistoricalWorkType(ticket);
    if(type==='UNKNOWN_TYPE'){unknown.push({...ref,reason:'UNKNOWN_TYPE'});continue;}
    if(type==='CONNECTION'){
      const result=classifyConnectionOnu(ticket,core);
      if(result.classification==='REVIEW_REQUIRED')unknown.push({...ref,reason:'ONU_SELECTION_REVIEW_REQUIRED'});
      else connection+=result.onu_connection;
    }else if(type==='REPAIR'){
      if(LOCAL_ONU_OVERRIDES[id]==='UNKNOWN'){unknown.push({...ref,reason:'UNKNOWN_ONU_CONSUMPTION'});continue;}
      const record={...ticket,type:'Ремонт',work_category:'repair',materials_display:reportPresentation(ticket,core).materials};
      const quantity=confirmedRepairOnuCount([record],core,LOCAL_ONU_OVERRIDES);
      if(!Number.isFinite(quantity)||quantity<0)unknown.push({...ref,reason:'INVALID_ONU_QUANTITY'});
      else repair+=quantity;
    }
  }
  return {connection,repair,unknown,excluded:[...new Set(excluded)],duplicates:reconciled.duplicates.length};
}


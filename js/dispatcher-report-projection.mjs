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

export function projectTicket(ticket,core,now=Date.now(),overrides=HISTORICAL_ONU_OVERRIDES){
  const text=v=>core.sanitize(v);
  const connection=/^п[іо]дключен(?:ня|ие)$/iu.test(String(ticket.type||''));
  // Saved equipment contains selected rows (checked may be absent). An explicit
  // empty/unchecked list means customer-owned ONU; never infer it from notes.
  const hasEquipment=Array.isArray(ticket.equipment)&&(!ticket.cloudImported||ticket.equipment.length>0);
  const selectedOnu=(ticket.equipment||[]).find(e=>core.isOnuEquipment(e)&&e.checked!==false);
  let seenOnu=false;
  const equipment=connection&&hasEquipment?ticket.equipment.flatMap(e=>{
    if(!core.isOnuEquipment(e))return [e];
    if(e.checked===false||seenOnu)return [];seenOnu=true;return [{...e,qty:1,consumption_qty:1,price:0}];
  }):ticket.equipment;
  const projected=connection&&hasEquipment?{...ticket,equipment}:ticket;
  const safePublic={id:ticket.id,date:ticket.date,type:ticket.type,macAddress:ticket.macAddress,
    equipment:(ticket.equipment||[]).map(e=>({label:publicBackupText(e.label),checked:e.checked,qty:e.qty,consumption_qty:e.consumption_qty})).map(e=>Object.fromEntries(Object.entries(e).filter(([,v])=>v!==undefined))),
    cables:(ticket.cables||[]).map(c=>({label:publicBackupText(c.label),meters:c.meters})),
    presetWorks:(ticket.presetWorks||[]).map(w=>({label:publicBackupText(w.label),qty:w.qty,checked:w.checked})),
    additionalWork:(ticket.additionalWork||[]).map(w=>({desc:publicBackupText(w.desc)})),
    note:publicBackupText(ticket.note),otherNote:publicBackupText(ticket.otherNote)};
  const analysis=workEvents(safePublic,publicBackupText(ticket.content,ticket.masterNote),{profile:'physical_consumption'});
  const quantity=(entity,action)=>analysis.events.filter(e=>e.category==='definite'&&e.entity===entity&&(!action||e.action===action)).reduce((s,e)=>s+(e.quantity||0),0);
  const presentation=reportPresentation(projected,core);
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
    if(category==='connection'&&hasEquipment){dto.onu_used=selectedOnu?1:0;dto.onu_replacement=0;}
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
export async function buildDTO(ticket,core,now=Date.now(),overrides=HISTORICAL_ONU_OVERRIDES){
  const dto=projectTicket(ticket,core,now,overrides),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(core.content(dto)));
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


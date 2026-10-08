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
  let materials=[...equipment.filter(e=>e.checked!==false&&Number(e.consumption_qty??e.qty??1)>0).map(e=>core.sanitize(e.label)+' — '+(e.consumption_qty??e.qty??1)+' шт.'),...cables.filter(c=>Number(c.meters)>0).map(c=>core.sanitize(c.label)+' — '+Number(c.meters)+' м')];
  if((raw&&!equipment.length&&!cables.length)||(!Array.isArray(ticket.equipment)&&!Array.isArray(ticket.cables))){
    materials=lines.flatMap(line=>{
      // Exact markers emitted by buildTicketContent; no fuzzy note guessing.
      const match=/^\s*(?:🛠️?|🔌)\s*([^:\n]+):\s*(\d+(?:[.,]\d+)?)\s*(шт\.?|м)(?=\s|$|[хx×])/u.exec(line);
      if(!match||Number(match[2].replace(',','.'))<=0)return [];
      const label=core.sanitize(match[1]);return label?[label+' — '+Number(match[2].replace(',','.'))+' '+(match[3].startsWith('шт')?'шт.':'м')]:[];
    });
  }
  const note=ticket.note||ticket.otherNote||((raw||ticket.note===undefined)?lines.filter(line=>/^\s*📝\s*/u.test(line)).map(line=>line.replace(/^\s*📝\s*/u,'')).join('\n'):'');
  const field=pattern=>core.sanitize(lines.map(line=>pattern.exec(line)?.[1]||'').find(Boolean)||'');
  const header=raw?field(/^\s*📋\s*ЗАЯВКА:\s*(ПІДКЛЮЧЕННЯ|РЕМОНТ)\s*$/u):'';
  const type=header==='РЕМОНТ'?'Ремонт':header==='ПІДКЛЮЧЕННЯ'?'Підключення':String(ticket.type||'');
  const payment=String(ticket.payment||'')||(raw?field(/^\s*💳\s*Оплата:\s*(Готівка|Безготівка|Безкоштовно|Змішана)\s*$/u):'');
  const tariff=Number(ticket.tariff)>0?'Тариф: '+Number(ticket.tariff)+' грн':raw?field(/^\s*💎\s*(Тариф:\s*\d+(?:[.,]\d+)?\s*грн)\s*$/u):'';
  return {materials:materials.filter(line=>!line.startsWith(' —')).join('\n'),note:[tariff,core.sanitize(publicBackupText(note,ticket.masterNote))].filter(Boolean).join('\n'),type,payment,
    city:core.sanitize(ticket.city)|| (raw?field(/^\s*🏙️?\s*Місто:\s*(.+)$/u):''),address:core.sanitize(ticket.address)|| (raw?field(/^\s*📍\s*Адреса:\s*(.+)$/u):'')};
}
export function projectTicket(ticket,core,now=Date.now()){
  const text=v=>core.sanitize(v);
  const safePublic={id:ticket.id,date:ticket.date,type:ticket.type,macAddress:ticket.macAddress,
    equipment:(ticket.equipment||[]).map(e=>({label:publicBackupText(e.label),checked:e.checked,qty:e.qty,consumption_qty:e.consumption_qty})).map(e=>Object.fromEntries(Object.entries(e).filter(([,v])=>v!==undefined))),
    cables:(ticket.cables||[]).map(c=>({label:publicBackupText(c.label),meters:c.meters})),
    presetWorks:(ticket.presetWorks||[]).map(w=>({label:publicBackupText(w.label),qty:w.qty,checked:w.checked})),
    additionalWork:(ticket.additionalWork||[]).map(w=>({desc:publicBackupText(w.desc)})),
    note:publicBackupText(ticket.note),otherNote:publicBackupText(ticket.otherNote)};
  const analysis=workEvents(safePublic,publicBackupText(ticket.content,ticket.masterNote),{profile:'physical_consumption'});
  const quantity=(entity,action)=>analysis.events.filter(e=>e.category==='definite'&&e.entity===entity&&(!action||e.action===action)).reduce((s,e)=>s+(e.quantity||0),0);
  const presentation=reportPresentation(ticket,core);
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
  if(type==='Інше'){
    for(const key of ['city','street','house','apartment','address_display','materials_display','mac_onu','partner_display'])dto[key]='';
    dto.dispatcher_comment=text(publicBackupText(ticket.otherNote||ticket.note||''));
    dto.onu_used=0;dto.onu_replacement=0;dto.router_used=0;
  }
  return dto;
}
export async function buildDTO(ticket,core,now=Date.now()){
  const dto=projectTicket(ticket,core,now),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(core.content(dto)));
  dto.source_hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');return core.validate(dto);
}

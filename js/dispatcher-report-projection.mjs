/* Reuse the exact existing, pure physical engine. Never call /ask, alter the
   Worker, or duplicate its business heuristics. The local ticket is projected
   before analysis and only three normalized counters cross the report boundary. */
import {workEvents} from '../mcp/src/ask/work-events.js';
import {publicBackupText} from '../mcp/src/gas/mappers.js';
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
  const total=Number(ticket.sum??0),payment=String(ticket.payment||''),free=payment==='Безкоштовно';
  const cash=free?0:payment==='Готівка'?total:payment==='Змішана'?Number(ticket.cashAmount||0):0;
  const card=free?0:payment==='Безготівка'?total:payment==='Змішана'?Number(ticket.cardAmount||0):0;
  const materials=[...(ticket.equipment||[]).filter(e=>e.checked!==false).map(e=>text(e.label)+' '+(e.consumption_qty??e.qty??1)+' шт.'),...(ticket.cables||[]).filter(c=>Number(c.meters)>0).map(c=>text(c.label)+' '+Number(c.meters)+' м')].join(', ');
  const type=String(ticket.type||''),category=/^п[іо]дключен(?:ня|ие)$/iu.test(type)?'connection':/^ремонт$/iu.test(type)?'repair':'other';
  const dto={ticket_id:String(ticket.id),work_date:core.dateKey(ticket.date),work_time:core.timeKey(ticket.time||'00:00'),work_type:text(type),work_category:category,
    city:text(ticket.city),street:text(ticket.street),house:text(ticket.house),apartment:text(ticket.apartment),
    address_display:text([ticket.city,ticket.address||[ticket.street,ticket.house,ticket.apartment&&'кв. '+ticket.apartment].filter(Boolean).join(' ')].filter(Boolean).join(', ')),
    materials_display:materials,mac_onu:String(ticket.macAddress||'').trim(),partner_display:text((ticket.connectMasters||[]).map(n=>typeof n==='string'?n:n?.name||'').filter(Boolean).join(', ')),
    payment_type:text(payment),amount:free?0:total,total:free?0:total,dispatcher_comment:text(publicBackupText(ticket.note||ticket.otherNote||'')),
    onu_used:quantity('onu'),onu_replacement:quantity('onu','replace'),router_used:quantity('router'),payment_cash:cash,payment_cashless:card,
    // Free amount is the saved monetary amount, not a guessed inventory price.
    payment_free_amount:free?total:0,payment_free_count:free?1:0,updated_at:new Date(now).toISOString(),source_version:now,source_hash:''};
  return dto;
}
export async function buildDTO(ticket,core,now=Date.now()){
  const dto=projectTicket(ticket,core,now),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(core.content(dto)));
  dto.source_hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');return core.validate(dto);
}

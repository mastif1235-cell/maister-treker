/* Small deterministic vertical slice. Other language still uses the existing
   LLM tool parser. Do not silently discard address/price/unknown constraints. */
import {ENTITIES,ACTIONS} from './work-events.js';
import {resolveDateRanges} from './date-resolver.js';
import {resolveRosterCoworker} from './coworker-names.js';
function concepts(text,defs){
  const found=[];
  for(const def of defs){
    const re=new RegExp('(?<![\\p{L}\\p{N}])(?:'+def.pattern.replaceAll('[а-я]','[а-яіїєґ]')+')(?![\\p{L}\\p{N}])','iu');
    const m=re.exec(text);
    if(m) found.push({id:def.id,start:m.index,end:m.index+m[0].length});
  }
  return found.filter(f=>!found.some(p=>p.id!==f.id && p.start<=f.start && p.end>=f.end && p.end-p.start>f.end-f.start));
}
export function workIntent(question,now,roster){
  const q=String(question||'').toLowerCase();
  if(!/(сколько|скільки|покаж|показать|средн|середн|худш|найгір|лучш|найкращ|чаще|найчаст|більше|больше)/u.test(q)) return null;
  const entities=concepts(q,ENTITIES), actions=concepts(q,ACTIONS);
  if(entities.length>1 || actions.length>1) return null;
  // Named locations and item-price constraints need the ordinary LLM parser.
  if(/(?:улиц|вулиц|адрес|город|міст|село|грн|договор|договір|телефон|mac|на\s+[\p{L}]+|в\s+днепр|у\s+дніпр)/iu.test(q)) return null;
  const signalQuestion=/сигнал|d\s*bm|д\s*бм/iu.test(q);
  if(/по\s+\d/iu.test(q) && !/(?:с|з)\s+\d+\s+по\s+\d+/iu.test(q)) return null;
  const equipmentQuestion=/оборудован|обладнан/iu.test(q);
  if(!entities.length && !signalQuestion && !equipmentQuestion) return null;
  const semantic={};
  if(entities.length) semantic.entity=entities[0].id;
  if(actions.length) semantic.action=actions[0].id;
   if(semantic.entity==='connection' && (!semantic.action || semantic.action==='connect')) semantic.action='complete';
  if(/упоминан|згадк/iu.test(q)){semantic.action='mention';semantic.category='all';}
  if(signalQuestion && semantic.entity==='onu' && !semantic.action) delete semantic.entity;
  const params={mode:/покаж|показать/iu.test(q)?'list':/средн|середн|худш|найгір|лучш|найкращ/iu.test(q)?'stats':'count',semantic};
  if(params.mode==='list') params.limit=8;
  if(/по\s+напарник|кожн.*напарник|с\s+кем|з\s+ким/iu.test(q)){params.mode='group';params.group_by='coworker';}
  if(equipmentQuestion){params.mode='group';params.group_by='entity';}
  const coworker=/(?:^|\s)(?:с|со|з|із)\s+([\p{L}ʼ'-]+)/iu.exec(q);
  const nonPerson=coworker&&(['кем','ким','каждым','кожним'].includes(coworker[1])||/^сигнал[\p{L}]*$/iu.test(coworker[1]));
  if(coworker && !nonPerson){
    const name=resolveRosterCoworker(coworker[1],roster);
    if(!name)return {clarification:true,question:'Уточніть період датами або напарника з переліку в Налаштуваннях. Невідоме слово після «с/з» не вважається імʼям майстра.'};
    params.coworker=name;
  }
  const ranges=resolveDateRanges(q,now);
  if(ranges.length>1) return null;
  if(ranges.length){params.date_from=ranges[0].from;params.date_to=ranges[0].to;}
  // Invalid explicit date phrases cannot become an all-time query.
  if(!ranges.length && /(?:с|з)\s+\d|за\s+\d|20\d{2}/u.test(q)) return null;
  const threshold=/(хуже|гірше|ниже|нижче)\s*(-\d+(?:[.,]\d+)?)/iu.exec(q);
  if(threshold) params.signal_worse_than=Number(threshold[2].replace(',','.'));
  if(/\d/u.test(q) && !ranges.length && !threshold) return null;
  if(signalQuestion){
    if(!threshold) params.has_signal=true;
    if(/вход|вхід/iu.test(q)) semantic.signal_context='input';
  }
  // This shortcut is intentionally closed: unknown constraints go to the
  // existing LLM schema parser, never to a silently broader fast-path query.
  let residual=q;
  for(const def of ENTITIES.concat(ACTIONS)) residual=residual.replace(new RegExp('(?<![\\p{L}\\p{N}])(?:'+def.pattern.replaceAll('[а-я]','[а-яіїєґ]')+')(?![\\p{L}\\p{N}])','giu'),' ');
  if(params.coworker || (coworker&&nonPerson)) residual=residual.replace(coworker[0],' ');
  if(threshold) residual=residual.replace(threshold[0],' ');
  if(semantic.entity==='connection')residual=residual.replace(/(?<![\p{L}])(?:пров[её]л[аи]?|пров[іе]в|виконав)(?![\p{L}])/giu,' ');
  residual=residual.replace(/[\d.,:?!-]+/g,' ');
  const filler=/^(?:сколько|скільки|я|ми|мы|покажи|покажіть|показать|показати|сделал|зробив|зробили|бы[лв][а-я]*|бул[а-я]*|за|в|у|з|с|по|до|эт[а-я]*|ц[еь][а-я]*|прошл[а-я]*|минул[а-я]*|сегодня|сьогодні|вчера|вчора|недел[а-я]*|тижд[а-я]*|месяц[а-я]*|місяц[а-яь]*|последн[а-я]*|останн[а-яі]*|дней|дня|днів|год|рік|время|час|все|всё|увесь|весь|январ[а-я]*|феврал[а-я]*|март[а-я]*|апрел[а-я]*|ма[йяе]|июн[а-я]*|июл[а-я]*|август[а-я]*|сентябр[а-я]*|октябр[а-я]*|ноябр[а-я]*|декабр[а-я]*|січн[а-яі]*|лют[а-яі]*|берез[а-яі]*|квіт[а-яі]*|трав[а-яі]*|черв[а-яі]*|лип[а-яі]*|серп[а-яі]*|верес[а-яі]*|жовт[а-яі]*|листопад[а-яі]*|груд[а-яі]*|заявок|заявки|заяв[а-я]*|сигнал[а-я]*|dBm|дбм|средн[а-я]*|середн[а-яі]*|худш[а-я]*|найгірш[а-яі]*|самый|самая|най|лучш[а-я]*|найкращ[а-яі]*|был|чаще|всего|найчаст[а-яі]*|какое|яке|оборудован[а-я]*|обладнан[а-яі]*|каждым|кожним|по|напарник[а-яі]*|с|кем|з|ким|упоминан[а-я]*|згадк[а-яі]*)$/iu;
  if(residual.split(/[^\p{L}]+/u).filter(Boolean).some(t=>!filler.test(t))) return null;
  semantic.category=semantic.category||'definite';
   semantic.signal_context=semantic.signal_context||'subscriber';
   semantic.profile=semantic.entity==='onu'&&semantic.action==='install'?'onu_physical':'work_v2';
  return params;
}

export function workAnswer(data,params){
  if(data.clarification) return data.question;
  const totals=data.work_totals;
  if(!totals) return null;
  const period=params.date_from||params.date_to ? (params.date_from||'…')+'–'+(params.date_to||'…') : 'увесь час';
  const sem=data.resolved_filters.semantic;
  const lines=['Період: '+period+'.', 'Знайдено '+totals.tickets+' заявок; '+totals.events+' подій ('+(sem.entity||'усі обʼєкти')+' / '+(sem.action||'аналіз сигналу')+').'];
   if(totals.onu_breakdown){
     const b=totals.onu_breakdown;
     lines.push('Нові підключення: '+b.new_connections+'; окремі установки: '+b.standalone_installs+'; заміни: '+b.replacements+'.');
     lines.push('Всього фізичних встановлень ONU (подій): '+b.total_physical_placements+'. ONU абонента виключено: '+b.customer_owned_excluded+'; перенос/повторне використання: '+b.reused_excluded+'.');
   }
   if(totals.quantity_known_events) lines.push((totals.business_derived_quantity_events?'Відома кількість (включає business-derived з підключень): ':'Явно вказана кількість: ')+totals.quantity_sum+'; подій без кількості: '+totals.quantity_unknown_events+'.');
    if(totals.legacy_coworker_tickets)lines.push('У '+totals.legacy_coworker_tickets+' заявках майстер вказаний в історичному тезі самої заявки (legacy_master_tag); включено в definite підрахунок, не за зміною.');
  if(totals.ambiguous_tickets) lines.push('Ще '+totals.ambiguous_tickets+' заявок неоднозначні — не включені в основний підрахунок.');
  if(params.mode==='stats') lines.push('Сума заявок: '+totals.money_sum+' грн. Сигнал: середній '+(totals.signal.average??'не вказано')+', найгірший '+(totals.signal.min??'не вказано')+', найкращий '+(totals.signal.max??'не вказано')+' dBm.');
  if(params.mode==='group') for(const group of totals.groups) lines.push(group.key+': '+group.tickets+' заявок, '+group.events+' подій.');
  if(data.evidence){
    lines.push('Показано '+data.evidence.length+' із '+totals.tickets+' заявок.');
      data.evidence.forEach((row,i)=>lines.push((i+1)+'. '+row.date+' · '+row.ticket_id+' · '+(data.tickets[i]?.address||'адреса не вказана')+' · '+(row.coworker_reason==='legacy_master_tag'?params.coworker||'майстер':row.coworkers.join(', ')||'напарник не вказаний')+(row.coworker_reason?' ('+row.coworker_reason+': '+(row.coworker_reason==='legacy_master_tag'?'майстер вказаний в історичному тезі самої заявки':'майстер прямо вказаний у заявці')+')':'')+' — '+row.events.slice(0,3).map(e=>e.evidence+' ('+e.reason+')').join('; ')+(row.events.length>3?' …':'')));
      for(const row of data.exclusion_evidence||[])lines.push('Виключено: '+row.ticket_id+' · '+row.reason+' · '+row.evidence+'.');
  }
  lines.push('Установки, заміни, зняття, перевірки та прості згадки розділено. Кількість одиниць не вигадується. Для перевірки: «Показати заявки» або «Чому так пораховано?»');
  return lines.join('\n');
}

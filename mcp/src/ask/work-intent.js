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
// A date-only continuation changes dates, never lets an LLM reconstruct the
// equipment/action/coworker filters from the wording of a previous breakdown.
// Closed grammar: additional constraints remain on the ordinary parser path.
export function parseTemporalWorkPeriod(question,now,queryContext){
  if(!queryContext?.resolved_filters?.semantic || !['count','list'].includes(queryContext.mode)) return null;
  const month='(?:январ(?:ь|я|е)|феврал(?:ь|я|е)|март(?:а|е)?|апрел(?:ь|я|е)|ма[йяе]|июн(?:ь|я|е)|июл(?:ь|я|е)|август(?:а|е)?|сентябр(?:ь|я|е)|октябр(?:ь|я|е)|ноябр(?:ь|я|е)|декабр(?:ь|я|е)|січ(?:ень|ня|ні)|лют(?:ий|ого|ому)|берез(?:ень|ня|ні)|квіт(?:ень|ня|ні)|трав(?:ень|ня|ні)|черв(?:ень|ня|ні)|лип(?:ень|ня|ні)|серп(?:ень|ня|ні)|верес(?:ень|ня|ні)|жовт(?:ень|ня|ні)|листопад(?:а|і)?|груд(?:ень|ня|ні))';
  if(!new RegExp('^(?:а\\s+)?(?:(?:в|у|за|на|з)\\s+)?'+month+'(?:\\s+20\\d{2}(?:\\s+(?:году|рік|року))?)?[.!?\\s]*$','iu').test(String(question||'').trim())) return null;
  const year=/\.(20\d{2})$/.exec(queryContext.resolved_filters.date_from||'')?.[1];
  const sameYear=year&&String(queryContext.resolved_filters.date_to||'').endsWith('.'+year);
  const ranges=resolveDateRanges(String(question)+(!/20\d{2}/.test(question)&&sameYear?' '+year:''),now);
  if(ranges.length!==1 || ranges[0].approximate) return null;
  return {from:ranges[0].from,to:ranges[0].to};
}
// Legacy fallback/compiler. The period grammar and resolver are shared with
// QueryState; supplying a parsed period avoids parsing twice on fallback.
export function temporalWorkIntent(question,now,queryContext,parsedPeriod){
  const period=parsedPeriod===undefined?parseTemporalWorkPeriod(question,now,queryContext):parsedPeriod;
  if(!period) return null;
  return {...queryContext.resolved_filters,mode:queryContext.mode==='list'?'list':'count',...(queryContext.mode==='list'?{limit:8}:{}),date_from:period.from,date_to:period.to};
}
export function workIntent(question,now,roster){
  const original=String(question||'').toLowerCase();
  const repairType=/(?:на|при)\s+ремонт[\p{L}]*/iu.test(original),connectionType=/(?:на|при)\s+(?:подключен|підключен)[\p{L}]*/iu.test(original);
  if(repairType&&connectionType)return null;
  const q=original.replace(/(?:на|при)\s+(?:ремонт|подключен|підключен)[\p{L}]*/giu,' ');
  if(!/(сколько|скільки|покаж|показать|средн|середн|худш|найгір|лучш|найкращ|чаще|найчаст|більше|больше)/u.test(q)) return null;
  const entities=concepts(q,ENTITIES), actions=concepts(q,ACTIONS);
  if(entities.length>1 || actions.length>1) return null;
  // Named locations and item-price constraints need the ordinary LLM parser.
  if(/(?:улиц|вулиц|адрес|город|міст|село|грн|договор|договір|телефон|mac|на\s+[\p{L}]+|в\s+днепр|у\s+дніпр)/iu.test(q)) return null;
  const signalQuestion=/сигнал|d\s*bm|д\s*бм/iu.test(q);
  if(/по\s+\d/iu.test(q) && !/(?:с|з)\s+\d+\s+по\s+\d+/iu.test(q)) return null;
  const equipmentQuestion=/оборудован|обладнан|материал|матеріал/iu.test(q);
  const consumptionQuestion=/ушло|пішло|списать|списати|использовал|використав|використали/iu.test(q);
  if(!entities.length && !signalQuestion && !equipmentQuestion) return null;
  const semantic={};
  if(entities.length) semantic.entity=entities[0].id;
  if(actions.length) semantic.action=actions[0].id;
   if(semantic.entity==='connection' && (!semantic.action || semantic.action==='connect')) semantic.action='complete';
  if(/упоминан|згадк/iu.test(q)){semantic.action='mention';semantic.category='all';}
  if(signalQuestion && semantic.entity==='onu' && !semantic.action) delete semantic.entity;
  const params={mode:/покаж|показать/iu.test(q)?'list':/средн|середн|худш|найгір|лучш|найкращ/iu.test(q)?'stats':'count',semantic};
  if(repairType)params.type='Ремонт';
  if(connectionType)params.type='Підключення';
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
  if(equipmentQuestion)residual=residual.replace(/материал[\p{L}]*|матеріал[\p{L}]*/giu,' ');
  if(consumptionQuestion)residual=residual.replace(/ушло|пішло|списать|списати|использовал[\p{L}]*|використав[\p{L}]*|використали/giu,' ');
  for(const def of ENTITIES.concat(ACTIONS)) residual=residual.replace(new RegExp('(?<![\\p{L}\\p{N}])(?:'+def.pattern.replaceAll('[а-я]','[а-яіїєґ]')+')(?![\\p{L}\\p{N}])','giu'),' ');
  if(params.coworker || (coworker&&nonPerson)) residual=residual.replace(coworker[0],' ');
  if(threshold) residual=residual.replace(threshold[0],' ');
  if(semantic.entity==='connection')residual=residual.replace(/(?<![\p{L}])(?:пров[её]л[аи]?|пров[іе]в|виконав)(?![\p{L}])/giu,' ');
  residual=residual.replace(/[\d.,:?!-]+/g,' ');
  const filler=/^(?:сколько|скільки|я|ми|мы|покажи|покажіть|показать|показати|сделал|зробив|зробили|бы[лв][а-я]*|бул[а-я]*|за|в|у|з|с|по|до|эт[а-я]*|ц[еь][а-я]*|прошл[а-я]*|минул[а-я]*|сегодня|сьогодні|вчера|вчора|недел[а-я]*|тижд[а-я]*|месяц[а-я]*|місяц[а-яь]*|последн[а-я]*|останн[а-яі]*|дней|дня|днів|год|рік|время|час|все|всё|увесь|весь|январ[а-я]*|феврал[а-я]*|март[а-я]*|апрел[а-я]*|ма[йяе]|июн[а-я]*|июл[а-я]*|август[а-я]*|сентябр[а-я]*|октябр[а-я]*|ноябр[а-я]*|декабр[а-я]*|січн[а-яі]*|лют[а-яі]*|берез[а-яі]*|квіт[а-яі]*|трав[а-яі]*|черв[а-яі]*|лип[а-яі]*|серп[а-яі]*|верес[а-яі]*|жовт[а-яі]*|листопад[а-яі]*|груд[а-яі]*|заявок|заявки|заяв[а-я]*|сигнал[а-я]*|dBm|дбм|средн[а-я]*|середн[а-яі]*|худш[а-я]*|найгірш[а-яі]*|самый|самая|най|лучш[а-я]*|найкращ[а-яі]*|был|чаще|всего|найчаст[а-яі]*|какое|яке|оборудован[а-я]*|обладнан[а-яі]*|каждым|кожним|по|напарник[а-яі]*|с|кем|з|ким|упоминан[а-я]*|згадк[а-яі]*)$/iu;
  if(residual.split(/[^\p{L}]+/u).filter(Boolean).some(t=>!filler.test(t))) return null;
  semantic.category=semantic.category||'definite';
   semantic.signal_context=semantic.signal_context||'subscriber';
   const physical=!signalQuestion&&semantic.action!=='mention'&&(consumptionQuestion||['install','replace','lay'].includes(semantic.action)||((repairType||connectionType)&&semantic.entity&&semantic.entity!=='connection'));
   if(physical&&!semantic.action)semantic.action='install';
   semantic.profile=physical?(semantic.entity==='onu'&&semantic.action==='install'?'onu_physical':'physical_consumption'):'work_v2';
  return params;
}

export function workAnswer(data,params,options={}){
  if(data.clarification) return data.question;
  const totals=data.work_totals;
  if(!totals) return null;
  const period=params.date_from||params.date_to ? (params.date_from||'…')+'–'+(params.date_to||'…') : 'увесь час';
  const sem=data.resolved_filters.semantic;
  const russian=/сколько|поставил|заменил|почему|покажи|списать|оборудован|январ|феврал|март|апрел|ма[йяе](?![\p{L}])|июн|июл|август|сентябр|октябр|ноябр|декабр/iu.test(options.question||'');
  const diagnostic=options.diagnostic===true;
  const labels={onu:'ONU',router:russian?'Роутер':'Роутер',onu_power_supply:'БП ONU',router_power_supply:russian?'БП роутера':'БП роутера',cable:russian?'Кабель':'Кабель',fiber:russian?'Оптический кабель':'Оптичний кабель'};
  const entityName=e=>labels[e]||e.replace(/^material:/,'');
  const unit=u=>u==='m'?'м':'шт.';
  let humanPeriod=period;
  const from=/^01\.(\d{2})\.(\d{4})$/.exec(params.date_from||''),to=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(params.date_to||'');
  if(from&&to&&from[1]===to[2]&&from[2]===to[3]&&Number(to[1])===new Date(Date.UTC(Number(from[2]),Number(from[1]),0)).getUTCDate())humanPeriod=new Intl.DateTimeFormat(russian?'ru':'uk',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(Number(from[2]),Number(from[1])-1,1)));
  const named=/(?:^|\s)(?:с|со|з|із)\s+([\p{L}ʼ'-]+)/iu.exec(options.question||'');
  const person=named&&params.coworker&&resolveRosterCoworker(named[1],[params.coworker])===params.coworker?named[1]:params.coworker;
  const withPerson=person?(russian?' вместе с ':' разом з ')+person:'';
  if(!diagnostic&&['count','group'].includes(params.mode)){
    const prefix=(russian?'За ':'За ')+humanPeriod+withPerson;
    if(params.mode==='group'&&params.group_by!=='entity'){
      const actions={install:russian?'Установки':'Установки',replace:russian?'Замены':'Заміни',check:russian?'Проверки':'Перевірки',complete:russian?'Подключения':'Підключення'};
      return [prefix+':',...(totals.groups||[]).map(g=>(params.group_by==='action'?actions[g.key]||g.key:g.key)+': '+(totals.consumption_totals&&g.quantity_sum!=null?g.quantity_sum+' '+unit(g.unit):g.events+(russian?' выполненных работ.':' виконаних робіт.')))].join('\n');
    }
    if(totals.consumption_totals){
      const items=totals.consumption_totals;
      if(sem.entity==='onu'){
        const item=items.find(e=>e.entity==='onu')||{quantity:0,connection:0,repair:0,other:0};
        const lines=[prefix+(russian?' установлено ':' встановлено ')+item.quantity+' ONU:'];
        lines.push(item.connection+(russian?' на подключениях,':' на підключеннях,'));
        lines.push(item.repair+(russian?' на ремонтах/заменах.':' на ремонтах/замінах.'));
        if(item.other)lines.push(item.other+(russian?' на других работах.':' на інших роботах.'));
        return lines.join('\n');
      }
      return items.length?[prefix+':',...items.map(e=>entityName(e.entity)+' — '+e.quantity+' '+unit(e.unit))].join('\n'):(russian?'Подтверждённого расхода оборудования нет.':'Підтвердженої витрати обладнання немає.');
    }
    if(params.mode==='group')return [prefix+':',...(totals.groups||[]).map(g=>(params.group_by==='entity'?entityName(g.key):g.key)+': '+g.events+(russian?' выполненных работ.':' виконаних робіт.'))].join('\n');
    return prefix+': '+totals.events+(russian?' выполненных работ.':' виконаних робіт.');
  }
  if(!diagnostic&&params.mode==='list'){
    const reasons={structured_consumption:russian?'Оборудование указано в заявке':'Обладнання вказано в заявці',derived_from_connection:russian?'Подключение с подтверждённым оборудованием':'Підключення з підтвердженим обладнанням',explicit_install:russian?'Указана установка':'Вказана установка',explicit_replace:russian?'Указана замена':'Вказана заміна',customer_owned_onu:russian?'ONU клиента':'ONU абонента',reused_onu_transfer:russian?'Повторно использована/перенесена существующая ONU':'Повторно використана/перенесена наявна ONU'};
    const lines=[];
    if(sem.category==='excluded'){
      for(const [i,t] of (data.tickets||[]).entries()){const why=(data.exclusion_evidence||[]).find(e=>e.ticket_id===t.id);lines.push((i+1)+'. '+t.date+' · '+(t.address||'')+' — '+(reasons[why?.reason]||(russian?'Не новое оборудование':'Не нове обладнання'))+'.');}
    }else for(const [i,row] of (data.evidence||[]).entries()){
      const why=(row.events||[]).slice(0,3).map(e=>entityName(e.entity)+(e.quantity!=null?' — '+e.quantity+' '+unit(e.unit):'')+' · '+(reasons[e.reason]||(russian?'Подтверждённая работа':'Підтверджена робота'))).join('; ');
      const coworker=row.coworker_reason==='legacy_master_tag'?(russian?'Мастер указан в историческом теге самой заявки':'Майстер вказаний в історичному тезі самої заявки'):row.coworker_reason==='direct_ticket'?(russian?'Мастер прямо указан в заявке':'Майстер прямо вказаний у заявці'):'';
      lines.push((i+1)+'. '+row.date+' · '+(data.tickets?.[i]?.address||'')+' — '+why+(coworker?'. '+coworker:'')+'.');
    }
    return lines.length?lines.join('\n'):(russian?'Подходящих заявок не найдено.':'Відповідних заявок не знайдено.');
  }
  if(!diagnostic&&params.mode==='stats'){
    const s=totals.signal;
    return (russian?'За ':'За ')+humanPeriod+withPerson+': '+(russian?'средний сигнал ':'середній сигнал ')+(s.average??'—')+' dBm; '+(russian?'минимальный ':'мінімальний ')+(s.min??'—')+'; '+(russian?'максимальный ':'максимальний ')+(s.max??'—')+'.';
  }
  const lines=['Період: '+period+'.', 'Знайдено '+totals.tickets+' заявок; '+totals.events+' подій ('+(sem.entity||'усі обʼєкти')+' / '+(sem.action||'аналіз сигналу')+').'];
   if(totals.onu_breakdown){
     const b=totals.onu_breakdown;
     lines.push('Нові підключення: '+b.new_connections+'; окремі установки: '+b.standalone_installs+'; заміни: '+b.replacements+'.');
     lines.push('Всього фізично використано ONU (шт.): '+b.total_physical_placements+'. ONU абонента виключено: '+b.customer_owned_excluded+'; перенос/повторне використання: '+b.reused_excluded+'.');
   }
   if(totals.consumption_totals){
     if(totals.business_derived_quantity_events)lines.push('Частина кількості — business-derived з підтверджених підключень, не явно записане число.');
     const labels={onu:'ONU',router:'Роутер',onu_power_supply:'БП ONU',router_power_supply:'БП роутера',cable:'Кабель',fiber:'Оптичний кабель'};
     for(const item of totals.consumption_totals)lines.push((labels[item.entity]||item.entity.replace(/^material:/,''))+' — '+item.quantity+' '+(item.unit==='m'?'м':'шт.')+' (підключення: '+item.connection+'; ремонт/заміна: '+item.repair+'; інше: '+item.other+').');
     if(totals.quantity_unknown_events)lines.push('Без доведеної кількості: '+totals.quantity_unknown_events+' подій; у витрату не включено.');
   }else if(totals.quantity_known_events) lines.push((totals.business_derived_quantity_events?'Відома кількість (включає business-derived з підключень): ':'Явно вказана кількість: ')+totals.quantity_sum+'; подій без кількості: '+totals.quantity_unknown_events+'.');
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

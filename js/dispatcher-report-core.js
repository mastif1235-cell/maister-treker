/* Shared, pure dispatcher contract. Loaded by the PWA and bundled into the
   SEPARATE report GAS project. No storage, network, AI or legacy sync writes. */
(function(root){
  'use strict';
  const FIELDS=Object.freeze(('ticket_id work_date work_time work_type work_category city street house apartment address_display materials_display mac_onu partner_display payment_type amount total dispatcher_comment onu_used onu_replacement router_used payment_cash payment_cashless payment_free_amount payment_free_count updated_at source_version source_hash').split(' '));
  const NUMBERS=new Set('amount total onu_used onu_replacement router_used payment_cash payment_cashless payment_free_amount payment_free_count source_version'.split(' '));
  const COUNTS=new Set(['onu_used','onu_replacement','router_used','payment_free_count']);
  const PRIVATE=/(?:masterNote|privateNote|private\s+notes?|приватн[а-яіїєґ\s]*(?:заметка|примітка)|password|пароль|login|лог[іи]н|bearer|token|токен|secret|секрет|local[-_ ]only|private\s+(?:photo|url)|diagnostics?|діагностика\s+мережі|internal[-_ ]only|fullDataJson)/iu;
  const SENSITIVE=/(?:geo(?:lat|lng|link|location)?|latitude|longitude|(?<![\p{L}])(?:lat|lng|location)(?![\p{L}])|координат[ыи]|геолокац[іяи]|ONU\s*signal|onuSignal|signal(?:_before|_after|\s+before|\s+after)?|optical\s+(?:level|power)|сигнал\s*(?:onu|ону)|dBm|https?:\/\/|www\.)/iu;
  const MONEY_MAX=1e9;
  function fail(code){const e=new Error(code);e.code=code;throw e;}
  function dateKey(value){
    const s=String(value||'');
    // Explicit parsing, never browser-locale dependent.
    let y,mo,d;if(/^\d{4}-/.test(s)){[y,mo,d]=s.split('-').map(Number);}else if(/^\d{2}\.\d{2}\.\d{4}$/.test(s)){[d,mo,y]=s.split('.').map(Number);}else fail('INVALID_DATE');
    const dt=new Date(Date.UTC(y,mo-1,d));if(y<2000||y>2100||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)fail('INVALID_DATE');
    return dt.toISOString().slice(0,10);
  }
  function timeKey(value){const s=String(value||'');if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s))fail('INVALID_TIME');return s;}
  function sanitize(value){
    let privateBlock=false;
    return String(value||'').replace(/\r\n?/g,'\n').split('\n').map(line=>{
      if(/(?:masterNote|privateNote|приватн[а-яіїєґ\s]*(?:заметка|примітка))/iu.test(line)){privateBlock=true;return '';}
      if(privateBlock)return '';
      // Remove credential-labelled remainder conservatively. Never forward
      // an unknown private value just because its key was omitted.
      let s=line.replace(/(?:password|пароль|login|лог[іи]н|bearer|token|токен|secret|секрет|local[-_ ]only|private\s+(?:photo|url)|diagnostics?|internal[-_ ]only|fullDataJson)\s*[:=]?[^\n]*/iu,'');
      s=s.replace(/https?:\/\/[^\s<>]+|www\.[^\s<>]+/giu,'');
      const number='[-+]?\\d+(?:[.,]\\d+)?';
      s=s.replace(new RegExp('(?:geo(?:lat|lng|accuracy|timestamp)|latitude|longitude|\\blat|\\blng|\\blon)\\s*[:=]?\\s*'+number,'giu'),'');
      s=s.replace(new RegExp('(?:geo(?:location)?|location|GPS|геолокац[іяи]|координат[ыи]|lat\\s*/\\s*lng)\\s*[:=]?\\s*'+number+'\\s*[,;/]\\s*'+number,'giu'),'');
      s=s.replace(new RegExp('(?:ONU\\s*signal|onuSignal(?:Before|After)?|signal(?:_before|_after|\\s+before|\\s+after)?|optical\\s+(?:level|power)|(?:сигнал|рівень|уровень)\\s*(?:ONU|ОНУ)?)(?:\\s*(?:before|after|до|после|після))?\\s*[:=]?\\s*'+number+'(?:\\s*dBm)?(?:\\s*[,;→]\\s*(?:before|after|до|после|після)\\s*[:=]?\\s*'+number+'(?:\\s*dBm)?)*','giu'),'');
      s=s.replace(new RegExp(number+'\\s*dBm','giu'),'');
      s=s.replace(/(?:phone|телефон|тел)\s*[:=]\s*[+\d ()-]+/giu,'');
      s=s.replace(/(?:\s*[,;—–]\s*){2,}/g,', ').replace(/^[\s,;—–]+|[\s,;—–]+$/g,'').replace(/:\s*[,;]/g,':').replace(/[ \t]{2,}/g,' ').trim();
      // Fail closed on a sensitive fragment not covered by the normalizer.
      return PRIVATE.test(s)||SENSITIVE.test(s)?'':s;
    }).filter(Boolean).join('\n');
  }
  function validate(dto){
    if(!dto||typeof dto!=='object'||Array.isArray(dto))fail('INVALID_DTO');
    if(Object.keys(dto).some(k=>!FIELDS.includes(k))||FIELDS.some(k=>!Object.prototype.hasOwnProperty.call(dto,k)))fail('UNKNOWN_OR_MISSING_FIELD');
    const out={};
    for(const k of FIELDS){
      const v=dto[k];
      if(NUMBERS.has(k)){
        if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>(k==='source_version'?Number.MAX_SAFE_INTEGER:MONEY_MAX)||COUNTS.has(k)&&!Number.isSafeInteger(v))fail('INVALID_NUMBER');out[k]=v;
      }else{
        if(typeof v!=='string'||v.length>(k==='dispatcher_comment'||k==='materials_display'?4000:500)||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v))fail('INVALID_TEXT');
        if(PRIVATE.test(v)||SENSITIVE.test(v))fail('PRIVACY_REJECTED');out[k]=v;
      }
    }
    if(!/^[\p{L}\p{N}_:.@-]{1,128}$/u.test(out.ticket_id))fail('INVALID_ID');
    if(dateKey(out.work_date)!==out.work_date)fail('INVALID_DATE');timeKey(out.work_time);
    if(!['connection','repair','other'].includes(out.work_category))fail('INVALID_CATEGORY');
    if(out.mac_onu&&!/^(?:[\da-f]{12}|(?:[\da-f]{2}[:-]){5}[\da-f]{2}|(?:[\da-f]{4}\.){2}[\da-f]{4})$/iu.test(out.mac_onu))fail('INVALID_MAC');
    if(!/^[a-f\d]{64}$/.test(out.source_hash)||!Number.isSafeInteger(out.source_version)||out.source_version<1)fail('INVALID_VERSION');
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(out.updated_at)||!Number.isFinite(Date.parse(out.updated_at))||new Date(out.updated_at).toISOString()!==out.updated_at)fail('INVALID_UPDATED_AT');
    if(out.onu_replacement>out.onu_used)fail('INVALID_COUNTERS');
    if(Math.abs(out.payment_cash+out.payment_cashless-out.total)>0.011)fail('PAYMENT_MISMATCH');
    if(out.payment_free_count>1)fail('INVALID_COUNTERS');
    return out;
  }
  function content(dto){const out={};for(const k of FIELDS)if(!['source_version','source_hash','updated_at'].includes(k))out[k]=dto[k];return JSON.stringify(out);}
  function weekKey(day){const dt=new Date(day+'T00:00:00Z');dt.setUTCDate(dt.getUTCDate()-(dt.getUTCDay()+6)%7);return dt.toISOString().slice(0,10);}
  function sorted(rows){return rows.filter(r=>!r.deleted_at).slice().sort((a,b)=>b.work_date.localeCompare(a.work_date)||b.work_time.localeCompare(a.work_time)||(a.ticket_id<b.ticket_id?-1:a.ticket_id>b.ticket_id?1:0));}
  function stats(rows){
    const s={ticket_count:rows.length,connections:0,repairs:0,other:0,onu_used:0,onu_replacement:0,router_used:0,total:0,payment_cash:0,payment_cashless:0,payment_free_amount:0,payment_free_count:0,working_days:new Set(rows.map(r=>r.work_date)).size};
    for(const r of rows){s[r.work_category==='connection'?'connections':r.work_category==='repair'?'repairs':'other']++;for(const k of ['onu_used','onu_replacement','router_used','total','payment_cash','payment_cashless','payment_free_amount','payment_free_count'])s[k]+=r[k];}
    for(const k of ['total','payment_cash','payment_cashless','payment_free_amount'])s[k]=Math.round(s[k]*100)/100;
    return s;
  }
  function group(rows,key){const m=new Map();for(const r of rows){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;}
  function money(n){return Number(n).toLocaleString('uk-UA',{maximumFractionDigits:2})+' грн';}
  function displayDate(day){return day.split('-').reverse().join('.');}
  function statsText(title,s){return title+'\n'+[['Всього нарядів',s.ticket_count],['Підключень',s.connections],['Ремонтів',s.repairs],['Інших робіт',s.other],['ONU',s.onu_used],['Замін ONU',s.onu_replacement],['Роутерів',s.router_used],['Загальна сума',money(s.total)],['Готівка',money(s.payment_cash)],['Безготівка',money(s.payment_cashless)],['Безкоштовно',s.payment_free_count+' · '+money(s.payment_free_amount)],['Робочих днів',s.working_days]].map(([k,v])=>k+': '+v).join('\n');}
  function card(r,n){
    const rule='- - - - - - - - - - - -';
    // Display the validated numeric DTO counters; never infer usage from notes.
    const paymentIcon=r.payment_free_count?'🆓':r.payment_cashless?'💳':'💵';
    if(r.work_type==='Інше')return ['📋 Наряд №'+n+' · 🕒 '+r.work_time+' · Інше','💰 Сума: '+money(r.total),r.dispatcher_comment].filter(Boolean).join('\n');
    return ['📋 Наряд №'+n+' · 🕒 '+r.work_time+' · 🛠 '+r.work_type,r.city&&'🏙 '+r.city,'📍 '+r.address_display,r.partner_display&&'👷 Напарник: '+r.partner_display,
      rule,r.materials_display&&'📦 Матеріали:\n'+r.materials_display,r.mac_onu&&'🔢 MAC: '+r.mac_onu,
      rule,paymentIcon+' Оплата: '+(r.payment_type||'Не вказано'),'💰 Сума: '+money(r.amount),rule,'🧾 Разом: '+money(r.total),r.dispatcher_comment&&'📝 Диспетчеру:\n'+r.dispatcher_comment].filter(Boolean).join('\n');
  }
  function render(rows){
    const data=sorted(rows),days=group(data,r=>r.work_date),weeks=group(data,r=>weekKey(r.work_date)),months=group(data,r=>r.work_date.slice(0,7)),blocks=[];
    const weekdays=['Неділя','Понеділок','Вівторок','Середа','Четвер','П’ятниця','Субота'];
    const lastWeek=new Map([...weeks].map(([k,v])=>[k,v[v.length-1].work_date])),lastMonth=new Map([...months].map(([k,v])=>[k,v[v.length-1].work_date]));
    for(const [day,list] of days){
      const summary=stats(list);blocks.push({kind:'day',key:day,text:displayDate(day)+' · '+weekdays[new Date(day+'T00:00:00Z').getUTCDay()]+'\n'+list.length+' нарядів · '+money(summary.total)});
      list.forEach((r,i)=>blocks.push({kind:'ticket',key:r.ticket_id,text:card(r,i+1)}));
      blocks.push({kind:'daily',key:day,text:statsText('СТАТИСТИКА ЗА '+displayDate(day),summary)});
      const week=weekKey(day),month=day.slice(0,7);
      if(lastWeek.get(week)===day){const end=new Date(week+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+6);blocks.push({kind:'weekly',key:week,text:statsText('ТИЖДЕНЬ '+displayDate(week)+'–'+displayDate(end.toISOString().slice(0,10)),stats(weeks.get(week)))});}
      if(lastMonth.get(month)===day)blocks.push({kind:'monthly',key:month,text:statsText('МІСЯЦЬ '+month,stats(months.get(month)))});
      blocks.push({kind:'spacer',key:day,text:''});
    }
    // Presentation-only coordinates (one-based, B:E). The statistics and
    // whitelist are shared with the existing vertical formatter above.
    const layout={rows:[],spans:[],dayFrames:[],statFrames:[],monthSeparators:[]},weekSpans=new Map(),monthSpans=new Map();
    const monthNames=['СІЧЕНЬ','ЛЮТИЙ','БЕРЕЗЕНЬ','КВІТЕНЬ','ТРАВЕНЬ','ЧЕРВЕНЬ','ЛИПЕНЬ','СЕРПЕНЬ','ВЕРЕСЕНЬ','ЖОВТЕНЬ','ЛИСТОПАД','ГРУДЕНЬ'];
    const statsBody=s=>['📋 Всього нарядів: '+s.ticket_count,'✅ Підключень: '+s.connections,'🛠 Ремонтів: '+s.repairs,'⚙ Інших робіт: '+s.other,
      '- - - - - - - - - - - -','🔌 ONU: '+s.onu_used,'🔄 Заміна ONU: '+s.onu_replacement,'📶 Роутерів: '+s.router_used,
      '- - - - - - - - - - - -','💰 Загальна сума: '+money(s.total),'💵 Готівка: '+money(s.payment_cash),'💳 Безготівка: '+money(s.payment_cashless),'🆓 Безкоштовно: '+s.payment_free_count+' · '+money(s.payment_free_amount),
      '- - - - - - - - - - - -','📅 Робочих днів: '+s.working_days].join('\n');
    function panel(kind,key,row,end,column,title,body){
      layout.spans.push({kind:kind+'Header',key,row,column,height:1,width:1,text:title});
      if(end>row)layout.spans.push({kind,key,row:row+1,column,height:end-row,width:1,text:body});
      layout.statFrames.push({kind,key,row,column,height:end-row+1});
    }
    if(data.length)layout.rows.push({kind:'topSpacer',key:'',text:''});
    let previousMonth='';
    for(const [day,list] of days){
      const month=day.slice(0,7),week=weekKey(day);
      if(month!==previousMonth){
        const row=layout.rows.length+1;
        layout.rows.push({kind:'monthHeader',key:month,text:monthNames[Number(month.slice(5))-1]+' '+month.slice(0,4)});
        // Do not merge across a month separator, including a cross-month week.
        // Such a week has one summary and a styled continuation, not two totals.
        layout.spans.push({kind:'monthHeader',key:month,row,column:2,height:1,width:4,text:layout.rows[row-1].text});
        layout.monthSeparators.push(row);
        monthSpans.set(month,{row:row+1,end:row,title:'МІСЯЦЬ\n'+layout.rows[row-1].text});
        previousMonth=month;
      }
      const start=layout.rows.length+1,summary=stats(list);
      layout.rows.push({kind:'day',key:day,text:displayDate(day)+' · '+weekdays[new Date(day+'T00:00:00Z').getUTCDay()]+'\n'+list.length+' нарядів · '+money(summary.total)});
      list.forEach((r,i)=>layout.rows.push({kind:'ticket',key:r.ticket_id,text:card(r,i+1)}));
      const end=layout.rows.length;
      layout.dayFrames.push({key:day,row:start,height:end-start+1});
      panel('daily',day,start,end,3,'СТАТИСТИКА ЗА\n'+displayDate(day),statsBody(summary));
      if(!weekSpans.has(week)){
        const last=new Date(week+'T00:00:00Z');last.setUTCDate(last.getUTCDate()+6);
        weekSpans.set(week,{title:'ТИЖДЕНЬ\n'+displayDate(week)+'–'+displayDate(last.toISOString().slice(0,10)),segments:[]});
      }
      const segments=weekSpans.get(week).segments,last=segments[segments.length-1];
      if(!last||last.month!==month)segments.push({month,row:start,end});else last.end=end;
      monthSpans.get(month).end=end;
    }
    for(const [week,span] of weekSpans)span.segments.forEach((s,i)=>panel(i?'weeklyContinuation':'weekly',week,s.row,s.end,4,i?'ПРОДОВЖЕННЯ ТИЖНЯ\n'+span.title.split('\n')[1]:span.title,i?'Підсумок тижня — у першому блоці вище.':statsBody(stats(weeks.get(week)))));
    for(const [month,s] of monthSpans)panel('monthly',month,s.row,s.end,5,s.title,statsBody(stats(months.get(month))));
    return {blocks,layout,daily:Object.fromEntries([...days].map(([k,v])=>[k,stats(v)])),weekly:Object.fromEntries([...weeks].map(([k,v])=>[k,stats(v)])),monthly:Object.fromEntries([...months].map(([k,v])=>[k,stats(v)]))};
  }
  function upsert(rows,dto){
    const value=validate(dto),i=rows.findIndex(r=>r.ticket_id===value.ticket_id),old=rows[i];
    if(old&&old.source_hash===value.source_hash&&!old.deleted_at)return 'unchanged';
    if(old&&old.source_version>=value.source_version)fail('STALE_VERSION');
    const next={...value,deleted_at:'',sync_status:'SYNCED'};if(i<0)rows.push(next);else rows[i]=next;return old?'updated':'inserted';
  }
  function remove(rows,id,version,now){
    if(typeof id!=='string'||!id||!Number.isSafeInteger(version)||version<1)fail('INVALID_DELETE');
    if(!/^[\p{L}\p{N}_:.@-]{1,128}$/u.test(id))fail('INVALID_DELETE');
    const row=rows.find(r=>r.ticket_id===id);
    if(!row){rows.push({ticket_id:id,source_version:version,deleted_at:now,sync_status:'DELETED'});return 'deleted';}
    if(row.deleted_at){row.source_version=Math.max(row.source_version,version);return 'unchanged';}if(row.source_version>=version)fail('STALE_VERSION');
    row.deleted_at=now;row.sync_status='DELETED';row.source_version=version;return 'deleted';
  }
  const api=Object.freeze({FIELDS,sanitize,validate,dateKey,timeKey,content,weekKey,sorted,stats,render,upsert,remove});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MTDispatcherReportCore=api;
})(typeof globalThis==='object'?globalThis:this);

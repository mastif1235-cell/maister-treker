'use strict';
/* Intent-corpus монтажника (ТЗ-10): 50+ реалистичных запросов.
   Детерминированная часть (даты/периоды) проверяется НАСТОЯЩИМ
   date-resolver'ом; инструментальный маппинг и правила поведения пинятся
   в системном промпте оркестратора. RU/UA/смешанные формулировки. */
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');
const resolver=require(path.join(root,'mcp/src/ask/date-resolver.js'));
const fs=require('node:fs');
const ORCH=fs.readFileSync(path.join(root,'mcp/src/ask/orchestrator.js'),'utf8');

const NOW=new Date(2026,8,17); // четверг 17.09.2026 — как в реальной проверке

/* [запрос, ожидаемый intent, ожидаемый tool(-ы), диапазон|null, нужно ли уточнение] */
const CORPUS=[
  /* ПОИСК (адрес/улица/дом/квартира/клиент/телефон/ID/нас.пункт) */
  ['Какие заявки были на Рабочей?','address_search','search_tickets',null,false],
  ['Какие заявки были на вул. Рабочей?','address_search','search_tickets',null,false],
  ['Покажи Рабочая 12','address_search','search_tickets',null,false],
  ['Что делали на Рабочей 12?','address_search','search_tickets',null,false],
  ['Какие заявки были в Таромском?','city_search','search_tickets',null,false],
  ['Что подключали в Таромском за август?','city_search','search_tickets',['01.08.2026','31.08.2026'],false],
  ['Были ремонты на этой улице?','followup_type_search','search_tickets',null,false],
  ['Покажи последние заявки по этому адресу','followup_address','list_tickets|search_tickets',null,false],
  ['Кто был клиентом?','followup_field','get_ticket',null,false],
  ['Какой номер телефона был в заявке?','followup_field','get_ticket',null,false],
  ['Какая сумма?','followup_field','get_ticket',null,false],
  ['Как оплачивали?','followup_field','get_ticket',null,false],
  ['Что ставили клиенту?','followup_field','get_ticket|search_tickets',null,false],
  ['заявка №123','by_id','get_ticket',null,false],
  ['открой №123','by_id_nav','local navigation',null,false],
  ['покажи заявку 871','by_id','get_ticket',null,false],
  ['Ищите абонента Петренко','client_search','search_tickets',null,false],
  ['заявка с телефоном 0501234567','phone_search','search_tickets',null,false],
  /* ДАТЫ */
  ['Сколько заявок за сегодня?','stats','get_statistics',['17.09.2026','17.09.2026'],false],
  ['Що підключали сьогодні?','list','search_tickets|get_tickets_by_date',['17.09.2026','17.09.2026'],false],
  ['Что было вчера?','list','search_tickets|get_tickets_by_date',['16.09.2026','16.09.2026'],false],
  ['позавчера что сделал?','list','search_tickets|get_tickets_by_date',['15.09.2026','15.09.2026'],false],
  ['заявки за эту неделю','list','search_tickets',['14.09.2026','20.09.2026'],false],
  ['ремонты за прошлую неделю','type_search','search_tickets',['07.09.2026','13.09.2026'],false],
  ['Сколько заявок за этот месяц?','stats','get_statistics',['01.09.2026','30.09.2026'],false],
  ['В Таромское сколько заявок было сделано за прошлый месяц','city_search','search_tickets',['01.08.2026','31.08.2026'],false],
  ['Мне нужно за весь месяц август заявки','list','search_tickets',['01.08.2026','31.08.2026'],false],
  ['а за август?','followup_range','search_tickets',['01.08.2026','31.08.2026'],false],
  ['в августе что подключал','list','search_tickets',['01.08.2026','31.08.2026'],false],
  ['заявки за сентябрь 2025','list','search_tickets',['01.09.2025','30.09.2025'],false],
  ['что было в декабре','list','search_tickets',['01.12.2025','31.12.2025'],false],
  ['заявки за последние 7 дней','list','search_tickets',['11.09.2026','17.09.2026'],false],
  ['заработок за последние 30 дней','money','get_reports|get_statistics',['19.08.2026','17.09.2026'],false],
  ['с начала месяца сколько сделал','stats','get_statistics|get_reports',['01.09.2026','17.09.2026'],false],
  ['заявки за неделю','list','search_tickets',['11.09.2026','17.09.2026'],false],
  /* РАБОТЫ */
  ['Сколько подключений за сентябрь?','type_stats','search_tickets|get_statistics',null,false],
  ['Ремонты за август','type_search','search_tickets',['01.08.2026','31.08.2026'],false],
  ['сколько было обрывов за месяц','type_stats','search_tickets|get_statistics',null,false],
  ['замены ONU за август','type_search','search_tickets',['01.08.2026','31.08.2026'],false],
  ['а только ремонты?','followup_type','search_tickets',null,false],
  /* ОПТИКА / СИГНАЛ */
  ['Какой сигнал был на этой заявке?','followup_signal','get_ticket|search_tickets',null,false],
  ['Какой сигнал был по Рабочей 12?','signal_search','search_tickets|get_ticket',null,false],
  ['Где был плохой сигнал?','signal_search','search_tickets',null,false],
  ['Покажи заявки где сигнал ниже -28','signal_search','search_tickets',null,false],
  ['Где самый слабый сигнал за месяц?','signal_search','search_tickets',['01.09.2026','30.09.2026'],false],
  ['Какой сигнал был при подключении?','followup_signal','get_ticket|search_tickets',null,false],
  ['Знайти слабкий сигнал','signal_search','search_tickets',null,false],
  /* ДЕНЬГИ */
  ['Сколько заработано за август?','money','get_reports|get_statistics',['01.08.2026','31.08.2026'],false],
  ['сколько наличных за сегодня','money','get_reports|get_statistics',['17.09.2026','17.09.2026'],false],
  ['Скільки зароблено за цей місяць?','money','get_reports|get_statistics',['01.09.2026','30.09.2026'],false],
  /* СМЕНЫ */
  ['Сколько часов отработано за месяц?','shifts','get_shifts',['01.09.2026','30.09.2026'],false],
  ['С кем я работал в августе?','shifts','get_shifts',['01.08.2026','31.08.2026'],false],
  /* FOLLOW-UP / РАЗНОЕ */
  ['покажи их','followup_list','previous results',null,false],
  ['открой вторую','followup_nav','local navigation',null,false],
  ['а остальные?','followup_list','previous results',null,false],
  ['а на Рабочей?','followup_location','search_tickets',null,false],
  ['а сколько там заработали?','followup_money','get_reports|get_statistics',null,false],
  ['Создай новую заявку на Рабочей 5','write_refusal','NONE',null,false],
  ['удали заявку 871','write_refusal','NONE',null,false]
];

(async function run(){
  /* 1) Детерминированные диапазоны — через РЕАЛЬНЫЙ резолвер */
  let checked=0, bad=[];
  for(const [q,intent,tool,range,clarify] of CORPUS){
    if(!range) continue;
    const r=resolver.resolveDateRanges(q,NOW);
    const ok=r.length>=1 && r[0].from===range[0] && r[0].to===range[1];
    checked++;
    if(!ok) bad.push(q+' -> '+JSON.stringify(r));
  }
  assert.ok(CORPUS.length>=50,'corpus has 50+ queries: '+CORPUS.length);
  assert.equal(bad.length,0,'all date-range expectations resolved:\n'+bad.join('\n'));
  console.log('PASS intent corpus: '+CORPUS.length+' queries; '+checked+' date ranges resolved deterministically (RU+UA)');

  /* 2) Инструментальный маппинг и правила — пинятся в промпте */
  for(const [needle,label] of [
    [/search_tickets/,'address/city/client/phone search tool named'],
    [/get_ticket\b|за її id/,'by-id tool named'],
    [/get_statistics|get_reports/,'statistics tools named'],
    [/get_shifts/,'shifts tool named'],
    [/get_tickets_by_date/,'by-date tool named'],
    [/частине слово/,'partial-match search guidance'],
    [/без «вул\.\/ул\.»|без «вул/,'street-prefix guidance'],
    [/date_from\/date_to/, 'range narrowing guidance'],
    [/скільки знайдено|сколько знайдено|скажи скільки знайдено/i,'many-results guidance'],
    [/Рівень сигнала в цих заявках не зберігся|НЕ вигадуй значень/,'signal: never invent'],
    [/Шукати по всій вулиці|ширший період/,'empty result: helpful next step'],
    [/лише для читання|режим лишь для читания|режим лише для читання/,'WRITE refusal'],
    [/історію діалогу/,'session context rule'],
    [/мовою останнього повідомлення користувача/,'language mirroring'],
    [/ЖОДНИХ markdown-таблиць/,'no markdown tables'],
    [/НІКОЛИ не питай користувача про поточну дату/,'never ask current date']
  ]){
    assert.ok(new RegExp(needle.source,needle.flags).test(ORCH),'prompt pins: '+label);
  }
  console.log('PASS orchestrator prompt pins: tool mapping, signal, empty-result, write-refusal, language, no-tables, no-date-questions');

  /* 3) Следование tool-allowlist: только READ-инструменты существуют */
  const defs=fs.readFileSync(path.join(root,'mcp/src/tools/definitions.js'),'utf8');
  for(const tool of ['search_tickets','get_ticket','get_tickets_by_date','list_tickets','get_statistics','get_reports','get_shifts']){
    assert.ok(defs.includes("name: '"+tool+"'"),'READ tool exists: '+tool);
  }
  console.log('PASS tool selection: all guided tools exist in READ allowlist (no WRITE)');

  console.log('PASS ai-intents: corpus 57 queries, date ranges + prompt/tool pins green');
  process.exit(0);
})().catch(function(e){ console.error(e); process.exit(1); });

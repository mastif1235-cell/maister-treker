/* Tool definitions exposed to MCP clients. Every tool in this READ-ONLY stage
   is annotated readOnlyHint:true / destructiveHint:false. Input schemas are
   JSON Schema 2020-12 (the default dialect since spec 2025-11-25). */

const DATE_ARG = {
  type: 'string',
  pattern: '^\\d{2}\\.\\d{2}\\.\\d{4}$',
  description: 'Дата у форматі ДД.ММ.РРРР (як у застосунку).'
};
const LIMIT_ARG = {type:'integer', minimum:1, maximum:200, default:50, description:'Максимум заявок у відповіді (1..200).'};
const OFFSET_ARG = {type:'integer', minimum:0, maximum:10000, description:'Зсув для посторінкового читання.'};

export const TOOL_DEFINITIONS = [
  {
    name: 'list_tickets',
    description: 'Список заявок «Майстер-Трекера» (новіші дати спочатку, усередині дня — за часом). Можна комбінувати city, date range, type, signal (dBm) та tags для analytics/count/group/unique.',
    inputSchema: {
      type:'object', additionalProperties:false,
      properties:{
        date_from: Object.assign({}, DATE_ARG, {description:'Початок діапазону, ДД.ММ.РРРР (включно).'}),
        date_to: Object.assign({}, DATE_ARG, {description:'Кінець діапазону, ДД.ММ.РРРР (включно).'}),
        type: {type:'string', description:'Опційний фільтр за типом робіт (наприклад: «Підключення», «Ремонт»).'},
        city: {type:'string', minLength:1, maxLength:100, description:'Опційний фільтр за населеним пунктом; підтримує UA/RU написання та відмінки.'},
        signal_worse_than: {type:'number', description:'Строгий фільтр сигналу нижче/гірше чисельно за вказаний dBm: -25 відбере -25.1, -26, але НЕ -25.'},
        signal_worse_or_equal: {type:'number', description:'Включний фільтр сигналу: вказане значення або чисельно гірше; -25 відбере -25, -25.1, -26.'},
        signal_better_than: {type:'number', description:'Фільтр заявок з рівнем сигналу краще (чисельно більше або дорівнює) вказаного dBm (наприклад: -25 dBm відбере -22, -18 тощо).'},
        tags: {type:'array', items:{type:'string'}, minItems:1, maxItems:20, description:'Фільтр за тегами: підходить заявка з хоча б одним із перелічених тегів.'},
        limit: LIMIT_ARG,
        offset: OFFSET_ARG
      }
    },
    annotations: {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  },
  {
    name: 'get_ticket',
    description: 'Одна заявка за її id (повна структурована картка без приватних полів).',
    inputSchema: {
      type:'object', additionalProperties:false, required:['ticket_id'],
      properties:{ ticket_id: {type:'string', minLength:1, maxLength:128, description:'id заявки (рядок).'} }
    },
    annotations: {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  },
  {
    name: 'search_tickets',
    description: 'Пошук заявок тих самих полів, що й пошук у застосунку: текст заявки, дата, теги, місто, адреса, імʼя клієнта, сигнал ONU, цифри телефону (включно з додатковими номерами).',
    inputSchema: {
      type:'object', additionalProperties:false, required:['query'],
      properties:{
        query: {type:'string', minLength:1, maxLength:200, description:'Рядок пошуку; шукає по тексту заявки, адресі, телефону, обладнанню та виконаним роботам.'},
        terms: {type:'array', items:{type:'string', minLength:1, maxLength:80}, minItems:1, maxItems:12, description:'Усі перелічені слова/ознаки мають збігтися (логічне AND) для складеного пошуку.'},
        item_conditions: {type:'array', minItems:1, maxItems:8, items:{type:'object', additionalProperties:false, properties:{text:{type:'string',minLength:1,maxLength:80}, kind:{type:'string',maxLength:30}, unit_price:{type:'number'}, quantity:{type:'number'}, total:{type:'number'}}, required:['text']}, description:'Структуровані умови item/work; кожна умова має збігтися в одному ticket, а text+price — в одній item.'},
        sum_min: {type:'number', description:'Мінімальна загальна сума заявки.'},
        sum_max: {type:'number', description:'Максимальна загальна сума заявки.'},
        payment: {type:'string', maxLength:80, description:'Спосіб оплати.'},
        date_from: Object.assign({}, DATE_ARG, {description:'Обмеження діапазону зліва (включно).'}),
        date_to: Object.assign({}, DATE_ARG, {description:'Обмеження діапазону справа (включно).'}),
        limit: LIMIT_ARG,
        offset: OFFSET_ARG
      }
    },
    annotations: {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  },
  {
    name: 'find_tickets_by_address',
    description: 'Розумний пошук заявок за адресою (місто, село, вулиця, будинок) із підтримкою українського та російського написання, відмінків та одруківок. Повертає знайдені заявки, розпізнану адресу та список будинків на вулиці.',
    inputSchema: {
      type:'object', additionalProperties:false, required:['address'],
      properties:{
        address: {type:'string', minLength:1, maxLength:200, description:'Адреса або її частина (наприклад: «Таромське Лісова 74», «Лесная 74», «вул. Мостова»).'},
        date_from: Object.assign({}, DATE_ARG, {description:'Початок діапазону (включно).'}),
        date_to: Object.assign({}, DATE_ARG, {description:'Кінець діапазону (включно).'}),
        limit: LIMIT_ARG,
        offset: OFFSET_ARG
      }
    },
    annotations: {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  },
  {
    name: 'list_places',
    description: 'Довідник реальних населених пунктів, вулиць та номерів будинків із наявних заявок майстра. Використовуй для перевірки списку відомих вулиць чи адрес на вулиці.',
    inputSchema: {
      type:'object', additionalProperties:false,
      properties:{
        city: {type:'string', description:'Опційний фільтр за містом/селом.'}
      }
    },
    annotations: {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  },
  {
    name: 'get_tickets_by_date',
    description: 'Усі заявки за конкретну дату (сортовані за часом, як список у застосунку).',
    inputSchema: {
      type:'object', additionalProperties:false, required:['date'],
      properties:{ date: DATE_ARG }
    },
    annotations: {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  },
  {
    name: 'get_shifts',
    description: 'Робочі зміни (напарники, години) за діапазон дат або за напарником.',
    inputSchema: {
      type:'object', additionalProperties:false,
      properties:{
        date_from: Object.assign({}, DATE_ARG, {description:'Початок діапазону, ДД.ММ.РРРР (включно).'}),
        date_to: Object.assign({}, DATE_ARG, {description:'Кінець діапазону, ДД.ММ.РРРР (включно).'}),
        coworker: {type:'string', description:'Опційний фільтр/пошук за імʼям напарника.'}
      }
    },
    annotations: {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  },
  {
    name: 'get_reports',
    description: 'Поденні зведення за заявками в діапазоні: кількість, загальна сума, готівка, безготівка (та сама арифметика, що звіт у застосунку).',
    inputSchema: {
      type:'object', additionalProperties:false, required:['date_from', 'date_to'],
      properties:{ date_from: DATE_ARG, date_to: DATE_ARG }
    },
    annotations: {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  },
  {
    name: 'get_statistics',
    description: 'Агрегати за періодом як у звітах застосунку (day/week/month/all від дати-якоря): суми + розбивка за типом робіт і способом оплати. anchor_date за замовчуванням — найпізніша дата заявок у даних.',
    inputSchema: {
      type:'object', additionalProperties:false, required:['period'],
      properties:{
        period: {type:'string', enum:['day','week','month','all'], description:'day=день якоря; week=7 днів від якоря назад; month=календарний місяць якоря; all=усе.'},
        anchor_date: Object.assign({}, DATE_ARG, {description:'Дата-якір періоду, ДД.ММ.РРРР.'})
      }
    },
    annotations: {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  }
];

export const TOOL_NAMES = TOOL_DEFINITIONS.map(function(def){ return def.name; });

/* AI: конфігурація (константи, allowlist, ліміти). Без DOM і мережі —
   безпечно завантажується у будь-якому середовищі й тестах. */
(function(){
'use strict';
const globalRef = typeof globalThis !== 'undefined' ? globalThis : window;
const MTAI = globalRef.MTAI = globalRef.MTAI || {};

MTAI.config = {
  /* Fresh install: бекенд НЕ налаштований, AI вимкнений, жодних запитів.
     Спільний backend пропонується лише в онбордингу й без власного
     access-токена користувача не працює (ліміти власника не витрачаються). */
  DEFAULT_BACKEND: '',
  /* Єдиний дозволений список «спільних» бекендів (CSP connect-src має їм
     відповідати — див. tests/ai-ui-architecture.test.js). Довільні URL
     дозволені лише в режимі «свій backend» (https-валідація). */
  ALLOWED_BACKENDS: [
    'https://maister-tracker-mcp.mastif1235.workers.dev',
    'https://maister-tracker-mcp-dev.mastif1235.workers.dev'
  ],
  SHARED_BACKEND: 'https://maister-tracker-mcp.mastif1235.workers.dev',
  /* Dev-воркер для локального preview: хост обирає sharedBackend() за
     origin сторінки — користувач URL спільного бекенда не редагує. */
  DEV_SHARED_BACKEND: 'https://maister-tracker-mcp-dev.mastif1235.workers.dev',
  /* Dev-оточення = все, що НЕ є продакшен-PWA: localhost/127.0.0.1/::1,
     Cloudflare Pages preview (*.pages.dev), приватні LAN-адреси (прев'ю з
     телефона по Wi-Fi). Усі вони -> dev Worker; продакшен-PWA та
     node-тести без location -> спільний prod. */
  isPreviewHost: function(host){
    host = String(host || '');
    if(/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(host)) return true;
    if(/\.pages\.dev$/i.test(host)) return true;
    if(/^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  },
  sharedBackend: function(){
    try{
      const host = String((globalRef.location && globalRef.location.hostname) || '');
      return MTAI.config.isPreviewHost(host) ? MTAI.config.DEV_SHARED_BACKEND : MTAI.config.SHARED_BACKEND;
    }catch(_err){
      return MTAI.config.SHARED_BACKEND;
    }
  },
  DEFAULT_PROVIDER: 'deepseek',
  DEFAULT_MODEL: 'deepseek-flash',
  LIMITS: {
    questionMaxChars: 2000,
    timeoutMs: 90000,
    /* Тимчасовий ліміт вкладень: бекенд /ask поки НЕ приймає зображення
       (контракт — mcp/docs/ai-multimodal-contract.md), тому send із
       вкладеннями блокується з поясненням. */
    attachmentsMax: 4,
    attachmentMaxBytes: 8 * 1024 * 1024,
    attachmentEdgePx: 1024
  },
  /* Типи вкладень — контекст для майбутнього vision/WRITE (схема існуючого
     photo storage НЕ змінюється). */
  ATTACHMENT_KINDS: [
    { id:'ticket',     label:'Фото заявки' },
    { id:'coupler',    label:'Муфта' },
    { id:'fob',        label:'FOB' },
    { id:'equipment',  label:'Обладнання' },
    { id:'result',     label:'Результат ремонту' },
    { id:'other',      label:'Інше' }
  ],
  /* Швидкі приклади питань (місяць підставляється динамічно). */
  quickPrompts: function(){
    const months = ['січень','лютий','березень','квітень','травень','червень','липень','серпень','вересень','жовтень','листопад','грудень'];
    const now = new Date();
    const month = months[now.getMonth()] + ' ' + now.getFullYear();
    return [
      'Заявки за сьогодні',
      'Останні 5 заявок',
      'Знайти за адресою',
      'Ремонти за ' + months[now.getMonth()] + ' ' + now.getFullYear() + '?',
      'Підключення за ' + months[now.getMonth()] + ' ' + now.getFullYear() + '?',
      'Скільки зароблено за ' + months[now.getMonth()] + ' ' + now.getFullYear() + '?',
      'Скільки годин відпрацьовано?',
      'Знайти слабкий сигнал'
    ];
  },
  /* 7 категорій практичних питань монтажника */
  quickPromptCategories: function(){
    const months = ['січень','лютий','березень','квітень','травень','червень','липень','серпень','вересень','жовтень','листопад','грудень'];
    const now = new Date();
    const curMonth = months[now.getMonth()] + ' ' + now.getFullYear();
    return [
      {
        icon: '📋',
        title: 'Заявки',
        prompts: [
          'Заявки за сьогодні',
          'Останні 5 заявок',
          'Що я робив учора?',
          'Які підключення були за ' + curMonth + '?',
          'Скільки всього заявок?'
        ]
      },
      {
        icon: '💰',
        title: 'Заробіток',
        prompts: [
          'Скільки заробив учора?',
          'Скільки зароблено за ' + curMonth + '?',
          'Заробіток за цей тиждень',
          'Скільки підключень зробив за місяць?'
        ]
      },
      {
        icon: '🕐',
        title: 'Зміни',
        prompts: [
          'Скільки годин працював учора?',
          'Скільки годин за цей тиждень?',
          'Скільки годин за ' + curMonth + '?',
          'Який найдовший робочий день?'
        ]
      },
      {
        icon: '👷',
        title: 'Напарники',
        prompts: [
          'З ким я працював 15 вересня?',
          'Скільки змін я працював з напарником?',
          'Коли востаннє працював з напарником?'
        ]
      },
      {
        icon: '📶',
        title: 'Сигнал',
        prompts: [
          'Покажи заявки з сигналом гірше -25',
          'Де був найслабший сигнал?',
          'Який сигнал був на Лісова 74?'
        ]
      },
      {
        icon: '📍',
        title: 'Адреси',
        prompts: [
          'Знайди адресу Лісова 74',
          'Які адреси є на вул. Лісова?',
          'Які заявки були в Таромському?'
        ]
      },
      {
        icon: '🗺️',
        title: 'Карта',
        prompts: [
          'Покажи на карті Лісова 74',
          'Знайти мої заявки на карті'
        ]
      }
    ];
  }
};
})();

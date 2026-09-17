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
  DEFAULT_PROVIDER: 'groq',
  DEFAULT_MODEL: 'openai/gpt-oss-120b',
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
      'Покажи останні 5 заявок',
      'Скільки зароблено за ' + month + '?',
      'Скільки заявок за сьогодні та какая сума?',
      'Скільки годин відпрацьовано за ' + month + '?'
    ];
  }
};
})();

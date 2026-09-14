// @ts-check
/* Конфігурація браузерних E2E (пункти 19/20 аудиту v91.27).
   E2E ДОПОВНЮЮТЬ наявні unit/vm/static-тести в tests/ і не замінюють їх.
   Кожен тест піднімає власний статичний сервер із тимчасової копії репозиторію
   (e2e/helpers/env.js), тому Service Worker / кеші / версії ізольовані. */
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Один воркер: тести ділять CPU з headless-браузером, а SW-сценарії
  // чутливі до таймінгів install/activate — детермінованість важливіша за швидкість.
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    browserName: 'chromium',
    headless: true,
    // Мобільний форм-фактор: застосунок mobile-first (PWA майстра).
    viewport: { width: 412, height: 915 },
    locale: 'uk-UA',
    timezoneId: 'Europe/Kiev',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});

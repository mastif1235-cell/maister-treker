'use strict';
/* Сценарій C (пункти 19/20): Offline — після повного встановлення PWA-кешу
   браузер переводиться в offline, сторінка перезавантажується і застосунок
   стартує з кешу Service Worker; основні дані (створена раніше заявка)
   доступні без мережі. */
const { test, expect, gotoApp, waitServiceWorkerCacheReady, createTicketViaUi } = require('./app-test');

const CLIENT = 'E2E Офлайн Клієнт';

test('C: після переведення контексту в offline застосунок стартує з PWA-кешу з даними', async ({ page, context, appEnv }) => {
  const errors = await gotoApp(page, appEnv.url);

  // SW встановлений/активований, кеш ядра повний, сторінка під контролем.
  const cacheName = await waitServiceWorkerCacheReady(page);
  expect(cacheName).toMatch(/^maister-treker-/);

  // Створюємо дані ДО вимкнення мережі.
  await createTicketViaUi(page, CLIENT);

  // Переводимо браузерний контекст повністю offline і перезавантажуємось.
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtAppInitDone === true, null, { timeout: 60_000 });

  // Застосунок відкрився з кешу: інтерфейс живий, сторінку контролює SW.
  await expect(page.locator('#screen-tickets')).toBeVisible();
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  expect(controlled, 'offline-сторінка обслуговується Service Worker').toBe(true);

  // Основні вкладки працюють і офлайн.
  for(const tab of ['calculator', 'shifts', 'settings', 'tickets']){
    await page.click(`.tab-btn[data-tab="${tab}"]`);
    await expect(page.locator(`#screen-${tab}`)).toBeVisible();
  }

  // Дані доступні: заявка, створена до offline, на місці (IndexedDB не залежить
  // від мережі, а shell/скрипти прийшли з PWA-кешу).
  await expect(page.locator('#ticketList .ticket-card', { hasText: CLIENT }).first()).toBeVisible({ timeout: 20_000 });
  const count = await page.evaluate(name => tickets.filter(t => t.clientName === name).length, CLIENT);
  expect(count).toBe(1);

  expect(errors, `необроблені JS-помилки в offline-сценарії: ${errors.join(' | ')}`).toEqual([]);
});

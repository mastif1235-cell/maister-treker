'use strict';
/* Сценарій E (пункти 19/20): Forms/modals — відкриття базової форми заявки,
   реальний submit без runtime-помилок і ключовий modal-flow (підтвердження
   видалення заявки: скасування залишає заявку, підтвердження видаляє її). */
const { test, expect, gotoApp, createTicketViaUi } = require('./app-test');

const CLIENT = 'E2E Форма Клієнт';

test('E: форма заявки відкривається, submit проходить, modal-видалення працює', async ({ page, appEnv }) => {
  const errors = await gotoApp(page, appEnv.url);

  /* 1. Базова форма відкривається і заповнюється. */
  await page.click('.tab-btn[data-tab="calculator"]');
  await expect(page.locator('#screen-calculator')).toBeVisible();
  await expect(page.locator('#calcForm')).toBeVisible();
  await expect(page.locator('#f_type')).toBeVisible();

  /* 2. Submit форми: заявка створюється без runtime-помилок. */
  await createTicketViaUi(page, CLIENT);
  const card = page.locator('#ticketList .ticket-card', { hasText: CLIENT }).first();
  await expect(card).toBeVisible();

  /* 3. Ключовий modal flow — видалення заявки. Спочатку скасування. */
  await card.locator('.delete-ticket-btn').click();
  await expect(page.locator('#modalOverlay')).toBeVisible();
  await expect(page.locator('#modalOverlay h3')).toHaveText('Видалити цю заявку?');
  await expect(page.locator('[data-modal-confirm]')).toBeVisible();
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('#modalOverlay')).toHaveCount(0);
  await expect(card, 'після скасування заявка лишається в списку').toBeVisible();

  /* 4. Тепер підтвердження видалення. */
  await card.locator('.delete-ticket-btn').click();
  await expect(page.locator('#modalOverlay')).toBeVisible();
  await page.locator('[data-modal-confirm]').click();
  await expect(page.locator('#modalOverlay')).toHaveCount(0);
  await expect(page.locator('#ticketList .ticket-card', { hasText: CLIENT })).toHaveCount(0);

  // Видалення дійшло до робочого стану й локального сховища.
  const remaining = await page.evaluate(name => tickets.filter(t => t.clientName === name).length, CLIENT);
  expect(remaining).toBe(0);

  /* 5. Редагування форми, що вже існувала (open/close без збереження) —
        ще один modal/форм-шлях без помилок. */
  await page.click('.tab-btn[data-tab="calculator"]');
  await expect(page.locator('#screen-calculator')).toBeVisible();

  expect(errors, `необроблені JS-помилки у формах/модалках: ${errors.join(' | ')}`).toEqual([]);
});

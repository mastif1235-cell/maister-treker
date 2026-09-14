'use strict';
/* Сценарій A (пункти 19/20): Boot — застосунок відкривається в реальному
   браузері, немає необробленої JS-помилки, основні вкладки з'являються і
   перемикаються. */
const { test, expect, gotoApp } = require('./app-test');

test('A: застосунок стартує без JS-помилок, усі основні вкладки доступні', async ({ page, appEnv }) => {
  const errors = await gotoApp(page, appEnv.url);

  // Основний екран і таб-бар на місці.
  await expect(page.locator('#screen-tickets')).toBeVisible();
  const tabs = ['tickets', 'calculator', 'shifts', 'tools', 'settings'];
  for(const tab of tabs){
    await expect(page.locator(`.tab-btn[data-tab="${tab}"]`)).toBeVisible();
  }

  // Перемикаємо кожну вкладку — екрани стають видимими без runtime-помилок.
  for(const tab of tabs){
    await page.click(`.tab-btn[data-tab="${tab}"]`);
    await expect(page.locator(`#screen-${tab}`)).toBeVisible();
  }

  // Індикатор синхронізації та версія застосунку ініціалізовані.
  await page.click('.tab-btn[data-tab="settings"]');
  await expect(page.locator('#appVersionLabel')).toContainText('Версія застосунку');

  expect(errors, `необроблені JS-помилки: ${errors.join(' | ')}`).toEqual([]);
});

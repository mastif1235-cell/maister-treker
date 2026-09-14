'use strict';
/* Сценарій B (пункти 19/20): IndexedDB persistence — створена через форму
   заявка зберігається, перечитується і переживає повне перезавантаження
   сторінки (реальний IndexedDB у браузері, а не мок). */
const { test, expect, gotoApp, createTicketViaUi } = require('./app-test');

const CLIENT = 'E2E Персистенція Клієнт';

test('B: створена заявка зберігається в IndexedDB і переживає reload', async ({ page, appEnv }) => {
  const errors = await gotoApp(page, appEnv.url);

  await createTicketViaUi(page, CLIENT);

  // Дані перечитуються з робочого стану застосунку.
  const inMemory = await page.evaluate(name => tickets.filter(t => t.clientName === name).map(t => ({
    id: String(t.id), content: String(t.content || '')
  })), CLIENT);
  expect(inMemory.length).toBe(1);
  expect(inMemory[0].content).toContain(CLIENT);
  expect(inMemory[0].id.length).toBeGreaterThan(5);

  // Реальне перечитування з IndexedDB: reload → init() → loadTicketsFromIdb.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtAppInitDone === true, null, { timeout: 60_000 });

  await expect(page.locator('#ticketList .ticket-card', { hasText: CLIENT }).first()).toBeVisible({ timeout: 20_000 });
  const afterReload = await page.evaluate(name => tickets.filter(t => t.clientName === name).length, CLIENT);
  expect(afterReload, 'після reload заявка лишилась у базі (IndexedDB) рівно одна').toBe(1);

  // Перевірка саме сховища: у IndexedDB-записі бази заявок є наша заявка.
  const persisted = await page.evaluate(async name => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('masterTrackerTickets', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction('tickets', 'readonly');
      const req = tx.objectStore('tickets').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const flat = all.flat ? all.flat(Infinity) : all;
    return (Array.isArray(flat) ? flat : []).some(t => t && t.clientName === name);
  }, CLIENT);
  expect(persisted, 'заявка фізично присутня в IndexedDB masterTrackerTickets').toBe(true);

  expect(errors, `необроблені JS-помилки: ${errors.join(' | ')}`).toEqual([]);
});

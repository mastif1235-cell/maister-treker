'use strict';
const {test,expect,gotoApp}=require('./app-test');

test('Інше expands shared delivery statuses and opens photos without editing',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  await page.evaluate(async()=>{
    // Isolated browser fixture only: no external delivery or user storage.
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    tickets=[Object.assign(blankTicketObject(),{id:'other-photo-test',date:currentTicketDate,time:'09:00',type:'Інше',sum:999,otherNote:'Нотатка з фото',note:'Нотатка з фото',content:'Нотатка з фото',photos:[image]})];
    await saveTicketsLocalOnly();
    // Pure presentation stubs; no send methods and no configured secrets.
    globalThis.MTDispatcherReport={delivery:()=>({state:'sent',code:''}),badge:()=> 'Таблиця Д ✅'};
    MTTicketCompactView.setMode('compact');renderTicketsScreen();
  });
  const compact=page.locator('.ticket-compact-card[data-id="other-photo-test"]');
  await expect(compact).toContainText('Нотатка з фото');
  await expect(compact.locator('.ticket-compact-sum')).toHaveCount(0);
  await expect(compact.locator('.tc-sync-badge')).toHaveCount(0);
  await compact.locator('.ticket-view-expand-btn').click();
  const card=page.locator('.ticket-card[data-id="other-photo-test"]');
  await expect(card.locator('.tc-details')).not.toHaveClass(/tc-collapsed/);
  await expect(card.locator('.tc-status-row')).toContainText('Таблиця Д ✅');
  await expect(card.locator('.tc-sum')).toHaveCount(0);
  await card.locator('.tc-photo-toggle-btn').click();
  await expect(card.locator('.tc-photo-wrap')).not.toHaveClass(/hidden/);
  await expect(card.locator('.tc-photo-thumb')).toBeVisible();
  await card.locator('.tc-photo-thumb').click();
  await expect(page.locator('#modalOverlay [role="dialog"]')).toBeVisible();
  await expect(page.locator('#modalBody img')).toBeVisible();
  expect(errors).toEqual([]);
});

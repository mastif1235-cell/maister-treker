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
  await expect(compact.locator('.ticket-view-expand-btn')).toHaveCount(1);
  await compact.locator('.ticket-view-expand-btn').click();
  const card=page.locator('.ticket-card[data-id="other-photo-test"]');
  const wrapper=page.locator('.ticket-compact-expanded[data-id="other-photo-test"]');
  await expect(wrapper.locator('.ticket-view-collapse-btn')).toHaveCount(1);
  await expect(card.locator('.tc-expand-btn')).toHaveCount(0);
  await expect(card.locator('.tc-details')).not.toHaveClass(/tc-collapsed/);
  await expect(card.locator('.tc-details')).toBeVisible();
  await expect(card.locator('.tc-status-row')).toContainText('Таблиця Д ✅');
  await expect(card.locator('.tc-status-row')).toBeVisible();
  await expect(card.locator('.tc-photo-toggle-btn')).toBeVisible();
  await expect(card.locator('.tc-details')).toContainText('Нотатка з фото');
  await expect(card.locator('.tc-sum')).toHaveCount(0);
  await card.locator('.tc-photo-toggle-btn').click();
  await expect(card.locator('.tc-photo-wrap')).not.toHaveClass(/hidden/);
  await expect(card.locator('.tc-photo-thumb')).toBeVisible();
  await card.locator('.tc-photo-thumb').click();
  await expect(page.locator('#modalOverlay [role="dialog"]')).toBeVisible();
  await expect(page.locator('#modalBody img')).toBeVisible();
  await page.locator('#modalCloseBtn').click();
  await wrapper.locator('.ticket-view-collapse-btn').click();
  await expect(compact).toBeVisible();
  await expect(compact.locator('.ticket-view-expand-btn')).toHaveCount(1);
  await expect(wrapper).toHaveCount(0);
  await expect(page.locator('#tcc-other-photo-test')).toHaveCount(0);
  // Full-mode notes still own their regular details toggle.
  await page.evaluate(()=>{MTTicketCompactView.setMode('full');renderTicketsScreen();});
  await expect(card.locator('.tc-expand-btn')).toHaveCount(1);
  await expect(card.locator('.tc-details')).toHaveClass(/tc-collapsed/);
  await card.locator('.tc-expand-btn').click();
  await expect(card.locator('.tc-details')).not.toHaveClass(/tc-collapsed/);
  await expect(card.locator('.tc-expand-btn')).toHaveText('▲ Згорнути');
  await card.locator('.tc-expand-btn').click();
  await expect(card.locator('.tc-details')).toHaveClass(/tc-collapsed/);
  await expect(card.locator('.tc-expand-btn')).toHaveText('▼ Розгорнути');
  expect(errors).toEqual([]);
});

'use strict';
const {test,expect,gotoApp,waitAppReady,waitServiceWorkerCacheReady}=require('./app-test');

test('compact list keeps ticket order, expands one full card and survives offline reload',async({page,appEnv})=>{
  await page.setViewportSize({width:320,height:740});
  const errors=await gotoApp(page,appEnv.url);
  const cache=await waitServiceWorkerCacheReady(page);
  expect(cache).toBe('maister-treker-v67-runtime-117');
  expect(await page.evaluate(async()=>{
    const base={date:currentTicketDate,city:'Дніпро',street:'вул. Робоча',house:'15',apartment:'27',address:'вул. Робоча 15, кв. 27',sum:450};
    tickets=[
      Object.assign(blankTicketObject(),base,{id:'compact-a',time:'10:00',clientName:'Compact Alpha',content:'👤 Клієнт: Compact Alpha',tags:['ремонт']}),
      Object.assign(blankTicketObject(),base,{id:'compact-b',time:'11:00',clientName:'Compact Beta',content:'👤 Клієнт: Compact Beta'})
    ];
    const saved=await saveTicketsLocalOnly();
    renderTicketsScreen();
    return saved;
  })).toBe(true);

  const ids=async selector=>page.locator(selector).evaluateAll(nodes=>nodes.map(node=>node.dataset.id));
  expect(await ids('#ticketList > .ticket-card')).toEqual(['compact-a','compact-b']);
  await expect(page.locator('#ticketViewModeBtn')).toHaveText('Компактно');
  await page.click('#ticketViewModeBtn');
  await expect(page.locator('#ticketViewModeBtn')).toHaveText('Повний вигляд');
  expect(await ids('#ticketList > .ticket-compact-card')).toEqual(['compact-a','compact-b']);
  const first=page.locator('#ticketList > .ticket-compact-card[data-id="compact-a"]');
  await expect(first).toContainText('10:00');
  await expect(first).toContainText('Дніпро, вул. Робоча, 15, кв. 27');
  await expect(first).toContainText('450 грн');
  await expect(first.locator('.ticket-view-expand-btn')).toBeVisible();
  expect(await first.locator('.edit-ticket-btn,.delete-ticket-btn,.share-ticket-btn,.tc-photo-toggle-btn,.goto-profile-btn').count()).toBe(0);
  expect(await page.evaluate(()=>{const el=document.querySelector('.ticket-view-actions');return el.scrollWidth<=el.clientWidth;})).toBe(true);

  await first.locator('.ticket-view-expand-btn').click();
  const opened=page.locator('#ticketList > .ticket-compact-expanded[data-id="compact-a"]');
  await expect(opened.locator('.ticket-card .edit-ticket-btn')).toBeVisible();
  await expect(opened.locator('.ticket-card .delete-ticket-btn')).toBeVisible();
  await expect(opened.locator('.ticket-card .share-ticket-btn')).toBeVisible();
  await expect(page.locator('#ticketList > .ticket-compact-card[data-id="compact-b"]')).toBeVisible();
  await opened.locator('.ticket-view-collapse-btn').click();
  expect(await ids('#ticketList > .ticket-compact-card')).toEqual(['compact-a','compact-b']);

  await page.fill('#searchInput','Compact Alpha');
  await expect(page.locator('#modeSummaryText')).toContainText('Знайдено: 1');
  expect(await ids('#ticketList > .ticket-compact-card')).toEqual(['compact-a']);
  await page.click('#ticketViewModeBtn');
  expect(await ids('#ticketList > .ticket-card')).toEqual(['compact-a']);
  await page.fill('#searchInput','');
  await expect(page.locator('#dateNavBlock')).toBeVisible();
  await page.click('#filterToggleBtn');
  await page.click('#tagFilterChips [data-tag="ремонт"]');
  expect(await ids('#ticketList > .ticket-card')).toEqual(['compact-a']);
  await page.click('#ticketViewModeBtn');
  expect(await ids('#ticketList > .ticket-compact-card')).toEqual(['compact-a']);
  await page.click('#modeResetBtn');
  expect(await ids('#ticketList > .ticket-compact-card')).toEqual(['compact-a','compact-b']);

  await page.click('#showVizitkaBtn');
  await expect(page.getByText('Візитка LNET').first()).toBeVisible();
  await page.reload({waitUntil:'domcontentloaded'});
  await waitAppReady(page);
  await expect(page.locator('#ticketViewModeBtn')).toHaveText('Повний вигляд');
  expect(await ids('#ticketList > .ticket-compact-card')).toEqual(['compact-a','compact-b']);
  await page.context().setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await waitAppReady(page);
  expect(await ids('#ticketList > .ticket-compact-card')).toEqual(['compact-a','compact-b']);
  await page.locator('#ticketList .ticket-compact-card[data-id="compact-a"] .ticket-view-expand-btn').click();
  await page.locator('#ticketList .ticket-compact-expanded[data-id="compact-a"] .edit-ticket-btn').click();
  await expect(page.locator('#screen-calculator')).toBeVisible();
  await expect(page.locator('#f_client')).toHaveValue('Compact Alpha');
  expect(errors).toEqual([]);
});

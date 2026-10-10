'use strict';
const {test,expect,gotoApp,waitAppReady,waitServiceWorkerCacheReady}=require('./app-test');

test('compact list keeps ticket order, expands one full card and survives offline reload',async({page,appEnv})=>{
  await page.setViewportSize({width:320,height:740});
  const errors=await gotoApp(page,appEnv.url);
  const cache=await waitServiceWorkerCacheReady(page);
  expect(cache).toBe('maister-treker-v71-runtime-141');
  expect(await page.evaluate(async()=>{
    const base={date:currentTicketDate,city:'Дніпро',street:'вул. Робоча',house:'15',apartment:'27',address:'вул. Робоча 15, кв. 27',sum:450};
    tickets=[
      Object.assign(blankTicketObject(),base,{id:'compact-a',time:'10:00',type:'Ремонт',clientName:'Compact Alpha',content:'👤 Клієнт: Compact Alpha',tags:['ремонт']}),
      Object.assign(blankTicketObject(),base,{id:'compact-b',time:'11:00',type:'Підключення',street:'вул. Дуже-довга-назва-вулиці-для-перевірки-переносу',clientName:'Compact Beta',content:'👤 Клієнт: Compact Beta'})
    ];
    const saved=await saveTicketsLocalOnly();
    renderTicketsScreen();
    return saved;
  })).toBe(true);

  const ids=async selector=>page.locator(selector).evaluateAll(nodes=>nodes.map(node=>node.dataset.id));
  const revealActions=async()=>{
    await page.locator('.ticket-view-actions').evaluate(el=>el.scrollIntoView({block:'start'}));
    const geometry=await page.evaluate(()=>{
      const actions=document.querySelector('.ticket-view-actions').getBoundingClientRect();
      const fab=document.getElementById('addTicketFab').getBoundingClientRect();
      const nav=document.querySelector('nav.tabbar').getBoundingClientRect();
      const buttons=['showVizitkaBtn','ticketViewModeBtn'].map(id=>document.getElementById(id).getBoundingClientRect());
      const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      return {aboveNav:buttons.every(r=>r.top>=0&&r.bottom<=nav.top),clearOfFab:buttons.every(r=>!overlaps(r,fab)),noHorizontalScroll:document.documentElement.scrollWidth<=innerWidth,actionsVisible:actions.top>=0&&actions.bottom<=innerHeight};
    });
    expect(geometry).toEqual({aboveNav:true,clearOfFab:true,noHorizontalScroll:true,actionsVisible:true});
    await page.locator('#showVizitkaBtn').click({trial:true});
    await page.locator('#ticketViewModeBtn').click({trial:true});
  };
  const clickAction=async selector=>{await revealActions();await page.click(selector);};
  expect(await ids('#ticketList > .ticket-card')).toEqual(['compact-a','compact-b']);
  const fullHeight=(await page.locator('#ticketList > .ticket-card[data-id="compact-a"]').boundingBox()).height;
  expect(await page.evaluate(()=>{const list=document.getElementById('ticketList'),actions=document.querySelector('.ticket-view-actions'),dial=document.getElementById('quickDialCard');return !!(list.compareDocumentPosition(actions)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(actions.compareDocumentPosition(dial)&Node.DOCUMENT_POSITION_FOLLOWING);})).toBe(true);
  await expect(page.locator('#ticketViewModeBtn')).toHaveText('Компактно');
  await clickAction('#ticketViewModeBtn');
  await expect(page.locator('#ticketViewModeBtn')).toHaveText('Повний вигляд');
  expect(await ids('#ticketList > .ticket-compact-card')).toEqual(['compact-a','compact-b']);
  const first=page.locator('#ticketList > .ticket-compact-card[data-id="compact-a"]');
  await expect(first).toContainText('10:00');
  await expect(first.locator('.ticket-compact-type')).toHaveText('Ремонт');
  await expect(page.locator('#ticketList > .ticket-compact-card[data-id="compact-b"] .ticket-compact-type')).toHaveText('Підключення');
  await expect(first).toContainText('Дніпро, вул. Робоча, 15, кв. 27');
  await expect(first).toContainText('450 грн');
  await expect(first.locator('.ticket-view-expand-btn')).toBeVisible();
  const cardBox=await first.boundingBox(),addressBox=await first.locator('.ticket-compact-address').boundingBox();
  const priceBox=await first.locator('.ticket-compact-sum').boundingBox(),expandBox=await first.locator('.ticket-view-expand-btn').boundingBox();
  expect(cardBox.height).toBeLessThan(fullHeight);
  expect(priceBox.x).toBeGreaterThan(addressBox.x);
  expect(expandBox.x).toBeGreaterThan(addressBox.x);
  expect(expandBox.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#quickDialCard').evaluate(el=>el.classList.remove('hidden'));
  const actionsBox=await page.locator('.ticket-view-actions').boundingBox();
  const dialBox=await page.locator('#quickDialCard').boundingBox();
  expect(actionsBox.y-(await page.locator('#ticketList').boundingBox()).y-(await page.locator('#ticketList').boundingBox()).height).toBeGreaterThanOrEqual(10);
  expect(dialBox.y-(actionsBox.y+actionsBox.height)).toBeGreaterThanOrEqual(10);
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
  await clickAction('#ticketViewModeBtn');
  expect(await ids('#ticketList > .ticket-card')).toEqual(['compact-a']);
  await page.fill('#searchInput','');
  await expect(page.locator('#dateNavBlock')).toBeVisible();
  await page.click('#filterToggleBtn');
  await page.click('#tagFilterChips [data-tag="ремонт"]');
  expect(await ids('#ticketList > .ticket-card')).toEqual(['compact-a']);
  await clickAction('#ticketViewModeBtn');
  expect(await ids('#ticketList > .ticket-compact-card')).toEqual(['compact-a']);
  await page.click('#modeResetBtn');
  expect(await ids('#ticketList > .ticket-compact-card')).toEqual(['compact-a','compact-b']);

  await clickAction('#showVizitkaBtn');
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

test('first expand shows real delivery statuses under the address; compact row stays clean',async({page,appEnv})=>{
  await page.setViewportSize({width:320,height:740});
  const errors=await gotoApp(page,appEnv.url);
  await page.evaluate(()=>{
    settings.scriptUrl='https://script.google.com/macros/s/legacy-synthetic/exec';
    settings.tgBotToken='BOT';settings.tgBackupChatId='CHAT';
    settings.dispatcherReportEndpoint='https://script.google.com/macros/s/synthetic/exec';
    settings.dispatcherReportEnabled=true;
    tickets=[Object.assign(blankTicketObject(),{id:'status-a',date:currentTicketDate,time:'10:00',type:'Ремонт',city:'Дніпро',address:'вул. Робоча 15',sum:450,payment:'Готівка',content:'тест'})];
    saveSettings();renderTicketsScreen();
  });
  // E) Compact row: design unchanged, no delivery badges.
  await page.locator('#ticketViewModeBtn').click();
  const compact=page.locator('#ticketList > .ticket-compact-card[data-id="status-a"]');
  await expect(compact.locator('.tc-status-row')).toHaveCount(0);
  await expect(compact.locator('[data-dispatcher-ticket-status]')).toHaveCount(0);
  await expect(compact).toContainText('вул. Робоча 15');
  await expect(compact.locator('.ticket-view-expand-btn')).toBeVisible();
  // D) First expand: statuses UNDER the address, ABOVE the action buttons.
  await compact.locator('.ticket-view-expand-btn').click();
  const card=page.locator('#ticketList > .ticket-compact-expanded[data-id="status-a"] .ticket-card');
  await expect(card.locator('.tc-status-row')).toHaveCount(1);
  const order=await card.evaluate(el=>{
    const sub=el.querySelector('.tc-head .tc-sub')||el.querySelector('.tc-sub'),status=el.querySelector('.tc-status-row'),actions=el.querySelector('.tc-actions');
    const follows=(a,b)=>!!(a&&b&&(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING));
    return {subBeforeStatus:follows(sub,status),statusBeforeActions:follows(status,actions)};
  });
  expect(order).toEqual({subBeforeStatus:true,statusBeforeActions:true});
  const statusRow=card.locator('.tc-status-row');
  await expect(statusRow).toContainText('Таблиця');
  await expect(statusRow).toContainText('Таблиця Д');
  await expect(statusRow).toContainText('Telegram');
  // Real states only: a queued Таблиця Д operation is ⏳ and never ✅.
  const reportBadge=card.locator('[data-dispatcher-ticket-status]');
  await expect(reportBadge).toHaveAttribute('data-delivery-state','pending');
  await expect(reportBadge).toContainText('⏳');
  await expect(reportBadge).not.toContainText('✅');
  await expect(statusRow).toContainText('⏳');
  // Second expand: the full detailed card (level 2).
  const details=card.locator('.tc-details');
  await expect(details).toHaveClass(/tc-collapsed/);
  await card.locator('.tc-expand-btn').click();
  await expect(details).not.toHaveClass(/tc-collapsed/);
  await card.locator('.tc-expand-btn').click();
  await expect(details).toHaveClass(/tc-collapsed/);
  expect(errors).toEqual([]);
});

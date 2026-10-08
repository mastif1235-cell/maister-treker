'use strict';
const {test,expect,gotoApp}=require('./app-test');
test('note-first other and collapsed cards have no sync badges at 360/390/430px',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  await page.evaluate(()=>{
    tickets.push({id:'test-other-135',date:currentTicketDate,time:'12:00',type:'Інше',sum:0,otherNote:'Забрати ONU у абонента завтра після 12:00',city:'FORBIDDEN_ADDRESS',address:'FORBIDDEN_ADDRESS',equipment:[{label:'ONU',qty:1}],connectMasters:['FORBIDDEN_PARTNER'],diagnosticHistory:[{}]});
    tickets.push({id:'test-normal-135',date:currentTicketDate,time:'11:00',type:'Ремонт',sum:100,city:'Дніпро',address:'Різоля 7, кв. 88',equipment:[{label:'ONU',qty:0},{label:'Роутер',qty:1}],cables:[{label:'UTP',meters:37}],content:'🛠️ ONU: 1 шт. х 0 грн\n🛠️ Роутер: 1 шт. х 100 грн\n🔌 UTP: 37м',payment:'Готівка'});
    MTTicketCompactView.setMode('compact');renderTicketsScreen();
  });
  for(const width of [360,390,430]){
    await page.setViewportSize({width,height:900});
    await expect(page.locator('.ticket-compact-card')).toHaveCount(2);
    await expect(page.locator('.ticket-compact-card .tc-status-row')).toHaveCount(0);
    await expect(page.locator('.ticket-compact-card[data-id="test-other-135"]')).toContainText('Забрати ONU');
    await expect(page.locator('.ticket-compact-card[data-id="test-other-135"]')).not.toContainText('FORBIDDEN');
    expect(await page.locator('.ticket-compact-card').evaluateAll(cards=>cards.every(c=>c.scrollWidth<=c.clientWidth))).toBe(true);
  }
  await page.locator('.ticket-view-expand-btn[data-id="test-other-135"]').click();
  const note=page.locator('.ticket-card[data-id="test-other-135"]');
  await expect(note).not.toContainText('діагност');await expect(note).not.toContainText('Матеріали');await expect(note).not.toContainText('FORBIDDEN');
  await expect(note.locator('.edit-ticket-btn')).toBeVisible();await expect(note.locator('.share-ticket-btn')).toBeVisible();await expect(note.locator('.delete-ticket-btn')).toBeVisible();
  await page.locator('.ticket-view-expand-btn[data-id="test-normal-135"]').click();
  await page.locator('.tc-expand-btn[data-id="test-normal-135"]').click();
  const materials=page.locator('.ticket-card[data-id="test-normal-135"] .tc-materials');
  await expect(materials).toContainText('Роутер — 1 шт.');await expect(materials).toContainText('UTP — 37 м');await expect(materials).not.toContainText('ONU');
  expect(errors).toEqual([]);
});

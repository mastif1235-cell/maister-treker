'use strict';
const {test,expect,gotoApp}=require('./app-test');

test('quick dial stays tappable in two compact mobile columns',async({page,appEnv})=>{
  await page.setViewportSize({width:320,height:740});
  const errors=await gotoApp(page,appEnv.url);
  await page.evaluate(()=>{
    settings.quickDialContacts=[
      {name:'Оля',phone:'+380 67 111 22 33'},
      {name:'Диспетчер Олександр Великий',phone:'+380 67 222 33 44'},
      {name:'Марія',phone:'+380 67 333 44 55'},
      {name:'Черговий майстер',phone:'+380 67 444 55 66'}
    ];
    renderQuickDialButtons();
  });

  const card=page.locator('#quickDialCard');
  const links=card.locator('#quickDialButtons > a');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Швидкий набір');
  await expect(card).not.toContainText('Номери з Налаштувань');
  await expect(links).toHaveCount(4);
  await expect(links.nth(0)).toHaveAttribute('href','tel:+380671112233');
  await expect(links.nth(1)).toContainText('Диспетчер Олександр Великий');
  const boxes=await links.evaluateAll(nodes=>nodes.map(node=>{
    const rect=node.getBoundingClientRect();
    return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
  }));
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[2].y).toBe(boxes[3].y);
  expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
  expect(Math.abs(boxes[0].width-boxes[1].width)).toBeLessThan(1);
  expect(Math.abs(boxes[0].height-boxes[1].height)).toBeLessThan(1);
  expect(boxes.every(box=>box.height>=44)).toBe(true);
  expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

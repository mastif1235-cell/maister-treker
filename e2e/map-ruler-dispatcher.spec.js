'use strict';
const {test,expect,gotoApp}=require('./app-test');
for(const engine of ['maplibre','leaflet'])test(`ruler ${engine}: clicks, segments, undo, clear, exit, no stored objects`,async({page,appEnv})=>{
 const errors=await gotoApp(page,appEnv.url);
 if(engine==='leaflet')await page.evaluate(()=>history.replaceState(null,'','?mapEngine=leaflet'));
 await page.evaluate(()=>{tickets=[{id:'ruler-house',city:'Тест',street:'Тестова',house:'1',address:'Тестова 1',geoLat:48.45,geoLng:35.05,signal:'-23',content:'Тест',sum:0,date:'05.10.2026'}];});
 await page.click('.tab-btn[data-tab="tools"]');await page.locator('[data-tools-view="map"]').click();
 const toggle=page.locator('[data-ruler="toggle"]');await expect(toggle).toBeVisible();expect(await page.evaluate(()=>!!window.MTToolsMapLibreAdapter?.isMounted?.())).toBe(engine==='maplibre');
 const before=await page.evaluate(()=>JSON.stringify({tickets,points:toolsNetworkPoints}));
 await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
 const map=page.locator('#toolsLeafletMap');await map.scrollIntoViewIfNeeded();const box=await map.boundingBox();
 for(const [x,y] of [[.55,.4],[.65,.45],[.6,.55]])await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
 await expect.poll(()=>page.evaluate(()=>MTToolsMapRulerController().snapshot().points.length)).toBe(3);
 const measured=await page.evaluate(()=>{const s=MTToolsMapRulerController().snapshot();return{distance:s.distance,total:MTMapRuler.total(s.points)};});expect(measured.distance).toBeGreaterThan(0);expect(measured.distance).toBe(measured.total);await expect(page.locator('[data-ruler="distance"]')).toContainText(/м|км/);
 await page.locator('[data-ruler="undo"]').click();expect(await page.evaluate(()=>MTToolsMapRulerController().snapshot().points.length)).toBe(2);
 await page.locator('[data-ruler="clear"]').click();expect(await page.evaluate(()=>MTToolsMapRulerController().snapshot().distance)).toBe(0);await page.locator('[data-ruler="exit"]').click();await expect(toggle).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>JSON.stringify({tickets,points:toolsNetworkPoints}))).toBe(before);expect(errors).toEqual([]);
});

test('dispatcher copy/share/report hides geo/signal but leaves ticket data intact',async({page,appEnv})=>{
 await gotoApp(page,appEnv.url);
 const result=await page.evaluate(async()=>{
  const out=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>out.push(t)}});Object.defineProperty(navigator,'share',{configurable:true,value:async p=>out.push(p.text)});
  const t={id:'privacy-fixture',type:'Ремонт',date:'05.10.2026',time:'10:00',city:'Тест',address:'Тестова 1',sum:300,payment:'Готівка',geoLat:48.45,geoLng:35.05,signal:'-23',content:'Заявка\nАдреса: Тестова 1\nГеолокація: https://maps.app.goo.gl/private\nСигнал ONU: -23 dBm\nNote: Роботи виконано, geoLat: 48.45, geoLng: 35.05; ONU signal before: -25; after: -23\n300 грн'};tickets=[t];
  const before=JSON.stringify(t),comment='Комментарий: заменили ONU, signal -18 dBm, всё работает; latitude 48.45 longitude 35.05';
  await copyTicketCardText(t.id);await shareTicket(t.id);openReportModal();document.getElementById('reportFullToggle').checked=true;document.getElementById('reportCommentInput').value=comment;renderReport('all');await document.getElementById('copyReportBtn').onclick();await document.getElementById('shareReportBtn').onclick();
  return{out,geoLat:t.geoLat,geoLng:t.geoLng,signal:t.signal,content:t.content,unchanged:JSON.stringify(t)===before,commentUnchanged:document.getElementById('reportCommentInput').value===comment};
 });
 expect(result.out).toHaveLength(4);for(const text of result.out){expect(text).not.toMatch(/Геолокація|maps\.|dBm|Сигнал ONU|geoLat|geoLng|latitude|longitude|signal|48\.45|35\.05|-25|-23/);expect(text).toContain('Адреса: Тестова 1');expect(text).toContain('Роботи виконано');expect(text).toContain('300 грн');}
 for(const text of result.out.slice(2))expect(text).toContain('Комментарий: заменили ONU, всё работает');expect(result.unchanged).toBe(true);expect(result.commentUnchanged).toBe(true);
 expect(result.geoLat).toBe(48.45);expect(result.geoLng).toBe(35.05);expect(result.signal).toBe('-23');expect(result.content).toContain('Сигнал ONU');
});

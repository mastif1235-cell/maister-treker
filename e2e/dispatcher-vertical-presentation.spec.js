'use strict';
const {test,expect,gotoApp}=require('./app-test');

test('expanded card: materials before payment/total, no empty history, existing history preserved',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  const result=await page.evaluate(()=>{
    const ticket={id:'visual-fixture',date:'11.10.2026',time:'12:00',type:'Ремонт',sum:900,equipment:[{label:'ONU',qty:1,price:800}],cables:[{label:'UTP',meters:10,pricePerMeter:10}],content:'📋 Ремонт\n📍 Адреса: Тестова 4\n------------------\n💳 Оплата: Готівка\n💵 ІТОГО: 900 грн\n📝 Виконано',diagnosticHistory:[]};
    const before=JSON.stringify(ticket),empty=renderTicketCard(ticket);
    return {empty,unchanged:before===JSON.stringify(ticket),history:ticketDiagnosticHistoryHtml({diagnosticHistory:[{id:'visual-diag',timestamp:'2026-10-11T12:00:00.000Z',summaryStatus:'ok',result:{online:true,summaryStatus:'ok',resources:[]}}]})};
  });
  expect(result.unchanged).toBe(true);
  expect(result.empty).not.toContain('tc-diagnostic-history');
  expect(result.empty).not.toContain('------------------');
  expect(result.empty.indexOf('tc-materials')).toBeLessThan(result.empty.indexOf('Оплата:'));
  expect(result.empty.indexOf('UTP — 10 м — 100 грн')).toBeLessThan(result.empty.indexOf('ІТОГО:'));
  expect(result.history).toContain('Історія діагностик');
  expect(errors).toEqual([]);
});

test('generated sheet fixture: all statistics in mobile vertical flow',async({page,appEnv},testInfo)=>{
  const errors=await gotoApp(page,appEnv.url);
  const blocks=await page.evaluate(()=>{
    const normal={ticket_id:'visual-normal',work_date:'2026-10-11',work_time:'12:00',work_type:'Ремонт',work_category:'repair',city:'Тестове місто',address_display:'Тестова 4',partner_display:'Майстер',materials_display:'ONU — 1 шт. — 800 грн\nUTP — 10 м — 100 грн',mac_onu:'',payment_type:'Готівка',amount:900,total:900,onu_used:1,onu_replacement:0,router_used:0,payment_cash:900,payment_cashless:0,payment_free_amount:0,payment_free_count:0,dispatcher_comment:'Виконано'};
    return MTDispatcherReportCore.render([normal,{...normal,ticket_id:'visual-other',work_time:'13:00',work_type:'Інше',work_category:'other',dispatcher_comment:'Коротка тестова нотатка',amount:0,total:0,payment_cash:0,onu_used:0},{...normal,ticket_id:'visual-previous',work_date:'2026-10-10',work_time:'09:00'}]).layout.rows;
  });
  // Generated visual fixture, not a live Google Sheet. Text is the exact core
  // formatter output; GAS range/style application is covered by its VM tests.
  const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const colors={monthHeader:'#DCC4F4',day:'#FFE49C',ticket:'#FFF6E5',daily:'#E5F1FA',weekly:'#E6F2E2',monthly:'#EFE5F7'};
  const html='<html lang="uk"><meta charset="utf-8"><style>body{margin:8px;font:15px/1.5 Arial;color:#243447}main{width:380px;max-width:100%}section{white-space:pre-wrap;overflow-wrap:anywhere;padding:8px;border-bottom:1px solid #D8D8D8}section.monthHeader{text-align:center;font-size:20px}section.day{font-size:16px}strong{font-weight:bold}</style><main>'+blocks.map(b=>{const [title,...body]=b.text.split('\n');return '<section class="'+b.kind+'" style="background:'+colors[b.kind]+'"><strong>'+escape(title)+'</strong>'+ (body.length?'\n'+escape(body.join('\n')):'')+'</section>';}).join('')+'</main></html>';
  await page.setContent(html);
  await expect(page.locator('section.daily')).toHaveCount(2);
  await expect(page.locator('section.weekly')).toHaveCount(1);
  await expect(page.locator('section.monthly')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const boxes=await page.locator('section').evaluateAll(nodes=>nodes.map(n=>({kind:n.className,top:n.getBoundingClientRect().top,left:n.getBoundingClientRect().left})));
  for(let i=1;i<boxes.length;i++){expect(boxes[i].top).toBeGreaterThan(boxes[i-1].top);expect(boxes[i].left).toBe(boxes[0].left);}
  await page.screenshot({path:testInfo.outputPath('vertical-report-mobile.png'),fullPage:true});
  await testInfo.attach('Generated vertical report fixture',{body:html,contentType:'text/html'});
  expect(errors).toEqual([]);
});

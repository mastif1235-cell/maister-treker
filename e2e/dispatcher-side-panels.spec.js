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

test('generated sheet fixture: restored B:E side panels and thick ticket separators',async({page,appEnv},testInfo)=>{
  const errors=await gotoApp(page,appEnv.url);
  const layout=await page.evaluate(()=>{
    const normal={ticket_id:'visual-normal',work_date:'2026-10-07',work_time:'12:02',work_type:'Ремонт',work_category:'repair',city:'Миколаївка 1',address_display:'вул. Садова 31',partner_display:'Майстер',materials_display:'ONU — 1 шт. — 800 грн\nUTP — 10 м — 100 грн',mac_onu:'',payment_type:'Готівка',amount:100,total:1000,onu_used:1,onu_replacement:0,router_used:0,payment_cash:1000,payment_cashless:0,payment_free_amount:0,payment_free_count:0,dispatcher_comment:'Виконано'};
    return MTDispatcherReportCore.render([
      normal,
      {...normal,ticket_id:'visual-connection',work_time:'11:15',work_type:'Підключення',work_category:'connection',city:'Таромське',address_display:'пров. Лермонтова 13',materials_display:'ONU — 1 шт. — 800 грн\nРоутер — 1 шт. — 2300 грн',router_used:1,amount:400,total:3500,payment_cash:0,payment_cashless:3500,payment_type:'Безготівка'},
      {...normal,ticket_id:'visual-other',work_time:'09:40',work_type:'Інше',work_category:'other',dispatcher_comment:'Коротка тестова нотатка',amount:0,total:0,payment_cash:0,onu_used:0},
      {...normal,ticket_id:'visual-previous',work_date:'2026-10-06',work_time:'13:20',address_display:'вул. Центральна 12'},
      {...normal,ticket_id:'visual-second',work_date:'2026-10-06',work_time:'10:15',address_display:'вул. Нова 7',dispatcher_comment:''},
      {...normal,ticket_id:'visual-month-edge',work_date:'2026-10-01',work_time:'09:10'},
      {...normal,ticket_id:'visual-old-month',work_date:'2026-09-30',work_time:'16:00'}
    ]).layout;
  });
  // Generated fixture, NOT a live Sheet or a user-data mutation. The actual
  // core B:E coordinates are projected to table rowspans/colspans; GAS styling
  // (including real SOLID_THICK ticket borders) is independently VM-tested.
  const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const colors={topSpacer:'#FFFFFF',monthHeader:'#DCC4F4',day:'#FFE49C',ticket:'#FFF6E5',statsSpacer:'#FFF6E5',daily:'#E5F1FA',dailyHeader:'#C9DFEF',weekly:'#E6F2E2',weeklyHeader:'#C8DFBF',weeklyContinuation:'#E6F2E2',weeklyContinuationHeader:'#C8DFBF',monthly:'#EFE5F7',monthlyHeader:'#DCC9EA'};
  const covered=new Set(),starts=new Map();
  for(const s of layout.spans){
    starts.set(s.row+':'+s.column,s);
    for(let r=s.row;r<s.row+s.height;r++)for(let c=s.column;c<s.column+s.width;c++)if(r!==s.row||c!==s.column)covered.add(r+':'+c);
  }
  const body=layout.rows.map((b,i)=>{
    const r=i+1,lines=b.text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/48)),0);
    const height=b.kind==='topSpacer'?21:b.kind==='monthHeader'?44:b.kind==='day'?64:b.kind==='statsSpacer'?b.height:Math.max(58,lines*18+16);
    let cells='<td class="gutter"></td>';
    for(let c=2;c<=5;c++){
      if(covered.has(r+':'+c))continue;
      const s=starts.get(r+':'+c),kind=s?s.kind:c===2?b.kind:'empty',text=s?s.text:c===2?b.text:'';
      const [title,...rest]=text.split('\n'),bold=kind==='ticket'||kind==='day'||/Header$/.test(kind);
      const content=bold?'<strong>'+escape(title)+'</strong>'+(rest.length?'\n'+escape(rest.join('\n')):''):escape(text);
      const separator=c===2&&b.kind==='ticket'&&i>0&&layout.rows[i-1].kind==='ticket';
      cells+='<td data-column="'+c+'" class="'+kind+(separator?' ticket-separator':'')+'" style="background:'+(colors[kind]||'#FFFFFF')+'" rowspan="'+(s?s.height:1)+'" colspan="'+(s?s.width:1)+'">'+content+'</td>';
    }
    return '<tr data-row="'+r+'" style="height:'+height+'px">'+cells+'</tr>';
  }).join('');
  const html='<html lang="uk"><meta charset="utf-8"><style>body{margin:12px;font:11pt/18px Arial;color:#243447}p{font:12px Arial;margin:0 0 8px}table{border-collapse:collapse;table-layout:fixed;width:1138px}td{box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;padding:7px;vertical-align:top;border:1px solid #E0D2B3}td.gutter{padding:0;border:0}td.monthHeader{text-align:center;vertical-align:middle;font-size:16pt;border:3px solid #233E69}td.day,td[class$="Header"]{font-size:12pt;border-bottom:3px solid #233E69}td.ticket-separator{border-top:3px solid #233E69}td.daily,td.weekly,td.weeklyContinuation,td.monthly{border:3px solid #233E69}td.statsSpacer{border-top:0}th{font:12px Arial;color:#666;background:#eee;padding:5px}</style><p>Візуальний тестовий макет B:E — не live Google Sheet</p><table><colgroup><col style="width:8px"><col style="width:380px"><col span="3" style="width:250px"></colgroup><thead><tr><th>A</th><th>B · Наряди</th><th>C · День</th><th>D · Тиждень</th><th>E · Місяць</th></tr></thead><tbody>'+body+'</tbody></table></html>';
  await page.setViewportSize({width:1200,height:900});
  await page.setContent(html);
  await expect(page.locator('td.ticket')).toHaveCount(7);
  await expect(page.locator('td.daily')).toHaveCount(4);
  await expect(page.locator('td.weekly')).toHaveCount(2);
  await expect(page.locator('td.weeklyContinuation')).toHaveCount(1);
  await expect(page.locator('td.monthly')).toHaveCount(2);
  await expect(page.locator('td.monthHeader[colspan="4"]')).toHaveCount(2);
  for(const [kind,column]of [['ticket',2],['daily',3],['weekly',4],['monthly',5]])await expect(page.locator('td.'+kind).first()).toHaveAttribute('data-column',String(column));
  const box=await page.locator('td.ticket').first().boundingBox(),daily=await page.locator('td.daily').first().boundingBox(),weekly=await page.locator('td.weekly').first().boundingBox(),monthly=await page.locator('td.monthly').first().boundingBox();
  expect(box.x).toBeLessThan(daily.x);expect(daily.x).toBeLessThan(weekly.x);expect(weekly.x).toBeLessThan(monthly.x);
  expect(daily.y).toBe(weekly.y);expect(weekly.y).toBe(monthly.y);
  expect(await page.locator('td.ticket-separator').count()).toBe(3);
  expect(await page.locator('td.ticket-separator').first().evaluate(n=>getComputedStyle(n).borderTopWidth)).toBe('3px');
  expect(await page.locator('table').innerText()).not.toMatch(/(?:-\s*){4}/);
  const ticketText=await page.locator('td.ticket').first().innerText();
  expect(ticketText.indexOf('Матеріали:')).toBeLessThan(ticketText.indexOf('Оплата:'));
  expect(ticketText.indexOf('Оплата:')).toBeLessThan(ticketText.indexOf('Разом:'));
  await page.screenshot({path:testInfo.outputPath('dispatcher-side-panels.png'),fullPage:true});
  await testInfo.attach('Generated restored B:E report fixture',{body:html,contentType:'text/html'});
  expect(errors).toEqual([]);
});

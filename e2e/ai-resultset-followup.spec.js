'use strict';
const {test,expect,gotoApp}=require('./app-test');
test('shown resultSet resolves voice address locally, preserves filters and survives browser reload',async({page,appEnv})=>{
 const qc={mode:'list',resolved_filters:{date_from:'01.10.2026',date_to:'05.10.2026',type:'Ремонт',coworker_exclude:'Женя',semantic:{entity:'onu',action:'install',profile:'onu_physical',category:'definite'}}};
 const rows=[{id:'RESULT_A',date:'05.10.2026',type:'Ремонт',address:'Карнаухівка, Вул Польова 14',content:'Synthetic A'},{id:'RESULT_B',date:'05.10.2026',type:'Ремонт',address:"ВЧ, Пам'ятна 3",content:'Synthetic B'}];
 let asks=0;
 await page.route('https://maister-tracker-mcp.mastif1235.workers.dev/ask',async route=>{
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  asks++;const body=route.request().postDataJSON();
  await route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({ai_contract_version:1,ok:true,answer:asks===1?'Знайдено 2 ONU на ремонтах.':'245 repairs',total:asks===1?2:245,shown:2,meta:{rounds:1},queryContext:qc,resultSet:asks===1?{version:1,id:'resultset-fixture',chatSessionId:body.context.chatSessionId,createdAt:Date.now(),expiresAt:Date.now()+600000,total:2,ticketIds:rows.map(r=>r.id)}:null,resultItems:rows.map(r=>({...r,ticket_id:r.id})),referentTickets:rows})});
 });
 const errors=await gotoApp(page,appEnv.url);
 await page.evaluate(async rows=>{tickets=rows;await saveTicketsLocalOnly();MTAI.storage.update({enabled:true,backendMode:'custom',backendUrl:MTAI.config.SHARED_BACKEND});MTAI.storage.setToken('synthetic-test');await mtSettingsSecretsFlushPending();MTAI.ui.open();},rows);
 const send=async q=>{await page.locator('#aiInput').fill(q);await page.locator('#aiSendBtn').click();await expect(page.locator('#aiSendBtn')).toBeEnabled();};
 await send('а ремонты Покажи пожалуйста');expect(asks).toBe(1);
 await send('Открой память на три');await expect(page.locator('.ai-msg-assistant').last().locator('[data-ai-ticket-card="RESULT_B"]')).toHaveCount(1);expect(asks).toBe(1);
 let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mtAiChatHistoryV1')));expect(saved.selectedTicketId).toBe('RESULT_B');expect(saved.messages.at(-1).queryContext).toEqual(qc);expect(saved.activeResultSet.ticketIds).toEqual(['RESULT_A','RESULT_B']);expect(saved.activeResultItems).toHaveLength(2);
 await page.reload();await page.waitForFunction(()=>__mtAppInitDone===true);await page.evaluate(()=>MTAI.ui.open());
 await send('открой первую');await expect(page.locator('.ai-msg-assistant').last().locator('[data-ai-ticket-card="RESULT_A"]')).toHaveCount(1);expect(asks).toBe(1);
 await send('открой вторую');await expect(page.locator('.ai-msg-assistant').last().locator('[data-ai-ticket-card="RESULT_B"]')).toHaveCount(1);expect(asks).toBe(1);
 await send('відкрий другу');await expect(page.locator('.ai-msg-assistant').last().locator('[data-ai-ticket-card="RESULT_B"]')).toHaveCount(1);expect(asks).toBe(1);
 await expect(page.locator('.ai-msg-assistant').last().getByRole('button',{name:'👤 Відкрити профіль',exact:true})).toBeVisible();
 saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mtAiChatHistoryV1')));expect(saved.messages.at(-1).meta.rounds).toBe(0);expect(saved.messages.at(-1).meta.toolCallsMade).toBe(0);expect(saved.messages.at(-1).queryContext).toEqual(qc);expect(errors).toEqual([]);
});

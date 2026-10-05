'use strict';
const {test,expect,gotoApp}=require('./app-test');
test('AI contract: incompatible response clears only AI session across real browser reload',async({page,appEnv})=>{
 const requests=[];let compatible=false;
 await page.route('https://maister-tracker-mcp.mastif1235.workers.dev/ask',async route=>{
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  requests.push(route.request().postDataJSON());
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({ok:true,...(compatible?{ai_contract_version:1}:{}),answer:compatible?'Fresh compatible answer':'MUST NOT DISPLAY',queryContext:{mode:'count',resolved_filters:{coworker:'Женя'}}})});
 });
 await gotoApp(page,appEnv.url);
 const open=()=>page.evaluate(async()=>{MTAI.storage.update({enabled:true,showInTools:true,backendMode:'custom',backendUrl:MTAI.config.SHARED_BACKEND});MTAI.storage.setToken('synthetic-ai-test');await mtSettingsSecretsFlushPending();MTAI.ui.open();});
 await open();
 await page.evaluate(()=>localStorage.setItem('contractNonAiSentinel','unchanged'));
 const send=async q=>{await page.locator('#aiInput').fill(q);await page.locator('#aiSendBtn').click();await expect(page.locator('#aiSendBtn')).toBeEnabled();};
 await send('Первоначальный вопрос');
 await expect(page.locator('#aiMessages')).toContainText('AI-модуль оновився');
 await expect(page.locator('#aiMessages')).not.toContainText('MUST NOT DISPLAY');
 expect(await page.evaluate(()=>localStorage.getItem('mtAiChatHistoryV1'))).toBeNull();
 compatible=true;
 await page.reload();await page.waitForFunction(()=>window.__mtAppInitDone===true);await open();
 await send('Новый первоначальный вопрос');
 await expect(page.locator('.ai-msg-assistant').last()).toContainText('Fresh compatible answer');
 expect(requests).toHaveLength(2);expect(requests[1].ai_contract_version).toBe(1);
 expect(requests[1].history).toEqual([]);expect(requests[1].context.queryContext).toBeUndefined();
 expect(requests[1].context.chatSessionId).not.toBe(requests[0].context.chatSessionId);
 expect(await page.evaluate(()=>localStorage.getItem('contractNonAiSentinel'))).toBe('unchanged');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mtAiChatHistoryV1')).ai_contract_version)).toBe(1);
});
